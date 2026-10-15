import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

/**
 * Encrypts small secrets kept in the database, such as webhook header values (AES-256-GCM).
 *
 * The key is derived from JWT_SECRET with HKDF, so there is no second secret to manage. A
 * different `info` keeps it separate from the token signing key. Changing JWT_SECRET makes the
 * stored values unreadable; they then have to be entered again. Stored as "v1:" + base64 of
 * iv (12 bytes) | auth tag (16 bytes) | ciphertext.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(jwtSecret: string) {
    this.key = Buffer.from(hkdfSync("sha256", jwtSecret, "testops", "secret-box v1", 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
  }

  /** The plain text, or null when the value can't be read (e.g. JWT_SECRET has changed since). */
  open(sealed: string): string | null {
    if (!sealed.startsWith("v1:")) return null;
    try {
      const raw = Buffer.from(sealed.slice(3), "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }
}
