import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

// Relative to the process cwd (/app in the container); mount a volume there to persist across rebuilds.
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
// The extension comes from the (filtered) mimetype, never the client's filename: a "x.html"
// declared as image/png would otherwise be served back as HTML from /uploads/.
const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

export const attachmentUploadOptions = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    // Random name, not the original filename: unguessable, doubles as the access token (see boards' invite tokens).
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString('hex') + EXTENSIONS[file.mimetype]),
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!Object.hasOwn(EXTENSIONS, file.mimetype)) {
      cb(new BadRequestException('Only PNG, JPEG, GIF or WebP images are allowed'), false);
    } else {
      cb(null, true);
    }
  },
};

/** Best-effort delete of a file behind an /uploads/ URL (a replaced background); anything else is ignored. */
export async function removeUpload(url: string): Promise<void> {
  const name = /^\/uploads\/([0-9a-f]{32}\.[a-z]+)$/.exec(url)?.[1];
  if (name) await unlink(join(UPLOAD_DIR, name)).catch(() => {});
}
