import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CardsService } from './cards.service.js';
import { parseUpsertCard } from './dto.js';
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
}
