// Pure-WebCrypto TOTP (RFC 6238) — no npm deps.
// Google Authenticator / Authy / 1Password all compatible.
// 30-second window, 6-digit code, SHA-1 (the ecosystem default).

const B32_ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32ToBytes(b32) {
  const clean = String(b32 || "").toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = "";
  for (const ch of clean) {
    const idx = B32_ALPHA.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}
function bytesToB32(bytes) {
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += B32_ALPHA[parseInt(chunk, 2)];
  }
  return out;
}

// Generate a fresh 20-byte (160-bit) secret encoded as base32.
export function generateSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return bytesToB32(bytes);
}

// The otpauth:// URI that Google Authenticator scans as a QR.
export function otpauthUri({ secret, label = "TradeCore", issuer = "TradeCore" }) {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(label)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Compute the current 6-digit TOTP for a base32 secret.
// Returns "" if the crypto call fails for any reason.
export async function currentCode(secret, now = Date.now()) {
  try {
    const key   = b32ToBytes(secret);
    const step  = Math.floor(now / 1000 / 30);
    const buf   = new ArrayBuffer(8);
    const dv    = new DataView(buf);
    dv.setUint32(4, step);            // 8-byte big-endian counter, high half = 0
    const ck = await crypto.subtle.importKey(
      "raw", key, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
    );
    const sig  = new Uint8Array(await crypto.subtle.sign("HMAC", ck, buf));
    const off  = sig[sig.length - 1] & 0x0f;
    const bin  = ((sig[off] & 0x7f) << 24) | (sig[off+1] << 16) | (sig[off+2] << 8) | sig[off+3];
    return String(bin % 1_000_000).padStart(6, "0");
  } catch (e) {
    console.warn("TOTP compute failed:", e);
    return "";
  }
}

// Verify a user-entered code against the secret. Accepts the current
// step, ±1 step (30s clock drift) — Google Authenticator UX matches
// this window.
export async function verifyCode(secret, code, now = Date.now()) {
  const wanted = String(code || "").trim();
  if (!/^\d{6}$/.test(wanted)) return false;
  for (const drift of [-1, 0, 1]) {
    const c = await currentCode(secret, now + drift * 30_000);
    if (c === wanted) return true;
  }
  return false;
}

// A tiny SVG QR of an otpauth URI — good enough for GAuth to scan.
// This is a naive matrix built via a compact QR algorithm — for our
// use case (short URIs), we cheat and use Google Charts' QR endpoint
// URL — but that's an external call blocked in most CSP setups.
// So we fall back to text-only: show the secret + the URI. The user
// pastes into Authy manually or scans an offline QR of the URI.
//
// If we DO want an inline QR, add a lightweight library later. For
// now, "manual entry key" mode is universally supported by every
// authenticator app.
