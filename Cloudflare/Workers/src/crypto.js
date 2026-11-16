// ============================================================================
// Cloudflare Workers Cryptographic & Security Utilities
// Uses standard W3C Web Crypto API available natively in Cloudflare Workers
// ============================================================================

/**
 * Generate a cryptographically secure random hex string or UUID
 */
export function generateRandomHex(length = 32) {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute SHA-256 hex hash of any string
 */
export async function sha256Hex(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash password with PBKDF2 using SHA-256 and 100,000 iterations
 */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const saltBytes = new Uint8Array(
    saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign']
  );

  const exported = await crypto.subtle.exportKey('raw', derivedKey);
  return Array.from(new Uint8Array(exported)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify password against stored hash and salt
 */
export async function verifyPassword(password, storedHash, saltHex) {
  const computedHash = await hashPassword(password, saltHex);
  return computedHash === storedHash;
}

/**
 * Derive AES-GCM 256-bit Key from Master Secret
 */
async function getEncryptionKey(secretString) {
  const enc = new TextEncoder();
  const rawKey = await crypto.subtle.digest('SHA-256', enc.encode(secretString || 'DEFAULT_ROBOT_SECRET_KEY_MECHATRONICS_2026'));
  return crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt sensitive plain text (e.g. Grok API Key) using AES-256-GCM
 * Returns formatted string: "iv_hex:ciphertext_hex"
 */
export async function encryptSecret(plainText, secretString) {
  if (!plainText) return '';
  const key = await getEncryptionKey(secretString);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
  const encoded = new TextEncoder().encode(plainText);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const cipherHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${ivHex}:${cipherHex}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 */
export async function decryptSecret(encryptedString, secretString) {
  if (!encryptedString || !encryptedString.includes(':')) return '';
  try {
    const [ivHex, cipherHex] = encryptedString.split(':');
    const key = await getEncryptionKey(secretString);
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
    const cipherBytes = new Uint8Array(cipherHex.match(/.{1,2}/g).map(b => parseInt(b, 16)));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBytes
    );

    return new TextDecoder().decode(decrypted);
  } catch (err) {
    console.error('Decryption failed:', err);
    return null;
  }
}

/**
 * Mask an API key for safe UI display (e.g., "xai-••••••••••••abcd")
 */
export function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 8) return '••••••••';
  const prefix = apiKey.slice(0, 4);
  const suffix = apiKey.slice(-4);
  return `${prefix}••••••••••••${suffix}`;
}
