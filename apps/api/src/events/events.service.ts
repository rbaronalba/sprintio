import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Observable, Subject, filter, from, map, switchMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomUUID } from 'node:crypto';
import { REDIS, type RedisClients } from '../redis/redis.module.js';
import { requestContext } from '../common/request-context.js';
import { mailEnabled, mailSubject, sendMail } from './mail.js';

/** Every api instance publishes here and every instance feeds its own SSE clients from it. */
const CHANNEL = 'sprintio:events';

export type EventType =
  | 'CARD_CREATED'
  | 'CARD_UPDATED'
  | 'CARD_MOVED'
  | 'CARD_DELETED'
  | 'CARD_ASSIGNED'
  | 'CARD_UNASSIGNED'
  | 'LABEL_ADDED'
  | 'LABEL_REMOVED'
  | 'COMMENT_ADDED'
  | 'COMMENT_DELETED'
  | 'ATTACHMENT_ADDED'
  | 'ATTACHMENT_DELETED'
  | 'TIME_LOGGED'
  | 'CHECKLIST_ADDED'
  | 'CHECKLIST_TOGGLED'
  | 'CHECKLIST_DELETED'
  | 'LIST_CREATED'
  | 'LIST_UPDATED'
  | 'LIST_DELETED'
  | 'MEMBER_JOINED'
  | 'BOARD_CREATED'
  | 'MEMBER_REMOVED'
  | 'BACKGROUND_CHANGED'
  | 'BOARD_RENAMED'
  | 'OWNER_CHANGED'
  // Live-only (never stored, never in a feed): tell open boards to re-read positions.
  | 'CARD_REORDERED'
  | 'LIST_REORDERED'
  | 'BOARD_REORDERED';

export interface RecordInput {
  type: EventType;
  boardId: string;
  actorId: string;
  cardId?: string;
  /** Display-only snapshot, rendered by the activity feed. Never read back as state. */
  data?: Record<string, unknown>;
  /** Users to notify. The actor is always dropped: you don't get notified of your own doing. */
  notify?: string[];
  /** Push to open boards only: no Event row, no notifications, nothing in any feed. */
  live?: boolean;
}

interface BusMessage {
  id: string;
  type: EventType;
  boardId: string;
  cardId: string | null;
  actorId: string;
  actorEmail: string;
  data: Record<string, unknown>;
  createdAt: string;
  recipients: string[];
  /** The browser tab whose request caused this, so it can skip its own echo. */
  clientId: string | null;
}

/** What a subscriber actually receives: the bus message minus the recipient list. */
export type StreamMessage = Omit<BusMessage, 'recipients'> & { notified: boolean };

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  /** This instance's copy of the stream. With Redis, fed only by the channel (our own publishes included). */
  private readonly bus = new Subject<BusMessage>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(REDIS) private readonly redis: RedisClients | null = null,
  ) {
    if (!redis) return;
    void redis.sub.subscribe(CHANNEL);
    redis.sub.on('message', (channel, raw) => {
      if (channel === CHANNEL) this.bus.next(JSON.parse(raw) as BusMessage);
    });
  }

  private async publish(message: BusMessage): Promise<void> {
    if (this.redis) await this.redis.cmd.publish(CHANNEL, JSON.stringify(message));
    else this.bus.next(message);
  }

  /**
   * Persists an activity event, fans out notifications, and pushes it to live subscribers.
   *
   * Best-effort by design: the action this describes has already been committed, so a
   * failure here must not turn a successful request into a 500. It logs and moves on.
   */
  async record(input: RecordInput): Promise<void> {
    const clientId = requestContext.getStore()?.clientId ?? null;
    try {
      if (input.live) {
        return await this.publish({
          id: randomUUID(),
          type: input.type,
          boardId: input.boardId,
          cardId: input.cardId ?? null,
          actorId: input.actorId,
          actorEmail: '',
          data: input.data ?? {},
          createdAt: new Date().toISOString(),
          recipients: [],
          clientId,
        });
      }
      const event = await this.prisma.event.create({
        data: {
          type: input.type,
          boardId: input.boardId,
          cardId: input.cardId ?? null,
          actorId: input.actorId,
          data: (input.data ?? {}) as object,
        },
        include: { actor: { select: { email: true, displayName: true } } },
      });

      const recipients = [...new Set(input.notify ?? [])].filter((id) => id !== input.actorId);
      if (recipients.length > 0) {
        await this.prisma.notification.createMany({
          data: recipients.map((userId) => ({ userId, eventId: event.id })),
          skipDuplicates: true,
        });
        // Not awaited: a slow SMTP server must not slow the request that caused this.
        const subject = mailSubject(input.type, event.actor.displayName || event.actor.email, input.data ?? {});
        if (mailEnabled && subject) void this.email(recipients, subject, event.boardId, event.cardId);
      }

      await this.publish({
        id: event.id,
        type: input.type,
        boardId: event.boardId,
        cardId: event.cardId,
        actorId: event.actorId,
        actorEmail: event.actor.email,
        data: (event.data ?? {}) as Record<string, unknown>,
        createdAt: event.createdAt.toISOString(),
        recipients,
        clientId,
      });
    } catch (error) {
      this.logger.error(`Failed to record ${input.type} on board ${input.boardId}`, error);
    }
  }

  private async email(userIds: string[], subject: string, boardId: string, cardId: string | null): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds }, disabledAt: null },
        select: { email: true },
      });
      const link = `${process.env.WEB_ORIGIN}/boards/${boardId}${cardId ? `?card=${cardId}` : ''}`;
      await Promise.all(users.map((u) => sendMail(u.email, subject, `${subject}\n\n${link}`)));
    } catch (error) {
      this.logger.error(`Failed to email "${subject}"`, error);
    }
  }

  /**
   * The live stream for one user, filtered to the boards they belong to.
   *
   * Membership is read once per connection, then kept current from the bus: a board
   * joined mid-stream is added on its MEMBER_JOINED (or on a BOARD_CREATED in a workspace
   * they belong to, which lists them in `data.userIds`), and a removal drops the board on
   * its MEMBER_REMOVED — after delivering that one event, so the client learns why.
   */
  streamFor(userId: string): Observable<StreamMessage> {
    return from(this.boardIdsOf(userId)).pipe(
      switchMap((ids) => {
        const boards = new Set(ids);
        return this.bus.pipe(
          filter((message) => {
            if (message.type === 'MEMBER_JOINED' && message.actorId === userId) {
              boards.add(message.boardId);
            }
            if (message.type === 'BOARD_CREATED' && (message.data.userIds as string[] | undefined)?.includes(userId)) {
              boards.add(message.boardId);
            }
            if (message.type === 'MEMBER_REMOVED' && message.data.userId === userId) {
              return boards.delete(message.boardId);
            }
            return boards.has(message.boardId);
          }),
          map(({ recipients, ...message }) => ({
            ...message,
            notified: recipients.includes(userId),
          })),
        );
      }),
    );
  }

  private async boardIdsOf(userId: string): Promise<string[]> {
    const memberships = await this.prisma.boardMember.findMany({
      where: { userId },
      select: { boardId: true },
    });
    return memberships.map((m) => m.boardId);
  }
}
