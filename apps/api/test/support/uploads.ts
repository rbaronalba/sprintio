import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Writes one-byte files into `dir`, backdated by `ageHours` so they look abandoned. */
export function writeUploads(dir: string, names: string[], ageHours = 0): void {
  const modified = new Date(Date.now() - ageHours * 60 * 60 * 1000);
  for (const name of names) {
    writeFileSync(join(dir, name), 'x');
    utimesSync(join(dir, name), modified, modified);
  }
}
