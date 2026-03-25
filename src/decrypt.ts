import { createDecipheriv, createCipheriv } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const MASTER_KEY = Buffer.from("UIlTTEMmmLfGowo/UC60x2H45W6MdGgTRfo/umg4754=", "base64");

export function decryptSecurityToken(securityToken: string): { key: Buffer; nonce: Buffer } {
  const decoded = Buffer.from(securityToken, "base64");
  const iv = decoded.subarray(0, 16);
  const encrypted = decoded.subarray(16);

  const decipher = createDecipheriv("aes-256-cbc", MASTER_KEY, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return {
    key: decrypted.subarray(0, 16),
    nonce: decrypted.subarray(16, 24),
  };
}

export async function decryptFile(filePath: string, key: Buffer, nonce: Buffer): Promise<void> {
  const data = await readFile(filePath);

  // AES-128-CTR with 64-bit nonce prefix and 64-bit counter starting at 0
  const iv = Buffer.alloc(16);
  nonce.copy(iv, 0); // First 8 bytes = nonce, last 8 bytes = 0 (counter)

  const decipher = createDecipheriv("aes-128-ctr", key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

  await writeFile(filePath, decrypted);
}
