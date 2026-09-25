const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Verifica el PIN contra el hash PBKDF2 guardado en la PC (funciona sin internet). */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const expected = b64(hash);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(salt), iterations: Number(iter) }, key, expected.length * 8));
  return bits.length === expected.length && bits.every((b, i) => b === expected[i]);
}
