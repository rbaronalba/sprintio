import { Module } from '@nestjs/common';
import { BoardListsController, ListsController } from './lists.controller.js';
import { ListsService } from './lists.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Module({
  controllers: [BoardListsController, ListsController],
  providers: [ListsService, PrismaService, JwtAuthGuard],
})
export class ListsModule {}
