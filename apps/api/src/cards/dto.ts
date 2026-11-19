import { BadRequestException } from '@nestjs/common';

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
  archived?: boolean;
  /** A move: land right after this card (null = top). The server works out the position. */
  afterId?: string | null;
  listId?: string;
}

function parseTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new BadRequestException('Title is required');
  }
  if (title.length > 200) {
    throw new BadRequestException('Title must be at most 200 characters');
  }
  return title.trim();
}

function parseDescription(description: unknown): string | null {
  if (description === null) return null;
  if (typeof description !== 'string') {
    throw new BadRequestException('Description must be a string');
  }
  if (description.length > 5000) {
    throw new BadRequestException(
      'Description must be at most 5000 characters',
    );
  }
  return description.trim() || null;
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean')
    throw new BadRequestException(`${field} must be a boolean`);
  return value;
}

function parseAfterId(afterId: unknown): string | null {
  if (afterId === null) return null;
  if (typeof afterId !== 'string' || afterId.length === 0) {
    throw new BadRequestException('afterId must be an id or null');
  }
  return afterId;
}

function parseListId(listId: unknown): string {
  if (typeof listId !== 'string' || listId.length === 0) {
    throw new BadRequestException('Invalid listId');
  }
  return listId;
}

function parseDueDate(dueDate: unknown): Date | null {
  return dueDate === null ? null : parseDateString(dueDate, 'dueDate');
}

const CARD_FIELD_PARSERS: {
  [K in keyof UpsertCardInput]-?: (value: unknown) => UpsertCardInput[K];
} = {
  title: parseTitle,
  description: parseDescription,
  dueDate: parseDueDate,
  dueDone: (value) => parseBoolean(value, 'dueDone'),
  archived: (value) => parseBoolean(value, 'archived'),
  afterId: parseAfterId,
  listId: parseListId,
};

/** Each field is optional (PATCH semantics): only the ones present are validated and returned. */
export function parseUpsertCard(body: unknown): UpsertCardInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const result: UpsertCardInput = {};

  for (const field of Object.keys(
    CARD_FIELD_PARSERS,
  ) as (keyof UpsertCardInput)[]) {
    if (raw[field] !== undefined)
      Object.assign(result, { [field]: CARD_FIELD_PARSERS[field](raw[field]) });
  }
  // A completion flag on a card with no due date is meaningless, so it wins over an
  // explicit dueDone in the same body.
  if (result.dueDate === null) result.dueDone = false;

  return result;
}

// Mentions are by email: it is the only identifier that is unique per user here.
// A display name would be ambiguous, and inventing @usernames means a whole new
// identity concept nobody asked for.
const MENTION_PATTERN = /@([\w.+-]+@[\w-]+\.[\w.-]+)/g;

export function extractMentions(body: string): string[] {
  return [
    ...new Set(
      Array.from(body.matchAll(MENTION_PATTERN), (m) => m[1].toLowerCase()),
    ),
  ];
}

/** `withFile`: an image-only comment is fine, so the text may be empty. */
export function parseCommentBody(body: unknown, withFile = false): string {
  const { body: text } = (body ?? {}) as Record<string, unknown>;
  const value = text === undefined && withFile ? '' : text;
  if (typeof value !== 'string' || isBlankWithoutFile(value, withFile)) {
    throw new BadRequestException('Comment body is required');
  }
  if (value.length > 2000) {
    throw new BadRequestException('Comment must be at most 2000 characters');
  }
  return value.trim();
}

function isBlankWithoutFile(text: string, withFile: boolean): boolean {
  return !withFile && text.trim().length === 0;
}

export interface UpsertTimeEntryInput {
  date: Date;
  hours: number;
  note?: string;
  /** Whose time this is. Omitted means the caller's own. */
  userId?: string;
}

function parseHours(hours: unknown): number {
  if (
    typeof hours !== 'number' ||
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24
  ) {
    throw new BadRequestException('Hours must be a number between 0 and 24');
  }
  return hours;
}

function parseNote(note: unknown): string | undefined {
  if (note === undefined) return undefined;
  if (typeof note !== 'string' || note.length > 200) {
    throw new BadRequestException(
      'Note must be a string of at most 200 characters',
    );
  }
  return note.trim() || undefined;
}

function parseUserId(userId: unknown): string | undefined {
  if (userId === undefined) return undefined;
  if (typeof userId !== 'string' || userId.length === 0)
    throw new BadRequestException('Invalid userId');
  return userId;
}

export function parseTimeEntry(body: unknown): UpsertTimeEntryInput {
  const { date, hours, note, userId } = (body ?? {}) as Record<string, unknown>;
  const validHours = parseHours(hours);
  const validNote = parseNote(note);
  const validUserId = parseUserId(userId);
  return {
    date: parseDateString(date, 'date'),
    hours: validHours,
    note: validNote,
    userId: validUserId,
  };
}

export interface UpdateTimeEntryInput {
  hours: number;
  note: string | null;
}

export function parseTimeEntryUpdate(body: unknown): UpdateTimeEntryInput {
  const { hours, note } = (body ?? {}) as Record<string, unknown>;
  return {
    hours: parseHours(hours),
    note: note === null ? null : (parseNote(note) ?? null),
  };
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
    if (typeof done !== 'boolean')
      throw new BadRequestException('done must be a boolean');
    result.done = done;
  }

  return result;
}
