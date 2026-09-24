import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from '../boards/access.js';
import { EventsService } from '../events/events.service.js';
import { CARD_FACE_INCLUDE } from '../cards/card-include.js';
import type { UpsertListInput } from './dto.js';

const MAX_LISTS_PER_BOARD = 30;

@Injectable()
export class ListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  private async assertBoardAccess(userId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, ...memberOf(userId) } });
    if (!board) throw new NotFoundException('Board not found');
  }

  async list(userId: string, boardId: string) {
    await this.assertBoardAccess(userId, boardId);
    return this.prisma.list.findMany({
      where: { boardId },
      orderBy: { position: 'asc' },
      include: {
        cards: { orderBy: { position: 'asc' }, include: CARD_FACE_INCLUDE },
      },
    });
  }

  async create(userId: string, boardId: string, title: string) {
    await this.assertBoardAccess(userId, boardId);
    if ((await this.prisma.list.count({ where: { boardId } })) >= MAX_LISTS_PER_BOARD) {
      throw new BadRequestException('List limit reached');
    }
    const last = await this.prisma.list.findFirst({
      where: { boardId },
      orderBy: { position: 'desc' },
    });
    const list = await this.prisma.list.create({
      data: { title, boardId, position: (last?.position ?? 0) + 1000 },
    });
    await this.events.record({
      type: 'LIST_CREATED',
      boardId,
      actorId: userId,
      data: { listTitle: list.title },
    });
    return list;
  }

  async findAccessible(userId: string, id: string) {
    const list = await this.prisma.list.findFirst({
      where: { id, board: memberOf(userId) },
    });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  async update(userId: string, id: string, input: UpsertListInput) {
    const list = await this.findAccessible(userId, id);
    const updated = await this.prisma.list.update({ where: { id }, data: input });
    // Reordering lists is not feed-worthy; renaming them is.
    if (input.title !== undefined && input.title !== list.title) {
      await this.events.record({
        type: 'LIST_UPDATED',
        boardId: list.boardId,
        actorId: userId,
        data: { from: list.title, listTitle: updated.title },
      });
    }
    return updated;
  }

  async remove(userId: string, id: string) {
    const list = await this.findAccessible(userId, id);
    await this.prisma.list.delete({ where: { id } });
    await this.events.record({
      type: 'LIST_DELETED',
      boardId: list.boardId,
      actorId: userId,
      data: { listTitle: list.title },
    });
  }
}
