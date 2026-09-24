import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** The bell shows recent history, not an archive. Older rows stay queryable but unseen. */
const NOTIFICATION_PAGE = 30;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: NOTIFICATION_PAGE,
        include: {
          event: {
            include: { actor: { select: { email: true, displayName: true } } },
          },
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        readAt: n.readAt,
        createdAt: n.createdAt,
        type: n.event.type,
        boardId: n.event.boardId,
        cardId: n.event.cardId,
        actor: n.event.actor,
        data: n.event.data,
      })),
    };
  }

  /** Scoped by userId, so passing someone else's notification ids marks nothing. */
  async markRead(userId: string, ids?: string[]) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { count };
  }
}
