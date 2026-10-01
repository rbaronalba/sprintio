import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
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

const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const IMAGE_EXTENSIONS = new Set([...Object.values(EXTENSIONS), '.jpeg']);
/**
 * What a card or comment accepts besides images: logs, dumps, docs, screen recordings.
 * Chosen by extension (browsers send no reliable mimetype for .log or .sql). That is safe
 * only because main.ts serves every non-image as a download, never inline: nothing here
 * can run as a page on our origin.
 */
const FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS, '.pdf', '.txt', '.log', '.csv', '.json', '.xml', '.sql', '.md', '.yml', '.yaml', '.har',
  '.zip', '.7z', '.gz', '.mp4', '.webm', '.mov', '.docx', '.xlsx', '.pptx',
]);

export const fileUploadOptions = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString('hex') + extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!FILE_EXTENSIONS.has(extname(file.originalname).toLowerCase())) {
      cb(new BadRequestException('This file type is not allowed'), false);
    } else {
      cb(null, true);
    }
  },
};

/** Best-effort delete of a file behind an /uploads/ URL (a replaced background); anything else is ignored. */
export async function removeUpload(url: string): Promise<void> {
  const name = /^\/uploads\/([0-9a-f]{32}\.[a-z0-9]+)$/.exec(url)?.[1];
  if (name) await unlink(join(UPLOAD_DIR, name)).catch(() => {});
}
