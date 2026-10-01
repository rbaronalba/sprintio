import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * What a card looks like on the board: everything the face renders, nothing more.
 * No description (up to 5 KB each, only the modal needs it: GET /cards/:id), and
 * hours / checklist come back as totals rather than one object per row.
 * Shared by cards.service and lists.service so every card payload matches.
 */
export const CARD_FACE_SELECT = {
  id: true,
  title: true,
  dueDate: true,
  dueDone: true,
  archived: true,
  position: true,
  listId: true,
  assignees: true,
  labels: true,
  _count: { select: { comments: true, attachments: true, checklist: true } },
} as const;

/**
 * Adds hoursTotal and checklistDone to cards selected with CARD_FACE_SELECT.
 * Two grouped queries for any number of cards, not one per card.
 */
export async function withTotals<T extends { id: string }>(prisma: PrismaService, cards: T[]) {
  if (cards.length === 0) return [];
  const ids = cards.map((c) => c.id);
  const [hours, done] = await Promise.all([
    prisma.timeEntry.groupBy({ by: ['cardId'], where: { cardId: { in: ids } }, _sum: { hours: true } }),
    prisma.checklistItem.groupBy({ by: ['cardId'], where: { cardId: { in: ids }, done: true }, _count: { _all: true } }),
  ]);
  const hoursBy = new Map(hours.map((h) => [h.cardId, h._sum.hours ?? 0]));
  const doneBy = new Map(done.map((d) => [d.cardId, d._count._all]));
  return cards.map((c) => ({ ...c, hoursTotal: hoursBy.get(c.id) ?? 0, checklistDone: doneBy.get(c.id) ?? 0 }));
}
