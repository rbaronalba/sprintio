import { BadRequestException } from '@nestjs/common';

// Floats lose ordering precision when they grow or get bisected without bound.
const MAX_POSITION = 1e9;

export interface UpsertListInput {
  title?: string;
  position?: number;
}

export function parseUpsertList(body: unknown): UpsertListInput {
  const { title, position } = (body ?? {}) as Record<string, unknown>;
  const result: UpsertListInput = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new BadRequestException('Title is required');
    }
    if (title.length > 100) {
      throw new BadRequestException('Title must be at most 100 characters');
    }
    result.title = title.trim();
  }

  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position) || Math.abs(position) > MAX_POSITION) {
      throw new BadRequestException(`Position must be a number within ±${MAX_POSITION}`);
    }
    result.position = position;
  }

  return result;
}
