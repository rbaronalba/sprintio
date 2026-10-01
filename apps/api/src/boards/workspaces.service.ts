import { randomBytes } from 'node:crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsService } from '../events/events.service.js';
import { MAX_MEMBERS_PER_BOARD, memberOf } from './access.js';

const MAX_WORKSPACES_PER_USER = 20;
// A department, not a company. Same as a board's cap, since everyone joins every board.
const MAX_MEMBERS_PER_WORKSPACE = MAX_MEMBERS_PER_BOARD;

/**
 * Workspace membership is materialized: joining adds a BoardMember row for every board in
 * the workspace, leaving removes them. Every other access check (lists, cards, assignment,
 * the live stream) keeps looking at BoardMember alone.
 */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Workspaces the user belongs to, plus any holding a board they were invited to directly. */
  async list(userId: string) {
    const list = await this.prisma.workspace.findMany({
      where: { OR: [{ members: { some: { userId } } }, { boards: { some: memberOf(userId) } }] },
      orderBy: { createdAt: 'asc' },
      include: { members: { where: { userId }, select: { userId: true } } },
    });
    return list.map(({ members, inviteToken, ...ws }) => ({
      ...ws,
      isMember: members.length > 0,
      // Only the owner may see (and so hand out) the invite link.
      inviteToken: ws.ownerId === userId ? inviteToken : null,
    }));
  }

  async create(ownerId: string, name: string) {
    if ((await this.prisma.workspace.count({ where: { ownerId } })) >= MAX_WORKSPACES_PER_USER) {
      throw new BadRequestException('Workspace limit reached');
    }
    const ws = await this.prisma.workspace.create({
      data: { name, ownerId, members: { create: { userId: ownerId } } },
    });
    return { ...ws, isMember: true };
  }

  private async findOwned(ownerId: string, id: string) {
    const ws = await this.prisma.workspace.findFirst({ where: { id, ownerId } });
    if (!ws) throw new NotFoundException('Workspace not found');
    return ws;
  }

  async rename(ownerId: string, id: string, name: string) {
    await this.findOwned(ownerId, id);
    return this.prisma.workspace.update({ where: { id }, data: { name } });
  }

  /** Takes every board in it along (cascade), like deleting a board takes its lists. */
  async remove(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.workspace.delete({ where: { id } });
  }

  async createInvite(ownerId: string, id: string) {
    const ws = await this.findOwned(ownerId, id);
    if (ws.inviteToken) return { token: ws.inviteToken };
    // Same 192-bit capability as board invites: knowing the link is the right to join.
    const token = randomBytes(24).toString('hex');
    await this.prisma.workspace.update({ where: { id }, data: { inviteToken: token } });
    return { token };
  }

  async revokeInvite(ownerId: string, id: string) {
    await this.findOwned(ownerId, id);
    await this.prisma.workspace.update({ where: { id }, data: { inviteToken: null } });
  }

  async members(userId: string, id: string) {
    const ws = await this.prisma.workspace.findFirst({ where: { id, members: { some: { userId } } } });
    if (!ws) throw new NotFoundException('Workspace not found');
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: id },
      orderBy: { joinedAt: 'asc' },
      include: { user: { select: { email: true, displayName: true } } },
    });
    return members.map((m) => ({ userId: m.userId, email: m.user.email, displayName: m.user.displayName }));
  }

  private async byToken(token: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { inviteToken: token } });
    if (!ws) throw new NotFoundException('Invitation not found or no longer valid');
    return ws;
  }

  async previewInvite(userId: string, token: string) {
    const ws = await this.byToken(token);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: ws.id, userId } },
    });
    return { workspaceId: ws.id, name: ws.name, isMember: member !== null };
  }

  async join(userId: string, token: string) {
    const ws = await this.byToken(token);
    const key = { workspaceId_userId: { workspaceId: ws.id, userId } };
    if (await this.prisma.workspaceMember.findUnique({ where: key })) return { workspaceId: ws.id };
    if ((await this.prisma.workspaceMember.count({ where: { workspaceId: ws.id } })) >= MAX_MEMBERS_PER_WORKSPACE) {
      throw new BadRequestException('This workspace is full');
    }

    // Boards they are not on yet; ones they were invited to directly stay as they are.
    const boards = await this.prisma.board.findMany({
      where: { workspaceId: ws.id, members: { none: { userId } } },
      select: { id: true, title: true },
    });
    // A board can also have direct invitees, so it may be full even when the workspace isn't.
    const counts = await this.prisma.boardMember.groupBy({
      by: ['boardId'],
      where: { boardId: { in: boards.map((b) => b.id) } },
      _count: { _all: true },
    });
    if (counts.some((c) => c._count._all >= MAX_MEMBERS_PER_BOARD)) {
      throw new BadRequestException('A board in this workspace is full');
    }
    await this.prisma.$transaction([
      this.prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId } }),
      this.prisma.boardMember.createMany({
        data: boards.map((b) => ({ boardId: b.id, userId })),
        skipDuplicates: true,
      }),
    ]);
    // Actor = joiner, one per board: exactly what widens their open stream (EventsService).
    for (const b of boards) {
      await this.events.record({ type: 'MEMBER_JOINED', boardId: b.id, actorId: userId, data: { boardTitle: b.title } });
    }
    return { workspaceId: ws.id };
  }

  /**
   * The owner removes anyone else; anyone else can only remove themselves (leave). They
   * lose every board in the workspace (and their assignments there), except boards they
   * own themselves, which would otherwise be left without their owner.
   */
  async removeMember(actorId: string, id: string, targetId: string) {
    const ws = await this.prisma.workspace.findFirst({ where: { id, members: { some: { userId: actorId } } } });
    if (!ws) throw new NotFoundException('Workspace not found');
    if (targetId === ws.ownerId) throw new BadRequestException('The owner cannot leave their workspace');
    if (actorId !== ws.ownerId && actorId !== targetId) {
      throw new ForbiddenException('Only the owner can remove other members');
    }

    const boardFilter = { workspaceId: id, ownerId: { not: targetId } };
    const boards = await this.prisma.board.findMany({
      where: { ...boardFilter, members: { some: { userId: targetId } } },
      select: { id: true, title: true },
    });
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { email: true } });
    const [removed] = await this.prisma.$transaction([
      this.prisma.workspaceMember.deleteMany({ where: { workspaceId: id, userId: targetId } }),
      this.prisma.cardMember.deleteMany({ where: { userId: targetId, card: { list: { board: boardFilter } } } }),
      this.prisma.boardMember.deleteMany({ where: { userId: targetId, board: boardFilter } }),
    ]);
    if (removed.count === 0) return;
    // Narrows the target's open stream board by board, same as a board-level removal.
    for (const b of boards) {
      await this.events.record({
        type: 'MEMBER_REMOVED',
        boardId: b.id,
        actorId,
        data: { boardTitle: b.title, userId: targetId, email: target?.email, left: actorId === targetId },
      });
    }
  }
}
