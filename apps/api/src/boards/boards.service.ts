import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { memberOf } from './access.js';

const MAX_BOARDS_PER_USER = 100;
const MAX_MEMBERS_PER_BOARD = 20;

@Injectable()
export class BoardsService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: { members: { include: { user: { select: { email: true } } }, orderBy: { joinedAt: 'asc' } } },
    });
    if (!board) throw new NotFoundException('Board not found');
    return {
      id: board.id,
      title: board.title,
      ownerId: board.ownerId,
      inviteToken: board.ownerId === userId ? board.inviteToken : null,
      members: board.members.map((m) => ({ userId: m.userId, email: m.user.email })),
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
    }
    return { boardId: board.id };
  }
}
