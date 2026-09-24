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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CardsService } from './cards.service.js';
import {
  parseChecklistText,
  parseChecklistUpdate,
  parseCommentBody,
  parseTimeEntry,
  parseUpsertCard,
} from './dto.js';
import { attachmentUploadOptions } from './uploads.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/auth.service.js';

@UseGuards(JwtAuthGuard)
@Controller('lists/:listId/cards')
export class ListCardsController {
  constructor(private readonly cards: CardsService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Param('listId') listId: string, @Body() body: unknown) {
    const { title } = parseUpsertCard(body);
    if (!title) throw new BadRequestException('Title is required');
    return this.cards.create(user.sub, listId, title);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('cards')
export class CardsController {
  constructor(private readonly cards: CardsService) {}

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.cards.update(user.sub, id, parseUpsertCard(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cards.remove(user.sub, id);
  }

  @Put(':id/members/:userId')
  assign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('userId') userId: string) {
    return this.cards.assign(user.sub, id, userId);
  }

  @Delete(':id/members/:userId')
  unassign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('userId') userId: string) {
    return this.cards.unassign(user.sub, id, userId);
  }

  @Put(':id/labels/:labelId')
  addLabel(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('labelId') labelId: string) {
    return this.cards.addLabel(user.sub, id, labelId);
  }

  @Delete(':id/labels/:labelId')
  removeLabel(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('labelId') labelId: string) {
    return this.cards.removeLabel(user.sub, id, labelId);
  }

  @Get(':id/activity')
  listActivity(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cards.listActivity(user.sub, id);
  }

  @Get(':id/comments')
  listComments(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cards.listComments(user.sub, id);
  }

  @Post(':id/comments')
  addComment(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.cards.addComment(user.sub, id, parseCommentBody(body));
  }

  @Delete(':id/comments/:commentId')
  removeComment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.cards.removeComment(user.sub, id, commentId);
  }

  @Get(':id/time')
  listTimeEntries(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cards.listTimeEntries(user.sub, id);
  }

  @Post(':id/time')
  addTimeEntry(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.cards.addTimeEntry(user.sub, id, parseTimeEntry(body));
  }

  @Delete(':id/time/:entryId')
  removeTimeEntry(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.cards.removeTimeEntry(user.sub, id, entryId);
  }

  @Get(':id/attachments')
  listAttachments(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cards.listAttachments(user.sub, id);
  }

  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions))
  addAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.cards.addAttachment(user.sub, id, file);
  }

  @Delete(':id/attachments/:attachmentId')
  removeAttachment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.cards.removeAttachment(user.sub, id, attachmentId);
  }

  @Get(':id/checklist')
  listChecklist(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cards.listChecklist(user.sub, id);
  }

  @Post(':id/checklist')
  addChecklistItem(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.cards.addChecklistItem(user.sub, id, parseChecklistText(body));
  }

  @Patch(':id/checklist/:itemId')
  updateChecklistItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.cards.updateChecklistItem(user.sub, id, itemId, parseChecklistUpdate(body));
  }

  @Delete(':id/checklist/:itemId')
  removeChecklistItem(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.cards.removeChecklistItem(user.sub, id, itemId);
  }
}
