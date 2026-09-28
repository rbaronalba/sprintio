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

/** workspaceId is optional: without it the board lands in the owner's first workspace. */
export function parseCreateBoard(body: unknown): { title: string; workspaceId?: string } {
  const { workspaceId } = (body ?? {}) as Record<string, unknown>;
  if (workspaceId !== undefined && typeof workspaceId !== 'string') {
    throw new BadRequestException('workspaceId must be a string');
  }
  return { title: parseTitle(body), workspaceId: workspaceId || undefined };
}

export function parseWorkspaceName(body: unknown): string {
  const { name } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim().length === 0) throw new BadRequestException('Name is required');
  if (name.length > 60) throw new BadRequestException('Name must be at most 60 characters');
  return name.trim();
}

// Fixed palette (Trello's 5 columns x 6 rows: subtle / normal / bold per hue) so labels stay
// consistent instead of arbitrary hex chaos. Mirrored in web board-detail.component.ts.
export const LABEL_COLORS = [
  '#baf3db', '#f8e6a0', '#fedec8', '#ffd5d2', '#dfd8fd',
  '#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef',
  '#1f845a', '#946f00', '#c25100', '#c9372c', '#6e5dc6',
  '#cce0ff', '#c6edfb', '#d3f1a7', '#fdd0ec', '#dcdfe4',
  '#579dff', '#6cc3e0', '#94c748', '#e774bb', '#8590a2',
  '#0c66e4', '#227d9b', '#5b7f24', '#ae4787', '#626f86',
] as const;

export interface UpsertLabelInput {
  name: string;
  color: string;
}

export function parseUpsertLabel(body: unknown): UpsertLabelInput {
  const { name, color } = (body ?? {}) as Record<string, unknown>;

  // '' is "no color" (Trello's "Remove color"): the label is shown by its name alone.
  if (typeof color !== 'string' || (color !== '' && !LABEL_COLORS.includes(color as (typeof LABEL_COLORS)[number]))) {
    throw new BadRequestException('Color must be empty or one of the palette colors');
  }
  if (name !== undefined && (typeof name !== 'string' || name.length > 40)) {
    throw new BadRequestException('Name must be a string of at most 40 characters');
  }

  // A label can be color-only or name-only, like Trello's — but not neither.
  const trimmed = (name as string | undefined)?.trim() ?? '';
  if (!trimmed && !color) throw new BadRequestException('A label needs a name or a color');
  return { name: trimmed, color };
}

/**
 * A JSON background is '' (none) or a palette color. Image backgrounds are only ever set
 * server-side from an upload, so a client can't slip arbitrary CSS into a style binding.
 */
export function parseBackground(body: unknown): string {
  const { background } = (body ?? {}) as Record<string, unknown>;
  if (background === '' || LABEL_COLORS.includes(background as (typeof LABEL_COLORS)[number])) {
    return background as string;
  }
  throw new BadRequestException('Background must be empty or one of the palette colors');
}
