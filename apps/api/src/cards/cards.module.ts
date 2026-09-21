import { Module } from '@nestjs/common';
import { CardsController, ListCardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Module({
  controllers: [ListCardsController, CardsController],
  providers: [CardsService, PrismaService, JwtAuthGuard],
})
export class CardsModule {}
