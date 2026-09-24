import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from '../boards/access.js';
import { EventsService } from '../events/events.service.js';
import { UPLOAD_DIR } from './uploads.js';
import { CARD_FACE_INCLUDE } from './card-include.js';
import { extractMentions } from './dto.js';
import type { UpdateChecklistItemInput, UpsertCardInput, UpsertTimeEntryInput } from './dto.js';

const MAX_CARDS_PER_LIST = 200;
const MAX_CHECKLIST_ITEMS = 100;
/** Activity is a feed, not an audit export. */
const ACTIVITY_PAGE = 50;

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
    if ((await this.prisma.card.count({ where: { listId } })) >= MAX_CARDS_PER_LIST) {
      throw new BadRequestException('Card limit reached');
    }
  }

  async create(userId: string, listId: string, title: string) {
    const list = await this.assertListAccess(userId, listId);
    await this.assertRoom(listId);
    const last = await this.prisma.card.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
    });
    const card = await this.prisma.card.create({
      data: { title, listId, position: (last?.position ?? 0) + 1000 },
      include: CARD_FACE_INCLUDE,
    });
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

  async update(userId: string, id: string, input: UpsertCardInput) {
    const card = await this.findAccessible(userId, id);
    let target: { title: string } | null = null;
    if (input.listId) {
      target = await this.assertListAccess(userId, input.listId);
      if (input.listId !== card.listId) await this.assertRoom(input.listId);
    }
    const updated = await this.prisma.card.update({ where: { id }, data: input });

    const moved = input.listId !== undefined && input.listId !== card.listId;
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
    } else if (!isReorderOnly(input)) {
      // A pure drag within the same list is noise in a feed, so it isn't recorded.
      await this.events.record({
        type: 'CARD_UPDATED',
        boardId: card.list.boardId,
        actorId: userId,
        cardId: id,
        data: { title: updated.title, fields: Object.keys(input).filter((k) => k !== 'position') },
      });
    }
    return updated;
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

  async listComments(userId: string, cardId: string) {
    await this.findAccessible(userId, cardId);
    return this.prisma.comment.findMany({
      where: { cardId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { email: true } } },
    });
  }

  async addComment(userId: string, cardId: string, body: string) {
    const card = await this.findAccessible(userId, cardId);
    const comment = await this.prisma.comment.create({
      data: { cardId, authorId: userId, body },
      include: { author: { select: { email: true } } },
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
    // Only the author can delete their own comment.
    const { count } = await this.prisma.comment.deleteMany({ where: { id: commentId, cardId, authorId: userId } });
    if (count === 0) throw new BadRequestException('Comment not found');
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
      include: { user: { select: { email: true } } },
    });
  }

  async addTimeEntry(userId: string, cardId: string, input: UpsertTimeEntryInput) {
    const card = await this.findAccessible(userId, cardId);
    const entry = await this.prisma.timeEntry.create({
      data: { ...input, cardId, userId },
      include: { user: { select: { email: true } } },
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

  async removeTimeEntry(userId: string, cardId: string, entryId: string) {
    await this.findAccessible(userId, cardId);
    // Only the person who logged the time can remove the entry.
    const { count } = await this.prisma.timeEntry.deleteMany({ where: { id: entryId, cardId, userId } });
    if (count === 0) throw new BadRequestException('Time entry not found');
  }

  async listAttachments(userId: string, cardId: string) {
    await this.findAccessible(userId, cardId);
    return this.prisma.attachment.findMany({
      where: { cardId },
      orderBy: { createdAt: 'desc' },
      include: { uploader: { select: { email: true } } },
    });
  }

  async addAttachment(userId: string, cardId: string, file: Express.Multer.File) {
    const card = await this.findAccessible(userId, cardId);
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

/** A drag that only changes order says nothing worth putting in a feed. */
function isReorderOnly(input: UpsertCardInput): boolean {
  return Object.keys(input).every((key) => key === 'position' || key === 'listId');
}
