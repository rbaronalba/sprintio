import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { BoardsService } from './boards.service.js';
import { parseBackground, parseCreateBoard, parseTitle, parseUpsertLabel } from './dto.js';
import { attachmentUploadOptions } from '../cards/uploads.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/auth.service.js';

@UseGuards(JwtAuthGuard)
@Controller('boards')
export class BoardsController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.boards.list(user.sub);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Get('join/:token')
  previewInvite(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.boards.previewInvite(user.sub, token);
  }

  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('join/:token')
  join(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.boards.join(user.sub, token);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.boards.get(user.sub, id);
  }

  @Put(':id/star')
  setStarred(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    const { starred } = (body ?? {}) as Record<string, unknown>;
    if (typeof starred !== 'boolean') throw new BadRequestException('starred must be a boolean');
    return this.boards.setStarred(user.sub, id, starred);
  }

  /** Multipart `file` sets an image; a JSON `{ background }` sets a color or clears it. */
  @Post(':id/background')
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions))
  setBackground(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.boards.setBackground(user.sub, id, file ? `/uploads/${file.filename}` : parseBackground(body));
  }

  @Post(':id/invite')
  createInvite(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.boards.createInvite(user.sub, id);
  }

  @Delete(':id/invite')
  revokeInvite(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.boards.revokeInvite(user.sub, id);
  }

  // Owner: remove a member. Anyone: pass their own id to leave.
  @Delete(':id/members/:userId')
  removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    return this.boards.removeMember(user.sub, id, userId);
  }

  @Get(':id/activity')
  listActivity(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.boards.listActivity(user.sub, id);
  }

  @Get(':id/labels')
  listLabels(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.boards.listLabels(user.sub, id);
  }

  @Post(':id/labels')
  createLabel(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.boards.createLabel(user.sub, id, parseUpsertLabel(body));
  }

  @Delete(':id/labels/:labelId')
  removeLabel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('labelId') labelId: string,
  ) {
    return this.boards.removeLabel(user.sub, id, labelId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const { title, workspaceId } = parseCreateBoard(body);
    return this.boards.create(user.sub, title, workspaceId);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.boards.update(user.sub, id, parseTitle(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.boards.remove(user.sub, id);
  }
}

// Its own path rather than /boards/search, which would collide with GET /boards/:id.
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly boards: BoardsService) {}

  @Get()
  search(@CurrentUser() user: JwtPayload, @Query('q') q: string) {
    return this.boards.search(user.sub, q ?? '');
  }
}

