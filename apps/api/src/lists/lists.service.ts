import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpsertListInput } from './dto.js';

@Injectable()
export class ListsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertBoardOwned(ownerId: string, boardId: string) {
    const board = await this.prisma.board.findFirst({ where: { id: boardId, ownerId } });
    if (!board) throw new NotFoundException('Board not found');
  }

  async list(ownerId: string, boardId: string) {
    await this.assertBoardOwned(ownerId, boardId);
    return this.prisma.list.findMany({
      where: { boardId },
      orderBy: { position: 'asc' },
      include: { cards: { orderBy: { position: 'asc' } } },
    });
  }

  async create(ownerId: string, boardId: string, title: string) {
    await this.assertBoardOwned(ownerId, boardId);
    const last = await this.prisma.list.findFirst({
      where: { boardId },
      orderBy: { position: 'desc' },
    });
    return this.prisma.list.create({
      data: { title, boardId, position: (last?.position ?? 0) + 1000 },
    });
  }

  async findOwned(ownerId: string, id: string) {
    const list = await this.prisma.list.findFirst({
      where: { id, board: { ownerId } },
    });
    if (!list) throw new NotFoundException('List not found');
    return list;
  }

  async update(ownerId: string, id: string, input: UpsertListInput) {
    await this.findOwned(ownerId, id);
    return this.prisma.list.update({ where: { id }, data: input });
  }

  async remove(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.list.delete({ where: { id } });
  }
}
