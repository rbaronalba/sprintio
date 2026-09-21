import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuthModule } from './auth/auth.module.js';
import { BoardsModule } from './boards/boards.module.js';
import { ListsModule } from './lists/lists.module.js';
import { CardsModule } from './cards/cards.module.js';

@Module({
  imports: [AuthModule, BoardsModule, ListsModule, CardsModule],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
