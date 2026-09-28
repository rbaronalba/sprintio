import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ListsService } from './lists.service.js';
import { parseUpsertList } from './dto.js';
import { parseBackground } from '../boards/dto.js';
import { attachmentUploadOptions } from '../cards/uploads.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/auth.service.js';

@UseGuards(JwtAuthGuard)
@Controller('boards/:boardId/lists')
export class BoardListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload, @Param('boardId') boardId: string) {
    return this.lists.list(user.sub, boardId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Param('boardId') boardId: string, @Body() body: unknown) {
    const { title } = parseUpsertList(body);
    if (!title) throw new BadRequestException('Title is required');
    return this.lists.create(user.sub, boardId, title);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('lists')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: unknown) {
    return this.lists.update(user.sub, id, parseUpsertList(body));
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
    return this.lists.setBackground(user.sub, id, file ? `/uploads/${file.filename}` : parseBackground(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.lists.remove(user.sub, id);
  }
}
