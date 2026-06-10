import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function decodeConfiguredKey(value: string) {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  try {
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(trimmed).digest();
}

export class SecretService {
  private masterKey?: Buffer;
  private masterKeyPromise?: Promise<Buffer>;

  constructor(private readonly dataDir: string) {}

  async encrypt(value: string, aad: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await this.getMasterKey(), iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [
      VERSION,
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":");
  }

  async decrypt(value: string, aad: string) {
    const [version, ivValue, tagValue, encryptedValue] = value.split(":");
    if (version !== VERSION || !ivValue || !tagValue || encryptedValue === undefined) {
      throw new Error("Unsupported encrypted value");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      await this.getMasterKey(),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  mask(value: string) {
    if (!value) return "";
    if (value.length <= 8) return `${value.slice(0, 1)}...${value.slice(-1)}`;
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private async getMasterKey() {
    if (this.masterKey) return this.masterKey;
    if (this.masterKeyPromise) return this.masterKeyPromise;
    this.masterKeyPromise = this.loadMasterKey();
    try {
      this.masterKey = await this.masterKeyPromise;
      return this.masterKey;
    } finally {
      this.masterKeyPromise = undefined;
    }
  }

  private async loadMasterKey() {
    if (process.env.APP_SECRET_KEY) {
      return decodeConfiguredKey(process.env.APP_SECRET_KEY);
    }

    await fs.mkdir(this.dataDir, { recursive: true });
    const keyFile = path.join(this.dataDir, ".app-secret-key");
    try {
      const existing = decodeConfiguredKey(await fs.readFile(keyFile, "utf8"));
      await fs.chmod(keyFile, 0o600);
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const generated = randomBytes(32);
      try {
        await fs.writeFile(keyFile, generated.toString("base64"), { mode: 0o600, flag: "wx" });
        return generated;
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        return decodeConfiguredKey(await fs.readFile(keyFile, "utf8"));
      }
    }
  }
}
