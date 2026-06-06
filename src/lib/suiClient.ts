const SUI_RPC = 'https://fullnode.mainnet.sui.io';

export async function suiRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

export async function waitForTransaction(
  digest: string,
  maxAttempts = 15,
  intervalMs = 2000,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await suiRpc<{ data?: { digest: string } }>(
        'sui_getTransactionBlock',
        [digest, {}],
      );
      if (res.data?.digest) return; // confirmed
    } catch {
      // chưa có, thử lại
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction ${digest} not confirmed after ${maxAttempts * intervalMs / 1000}s`);
}

export async function getOwnedObjects(owner: string, type?: string): Promise<Array<{
  objectId: string;
  json: Record<string, unknown> | null;
}>> {
  const filter = type ? { StructType: type } : undefined;
  const res = await suiRpc<{
    data: Array<{
      data?: {
        objectId: string;
        content?: { fields?: Record<string, unknown> };
      };
    }>;
  }>('suix_getOwnedObjects', [
    owner,
    {
      filter,
      options: { showContent: true },
    },
    null,
    50,
  ]);

  return (res.data ?? []).map(item => ({
    objectId: item.data?.objectId ?? '',
    json: (item.data?.content?.fields ?? null) as Record<string, unknown> | null,
  })).filter(x => x.objectId);
}

export async function getObject(objectId: string): Promise<Record<string, unknown> | null> {
  const res = await suiRpc<{
    data?: { content?: { fields?: Record<string, unknown> } };
  }>('sui_getObject', [objectId, { showContent: true }]);
  return (res.data?.content?.fields ?? null) as Record<string, unknown> | null;
}