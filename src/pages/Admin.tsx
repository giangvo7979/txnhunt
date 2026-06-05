import { useState } from 'react';
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
} from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { pickRandomTransaction, buildHint, serializeHint, type TxnMeta } from '../lib/tatum';
import { generateSalt, computeDigestHash, bytesToHex } from '../lib/crypto';
import { walrusUploadJSON } from '../lib/walrus';
import {
  buildCreateSessionTx,
  buildResetLeaderboardTx,
  buildAddAdminTx,
  buildRemoveAdminTx,
  findAdminCap,
  fetchGameConfig,
  fetchSessionObjectId,
  fetchRoundHistory,
  type OnChainRoundHistory,
} from '../lib/contract';
import { getOwnedObjects } from '../lib/suiClient';
import { gsCreateRound } from '../lib/googleScript';
import {
  PACKAGE_ID,
  SUPER_ADMIN,
  DURATION_MS,
  DIFFICULTY_LABELS,
  BLOCK_RANGE_WIDTH,
  DIFFICULTY_POINTS,
  SUISCAN_TX_URL,
  WALRUS_AGGREGATOR,
} from '../lib/constants';

type Step = 'idle' | 'running' | 'done' | 'error';

export default function Admin({
  isSuperAdmin = false,
  adminList = [],
  onAdminChange = () => {},
}: {
  isSuperAdmin?: boolean;
  adminList?: string[];
  onAdminChange?: () => void;
}) {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [difficulty, setDifficulty] = useState(1);
  const [step, setStep]       = useState<Step>('idle');
  const [log, setLog]         = useState<string[]>([]);
  const [error, setError]     = useState('');
  const [txDigest, setTxDigest] = useState('');
  const [walrusBlobId, setWalrusBlobId] = useState('');
  const [roundId, setRoundId] = useState(0);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<OnChainRoundHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [newAdminInput, setNewAdminInput] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

  const addLog = (msg: string) => setLog(p => [...p, msg]);

  async function handleCreate() {
    if (!account) return;
    setStep('running'); setError(''); setLog([]);

    try {
      addLog('🔍 Fetching random transaction from Tatum...');
      const txnMeta: TxnMeta = await pickRandomTransaction();
      addLog(`✓ Txn: ${txnMeta.digest.slice(0, 20)}... (checkpoint ${txnMeta.checkpoint})`);

      addLog('📡 Reading session_counter from chain...');
      const config = await fetchGameConfig();
      if (!config) throw new Error('Could not fetch GameConfig');
      const nextCounter = config.session_counter + 1;
      addLog(`✓ Next round: #${nextCounter}`);

      const salt        = generateSalt();
      const saltHex     = bytesToHex(salt);
      const digestHash  = await computeDigestHash(txnMeta.digest, salt);
      addLog(`✓ Salt & hash generated`);

      const hint     = buildHint(txnMeta, difficulty);
      const hintJson = serializeHint(hint);
      const expiresAt = Date.now() + DURATION_MS[difficulty];

      addLog('🐋 Uploading round info to Walrus...');
      const roundInfo = {
        round_id:       nextCounter,
        difficulty,
        difficulty_label: DIFFICULTY_LABELS[difficulty],
        block_num:      txnMeta.checkpoint,
        digest:         txnMeta.digest,
        expires_at:     expiresAt,
        created_at:     new Date().toISOString(),
        hint: {
          block_start: hint.blockStart,
          block_end:   hint.blockEnd,
          sender_suffix: hint.senderSuffix,
        },
      };
      const walrusResult = await walrusUploadJSON(
        (args) => signAndExecute({ transaction: args.transaction as Transaction }),
        account.address,
        roundInfo,
        { epochs: 5 },
      );
      addLog(`✓ Walrus blobId: ${walrusResult.blobId.slice(0, 20)}...`);
      setWalrusBlobId(walrusResult.blobId);

      addLog('🔑 Finding AdminCap...');
      const adminCapId = await findAdminCap(account.address);
      if (!adminCapId) throw new Error('AdminCap not found in wallet');

      addLog('⛓ Creating session on-chain...');
      const createTx = buildCreateSessionTx({
        adminCapId,
        digestHash,
        difficulty,
        blobId:    walrusResult.blobId,
        hint:      hintJson,
        blockNum:  txnMeta.checkpoint,
        expiresAt,
      });
      const createResult = await signAndExecute({ transaction: createTx });
      const createDigest = (createResult as { digest?: string }).digest ?? '';
      addLog(`✓ Session on-chain OK. Tx: ${createDigest.slice(0, 20)}...`);
      setTxDigest(createDigest);

      addLog('⏳ Waiting for indexer + fetching session object ID...');
      await new Promise(r => setTimeout(r, 2500));
      let sessionObjId = await fetchSessionObjectId(createDigest);
      if (!sessionObjId) {
        await new Promise(r => setTimeout(r, 2500));
        sessionObjId = await fetchSessionObjectId(createDigest);
      }
      if (!sessionObjId) throw new Error('Could not retrieve session object ID');
      addLog(`✓ Session object ID: ${sessionObjId.slice(0, 20)}...`);

      addLog('⏳ Waiting...');
      await gsCreateRound({
        roundId:      nextCounter,
        digest:       txnMeta.digest,
        blobId:       walrusResult.blobId,
        sessionObjId: sessionObjId,
        difficulty,
        blockNum:     txnMeta.checkpoint,
        salt:         saltHex,
        txDigest:     createDigest,
      });

      setRoundId(nextCounter);
      addLog(`\n✅ Round #${nextCounter} is live! Players can start hunting.`);
      setStep('done');
    } catch (e) {
      setError(String(e));
      setStep('error');
    }
  }

  async function handleResetLeaderboard() {
    if (!account || !confirm('Reset the entire leaderboard?')) return;
    try {
      const objects = await getOwnedObjects(
        account.address,
        `${PACKAGE_ID}::leaderboard::LeaderboardAdminCap`,
      );
      const lbCapId = objects[0]?.objectId;
      if (!lbCapId) throw new Error('LeaderboardAdminCap not found in wallet');
      const tx = buildResetLeaderboardTx(lbCapId);
      await signAndExecute({ transaction: tx });
      alert('Leaderboard has been reset!');
    } catch (e) {
      alert(`Error: ${e}`);
    }
  }

  async function handleAddAdmin() {
    const addr = newAdminInput.trim();
    if (!addr || !addr.startsWith('0x')) { alert('Invalid address'); return; }
    setAdminLoading(true);
    try {
      const tx = buildAddAdminTx(addr);
      await signAndExecute({ transaction: tx });
      setNewAdminInput('');
      await new Promise(r => setTimeout(r, 2000));
      onAdminChange();
    } catch (e) { alert(`Error: ${e}`); }
    finally { setAdminLoading(false); }
  }

  async function handleRemoveAdmin(addr: string) {
    if (!confirm(`Remove admin ${addr.slice(0,10)}...${addr.slice(-6)}?`)) return;
    setAdminLoading(true);
    try {
      const tx = buildRemoveAdminTx(addr);
      await signAndExecute({ transaction: tx });
      await new Promise(r => setTimeout(r, 2000));
      onAdminChange();
    } catch (e) { alert(`Error: ${e}`); }
    finally { setAdminLoading(false); }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const rounds = await fetchRoundHistory();
      setHistory(rounds);
    } catch (e) {
      alert(`Failed to load history: ${e}`);
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1 className="page-title"><span className="title-accent">ADMIN</span> PANEL</h1>
        <div className="admin-header-right">
          <p className="wallet-badge mono">{account?.address.slice(0, 8)}...{account?.address.slice(-6)}</p>
          <button className="btn btn-secondary small" onClick={handleResetLeaderboard}>
            🗑 Reset Leaderboard
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`tab-btn ${!showHistory ? 'active' : ''}`}
          onClick={() => setShowHistory(false)}
        >
          ⚡ Create Round
        </button>
        <button
          className={`tab-btn ${showHistory ? 'active' : ''}`}
          onClick={() => { setShowHistory(true); loadHistory(); }}
        >
          📋 Round History
        </button>
      </div>

      {/* ── Tab: Create Round ── */}
      {!showHistory && (
        <>
          {(step === 'idle' || step === 'error') && (
            <div className="card create-card">
              <h2 className="card-title">Create New Round</h2>
              <p className="create-desc">
                The system will: pick a random txn from Tatum → upload round info to Walrus →
                create an on-chain session → store digest + salt in Google Apps Script.
              </p>
              <div className="difficulty-selector">
                <label className="field-label">SELECT DIFFICULTY</label>
                <div className="diff-buttons">
                  {[1, 2, 3].map((d) => (
                    <button
                      key={d}
                      className={`diff-btn diff-${d} ${difficulty === d ? 'active' : ''}`}
                      onClick={() => setDifficulty(d)}
                    >
                      <span className="diff-name">{DIFFICULTY_LABELS[d]}</span>
                      <span className="diff-meta">
                        {BLOCK_RANGE_WIDTH[d]} blocks · {DURATION_MS[d] / 3600000}h · {DIFFICULTY_POINTS[d]}pt
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary btn-large" onClick={handleCreate} disabled={!account}>
                ⚡ CREATE SESSION
              </button>
              {error && <div className="error-box">❌ {error}</div>}
            </div>
          )}

          {step === 'running' && (
            <div className="card log-card">
              <h2 className="card-title">Processing...</h2>
              <div className="log-output">
                {log.map((l, i) => <div key={i} className="log-line"><span className="log-arrow">›</span> {l}</div>)}
                <div className="log-line blink">▌</div>
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="card success-card">
              <div className="success-icon">✅</div>
              <h2 className="card-title">Round #{roundId} is Live!</h2>
              <p className="success-msg">Players can now start hunting the transaction.</p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, textAlign: 'left' }}>
                <div className="mono-field">
                  <span className="field-label">Difficulty</span>
                  <span className={`diff-badge diff-${difficulty}`}>{DIFFICULTY_LABELS[difficulty]}</span>
                </div>
                <div className="mono-field">
                  <span className="field-label">Create Session Tx</span>
                  <a href={SUISCAN_TX_URL(txDigest)} target="_blank" rel="noreferrer" className="field-value mono small link">
                    {txDigest.slice(0, 20)}... ↗
                  </a>
                </div>
                <div className="mono-field">
                  <span className="field-label">Walrus Round Info</span>
                  <a href={`${WALRUS_AGGREGATOR}/blobs/${walrusBlobId}`} target="_blank" rel="noreferrer" className="field-value mono small link">
                    {walrusBlobId.slice(0, 20)}... ↗
                  </a>
                </div>
              </div>

              <div className="log-output" style={{ maxHeight: 180, overflow: 'auto', marginBottom: 16 }}>
                {log.map((l, i) => <div key={i} className="log-line"><span className="log-arrow">›</span> {l}</div>)}
              </div>
              <button className="btn btn-primary" onClick={() => { setStep('idle'); setLog([]); }}>
                + New Round
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Tab: History ── */}
      {showHistory && (
        <div className="card history-card">
          <div className="history-header">
            <h2 className="card-title" style={{ marginBottom: 0 }}>Round History</h2>
            <button className="btn btn-secondary small" onClick={loadHistory} disabled={loadingHistory}>
              {loadingHistory ? '...' : '↻ Refresh'}
            </button>
          </div>

          {loadingHistory && <div className="loading-row">Loading...</div>}

          {!loadingHistory && history.length === 0 && (
            <p className="lb-empty">No rounds found.</p>
          )}

          {!loadingHistory && history.length > 0 && (
            <div className="history-list">
              {history.map(r => (
                <div key={r.round_id} className={`history-row ${r.winner ? 'minted' : ''}`}>
                  <div className="history-round">
                    <span className="history-id">#{r.round_id}</span>
                    <span className={`diff-badge diff-${r.difficulty} small`}>{DIFFICULTY_LABELS[r.difficulty]}</span>
                    {r.winner && <span className="minted-badge">✅ MINTED</span>}
                  </div>
                  <div className="history-meta">
                    <span>Block {r.block_num.toLocaleString()}</span>
                    <span>{new Date(r.created_at).toLocaleString('en-US')}</span>
                  </div>
                  {r.winner && (
                    <div className="history-winner">
                      🏆 {r.winner.slice(0, 8)}...{r.winner.slice(-6)}
                    </div>
                  )}
                  <div className="history-links">
                    {r.blob_id && (
                      <a
                        href={`${WALRUS_AGGREGATOR}/blobs/${r.blob_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="history-link"
                      >
                        Walrus ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Admin Management (super admin only) ── */}
      {isSuperAdmin && (
        <div className="card" style={{ marginTop: 8 }}>
          <h2 className="card-title">👑 Admin Management</h2>
          <div className="history-list">
            <div className="history-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="mono small">{SUPER_ADMIN.slice(0, 10)}...{SUPER_ADMIN.slice(-6)}</span>
              <span className="minted-badge">👑 Super Admin</span>
            </div>
            {adminList.map(addr => (
              <div key={addr} className="history-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="mono small">{addr.slice(0, 10)}...{addr.slice(-6)}</span>
                <button
                  className="btn btn-secondary small"
                  onClick={() => handleRemoveAdmin(addr)}
                  disabled={adminLoading}
                >
                  🗑 Remove
                </button>
              </div>
            ))}
            {adminList.length === 0 && (
              <p className="lb-empty">No sub-admins yet.</p>
            )}
          </div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              className="digest-input mono"
              style={{ flex: 1 }}
              placeholder="0x new wallet address..."
              value={newAdminInput}
              onChange={e => setNewAdminInput(e.target.value)}
            />
            <button
              className="btn btn-primary"
              onClick={handleAddAdmin}
              disabled={adminLoading || !newAdminInput}
            >
              {adminLoading ? '...' : '+ Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
