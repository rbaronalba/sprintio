import { BadRequestException } from '@nestjs/common';

export interface UpsertCardInput {
  title?: string;
  description?: string | null;
  position?: number;
  listId?: string;
}

export function parseUpsertCard(body: unknown): UpsertCardInput {
  const { title, description, position, listId } = (body ?? {}) as Record<string, unknown>;
  const result: UpsertCardInput = {};

  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new BadRequestException('Title is required');
    }
    if (title.length > 200) {
      throw new BadRequestException('Title must be at most 200 characters');
    }
    result.title = title.trim();
  }

  if (description !== undefined) {
    if (description !== null && typeof description !== 'string') {
      throw new BadRequestException('Description must be a string');
    }
    if (description !== null && description.length > 5000) {
      throw new BadRequestException('Description must be at most 5000 characters');
    }
    result.description = description?.trim() || null;
  }

  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position)) {
      throw new BadRequestException('Position must be a finite number');
    }
    result.position = position;
  }

  if (listId !== undefined) {
    if (typeof listId !== 'string' || listId.length === 0) {
      throw new BadRequestException('Invalid listId');
    }
    result.listId = listId;
  }

  return result;
}
