import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { WorkspacesService } from './workspaces.service.js';
import { parseWorkspaceName } from './dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/auth.service.js';

@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.workspaces.list(user.sub);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.workspaces.create(user.sub, parseWorkspaceName(body));
  }

  // Throttled like the board invite endpoints: a token is a capability, don't let it be guessed.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('join/:token')
  previewInvite(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.workspaces.previewInvite(user.sub, token);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('join/:token')
  join(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.workspaces.join(user.sub, token);
  }

  @Patch(':id')
  rename(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.workspaces.rename(user.sub, id, parseWorkspaceName(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.workspaces.remove(user.sub, id);
  }

  @Post(':id/invite')
  createInvite(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.workspaces.createInvite(user.sub, id);
  }

  @Delete(':id/invite')
  revokeInvite(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.workspaces.revokeInvite(user.sub, id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.workspaces.members(user.sub, id);
  }

  // Owner: remove a member. Anyone: pass their own id to leave.
  @Delete(':id/members/:userId')
  removeMember(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('userId') userId: string) {
    return this.workspaces.removeMember(user.sub, id, userId);
  }
}
