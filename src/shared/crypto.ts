/**
 * Crypto utilities on WebCrypto (Workers-native).
 * Replaces: Python passlib password hashing, itsdangerous-style tokens, and
 * the application-level encryption of OAuth/bearer tokens.
 *
 * NOTE: existing Postgres password hashes (bcrypt) cannot be verified here;
 * migrated users must go through the password-reset flow once.
 */

const te = new TextEncoder();
const td = new TextDecoder();

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replaceAll('-', '+').replaceAll('_', '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Password hashing: PBKDF2-SHA256 ─────────────────────────────────────────
const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromBase64url(parts[2]!);
  const expected = fromBase64url(parts[3]!);
  const bits = new Uint8Array(await pbkdf2(password, salt, iterations));
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i]! ^ expected[i]!;
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
}

// ── Session tokens: HS256 JWT ────────────────────────────────────────────────
export interface SessionClaims {
  sub: string; // user id
  exp: number; // unix seconds
  iat: number;
}

export async function signSession(userId: string, secret: string, ttlSeconds = 60 * 60 * 24 * 7): Promise<string> {
  const header = base64url(te.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(te.encode(JSON.stringify({ sub: userId, iat: now, exp: now + ttlSeconds } satisfies SessionClaims)));
  const sig = await hmac(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionClaims | null> {
  const [header, payload, sig] = token.split('.');
  if (!header || !payload || !sig) return null;
  const expected = await hmac(`${header}.${payload}`, secret);
  if (!timingSafeEqualStr(sig, expected)) return null;
  try {
    const claims = JSON.parse(td.decode(fromBase64url(payload))) as SessionClaims;
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(data));
  return base64url(sig);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── Token-at-rest encryption: AES-256-GCM ───────────────────────────────────
// user_oauth_connections.access_token / refresh_token and
// channel_integrations.credentials values are stored as `gcm$<iv>$<ciphertext>`.

export async function encryptSecret(plaintext: string, keyB64: string): Promise<string> {
  const key = await importAesKey(keyB64);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, te.encode(plaintext));
  return `gcm$${base64url(iv)}$${base64url(ct)}`;
}

export async function decryptSecret(stored: string, keyB64: string): Promise<string> {
  const [tag, ivB64, ctB64] = stored.split('$');
  if (tag !== 'gcm' || !ivB64 || !ctB64) throw new Error('invalid encrypted secret format');
  const key = await importAesKey(keyB64);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(ivB64) as BufferSource },
    key,
    fromBase64url(ctB64) as BufferSource,
  );
  return td.decode(pt);
}

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64url(keyB64) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
