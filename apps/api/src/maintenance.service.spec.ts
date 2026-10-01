import { mkdtempSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'uploads-'));
vi.stubEnv('UPLOAD_DIR', dir);
const { MaintenanceService } = await import('./maintenance.service.js');

describe('MaintenanceService.sweepUploads', () => {
  it('removes old unreferenced files only', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const name of ['kept.png', 'bg.png', 'orphan.png', 'fresh.png']) writeFileSync(join(dir, name), 'x');
    for (const name of ['kept.png', 'bg.png', 'orphan.png']) utimesSync(join(dir, name), old, old);

    const prisma = {
      attachment: { findMany: async () => [{ path: 'kept.png' }] },
      board: { findMany: async () => [{ background: '/uploads/bg.png' }] },
      list: { findMany: async () => [] },
    };
    const removed = await new MaintenanceService(prisma as never).sweepUploads(Date.now());

    expect(removed).toBe(1);
    expect(existsSync(join(dir, 'orphan.png'))).toBe(false);
    // Referenced ones stay, and so does a fresh file whose row may not be written yet.
    expect(['kept.png', 'bg.png', 'fresh.png'].every((n) => existsSync(join(dir, n)))).toBe(true);
  });
});
