import { walrus, WalrusFile } from '@mysten/walrus';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { WALRUS_AGGREGATOR } from './constants';


type WalrusClient = ReturnType<typeof createClient>;
let _client: WalrusClient | null = null;

function createClient() {
  return new SuiGrpcClient({
    baseUrl: 'https://fullnode.mainnet.sui.io:443',
    network: 'mainnet',
  }).$extend(walrus({ storageNodeClientOptions: { timeout: 30000 } }));
}

function getClient(): WalrusClient {
  if (!_client) _client = createClient();
  return _client;
}

export interface UploadResult {
  blobId: string;
  size: number;
}

export async function walrusUpload(
  signAndExecute: (args: { transaction: Transaction }) => Promise<unknown>,
  address: string,
  data: Uint8Array,
  opts: { epochs?: number; deletable?: boolean } = {},
): Promise<UploadResult> {
  const { epochs = 5, deletable = false } = opts;
  const client = getClient();

  const flow = client.walrus.writeFilesFlow({
    files: [
      WalrusFile.from({
        contents: data,
        identifier: 'data.bin',
        tags: { 'content-type': 'application/octet-stream' },
      }),
    ],
  });

  try {
    await flow.encode();
    console.log('=== walrus encode OK ===');

    const registerTx = flow.register({ epochs, deletable, owner: address });
    const registerResult = await signAndExecute({ transaction: registerTx as Transaction });
    console.log('=== walrus register OK ===', registerResult);

    const digest = (registerResult as { digest: string }).digest;
    await flow.upload({ digest });
    console.log('=== walrus upload OK ===');

    const certifyTx = flow.certify();
    await signAndExecute({ transaction: certifyTx as Transaction });
    console.log('=== walrus certify OK ===');

    const files = await flow.listFiles();
    return { blobId: files[0].blobId, size: data.byteLength };
  } catch (err) {
    console.error('=== walrus ERROR ===', err);
    throw err;
  }
}

export async function walrusUploadJSON<T>(
  signAndExecute: (args: { transaction: Transaction }) => Promise<unknown>,
  address: string,
  data: T,
  opts?: { epochs?: number; deletable?: boolean },
): Promise<UploadResult> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return walrusUpload(signAndExecute, address, bytes, opts);
}

export async function walrusDownload(blobId: string): Promise<Uint8Array> {
  if (!blobId) throw new Error('walrusDownload: blobId is empty');
  const url = walrusBlobUrl(blobId);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`walrusDownload failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function walrusDownloadJSON<T>(blobId: string): Promise<T> {
  const bytes = await walrusDownload(blobId);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text.trim().replace(/\0+$/, '')) as T;
}

export function walrusBlobUrl(blobId: string): string {
  return `${WALRUS_AGGREGATOR}/blobs/${encodeURIComponent(blobId)}`;
}