/**
 * Licence records, kept in a JSON file. Deliberately boring: at the volumes
 * this product needs before it earns a database, a file plus atomic rename is
 * more reliable than an ORM. Swap the four methods for SQL when it matters.
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  const read = () => {
    if (!existsSync(file)) return { licenses: {} };
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { licenses: {} };
    }
  };
  const write = (data) => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, file);
  };

  return {
    save(record) {
      const data = read();
      data.licenses[record.id] = record;
      write(data);
      return record;
    },
    get(id) {
      return read().licenses[id] || null;
    },
    findBy(predicate) {
      return Object.values(read().licenses).find(predicate) || null;
    },
    revoke(id, reason) {
      const data = read();
      if (!data.licenses[id]) return null;
      data.licenses[id] = {
        ...data.licenses[id],
        revokedAt: new Date().toISOString(),
        revokedReason: reason,
      };
      write(data);
      return data.licenses[id];
    },
  };
}
