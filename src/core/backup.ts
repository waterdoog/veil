/**
 * Encrypted study backup. Raw transcripts and the codebook key live only in this browser's IndexedDB, so
 * clearing site data would orphan a study. A backup file is the whole study, encrypted on this device with a
 * passphrase (PBKDF2-SHA-256 → AES-256-GCM, Web Crypto). Without the passphrase the file is useless; it is
 * never uploaded anywhere.
 */
export interface BackupFile {
  format: "veil-backup-v1";
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  data: string;
}

const ITERATIONS = 310_000;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(passphrase: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function chunkedB64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function encryptBackup(payload: unknown, passphrase: string): Promise<string> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(passphrase, salt, ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const file: BackupFile = {
    format: "veil-backup-v1",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv) },
    data: chunkedB64(ct),
  };
  return JSON.stringify(file);
}

export async function decryptBackup<T = unknown>(text: string, passphrase: string): Promise<T> {
  let file: BackupFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("This isn't a Veil backup file.");
  }
  if (file?.format !== "veil-backup-v1") throw new Error("This isn't a Veil backup file.");
  const key = await keyFrom(passphrase, unb64(file.kdf.salt), file.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(file.cipher.iv) as BufferSource }, key, unb64(file.data) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new Error("Wrong passphrase, or the file was changed.");
  }
}
