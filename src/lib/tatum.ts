import { BLOCK_RANGE_WIDTH } from './constants';

export interface TxnMeta {
  digest: string;
  checkpoint: number;
  sender: string;
  timestampMs: number;
  type: string;
}

export interface HintData {
  blockStart: number;
  blockEnd: number;
  senderSuffix: string;
  timestampPrecise: string | null;
  timestampHourMin: string | null;
  txType: string | null;
  sealObjectId: string;
  sealSessionId: number;
}

const TATUM_SUI_RPC = 'https://sui-mainnet.gateway.tatum.io';

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(TATUM_SUI_RPC, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_TATUM_API_KEY ?? '',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Tatum RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`Tatum RPC error: ${json.error.message}`);
  return json.result;
}

async function getLatestCheckpoint(): Promise<number> {
  const result = await rpc('sui_getLatestCheckpointSequenceNumber');
  return Number(result as string);
}

async function getCheckpointTransactions(checkpoint: number): Promise<string[]> {
  const result = await rpc('sui_getCheckpoint', [String(checkpoint)]) as {
    transactions: string[];
  };
  return result.transactions ?? [];
}

async function getTransaction(digest: string): Promise<TxnMeta | null> {
  try {
    const result = await rpc('sui_getTransactionBlock', [
      digest,
      {
        showInput: true,
        showEffects: false,
        showEvents: false,
        showObjectChanges: false,
        showBalanceChanges: false,
      },
    ]) as {
      digest: string;
      checkpoint?: string;
      transaction?: {
        data?: {
          sender?: string;
          transaction?: { kind?: string };
        };
      };
      timestampMs?: string;
    };

    const sender = result.transaction?.data?.sender ?? '';
    const checkpoint = Number(result.checkpoint ?? 0);
    const timestampMs = Number(result.timestampMs ?? 0);
    const kind = result.transaction?.data?.transaction?.kind ?? 'Unknown';

    let type = kind;
    if (kind === 'ProgrammableTransaction') type = 'Programmable';
    if (kind === 'ChangeEpoch') type = 'Epoch change';

    return { digest, checkpoint, sender, timestampMs, type };
  } catch {
    return null;
  }
}

export async function pickRandomTransaction(): Promise<TxnMeta> {
  const latest = await getLatestCheckpoint();
  const offset = Math.floor(Math.random() * 369);
  const checkpoint = latest - offset;

  const txs = await getCheckpointTransactions(checkpoint);
  if (txs.length === 0) throw new Error('Checkpoint has no transactions');

  const digest = txs[Math.floor(Math.random() * txs.length)];
  const meta = await getTransaction(digest);

  if (!meta) throw new Error(`Could not fetch transaction ${digest}`);

  return meta;
}

export function buildHint(meta: TxnMeta, difficulty: number): HintData {
  const width = BLOCK_RANGE_WIDTH[difficulty];
  const offset = Math.floor(Math.random() * (width + 1));
  const blockStart = meta.checkpoint - offset;
  const blockEnd = blockStart + width;

  const senderSuffix = '...' + meta.sender.slice(-11);

  const date = new Date(meta.timestampMs);
  const iso = date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  const hourMin = date.toISOString().substring(11, 16);

  return {
    blockStart,
    blockEnd,
    senderSuffix,
    timestampPrecise: difficulty === 1 ? iso : null,
    timestampHourMin: difficulty === 2 ? hourMin : null,
    txType: difficulty === 1 ? meta.type : null,
    sealObjectId: '',
    sealSessionId: 0,
  };
}

export function serializeHint(hint: HintData): string {
  return JSON.stringify(hint);
}

export function deserializeHint(raw: string): HintData {
  return JSON.parse(raw) as HintData;
}
