import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service.js';
import { UPLOAD_DIR } from './cards/uploads.js';

const EVERY_MS = 6 * 60 * 60 * 1000;
/** The activity feed and notifications are recent history; a year is plenty. */
const EVENT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
/** A file lands on disk a moment before its row is written; never sweep one that young. */
const UPLOAD_GRACE_MS = 60 * 60 * 1000;

/**
 * Housekeeping that would otherwise grow without bound: expired sessions, old events
 * (their notifications cascade), and upload files no row points at any more (left by
 * deleting a card, list, board or workspace, or by a crash between disk and database).
 *
 * ponytail: a setInterval in every api instance. The work is idempotent, so several
 * instances running it is only redundant; move it to a single scheduled job if that ever costs.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(now = Date.now()): Promise<void> {
    try {
      const sessions = await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
      const events = await this.prisma.event.deleteMany({ where: { createdAt: { lt: new Date(now - EVENT_RETENTION_MS) } } });
      const files = await this.sweepUploads(now);
      this.logger.log(`Removed ${sessions.count} sessions, ${events.count} events, ${files} orphaned files`);
    } catch (error) {
      this.logger.error('Maintenance run failed', error);
    }
  }

  /** ponytail: loads every referenced filename into memory; fine to ~1M attachments, then page it. */
  async sweepUploads(now: number): Promise<number> {
    const [attachments, boards, lists] = await Promise.all([
      this.prisma.attachment.findMany({ select: { path: true } }),
      this.prisma.board.findMany({ where: { background: { startsWith: '/uploads/' } }, select: { background: true } }),
      this.prisma.list.findMany({ where: { background: { startsWith: '/uploads/' } }, select: { background: true } }),
    ]);
    const referenced = new Set([
      ...attachments.map((a) => a.path),
      ...[...boards, ...lists].map((x) => x.background.slice('/uploads/'.length)),
    ]);

    let removed = 0;
    for (const name of await readdir(UPLOAD_DIR)) {
      if (referenced.has(name)) continue;
      const file = join(UPLOAD_DIR, name);
      if ((await stat(file)).mtimeMs > now - UPLOAD_GRACE_MS) continue;
      await unlink(file).catch(() => {});
      removed++;
    }
    return removed;
  }
}
