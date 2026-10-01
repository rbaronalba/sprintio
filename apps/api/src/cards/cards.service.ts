import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from '../boards/access.js';
import { EventsService } from '../events/events.service.js';
import { UPLOAD_DIR } from './uploads.js';
import { CARD_FACE_SELECT, withTotals } from './card-include.js';
import { extractMentions } from './dto.js';
import { place, type Placement } from '../common/position.js';
import type { UpdateChecklistItemInput, UpdateTimeEntryInput, UpsertCardInput, UpsertTimeEntryInput } from './dto.js';

const MAX_CARDS_PER_LIST = 200;
/** Archived cards don't count against the list's 200, but archiving can't be a way around every limit. */
const MAX_CARDS_INCL_ARCHIVED = 1000;
const MAX_CHECKLIST_ITEMS = 100;
/** Per uploader, across every board: what stops one account from filling the disk 8 MB at a time. */
const MAX_UPLOAD_BYTES_PER_USER = 500 * 1024 * 1024;
/** Activity is a feed, not an audit export. */
const ACTIVITY_PAGE = 50;
const COMMENT_PAGE = 50;
/** A card is a task, not a chat room: past this, something is misusing it. */
const MAX_COMMENTS_PER_CARD = 1000;
const MAX_ATTACHMENTS_PER_CARD = 100;

const COMMENT_INCLUDE = {
  author: { select: { email: true, displayName: true } },
  attachments: { select: { id: true, path: true, originalName: true } },
} as const;

@Injectable()
export class CardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  private async assertListAccess(userId: string, listId: string) {
    const list = await this.prisma.list.findFirst({ where: { id: listId, board: memberOf(userId) } });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  private async assertRoom(listId: string) {
    const [visible, all] = await Promise.all([
      this.prisma.card.count({ where: { listId, archived: false } }),
      this.prisma.card.count({ where: { listId } }),
    ]);
    // ponytail: count-then-write, so two racing requests can land one card over; a soft cap.
    if (visible >= MAX_CARDS_PER_LIST || all >= MAX_CARDS_INCL_ARCHIVED) {
      throw new BadRequestException('Card limit reached');
    }
  }

  /** Where card `id` lands right after `afterId` in `listId`, from current rows. */
  private async placeIn(listId: string, id: string, afterId: string | null): Promise<Placement> {
    const siblings = await this.prisma.card.findMany({
      where: { listId, id: { not: id } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { id: true, position: true },
    });
    const placement = place(siblings, afterId);
    if (!placement) throw new BadRequestException('afterId is not a card in the target list');
    return placement;
  }

  async create(userId: string, listId: string, title: string) {
    const list = await this.assertListAccess(userId, listId);
    await this.assertRoom(listId);
    const last = await this.prisma.card.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
    });
    const [card] = await withTotals(
      this.prisma,
      [await this.prisma.card.create({ data: { title, listId, position: (last?.position ?? 0) + 1000 }, select: CARD_FACE_SELECT })],
    );
    await this.events.record({
      type: 'CARD_CREATED',
      boardId: list.boardId,
      actorId: userId,
      cardId: card.id,
      data: { title: card.title, listTitle: list.title },
    });
    return card;
  }

  async findAccessible(userId: string, id: string) {
    const card = await this.prisma.card.findFirst({
      where: { id, list: { board: memberOf(userId) } },
      include: { list: { select: { boardId: true } } },
    });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  /** One card as the board shows it, plus its description: what the modal and live updates fetch. */
  async getOne(userId: string, id: string) {
    await this.findAccessible(userId, id);
    const card = await this.prisma.card.findUniqueOrThrow({
      where: { id },
      select: { ...CARD_FACE_SELECT, description: true },
    });
    return (await withTotals(this.prisma, [card]))[0];
  }

  async update(userId: string, id: string, input: UpsertCardInput) {
    const card = await this.findAccessible(userId, id);
    const { afterId, ...fields } = input;
    let target: { title: string } | null = null;
    if (fields.listId) {
      target = await this.assertListAccess(userId, fields.listId);
      if (fields.listId !== card.listId) await this.assertRoom(fields.listId);
    }
    // Restoring an archived card puts it back on the board: the visible cap applies again.
    if (card.archived && fields.archived === false) await this.assertRoom(fields.listId ?? card.listId);
    const placement = afterId === undefined ? null : await this.placeIn(fields.listId ?? card.listId, id, afterId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // ponytail: one UPDATE per sibling (max 1000), only when a gap runs out; a VALUES join if that ever shows up.
      for (const r of placement?.renumber ?? []) {
        await tx.card.update({ where: { id: r.id }, data: { position: r.position } });
      }
      return tx.card.update({ where: { id }, data: { ...fields, ...(placement && { position: placement.position }) } });
    });
    const renumbered = !!placement?.renumber;
    if (renumbered) {
      // Every position in the list changed: open boards must reload, not patch one card.
      await this.events.record({ type: 'BOARD_REORDERED', boardId: card.list.boardId, actorId: userId, live: true });
    }

    const moved = fields.listId !== undefined && fields.listId !== card.listId;
    if (moved) {
      const from = await this.prisma.list.findUnique({
        where: { id: card.listId },
        select: { title: true },
      });
      await this.events.record({
        type: 'CARD_MOVED',
        boardId: card.list.boardId,
        actorId: userId,
        cardId: id,
        data: { title: updated.title, from: from?.title ?? '?', to: target?.title ?? '?' },
        notify: await this.assigneeIds(id),
      });
    } else if (Object.keys(fields).some((k) => k !== 'listId')) {
      await this.events.record({
        type: 'CARD_UPDATED',
        boardId: card.list.boardId,
        actorId: userId,
        cardId: id,
        data: { title: updated.title, fields: Object.keys(fields) },
      });
    } else if (placement && !renumbered) {
      // A pure drag within the same list is noise in a feed, but open boards still need it.
      await this.events.record({ type: 'CARD_REORDERED', boardId: card.list.boardId, actorId: userId, cardId: id, live: true });
    }
    // `renumbered` tells the caller its local positions are stale: reload the board.
    return { ...updated, renumbered };
  }

  async remove(userId: string, id: string) {
    const card = await this.findAccessible(userId, id);
    await this.prisma.card.delete({ where: { id } });
    // Recorded after the delete, and Event.cardId is deliberately not a foreign key,
    // so "deleted card X" survives the card it describes.
    await this.events.record({
      type: 'CARD_DELETED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId: id,
      data: { title: card.title },
    });
  }

  /** Throws when this upload would take the user past their storage quota, or the card past its cap. */
  private async assertQuota(userId: string, file: Express.Multer.File, cardId: string): Promise<void> {
    if ((await this.prisma.attachment.count({ where: { cardId } })) >= MAX_ATTACHMENTS_PER_CARD) {
      throw new BadRequestException('Attachment limit reached');
    }
    const { _sum } = await this.prisma.attachment.aggregate({ where: { uploaderId: userId }, _sum: { size: true } });
    if ((_sum.size ?? 0) + file.size > MAX_UPLOAD_BYTES_PER_USER) {
      throw new BadRequestException('Storage quota exceeded: delete some attachments first');
    }
  }

  private async assigneeIds(cardId: string): Promise<string[]> {
    const members = await this.prisma.cardMember.findMany({ where: { cardId }, select: { userId: true } });
    return members.map((m) => m.userId);
  }

  async listActivity(userId: string, cardId: string) {
    await this.findAccessible(userId, cardId);
    return this.prisma.event.findMany({
      where: { cardId },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_PAGE,
      include: { actor: { select: { email: true, displayName: true } } },
    });
  }

  // Any member can assign any other member; the target must belong to the card's board.
  async assign(userId: string, cardId: string, targetUserId: string) {
    const card = await this.findAccessible(userId, cardId);
    const member = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: card.list.boardId, userId: targetUserId } },
    });
    if (!member) throw new BadRequestException('User is not a member of this board');
    await this.prisma.cardMember.upsert({
      where: { cardId_userId: { cardId, userId: targetUserId } },
      create: { cardId, userId: targetUserId },
      update: {},
    });
    await this.events.record({
      type: 'CARD_ASSIGNED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, targetId: targetUserId },
      notify: [targetUserId],
    });
  }

  async unassign(userId: string, cardId: string, targetUserId: string) {
    const card = await this.findAccessible(userId, cardId);
    const { count } = await this.prisma.cardMember.deleteMany({ where: { cardId, userId: targetUserId } });
    if (count === 0) return;
    await this.events.record({
      type: 'CARD_UNASSIGNED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, targetId: targetUserId },
      notify: [targetUserId],
    });
  }

  async addLabel(userId: string, cardId: string, labelId: string) {
    const card = await this.findAccessible(userId, cardId);
    const label = await this.prisma.label.findFirst({ where: { id: labelId, boardId: card.list.boardId } });
    if (!label) throw new BadRequestException('Label does not belong to this board');
    await this.prisma.cardLabel.upsert({
      where: { cardId_labelId: { cardId, labelId } },
      create: { cardId, labelId },
      update: {},
    });
    await this.events.record({
      type: 'LABEL_ADDED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, labelName: label.name, labelColor: label.color },
    });
  }

  async removeLabel(userId: string, cardId: string, labelId: string) {
    const card = await this.findAccessible(userId, cardId);
    const label = await this.prisma.label.findUnique({ where: { id: labelId }, select: { name: true } });
    const { count } = await this.prisma.cardLabel.deleteMany({ where: { cardId, labelId } });
    if (count === 0) return;
    await this.events.record({
      type: 'LABEL_REMOVED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, labelName: label?.name ?? '' },
    });
  }

  /** Newest page first in the query, returned oldest-first so the UI can simply render it. */
  async listComments(userId: string, cardId: string, before?: string) {
    await this.findAccessible(userId, cardId);
    const page = await this.prisma.comment.findMany({
      where: { cardId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: COMMENT_PAGE,
      ...(before && { cursor: { id: before }, skip: 1 }),
      include: COMMENT_INCLUDE,
    });
    return page.reverse();
  }

  async addComment(userId: string, cardId: string, body: string, file?: Express.Multer.File) {
    const card = await this.findAccessible(userId, cardId);
    if ((await this.prisma.comment.count({ where: { cardId } })) >= MAX_COMMENTS_PER_CARD) {
      throw new BadRequestException('Comment limit reached');
    }
    if (file) await this.assertQuota(userId, file, cardId);
    const comment = await this.prisma.comment.create({
      data: {
        cardId,
        authorId: userId,
        body,
        attachments: file && {
          create: { cardId, uploaderId: userId, path: file.filename, originalName: file.originalname, size: file.size },
        },
      },
      include: COMMENT_INCLUDE,
    });

    // Notify the people already on the card, plus anyone mentioned by email.
    // Mentions are resolved against board members only, so a comment cannot be used
    // to probe whether an arbitrary email has an account here.
    const mentioned = await this.resolveMentions(card.list.boardId, extractMentions(body));
    await this.events.record({
      type: 'COMMENT_ADDED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, excerpt: body.slice(0, 140), mentioned },
      notify: [...(await this.assigneeIds(cardId)), ...mentioned],
    });
    return comment;
  }

  private async resolveMentions(boardId: string, emails: string[]): Promise<string[]> {
    if (emails.length === 0) return [];
    const members = await this.prisma.boardMember.findMany({
      where: { boardId, user: { email: { in: emails, mode: 'insensitive' } } },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  async removeComment(userId: string, cardId: string, commentId: string) {
    const card = await this.findAccessible(userId, cardId);
    // Only the author can delete their own comment. Its images go with it (cascade), files too.
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, cardId, authorId: userId },
      include: { attachments: { select: { path: true } } },
    });
    if (!comment) throw new BadRequestException('Comment not found');
    await this.prisma.comment.delete({ where: { id: comment.id } });
    await Promise.all(comment.attachments.map((a) => unlink(join(UPLOAD_DIR, a.path)).catch(() => {})));
    await this.events.record({
      type: 'COMMENT_DELETED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title },
    });
  }

  async listTimeEntries(userId: string, cardId: string) {
    await this.findAccessible(userId, cardId);
    return this.prisma.timeEntry.findMany({
      where: { cardId },
      orderBy: { date: 'desc' },
      include: { user: { select: { email: true, displayName: true } } },
    });
  }

  async addTimeEntry(userId: string, cardId: string, { userId: forUserId, ...input }: UpsertTimeEntryInput) {
    const card = await this.findAccessible(userId, cardId);
    // Any member may log time on someone's behalf, but only for a member of this board.
    const owner = forUserId ?? userId;
    if (owner !== userId) {
      const member = await this.prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId: card.list.boardId, userId: owner } },
      });
      if (!member) throw new BadRequestException('User is not a member of this board');
    }
    // Same person + same day adds onto the existing row instead of making a new one.
    const { date, hours, note } = input;
    const entry = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.timeEntry.findUnique({
        where: { cardId_userId_date: { cardId, userId: owner, date } },
      });
      const merged = await tx.timeEntry.upsert({
        where: { cardId_userId_date: { cardId, userId: owner, date } },
        create: { date, hours, note, cardId, userId: owner },
        update: {
          hours: { increment: hours },
          ...(note && { note: existing?.note ? `${existing.note}; ${note}`.slice(0, 200) : note }),
        },
        include: { user: { select: { email: true, displayName: true } } },
      });
      if (merged.hours > 24) throw new BadRequestException('A day cannot have more than 24 hours');
      return merged;
    });
    await this.events.record({
      type: 'TIME_LOGGED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, hours: input.hours },
    });
    return entry;
  }

  async updateTimeEntry(userId: string, cardId: string, entryId: string, input: UpdateTimeEntryInput) {
    await this.findAccessible(userId, cardId);
    // Same rule as removal: only the person whose time it is can change it.
    const { count } = await this.prisma.timeEntry.updateMany({ where: { id: entryId, cardId, userId }, data: input });
    if (count === 0) throw new BadRequestException('Time entry not found');
    return this.prisma.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { user: { select: { email: true, displayName: true } } },
    });
  }

  async removeTimeEntry(userId: string, cardId: string, entryId: string) {
    await this.findAccessible(userId, cardId);
    // Only the person who logged the time can remove the entry.
    const { count } = await this.prisma.timeEntry.deleteMany({ where: { id: entryId, cardId, userId } });
    if (count === 0) throw new BadRequestException('Time entry not found');
  }

  async listAttachments(userId: string, cardId: string) {
    await this.findAccessible(userId, cardId);
    // Card-level only: images posted with a comment come back with that comment.
    return this.prisma.attachment.findMany({
      where: { cardId, commentId: null },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { email: true } } },
    });
  }

  async addAttachment(userId: string, cardId: string, file: Express.Multer.File) {
    const card = await this.findAccessible(userId, cardId);
    await this.assertQuota(userId, file, cardId);
    const attachment = await this.prisma.attachment.create({
      data: { cardId, uploaderId: userId, path: file.filename, originalName: file.originalname, size: file.size },
      include: { uploader: { select: { email: true } } },
    });
    await this.events.record({
      type: 'ATTACHMENT_ADDED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, name: attachment.originalName },
    });
    return attachment;
  }

  async removeAttachment(userId: string, cardId: string, attachmentId: string) {
    const card = await this.findAccessible(userId, cardId);
    // Only the uploader can delete their own attachment.
    const attachment = await this.prisma.attachment.findFirst({ where: { id: attachmentId, cardId, uploaderId: userId } });
    if (!attachment) throw new BadRequestException('Attachment not found');
    await this.prisma.attachment.delete({ where: { id: attachment.id } });
    await unlink(join(UPLOAD_DIR, attachment.path)).catch(() => {});
    await this.events.record({
      type: 'ATTACHMENT_DELETED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, name: attachment.originalName },
    });
  }

  async listChecklist(userId: string, cardId: string) {
    await this.findAccessible(userId, cardId);
    return this.prisma.checklistItem.findMany({ where: { cardId }, orderBy: { position: 'asc' } });
  }

  async addChecklistItem(userId: string, cardId: string, text: string) {
    const card = await this.findAccessible(userId, cardId);
    if ((await this.prisma.checklistItem.count({ where: { cardId } })) >= MAX_CHECKLIST_ITEMS) {
      throw new BadRequestException('Checklist item limit reached');
    }
    const last = await this.prisma.checklistItem.findFirst({ where: { cardId }, orderBy: { position: 'desc' } });
    const item = await this.prisma.checklistItem.create({
      data: { cardId, text, position: (last?.position ?? 0) + 1000 },
    });
    await this.events.record({
      type: 'CHECKLIST_ADDED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, text: item.text },
    });
    return item;
  }

  async updateChecklistItem(userId: string, cardId: string, itemId: string, input: UpdateChecklistItemInput) {
    const card = await this.findAccessible(userId, cardId);
    const { count } = await this.prisma.checklistItem.updateMany({ where: { id: itemId, cardId }, data: input });
    if (count === 0) throw new BadRequestException('Checklist item not found');
    if (input.done !== undefined) {
      await this.events.record({
        type: 'CHECKLIST_TOGGLED',
        boardId: card.list.boardId,
        actorId: userId,
        cardId,
        data: { title: card.title, text: input.text, done: input.done },
      });
    }
  }

  async removeChecklistItem(userId: string, cardId: string, itemId: string) {
    const card = await this.findAccessible(userId, cardId);
    const item = await this.prisma.checklistItem.findFirst({ where: { id: itemId, cardId } });
    if (!item) return;
    await this.prisma.checklistItem.delete({ where: { id: item.id } });
    await this.events.record({
      type: 'CHECKLIST_DELETED',
      boardId: card.list.boardId,
      actorId: userId,
      cardId,
      data: { title: card.title, text: item.text },
    });
  }
}
