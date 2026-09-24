import { BadRequestException } from '@nestjs/common';

// Floats lose ordering precision when they grow or get bisected without bound.
const MAX_POSITION = 1e9;

function parseDateString(value: unknown, field: string): Date {
  const parsed = new Date(value as string);
  if (typeof value !== 'string' || Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`Invalid ${field}`);
  }
  return parsed;
}

export interface UpsertCardInput {
  title?: string;
  description?: string | null;
  dueDate?: Date | null;
  dueDone?: boolean;
  position?: number;
  listId?: string;
}

export function parseUpsertCard(body: unknown): UpsertCardInput {
  const { title, description, dueDate, dueDone, position, listId } = (body ?? {}) as Record<
    string,
    unknown
  >;
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

  if (dueDate !== undefined) {
    result.dueDate = dueDate === null ? null : parseDateString(dueDate, 'dueDate');
  }

  if (dueDone !== undefined) {
    if (typeof dueDone !== 'boolean') throw new BadRequestException('dueDone must be a boolean');
    result.dueDone = dueDone;
  }

  // Applied last so it wins over an explicit dueDone in the same body: a completion
  // flag on a card with no due date is meaningless.
  if (result.dueDate === null) result.dueDone = false;

  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isFinite(position) || Math.abs(position) > MAX_POSITION) {
      throw new BadRequestException(`Position must be a number within ±${MAX_POSITION}`);
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

// Mentions are by email: it is the only identifier that is unique per user here.
// A display name would be ambiguous, and inventing @usernames means a whole new
// identity concept nobody asked for.
const MENTION_PATTERN = /@([\w.+-]+@[\w-]+\.[\w.-]+)/g;

export function extractMentions(body: string): string[] {
  return [...new Set(Array.from(body.matchAll(MENTION_PATTERN), (m) => m[1].toLowerCase()))];
}

export function parseCommentBody(body: unknown): string {
  const { body: text } = (body ?? {}) as Record<string, unknown>;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new BadRequestException('Comment body is required');
  }
  if (text.length > 2000) {
    throw new BadRequestException('Comment must be at most 2000 characters');
  }
  return text.trim();
}

export interface UpsertTimeEntryInput {
  date: Date;
  hours: number;
  note?: string;
}

export function parseTimeEntry(body: unknown): UpsertTimeEntryInput {
  const { date, hours, note } = (body ?? {}) as Record<string, unknown>;

  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new BadRequestException('Hours must be a number between 0 and 24');
  }
  if (note !== undefined && (typeof note !== 'string' || note.length > 200)) {
    throw new BadRequestException('Note must be a string of at most 200 characters');
  }

  return { date: parseDateString(date, 'date'), hours, note: (note as string | undefined)?.trim() || undefined };
}

export function parseChecklistText(body: unknown): string {
  const { text } = (body ?? {}) as Record<string, unknown>;
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new BadRequestException('Text is required');
  }
  if (text.length > 200) {
    throw new BadRequestException('Text must be at most 200 characters');
  }
  return text.trim();
}

export interface UpdateChecklistItemInput {
  text?: string;
  done?: boolean;
}

export function parseChecklistUpdate(body: unknown): UpdateChecklistItemInput {
  const { text, done } = (body ?? {}) as Record<string, unknown>;
  const result: UpdateChecklistItemInput = {};

  if (text !== undefined) result.text = parseChecklistText({ text });
  if (done !== undefined) {
    if (typeof done !== 'boolean') throw new BadRequestException('done must be a boolean');
    result.done = done;
  }

  return result;
}
