import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Role } from '../generated/prisma/enums.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { Roles } from './decorators/roles.decorator.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { hashPassword } from './password.util.js';
import type { JwtPayload } from './auth.service.js';

function parseRole(role: unknown): Role {
  if (!Object.values(Role).includes(role as Role))
    throw new BadRequestException('Rol no válido');
  return role as Role;
}

function parseDisabled(disabled: unknown): boolean {
  if (typeof disabled !== 'boolean')
    throw new BadRequestException('disabled must be a boolean');
  return disabled;
}

/** `disabling`: the account is being switched off, so its sessions must be revoked. */
function parseUserPatch(body: unknown): {
  data: { role?: Role; disabledAt?: Date | null };
  disabling: boolean;
} {
  const { role, disabled } = (body ?? {}) as Record<string, unknown>;
  const data: { role?: Role; disabledAt?: Date | null } = {};
  if (role !== undefined) data.role = parseRole(role);
  const isDisabled =
    disabled === undefined ? undefined : parseDisabled(disabled);
  if (isDisabled !== undefined)
    data.disabledAt = isDisabled ? new Date() : null;
  return { data, disabling: isDisabled === true };
}

/**
 * User administration, ADMIN only. The first admin comes from ADMIN_EMAILS (see AuthService);
 * after that admins promote each other here.
 *
 * The role is read from the access token, so a demotion or a disabled account can keep
 * working for up to 15 minutes (the token's life). Sessions are deleted, so not longer.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('auth/admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('users')
  async users() {
    const users = await this.prisma.user.findMany({
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        disabledAt: true,
        _count: { select: { boards: true, workspaces: true } },
      },
    });
    return users.map(({ _count, ...user }) => ({
      ...user,
      owned: _count.boards + _count.workspaces,
    }));
  }

  @Patch('users/:id')
  async update(
    @CurrentUser() me: JwtPayload,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    // Not on yourself: that is how the last admin gets locked out.
    if (id === me.sub)
      throw new BadRequestException(
        'No puedes cambiar tu propia cuenta desde aquí',
      );
    const { data, disabling } = parseUserPatch(body);
    const { count } = await this.prisma.user.updateMany({
      where: { id },
      data,
    });
    if (count === 0) throw new NotFoundException('Usuario no encontrado');
    if (disabling)
      await this.prisma.session.deleteMany({ where: { userId: id } });
    return { success: true };
  }

  /** There is no "forgot password" email: the admin hands over a one-off password to change. */
  @Post('users/:id/password')
  async resetPassword(@Param('id') id: string) {
    const password = randomBytes(9).toString('base64url');
    const { count } = await this.prisma.user.updateMany({
      where: { id },
      data: { passwordHash: await hashPassword(password) },
    });
    if (count === 0) throw new NotFoundException('Usuario no encontrado');
    await this.prisma.session.deleteMany({ where: { userId: id } });
    return { password };
  }

  /**
   * Someone left: everything they own (boards and workspaces) goes to another user, who is
   * made a member of those workspaces and of every board in them.
   */
  @Post('users/:id/transfer')
  async transfer(@Param('id') fromId: string, @Body() body: unknown) {
    const { toUserId: toId } = (body ?? {}) as Record<string, unknown>;
    if (typeof toId !== 'string' || toId === fromId)
      throw new BadRequestException('Usuario de destino no válido');
    await this.assertActiveTarget(toId);

    return this.prisma.$transaction(async (tx) => {
      const workspaceIds = (
        await tx.workspace.findMany({
          where: { ownerId: fromId },
          select: { id: true },
        })
      ).map((w) => w.id);
      const boards = await tx.board.findMany({
        where: {
          OR: [{ ownerId: fromId }, { workspaceId: { in: workspaceIds } }],
        },
        select: { id: true },
      });
      await tx.workspaceMember.createMany({
        data: workspaceIds.map((workspaceId) => ({
          workspaceId,
          userId: toId,
        })),
        skipDuplicates: true,
      });
      await tx.boardMember.createMany({
        data: boards.map((b) => ({ boardId: b.id, userId: toId })),
        skipDuplicates: true,
      });
      const moved = await tx.board.updateMany({
        where: { ownerId: fromId },
        data: { ownerId: toId },
      });
      await tx.workspace.updateMany({
        where: { ownerId: fromId },
        data: { ownerId: toId },
      });
      return { boards: moved.count, workspaces: workspaceIds.length };
    });
  }

  private async assertActiveTarget(toId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: toId, disabledAt: null },
    });
    if (!target)
      throw new BadRequestException(
        'El usuario de destino no existe o está desactivado',
      );
  }
}
