import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeUploads } from '../test/support/uploads.js';

const dir = mkdtempSync(join(tmpdir(), 'uploads-'));
vi.stubEnv('UPLOAD_DIR', dir);
const { MaintenanceService } = await import('./maintenance.service.js');

describe('MaintenanceService.sweepUploads', () => {
  it('removes old unreferenced files only', async () => {
    writeUploads(dir, ['kept.png', 'bg.png', 'orphan.png'], 2);
    writeUploads(dir, ['fresh.png']);

    const prisma = {
      attachment: { findMany: async () => [{ path: 'kept.png' }] },
      board: { findMany: async () => [{ background: '/uploads/bg.png' }] },
      list: { findMany: async () => [] },
    };
    const removed = await new MaintenanceService(prisma as never).sweepUploads(Date.now());

    expect(removed).toBe(1);
    expect(existsSync(join(dir, 'orphan.png'))).toBe(false);
    // Referenced ones stay, and so does a fresh file whose row may not be written yet.
    expect(existsSync(join(dir, 'kept.png'))).toBe(true);
    expect(existsSync(join(dir, 'bg.png'))).toBe(true);
    expect(existsSync(join(dir, 'fresh.png'))).toBe(true);
  });
});
