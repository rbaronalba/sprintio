import { Global, Module } from '@nestjs/common';
import { EventsController, NotificationsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { NotificationsService } from './notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

// Global because boards, lists and cards all record events; the alternative is
// importing this module into each of them for no gain.
@Global()
@Module({
  controllers: [EventsController, NotificationsController],
  providers: [EventsService, NotificationsService, PrismaService, JwtAuthGuard],
  exports: [EventsService],
})
export class EventsModule {}
