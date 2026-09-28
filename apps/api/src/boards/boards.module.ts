import { Module } from '@nestjs/common';
import { BoardsController, SearchController } from './boards.controller.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { BoardsService } from './boards.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@Module({
  controllers: [BoardsController, SearchController, WorkspacesController],
  providers: [BoardsService, WorkspacesService, PrismaService, JwtAuthGuard],
})
export class BoardsModule {}
