import { BadRequestException } from '@nestjs/common';

export function parseTitle(body: unknown): string {
  const { title } = (body ?? {}) as Record<string, unknown>;
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new BadRequestException('Title is required');
  }
  if (title.length > 100) {
    throw new BadRequestException('Title must be at most 100 characters');
  }
  return title.trim();
}
