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

// Fixed palette so labels stay visually consistent with the Ferrari theme instead of arbitrary hex chaos.
export const LABEL_COLORS = [
  '#c8102e', // rosso corsa
  '#e08a1e', // amber
  '#d9c22e', // yellow
  '#3f8f4f', // green
  '#2e7fd9', // blue
  '#7a4fd9', // purple
  '#6b7280', // slate
] as const;

export interface UpsertLabelInput {
  name: string;
  color: string;
}

export function parseUpsertLabel(body: unknown): UpsertLabelInput {
  const { name, color } = (body ?? {}) as Record<string, unknown>;

  if (typeof color !== 'string' || !LABEL_COLORS.includes(color as (typeof LABEL_COLORS)[number])) {
    throw new BadRequestException(`Color must be one of: ${LABEL_COLORS.join(', ')}`);
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > 40)) {
    throw new BadRequestException('Name must be a string of at most 40 characters');
  }

  // A label can be color-only, like Trello's.
  return { name: (name as string | undefined)?.trim() ?? '', color };
}
