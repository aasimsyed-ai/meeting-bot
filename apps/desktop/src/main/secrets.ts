import type { Repo } from './db/repo';

/**
 * Secrets (API keys, OAuth tokens) are encrypted with the operating system's
 * credential store before they touch disk: Keychain on macOS, DPAPI on
 * Windows, libsecret on Linux. If no secure store is available, secrets are
 * kept in memory for the session only and never written in plaintext.
 */
export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class SecretStore {
  private readonly memory = new Map<string, string>();

  constructor(
    private readonly repo: Repo,
    private readonly crypto: Encryptor | null,
  ) {}

  get persistent(): boolean {
    try {
      return Boolean(this.crypto?.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  set(name: string, value: string | null): { persistent: boolean } {
    const key = `secret:${name}`;
    this.memory.delete(name);
    this.repo.deleteSetting(key);
    if (value === null || value === '') return { persistent: this.persistent };
    if (this.persistent) {
      this.repo.setSetting(key, this.crypto!.encryptString(value).toString('base64'));
      return { persistent: true };
    }
    this.memory.set(name, value);
    return { persistent: false };
  }

  get(name: string): string | null {
    if (this.memory.has(name)) return this.memory.get(name)!;
    const stored = this.repo.getSetting(`secret:${name}`);
    if (!stored || !this.persistent) return null;
    try {
      return this.crypto!.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      // Unreadable (for example the OS keychain changed): drop it rather than crash.
      this.repo.deleteSetting(`secret:${name}`);
      return null;
    }
  }

  has(name: string): boolean {
    return this.get(name) !== null;
  }
}
