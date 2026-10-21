import { observeCaughtError } from './errorObservation';
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Commit the manifest last; never remove the old login before verifying its replacement. */
export function encryptedPersistence(secure: Storage, legacy: Storage,
  hash: (key: string) => Promise<string>, version: () => string): Storage {
  const pending = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const next = (pending.get(key) ?? Promise.resolve()).catch((caughtErrorc721d6d125: unknown) => { observeCaughtError(caughtErrorc721d6d125, {"source":"src/utils/encryptedPersistence.ts","handler":"serial","site":"encryptedPersistence:c721d6d125"}); return undefined; }).then(work);
    pending.set(key, next);
    void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch((caughtErrord92b02ddc4: unknown) => { observeCaughtError(caughtErrord92b02ddc4, {"source":"src/utils/encryptedPersistence.ts","handler":"serial","site":"encryptedPersistence:d92b02ddc4"}); return undefined; });
    return next;
  };
  type Manifest = { version: string; count: number };
  async function manifest(base: string): Promise<Manifest | null> {
    const raw = await secure.getItem(base);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Manifest;
    if (!/^[a-zA-Z0-9-]+$/.test(parsed.version) || !Number.isInteger(parsed.count) || parsed.count < 1 || parsed.count > 600)
      throw new Error('AUTH_STORAGE_CORRUPT');
    return parsed;
  }
  async function read(base: string, entry: Manifest): Promise<string> {
    const chunks = await Promise.all(Array.from({ length: entry.count }, (_, i) => secure.getItem(`${base}.${entry.version}.${i}`)));
    if (chunks.some(chunk => chunk === null)) throw new Error('AUTH_STORAGE_INCOMPLETE');
    return chunks.join('');
  }
  async function discard(base: string, entry: Manifest | null) {
    if (entry) await Promise.all(Array.from({ length: entry.count }, (_, i) => secure.removeItem(`${base}.${entry.version}.${i}`)));
  }
  async function write(base: string, value: string) {
    const old = await manifest(base);
    const chars = Array.from(value);
    if (chars.length > 250000) throw new Error('AUTH_STORAGE_TOO_LARGE');
    // At most 1920 UTF-8 bytes per native entry, including non-BMP characters.
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += 480) chunks.push(chars.slice(i, i + 480).join(''));
    if (!chunks.length) chunks.push('');
    const entry = { version: version(), count: chunks.length };
    for (let i = 0; i < chunks.length; i++) await secure.setItem(`${base}.${entry.version}.${i}`, chunks[i]);
    if (await read(base, entry) !== value) throw new Error('AUTH_STORAGE_VERIFY_FAILED');
    await secure.setItem(base, JSON.stringify(entry));
    // Cleanup is best effort AFTER committing: a cleanup error must not revert the new login.
    await discard(base, old).catch((caughtErrorad7510b017: unknown) => { observeCaughtError(caughtErrorad7510b017, {"source":"src/utils/encryptedPersistence.ts","handler":"write","site":"encryptedPersistence:ad7510b017"}); return undefined; });
  }
  return {
    getItem: key => serial(key, async () => {
      const base = `firebaseAuth.${await hash(key)}`;
      const entry = await manifest(base);
      if (entry) {
        const value = await read(base, entry);
        await legacy.removeItem(key);
        return value;
      }
      const value = await legacy.getItem(key);
      if (value !== null) { await write(base, value); await legacy.removeItem(key); }
      return value;
    }),
    setItem: (key, value) => serial(key, async () => {
      await write(`firebaseAuth.${await hash(key)}`, value);
      await legacy.removeItem(key);
    }),
    removeItem: key => serial(key, async () => {
      const base = `firebaseAuth.${await hash(key)}`;
      const entry = await manifest(base);
      await legacy.removeItem(key);
      await secure.removeItem(base);
      await discard(base, entry);
    }),
  };
}
