import { useState, useEffect } from 'react';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useCountdown } from '../hooks/useCountdown';
import { deserializeHint } from '../lib/tatum';
import { walrusUploadJSON, walrusBlobUrl } from '../lib/walrus';
import { gsVerifyDigest, gsGetCurrentRound, type RoundInfo } from '../lib/googleScript';
import {
  fetchSession,
  fetchCurrentSessionId,
  fetchLeaderboard,
  findAllowlistCap,
  buildSubmitAnswerTx,
  buildMintNftTx,
  type Session,
  type ScoreEntry,
} from '../lib/contract';
import {
  DIFFICULTY_LABELS,
  SUISCAN_BLOCK_URL,
  WALRUS_AGGREGATOR,
  NFT_IMAGE_BLOBS,
  LOCKED_IMAGE_BLOB,
} from '../lib/constants';

import { waitForTransaction } from '../lib/suiClient';

type GameStep =
  | 'loading'
  | 'hunt'
  | 'verifying'
  | 'submitting'
  | 'unlocked'
  | 'minting'
  | 'minted'
  | 'winner_taken'
  | 'expired'
  | 'error';

export default function Play() {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [session, setSession]         = useState<Session | null>(null);
  const [step, setStep]               = useState<GameStep>('loading');
  const [digest, setDigest]           = useState('');
  const [error, setError]             = useState('');
  const [mintedNftBlobId, setMintedNftBlobId] = useState('');
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [capId, setCapId]             = useState<string | null>(null);
  const [roundInfo, setRoundInfo]     = useState<RoundInfo | null>(null);
  const [sessionObjId, setSessionObjId] = useState('');
  const [saltHex, setSaltHex]         = useState('');
  const [winnerWallet, setWinnerWallet] = useState<string | null>(null);

  useEffect(() => {
    loadSession();
    fetchLeaderboard().then(setLeaderboard);
  }, []);

  useEffect(() => {
    if (!account || !session) return;
    findAllowlistCap(account.address, session.session_id).then(id => {
      if (id) { setCapId(id); setStep('unlocked'); }
    });
  }, [account, session]);

  async function loadSession(skipIfMinted = false) {
    setStep('loading');
    try {
      const id = await fetchCurrentSessionId();
      if (!id) { setError('No active round. Admin needs to create one first.'); setStep('error'); return; }
      const s = await fetchSession(id);
      if (!s) { setError('Session not found.'); setStep('error'); return; }
      setSession(s);
      setSessionObjId(s.id);

      if (s.minted) {
        if (skipIfMinted) return;
        const roundStatus = await gsGetCurrentRound(s.session_id);
        setWinnerWallet(roundStatus?.winnerWallet ?? null);
        if (roundStatus?.blobId) {
          setRoundInfo({
            round_id: s.session_id,
            difficulty: s.difficulty,
            block_num: s.block_num,
            walrus_blob_id: roundStatus.blobId,
          });
        }
        setStep('winner_taken');
        return;
      }
      if (Date.now() >= s.expires_at) { setStep('expired'); return; }
      setStep('hunt');
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }

  const countdown = useCountdown(session?.expires_at ?? Date.now() + 9999999);

  async function handleSubmit() {
    if (!account || !session || !digest.trim()) return;
    const trimmed = digest.trim();
    setStep('verifying');
    setError('');

    try {
      const verifyResult = await gsVerifyDigest(
        session.session_id,
        trimmed,
        account.address,
      );

      if (!verifyResult.approved) {
        const msg = verifyResult.reason === 'already_used'
          ? 'Someone solved it first! 😔 Wait for the next round.'
          : 'Incorrect digest. Try again!';
        setError(msg);
        setStep('hunt');
        return;
      }

      setSaltHex(verifyResult.salt);
      setRoundInfo(verifyResult.roundInfo);

      setStep('submitting');

      const submitTx = buildSubmitAnswerTx({
        sessionId: verifyResult.sessionObjId,
        digest:    trimmed,
        salt:      verifyResult.salt,
      });
      const result = await signAndExecute({ transaction: submitTx });
      await waitForTransaction(result.digest);
      const cap = await findAllowlistCap(account.address, session.session_id);
      if (!cap) throw new Error('AllowlistCap not found — retry in a few seconds');

      setCapId(cap);
      setStep('unlocked');
    } catch (e) {
      const msg = String(e);
      if (msg.includes('E_SESSION_EXPIRED'))  setError('Time is up!');
      else if (msg.includes('E_ALREADY_MINTED'))  setError('This round already has a winner!');
      else if (msg.includes('E_ALREADY_SOLVED'))  setError('Someone solved it before you! 😔');
      else if (msg.includes('E_WRONG_DIGEST'))    setError('Hash verification failed. Contact admin.');
      else setError(`Error: ${msg}`);
      setStep('hunt');
    }
  }

  async function handleMint() {
    if (!account || !session || !capId || !sessionObjId) return;
    setStep('minting');
    setError('');

    try {
      const imgBlobId = NFT_IMAGE_BLOBS[session.difficulty] ?? '';
      const imgUrl    = `${WALRUS_AGGREGATOR}/blobs/${imgBlobId}`;

      const metadata = {
        name:        `TxnHunt #${session.session_id} — ${DIFFICULTY_LABELS[session.difficulty]}`,
        description: `Solved block ${session.block_num} on Sui mainnet.`,
        image:       imgUrl,
        attributes:  [
          { trait_type: 'Difficulty', value: DIFFICULTY_LABELS[session.difficulty] },
          { trait_type: 'Block',      value: String(session.block_num) },
          { trait_type: 'Points',     value: [1, 1, 2, 3][session.difficulty] ?? 1 },
          { trait_type: 'Session',    value: session.session_id },
          { trait_type: 'Solved At',  value: new Date().toISOString() },
          { trait_type: 'Round Info Walrus', value: roundInfo?.walrus_blob_id ?? '' },
        ],
      };

      const { blobId: metaBlobId } = await walrusUploadJSON(
        (args) => signAndExecute({ transaction: args.transaction as Transaction }),
        account.address,
        metadata,
        { epochs: 5 },
      );

      const mintTx = buildMintNftTx({ sessionId: sessionObjId, capId, metadataBlobId: metaBlobId });
      await signAndExecute({ transaction: mintTx });

      setMintedNftBlobId(metaBlobId);
      setStep('minted');

      await new Promise(r => setTimeout(r, 4000));
      fetchLeaderboard().then(setLeaderboard);

      setTimeout(() => loadSession(true), 1000);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('E_ALREADY_MINTED')) setError('Someone else minted first! 😔');
      else setError(msg);
      setStep('unlocked');
    }
  }

  const hint         = session ? deserializeHint(session.hint) : null;
  const nftImageUrl  = session ? walrusBlobUrl(NFT_IMAGE_BLOBS[session.difficulty] ?? '') : '';
  const lockedImgUrl = walrusBlobUrl(LOCKED_IMAGE_BLOB);

  return (
    <div className="play-page">
      <div className="play-layout">

        {/* ── LEFT: Game panel ── */}
        <div className="game-panel">

          {step === 'loading' && (
            <div className="card loading-card">
              <div className="spinner" />
              <p>Loading round...</p>
            </div>
          )}

          {step === 'error' && (
            <div className="card error-card">
              <div className="error-icon">⚠️</div>
              <h2>No Active Round</h2>
              <p style={{ color: 'var(--text-sub)', marginTop: 8 }}>{error || 'Admin has not created a session yet.'}</p>
            </div>
          )}

          {step === 'expired' && (
            <div className="card expired-card">
              <div className="expired-icon">⏰</div>
              <h2>Round Expired</h2>
              <p style={{ color: 'var(--text-sub)', marginTop: 8 }}>Time ran out with no winner.</p>
              <p className="status-sub" style={{ marginTop: 6 }}>Wait for admin to create a new round.</p>
            </div>
          )}

          {/* ── Round already won ── */}
          {step === 'winner_taken' && session && (
            <div className="card winner-taken-card">
              <span className="winner-trophy">🏆</span>
              <h2 className="winner-title">Round Completed!</h2>
              <p className="winner-desc">Round #{session.session_id} has been solved.</p>

              {winnerWallet && (
                <div className="winner-info">
                  <span className="winner-label">Winner</span>
                  <span className="winner-wallet mono">
                    {winnerWallet.slice(0, 8)}...{winnerWallet.slice(-6)}
                  </span>
                </div>
              )}

              {roundInfo?.walrus_blob_id && (
                <div className="winner-walrus">
                  <a
                    href={`${WALRUS_AGGREGATOR}/blobs/${roundInfo.walrus_blob_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary small"
                  >
                    🐋 View Round Info on Walrus ↗
                  </a>
                </div>
              )}

              <div className="waiting-next">
                <div className="waiting-icon">⏳</div>
                <p>Waiting for admin to start the next round...</p>
              </div>
            </div>
          )}

          {/* ── Active game ── */}
          {session && hint && !['loading', 'error', 'expired', 'winner_taken'].includes(step) && (
            <>
              {/* Header */}
              <div className="session-header">
                <div className={`diff-badge diff-${session.difficulty} large`}>
                  {DIFFICULTY_LABELS[session.difficulty]}
                </div>
                <div className={`countdown ${countdown.expired ? 'expired' : ''}`}>
                  <span className="countdown-label">TIME LEFT</span>
                  <span className="countdown-value">{countdown.formatted}</span>
                </div>
              </div>

              {/* NFT Image */}
              <div className="nft-image-container">
                {['unlocked', 'minting', 'minted'].includes(step) ? (
                  <>
                    {/* Congrats banner ABOVE the image */}
                    <div className="congrats-banner">
                      <div className="congrats-text">🎉 TRANSACTION FOUND!</div>
                      {roundInfo && (
                        <div className="walrus-proof">
                          <div className="walrus-proof-title">📦 Proof stored on Walrus</div>
                          <div className="walrus-proof-grid">
                            <div className="walrus-proof-item">
                              <span className="wp-label">Round ID</span>
                              <span className="wp-value mono">#{roundInfo.round_id}</span>
                            </div>
                            <div className="walrus-proof-item">
                              <span className="wp-label">Difficulty</span>
                              <span className={`diff-badge diff-${roundInfo.difficulty} small`}>
                                {DIFFICULTY_LABELS[roundInfo.difficulty]}
                              </span>
                            </div>
                            <div className="walrus-proof-item">
                              <span className="wp-label">Block</span>
                              <span className="wp-value mono">{roundInfo.block_num.toLocaleString()}</span>
                            </div>
                          </div>
                          {roundInfo.walrus_blob_id && (
                            <a
                              href={`${WALRUS_AGGREGATOR}/blobs/${roundInfo.walrus_blob_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="walrus-proof-link"
                            >
                              🔗 View on Walrus ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Image wrapper — clean, no overlay */}
                    <div className="nft-image-wrapper unlocked">
                      <img src={nftImageUrl} alt="TxnHunt NFT" className="nft-preview-img" />
                      <div className="unlock-badge">🔓 UNLOCKED</div>
                    </div>
                  </>
                ) : (
                  <div className="nft-image-wrapper locked">
                    <img src={lockedImgUrl} alt="Locked" className="nft-preview-img" />
                    <div className="lock-overlay">
                      <span className="lock-icon">🔒</span>
                      <span className="lock-text">Find the correct transaction to unlock</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Hint card */}
              {!['unlocked', 'minting', 'minted'].includes(step) && (
                <div className="card hint-card">
                  <h2 className="card-title">🔍 CLUES</h2>
                  <div className="hint-list">
                    <div className="hint-item">
                      <span className="hint-label">Block range</span>
                      <span className="hint-value mono">
                        {hint.blockStart.toLocaleString()} – {hint.blockEnd.toLocaleString()}
                      </span>
                    </div>
                    <div className="hint-item">
                      <span className="hint-label">Sender ends with</span>
                      <span className="hint-value mono">{hint.senderSuffix}</span>
                    </div>
                    {hint.timestampPrecise && (
                      <div className="hint-item">
                        <span className="hint-label">Timestamp</span>
                        <span className="hint-value mono">{hint.timestampPrecise}</span>
                      </div>
                    )}
                    {hint.timestampHourMin && (
                      <div className="hint-item">
                        <span className="hint-label">Time (HH:MM UTC)</span>
                        <span className="hint-value mono">{hint.timestampHourMin}</span>
                      </div>
                    )}
                    {hint.txType && (
                      <div className="hint-item">
                        <span className="hint-label">Transaction type</span>
                        <span className="hint-value mono">{hint.txType}</span>
                      </div>
                    )}
                    {session.has_solver && (
                      <div className="hint-item solver-taken">
                        <span className="hint-label">⚠️ Status</span>
                        <span className="hint-value">Solved — waiting to mint</span>
                      </div>
                    )}
                  </div>
                  <div className="explorer-links">
                    <span className="explorer-label">Search on:</span>
                    <a href={SUISCAN_BLOCK_URL(String(hint.blockStart))} target="_blank" rel="noreferrer" className="explorer-link">SuiScan ↗</a>
                    <a href={`https://suivision.xyz/checkpoint/${hint.blockStart}`} target="_blank" rel="noreferrer" className="explorer-link">SuiVision ↗</a>
                  </div>
                </div>
              )}

              {/* Hunt — enter digest */}
              {step === 'hunt' && (
                <div className="card submit-card">
                  <h2 className="card-title">📋 SUBMIT ANSWER</h2>
                  <p className="submit-desc">Enter the transaction digest below:</p>
                  <div className="input-group">
                    <input
                      className="digest-input mono"
                      placeholder="9buEr3qCp14kZMDJvrd..."
                      value={digest}
                      onChange={e => setDigest(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                    />
                    <button
                      className="btn btn-primary"
                      onClick={handleSubmit}
                      disabled={!digest.trim() || countdown.expired}
                    >
                      CONFIRM
                    </button>
                  </div>
                  {error && <div className="error-box">❌ {error}</div>}
                </div>
              )}

              {/* Verifying */}
              {step === 'verifying' && (
                <div className="card status-card">
                  <div className="spinner" />
                  <p>Verifying digest...</p>
                  <p className="status-sub">Please wait</p>
                </div>
              )}

              {/* Submitting on-chain */}
              {step === 'submitting' && (
                <div className="card status-card">
                  <div className="spinner" />
                  <p>Writing on-chain...</p>
                  <p className="status-sub">Confirm in your wallet</p>
                </div>
              )}

              {/* Unlocked — Mint NFT */}
              {(step === 'unlocked' || step === 'minting') && (
                <div className="card unlocked-card">
                  <h2 className="card-title">🎉 CORRECT ANSWER!</h2>
                  <p className="unlocked-desc">
                    You're first! Mint your NFT before someone else does.
                  </p>
                  <button
                    className="btn btn-primary btn-gold btn-large"
                    onClick={handleMint}
                    disabled={step === 'minting' || countdown.expired}
                  >
                    {step === 'minting' ? '⏳ Minting...' : '⚡ MINT NFT'}
                  </button>
                  {error && <div className="error-box">❌ {error}</div>}
                </div>
              )}

              {/* Minted */}
              {step === 'minted' && (
                <div className="card minted-card">
                  <div className="minted-glow" />
                  <div className="nft-preview">
                    <img src={nftImageUrl} alt="TxnHunt NFT" className="nft-image" />
                  </div>
                  <h2 className="card-title minted-title">🏆 YOU WON!</h2>
                  <p className="minted-name">TxnHunt #{session.session_id} — {DIFFICULTY_LABELS[session.difficulty]}</p>
                  <p className="minted-sub">NFT minted to your wallet!</p>
                  {mintedNftBlobId && (
                    <a href={`${WALRUS_AGGREGATOR}/blobs/${mintedNftBlobId}`} target="_blank" rel="noreferrer" className="btn btn-secondary small">
                      View Metadata on Walrus ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── RIGHT: Leaderboard ── */}
        <div className="leaderboard-panel">
          <div className="card leaderboard-card">
            <h2 className="card-title">🏅 LEADERBOARD</h2>
            <p className="lb-subtitle">All-time Hall of Fame</p>
            {leaderboard.length === 0 ? (
              <p className="lb-empty">No entries yet. Be the first!</p>
            ) : (
              <div className="lb-list">
                {leaderboard.slice(0, 10).map((e, i) => (
                  <div key={e.wallet} className={`lb-row ${i === 0 ? 'lb-first' : ''}`}>
                    <span className="lb-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                    <span className="lb-wallet mono">{e.wallet.slice(0,6)}...{e.wallet.slice(-4)}</span>
                    <span className="lb-pts">{e.points}pt</span>
                    <span className="lb-nfts">{e.nft_count} NFT{e.nft_count !== 1 ? 's' : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}