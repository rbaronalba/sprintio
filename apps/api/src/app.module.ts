import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { AuthModule } from './auth/auth.module.js';
import { EventsModule } from './events/events.module.js';
import { BoardsModule } from './boards/boards.module.js';
import { ListsModule } from './lists/lists.module.js';
import { CardsModule } from './cards/cards.module.js';
import { REDIS, RedisModule, type RedisClients } from './redis/redis.module.js';
import { RedisThrottlerStorage } from './redis/throttler-storage.js';
import { UserThrottlerGuard } from './auth/guards/user-throttler.guard.js';
import { MaintenanceService } from './maintenance.service.js';

@Module({
  imports: [
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS],
      useFactory: (redis: RedisClients | null) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        // Without Redis the counters live in this process: fine for one instance only.
        storage: redis ? new RedisThrottlerStorage(redis.cmd) : undefined,
      }),
    }),
    AuthModule,
    EventsModule,
    BoardsModule,
    ListsModule,
    CardsModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, MaintenanceService, { provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
