import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { BoardsService } from './boards.service.js';
import { parseTitle } from './dto.js';
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

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.boards.create(user.sub, parseTitle(body));
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
