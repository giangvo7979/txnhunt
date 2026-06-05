import { Transaction } from '@mysten/sui/transactions';
import { suiRpc, getOwnedObjects, getObject } from './suiClient';
import {
  PACKAGE_ID,
  GAME_CONFIG_ID,
  LEADERBOARD_ID,
  ROUND_HISTORY_ID,
} from './constants';


export interface Session {
  id: string;
  session_id: number;
  digest_hash: number[];
  difficulty: number;
  blob_id: string;
  hint: string;
  block_num: number;
  has_solver: boolean;
  solver: string | null;
  minted: boolean;
  expires_at: number;
}

export interface ScoreEntry {
  wallet: string;
  points: number;
  nft_count: number;
  last_mint: number;
}

export interface GameConfig {
  session_counter: number;
  current_session: string | null;
}

export function buildCreateSessionTx(params: {
  adminCapId: string;
  digestHash: Uint8Array;
  difficulty: number;
  blobId: string;
  hint: string;
  blockNum: number;
  expiresAt: number;
}): Transaction {
  const tx = new Transaction();
  const { adminCapId, digestHash, difficulty, blobId, hint, blockNum, expiresAt } = params;

  tx.moveCall({
    target: `${PACKAGE_ID}::game::create_session`,
    arguments: [
      tx.object(adminCapId),
      tx.object(GAME_CONFIG_ID),
      tx.object(ROUND_HISTORY_ID),
      tx.pure.vector('u8', Array.from(digestHash)),
      tx.pure.u8(difficulty),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(blobId))),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(hint))),
      tx.pure.u64(blockNum),
      tx.pure.u64(expiresAt),
      tx.object('0x6'),
    ],
  });

  return tx;
}

export function buildSubmitAnswerTx(params: {
  sessionId: string;
  digest: string;
  salt: string;
}): Transaction {
  const tx = new Transaction();

  const digestBytes = Array.from(new TextEncoder().encode(params.digest));
  const saltBytes   = Array.from(hexToBytes(params.salt));

  tx.moveCall({
    target: `${PACKAGE_ID}::game::submit_answer`,
    arguments: [
      tx.object(params.sessionId),
      tx.pure.vector('u8', digestBytes),
      tx.pure.vector('u8', saltBytes),
      tx.object('0x6'),
    ],
  });

  return tx;
}

export function buildMintNftTx(params: {
  sessionId: string;
  capId: string;
  metadataBlobId: string;
}): Transaction {
  const tx = new Transaction();

  const [witness] = tx.moveCall({
    target: `${PACKAGE_ID}::game::create_game_witness`,
    arguments: [],
  });

  tx.moveCall({
    target: `${PACKAGE_ID}::game::mint_nft`,
    arguments: [
      tx.object(params.sessionId),
      tx.object(params.capId),
      tx.object(GAME_CONFIG_ID),
      tx.object(ROUND_HISTORY_ID),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(params.metadataBlobId))),
      tx.object(LEADERBOARD_ID),
      witness,
      tx.object('0x6'),
    ],
  });

  return tx;
}

export function buildAddAdminTx(newAdmin: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::game::add_admin`,
    arguments: [
      tx.object(GAME_CONFIG_ID),
      tx.pure.address(newAdmin),
    ],
  });
  return tx;
}

export function buildRemoveAdminTx(admin: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::game::remove_admin`,
    arguments: [
      tx.object(GAME_CONFIG_ID),
      tx.pure.address(admin),
    ],
  });
  return tx;
}

export async function fetchAdminList(): Promise<string[]> {
  try {
    const fields = await getObject(GAME_CONFIG_ID);
    if (!fields) return [];
    const tableId = (fields.admins as { id?: { id?: string } } | null)?.id?.id;
    if (!tableId) return [];
    const res = await suiRpc<{ data: Array<{ name: { value: string } }> }>(
      'suix_getDynamicFields',
      [tableId, null, 50],
    );
    return (res.data ?? []).map(item => item.name.value);
  } catch {
    return [];
  }
}

export function buildResetLeaderboardTx(lbAdminCapId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::leaderboard::reset`,
    arguments: [
      tx.object(lbAdminCapId),   // LeaderboardAdminCap
      tx.object(LEADERBOARD_ID),
    ],
  });
  return tx;
}

export async function fetchGameConfig(): Promise<GameConfig | null> {
  try {
    const fields = await getObject(GAME_CONFIG_ID);
    if (!fields) return null;

    const opt = fields.current_session as { vec?: string[] } | string | null;
    let currentSession: string | null = null;
    if (typeof opt === 'string') currentSession = opt;
    else if (opt && typeof opt === 'object' && Array.isArray(opt.vec) && opt.vec.length > 0) {
      currentSession = opt.vec[0] ?? null;
    }

    return {
      session_counter: Number(fields.session_counter),
      current_session: currentSession,
    };
  } catch {
    return null;
  }
}

export async function fetchCurrentSessionId(): Promise<string | null> {
  const config = await fetchGameConfig();
  return config?.current_session ?? null;
}

export async function fetchSession(sessionObjectId: string): Promise<Session | null> {
  try {
    const fields = await getObject(sessionObjectId);
    if (!fields) return null;

    const solverOpt = fields.solver as { vec?: string[] } | null;
    const solverAddr = solverOpt?.vec?.[0] ?? null;

    return {
      id:         sessionObjectId,
      session_id: Number(fields.session_id),
      digest_hash: fields.digest_hash as number[],
      difficulty: Number(fields.difficulty),
      blob_id:    fields.blob_id as string,
      hint:       fields.hint as string,
      block_num:  Number(fields.block_num),
      has_solver: !!(solverOpt?.vec && solverOpt.vec.length > 0),
      solver:     solverAddr,
      minted:     fields.minted as boolean,
      expires_at: Number(fields.expires_at),
    };
  } catch {
    return null;
  }
}

export async function fetchSessionObjectId(txDigest: string): Promise<string | null> {
  try {
    const res = await suiRpc<{
      objectChanges?: Array<{
        type: string;
        objectType?: string;
        objectId?: string;
      }>;
    }>('sui_getTransactionBlock', [txDigest, { showObjectChanges: true }]);

    const changes = res.objectChanges ?? [];
    for (const change of changes) {
      if (
        change.type === 'created' &&
        change.objectType?.includes('::game::Session') &&
        change.objectId
      ) {
        return change.objectId;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function findAllowlistCap(
  walletAddress: string,
  sessionId: number,
): Promise<string | null> {
  try {
    const objects = await getOwnedObjects(
      walletAddress,
      `${PACKAGE_ID}::game::AllowlistCap`,
    );
    for (const obj of objects) {
      if (Number(obj.json?.session_id) === sessionId) return obj.objectId;
    }
    return null;
  } catch {
    return null;
  }
}

export async function findAdminCap(walletAddress: string): Promise<string | null> {
  try {
    const objects = await getOwnedObjects(
      walletAddress,
      `${PACKAGE_ID}::game::AdminCap`,
    );
    return objects[0]?.objectId ?? null;
  } catch {
    return null;
  }
}

export async function fetchLeaderboard(): Promise<ScoreEntry[]> {
  try {
    const fields = await getObject(LEADERBOARD_ID);
    if (!fields) return [];

    const allTime = fields.all_time as Array<
      | { fields: { wallet: string; points: string; nft_count: string; last_mint: string } }
      | { wallet: string; points: string; nft_count: string; last_mint: string }
    > | null;

    return (allTime ?? [])
      .map((e) => {
        // Unwrap nested fields nếu có
        const f = ('fields' in e && e.fields) ? e.fields : e as {
          wallet: string; points: string; nft_count: string; last_mint: string;
        };
        return {
          wallet:    f.wallet ?? '',
          points:    Number(f.points ?? 0),
          nft_count: Number(f.nft_count ?? 0),
          last_mint: Number(f.last_mint ?? 0),
        };
      })
      .filter((e) => !!e.wallet)
      .sort((a, b) => {
        if (b.points    !== a.points)    return b.points    - a.points;
        if (b.nft_count !== a.nft_count) return b.nft_count - a.nft_count;
        return a.last_mint - b.last_mint;
      });
  } catch {
    return [];
  }
}

export interface OnChainRoundHistory {
  round_id:   number;
  difficulty: number;
  block_num:  number;
  blob_id:    string;
  winner:     string | null;
  minted_at:  number;
  created_at: number;
}

export async function fetchRoundHistory(): Promise<OnChainRoundHistory[]> {
  try {
    const fields = await getObject(ROUND_HISTORY_ID);
    if (!fields) return [];

    const rounds = fields.rounds as Array<
      | { fields: { round_id: string; difficulty: number; block_num: string; blob_id: string; winner: { vec?: string[] }; minted_at: string; created_at: string } }
      | { round_id: string; difficulty: number; block_num: string; blob_id: string; winner: { vec?: string[] }; minted_at: string; created_at: string }
    > | null;

    return (rounds ?? [])
      .map((e) => {
        const f = ('fields' in e && e.fields) ? e.fields : e as {
          round_id: string; difficulty: number; block_num: string; blob_id: string;
          winner: { vec?: string[] }; minted_at: string; created_at: string;
        };
        return {
          round_id:   Number(f.round_id),
          difficulty: Number(f.difficulty),
          block_num:  Number(f.block_num),
          blob_id:    f.blob_id ?? '',
          winner:     f.winner?.vec?.[0] ?? null,
          minted_at:  Number(f.minted_at),
          created_at: Number(f.created_at),
        };
      })
      .sort((a, b) => b.round_id - a.round_id);
  } catch {
    return [];
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
