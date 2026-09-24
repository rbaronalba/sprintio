import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';

// Relative to the process cwd (/app in the container); mount a volume there to persist across rebuilds.
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? 'uploads';
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const attachmentUploadOptions = {
  storage: diskStorage({
    destination: UPLOAD_DIR,
    // Random name, not the original filename: unguessable, doubles as the access token (see boards' invite tokens).
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString('hex') + extname(file.originalname).slice(0, 10)),
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      cb(new BadRequestException('Only PNG, JPEG, GIF or WebP images are allowed'), false);
    } else {
      cb(null, true);
    }
  },
};
