import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from './access.js';
import { EventsService } from '../events/events.service.js';
import type { UpsertLabelInput } from './dto.js';

const MAX_BOARDS_PER_USER = 100;
const MAX_MEMBERS_PER_BOARD = 20;
const MAX_LABELS_PER_BOARD = 20;
const ACTIVITY_PAGE = 50;
/** A search is a jump-to, not a report: more than this and you should be filtering a board. */
const SEARCH_LIMIT = 25;

@Injectable()
export class BoardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  list(userId: string) {
    return this.prisma.board.findMany({
      where: memberOf(userId),
      orderBy: { createdAt: 'desc' },
      omit: { inviteToken: true },
    });
  }

  async create(ownerId: string, title: string) {
    if ((await this.prisma.board.count({ where: { ownerId } })) >= MAX_BOARDS_PER_USER) {
      throw new BadRequestException('Board limit reached');
    }
    return this.prisma.board.create({
      data: { title, ownerId, members: { create: { userId: ownerId } } },
      omit: { inviteToken: true },
    });
  }

  // Any member can read a board; only the owner gets to see the invite token.
  async get(userId: string, id: string) {
    const board = await this.prisma.board.findFirst({
      where: { id, ...memberOf(userId) },
      include: {
        members: { include: { user: { select: { email: true } } }, orderBy: { joinedAt: 'asc' } },
        labels: { orderBy: { name: 'asc' } },
      },
    });
    if (!board) throw new NotFoundException('Board not found');
    return {
      id: board.id,
      title: board.title,
      ownerId: board.ownerId,
      inviteToken: board.ownerId === userId ? board.inviteToken : null,
      members: board.members.map((m) => ({ userId: m.userId, email: m.user.email })),
      labels: board.labels,
    };
  }

  async findOwned(ownerId: string, id: string) {
    const board = await this.prisma.board.findFirst({ where: { id, ownerId } });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  async update(ownerId: string, id: string, title: string) {
    await this.findOwned(ownerId, id);
    return this.prisma.board.update({ where: { id }, data: { title }, omit: { inviteToken: true } });
  }

  async remove(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.board.delete({ where: { id } });
  }

  async createInvite(ownerId: string, id: string) {
    const board = await this.findOwned(ownerId, id);
    if (board.inviteToken) return { token: board.inviteToken };
    // 192 bits: an unguessable capability, so knowing the link is what grants the right to join.
    const token = randomBytes(24).toString('hex');
    await this.prisma.board.update({ where: { id }, data: { inviteToken: token } });
    return { token };
  }

  async revokeInvite(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.board.update({ where: { id }, data: { inviteToken: null } });
  }

  private async assertMember(userId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, ...memberOf(userId) } });
    if (!board) throw new NotFoundException('Board not found');
  }

  async listLabels(userId: string, boardId: string) {
    await this.assertMember(userId, boardId);
    return this.prisma.label.findMany({ where: { boardId }, orderBy: { name: 'asc' } });
  }

  async createLabel(userId: string, boardId: string, input: UpsertLabelInput) {
    await this.assertMember(userId, boardId);
    if ((await this.prisma.label.count({ where: { boardId } })) >= MAX_LABELS_PER_BOARD) {
      throw new BadRequestException('Label limit reached');
    }
    return this.prisma.label.create({ data: { ...input, boardId } });
  }

  async removeLabel(userId: string, boardId: string, id: string) {
    await this.assertMember(userId, boardId);
    await this.prisma.label.deleteMany({ where: { id, boardId } });
  }

  private async byToken(token: string) {
    const board = await this.prisma.board.findUnique({ where: { inviteToken: token } });
    if (!board) throw new NotFoundException('Invitation not found or no longer valid');
    return board;
  }

  async previewInvite(userId: string, token: string) {
    const board = await this.byToken(token);
    const member = await this.prisma.boardMember.findUnique({
      where: { boardId_userId: { boardId: board.id, userId } },
    });
    return { boardId: board.id, title: board.title, isMember: member !== null };
  }

  async join(userId: string, token: string) {
    const board = await this.byToken(token);
    const key = { boardId_userId: { boardId: board.id, userId } };
    if (!(await this.prisma.boardMember.findUnique({ where: key }))) {
      if ((await this.prisma.boardMember.count({ where: { boardId: board.id } })) >= MAX_MEMBERS_PER_BOARD) {
        throw new BadRequestException('This board is full');
      }
      await this.prisma.boardMember.create({ data: { boardId: board.id, userId } });
      // The actor is the joiner: EventsService uses exactly this to widen an open
      // stream's board set without re-querying membership on every message.
      await this.events.record({
        type: 'MEMBER_JOINED',
        boardId: board.id,
        actorId: userId,
        data: { boardTitle: board.title },
      });
    }
    return { boardId: board.id };
  }

  async listActivity(userId: string, boardId: string) {
    await this.assertMember(userId, boardId);
    return this.prisma.event.findMany({
      where: { boardId },
      orderBy: { createdAt: 'desc' },
      take: ACTIVITY_PAGE,
      include: { actor: { select: { email: true, displayName: true } } },
    });
  }

  /**
   * Global card search across every board the user belongs to. The membership filter
   * is part of the where clause, not a post-filter, so there is no path that returns
   * a card from someone else's board.
   */
  async search(userId: string, term: string) {
    const query = term.trim();
    if (query.length < 2) return [];
    const cards = await this.prisma.card.findMany({
      where: {
        list: { board: memberOf(userId) },
        OR: [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_LIMIT,
      select: {
        id: true,
        title: true,
        list: { select: { id: true, title: true, board: { select: { id: true, title: true } } } },
      },
    });
    return cards.map((card) => ({
      cardId: card.id,
      title: card.title,
      listTitle: card.list.title,
      boardId: card.list.board.id,
      boardTitle: card.list.board.title,
    }));
  }
}
