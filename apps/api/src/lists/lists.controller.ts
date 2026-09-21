import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ListsService } from './lists.service.js';
import { parseUpsertList } from './dto.js';
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

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.lists.remove(user.sub, id);
  }
}
