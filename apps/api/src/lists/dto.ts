import { BadRequestException } from '@nestjs/common';

export interface UpsertListInput {
  title?: string;
  /** A move: land right after this list (null = first). The server works out the position. */
  afterId?: string | null;
}

function parseListTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new BadRequestException('Title is required');
  }
  if (title.length > 100) {
    throw new BadRequestException('Title must be at most 100 characters');
  }
  return title.trim();
}

function parseAfterId(afterId: unknown): string | null {
  if (afterId === null) return null;
  if (typeof afterId !== 'string' || afterId.length === 0) {
    throw new BadRequestException('afterId must be an id or null');
  }
  return afterId;
}

export function parseUpsertList(body: unknown): UpsertListInput {
  const { title, afterId } = (body ?? {}) as Record<string, unknown>;
  const result: UpsertListInput = {};
  if (title !== undefined) result.title = parseListTitle(title);
  if (afterId !== undefined) result.afterId = parseAfterId(afterId);
  return result;
}
