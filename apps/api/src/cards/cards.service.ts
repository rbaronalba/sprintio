import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { UpsertCardInput } from './dto.js';

@Injectable()
export class CardsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertListOwned(ownerId: string, listId: string) {
    const list = await this.prisma.list.findFirst({ where: { id: listId, board: { ownerId } } });
    if (!list) throw new NotFoundException('List not found');
  }

  async create(ownerId: string, listId: string, title: string) {
    await this.assertListOwned(ownerId, listId);
    const last = await this.prisma.card.findFirst({
      where: { listId },
      orderBy: { position: 'desc' },
    });
    return this.prisma.card.create({
      data: { title, listId, position: (last?.position ?? 0) + 1000 },
    });
  }

  async findOwned(ownerId: string, id: string) {
    const card = await this.prisma.card.findFirst({
      where: { id, list: { board: { ownerId } } },
    });
    if (!card) throw new NotFoundException('Card not found');
    return card;
  }

  async update(ownerId: string, id: string, input: UpsertCardInput) {
    await this.findOwned(ownerId, id);
    if (input.listId) await this.assertListOwned(ownerId, input.listId);
    return this.prisma.card.update({ where: { id }, data: input });
  }

  async remove(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.card.delete({ where: { id } });
  }
}
