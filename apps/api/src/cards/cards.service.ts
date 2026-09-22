import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from '../boards/access.js';
import type { UpsertCardInput } from './dto.js';

const MAX_CARDS_PER_LIST = 200;

@Injectable()
export class CardsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertListAccess(userId: string, listId: string) {
    const list = await this.prisma.list.findFirst({ where: { id: listId, board: memberOf(userId) } });
    if (!list) throw new NotFoundException('List not found');
  }

  private async assertRoom(listId: string) {
    if ((await this.prisma.card.count({ where: { listId } })) >= MAX_CARDS_PER_LIST) {
      throw new BadRequestException('Card limit reached');
    }
  }

  async create(userId: string, listId: string, title: string) {
    await this.assertListAccess(userId, listId);
    await this.assertRoom(listId);
    const last = await this.prisma.card.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
    });
    return this.prisma.card.create({
      data: { title, listId, position: (last?.position ?? 0) + 1000 },
      include: { assignees: true },
    });
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
    if (input.listId) {
      await this.assertListAccess(userId, input.listId);
      if (input.listId !== card.listId) await this.assertRoom(input.listId);
    }
    return this.prisma.card.update({ where: { id }, data: input });
  }

  async remove(userId: string, id: string) {
    await this.findAccessible(userId, id);
    await this.prisma.card.delete({ where: { id } });
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
  }

  async unassign(userId: string, cardId: string, targetUserId: string) {
    await this.findAccessible(userId, cardId);
    await this.prisma.cardMember.deleteMany({ where: { cardId, userId: targetUserId } });
  }
}
