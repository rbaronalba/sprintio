import { Module } from '@nestjs/common';
import { BoardsController, SearchController } from './boards.controller.js';
import { BoardsService } from './boards.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Module({
  controllers: [BoardsController, SearchController],
  providers: [BoardsService, PrismaService, JwtAuthGuard],
})
export class BoardsModule {}
