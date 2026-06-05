export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function computeDigestHash(digest: string, salt: Uint8Array): Promise<Uint8Array> {
  const digestBytes = new TextEncoder().encode(digest);
  const combined = new Uint8Array(digestBytes.length + salt.length);
  combined.set(digestBytes);
  combined.set(salt, digestBytes.length);
  const hashBuf = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuf);
}
