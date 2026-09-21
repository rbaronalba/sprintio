import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

  list(ownerId: string) {
    return this.prisma.board.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });
  }

  create(ownerId: string, title: string) {
    return this.prisma.board.create({ data: { title, ownerId } });
  }

  async findOwned(ownerId: string, id: string) {
    const board = await this.prisma.board.findFirst({ where: { id, ownerId } });
    if (!board) throw new NotFoundException('Board not found');
    return board;
  }

  async update(ownerId: string, id: string, title: string) {
    await this.findOwned(ownerId, id);
    return this.prisma.board.update({ where: { id }, data: { title } });
  }

  async remove(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.board.delete({ where: { id } });
  }
}
