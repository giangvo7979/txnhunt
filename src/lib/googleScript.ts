import { GOOGLE_SCRIPT_URL, GOOGLE_ADMIN_KEY } from './constants';

export async function gsCreateRound(params: {
  roundId: number;
  digest: string;
  blobId: string;
  sessionObjId: string;
  difficulty: number;
  blockNum: number;
  salt: string;            // salt hex để submit_answer on-chain
  txDigest: string;
}): Promise<void> {
  const res = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'create_round',
      admin_key: GOOGLE_ADMIN_KEY,
      round_id: params.roundId,
      digest: params.digest,
      blob_id: params.blobId,
      session_obj_id: params.sessionObjId,
      difficulty: params.difficulty,
      block_num: params.blockNum,
      salt: params.salt,
      tx_digest: params.txDigest,
    }),
    redirect: 'follow',
  });
  const data = await res.json() as { success?: boolean; error?: string };
  if (!data.success) throw new Error(`Google Script: ${data.error}`);
}

export type VerifyResult =
  | {
      approved: true;
      sessionObjId: string;
      salt: string;
      blobId: string;       // walrus blob_id của round info
      roundInfo: RoundInfo;
    }
  | { approved: false; reason: 'wrong_digest' | 'already_used' | string };

export interface RoundInfo {
  round_id: number;
  difficulty: number;
  block_num: number;
  walrus_blob_id: string;
}

export async function gsVerifyDigest(
  roundId: number,
  digest: string,
  wallet: string,
): Promise<VerifyResult> {
  const res = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'verify_digest', round_id: roundId, digest, wallet }),
    redirect: 'follow',
  });
  const data = await res.json() as {
    approved?: boolean;
    reason?: string;
    session_obj_id?: string;
    salt?: string;
    blob_id?: string;
    round_info?: RoundInfo;
    error?: string;
  };
  if (data.error) throw new Error(`Google Script: ${data.error}`);
  if (data.approved) {
    return {
      approved: true,
      sessionObjId: data.session_obj_id ?? '',
      salt: data.salt ?? '',
      blobId: data.blob_id ?? '',
      roundInfo: data.round_info ?? { round_id: roundId, difficulty: 1, block_num: 0, walrus_blob_id: '' },
    };
  }
  return { approved: false, reason: data.reason ?? 'unknown' };
}

export async function gsResetLeaderboard(): Promise<void> {
  const res = await fetch(GOOGLE_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'reset_leaderboard', admin_key: GOOGLE_ADMIN_KEY }),
    redirect: 'follow',
  });
  const data = await res.json() as { success?: boolean; error?: string };
  if (!data.success) throw new Error(`Google Script: ${data.error}`);
}

export interface RoundHistory {
  round_id: number;
  difficulty: number;
  block_num: number;
  walrus_blob_id: string;
  tx_digest: string;
  winner_wallet: string | null;
  minted: boolean;
  created_at: string;
}

export async function gsGetRoundHistory(adminKey: string): Promise<RoundHistory[]> {
  const url = `${GOOGLE_SCRIPT_URL}?action=round_history&admin_key=${encodeURIComponent(adminKey)}`;
  const res = await fetch(url);
  const data = await res.json() as { rounds?: RoundHistory[]; error?: string };
  if (data.error) throw new Error(data.error);
  return data.rounds ?? [];
}

export async function gsGetCurrentRound(roundId: number): Promise<{
  hasWinner: boolean;
  winnerWallet: string | null;
  blobId: string;
} | null> {
  const url = `${GOOGLE_SCRIPT_URL}?action=get_round&round_id=${roundId}`;
  const res = await fetch(url);
  const data = await res.json() as {
    has_winner?: boolean;
    winner_wallet?: string | null;
    blob_id?: string;
    error?: string;
  };
  if (data.error) return null;
  return {
    hasWinner: !!data.has_winner,
    winnerWallet: data.winner_wallet ?? null,
    blobId: data.blob_id ?? '',
  };
}
