import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from '../boards/access.js';
import { EventsService } from '../events/events.service.js';
import { CARD_FACE_SELECT, withTotals } from '../cards/card-include.js';
import type { UpsertListInput } from './dto.js';
import { removeUpload } from '../cards/uploads.js';
import { place } from '../common/position.js';

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
    const lists = await this.prisma.list.findMany({
      where: { boardId },
      // id breaks ties, so two items that ended up on the same position keep a stable order.
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: {
        cards: { where: { archived: false }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: CARD_FACE_SELECT },
      },
    });
    // Totals for the whole board in one pass, then dealt back to their lists.
    const cards = new Map((await withTotals(this.prisma, lists.flatMap((l) => l.cards))).map((c) => [c.id, c]));
    return lists.map((l) => ({ ...l, cards: l.cards.map((c) => cards.get(c.id)!) }));
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
    const { afterId, ...fields } = input;
    let renumber: { id: string; position: number }[] = [];
    let position: number | undefined;
    if (afterId !== undefined) {
      const siblings = await this.prisma.list.findMany({
        where: { boardId: list.boardId, id: { not: id } },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: { id: true, position: true },
      });
      const placement = place(siblings, afterId);
      if (!placement) throw new BadRequestException('afterId is not a list on this board');
      ({ position, renumber = [] } = placement);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      for (const r of renumber) await tx.list.update({ where: { id: r.id }, data: { position: r.position } });
      return tx.list.update({ where: { id }, data: { ...fields, ...(position !== undefined && { position }) } });
    });
    if (afterId !== undefined) {
      // Not feed-worthy, but other open boards must re-read the order (a full reload: lists are few).
      await this.events.record({ type: 'LIST_REORDERED', boardId: list.boardId, actorId: userId, live: true });
    }
    // Reordering lists is not feed-worthy; renaming them is.
    if (input.title !== undefined && input.title !== list.title) {
      await this.events.record({
        type: 'LIST_UPDATED',
        boardId: list.boardId,
        actorId: userId,
        data: { from: list.title, listTitle: updated.title },
      });
    }
    return { ...updated, renumbered: renumber.length > 0 };
  }

  /** Same rules as the board's: any member; a just-uploaded image is deleted again if access fails. */
  async setBackground(userId: string, id: string, background: string) {
    const list = await this.findAccessible(userId, id).catch(async (e: unknown) => {
      await removeUpload(background);
      throw e;
    });
    await this.prisma.list.update({ where: { id }, data: { background } });
    await removeUpload(list.background);
    await this.events.record({
      type: 'BACKGROUND_CHANGED',
      boardId: list.boardId,
      actorId: userId,
      data: { title: list.title },
    });
    return { background };
  }

  async remove(userId: string, id: string) {
    const list = await this.findAccessible(userId, id);
    await this.prisma.list.delete({ where: { id } });
    await removeUpload(list.background);
    await this.events.record({
      type: 'LIST_DELETED',
      boardId: list.boardId,
      actorId: userId,
      data: { listTitle: list.title },
    });
  }
}
