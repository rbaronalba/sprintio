import { BadRequestException } from '@nestjs/common';

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
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      throw new BadRequestException('Position must be a finite number');
    }
    result.position = position;
  }

  return result;
}
