import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject, filter, from, map, switchMap } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';

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
  | 'MEMBER_REMOVED';

export interface RecordInput {
  type: EventType;
  boardId: string;
  actorId: string;
  cardId?: string;
  /** Display-only snapshot, rendered by the activity feed. Never read back as state. */
  data?: Record<string, unknown>;
  /** Users to notify. The actor is always dropped: you don't get notified of your own doing. */
  notify?: string[];
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
}

/** What a subscriber actually receives: the bus message minus the recipient list. */
export type StreamMessage = Omit<BusMessage, 'recipients'> & { notified: boolean };

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly bus = new Subject<BusMessage>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an activity event, fans out notifications, and pushes it to live subscribers.
   *
   * Best-effort by design: the action this describes has already been committed, so a
   * failure here must not turn a successful request into a 500. It logs and moves on.
   */
  async record(input: RecordInput): Promise<void> {
    try {
      const event = await this.prisma.event.create({
        data: {
          type: input.type,
          boardId: input.boardId,
          cardId: input.cardId ?? null,
          actorId: input.actorId,
          data: (input.data ?? {}) as object,
        },
        include: { actor: { select: { email: true } } },
      });

      const recipients = [...new Set(input.notify ?? [])].filter((id) => id !== input.actorId);
      if (recipients.length > 0) {
        await this.prisma.notification.createMany({
          data: recipients.map((userId) => ({ userId, eventId: event.id })),
          skipDuplicates: true,
        });
      }

      this.bus.next({
        id: event.id,
        type: input.type,
        boardId: event.boardId,
        cardId: event.cardId,
        actorId: event.actorId,
        actorEmail: event.actor.email,
        data: (event.data ?? {}) as Record<string, unknown>,
        createdAt: event.createdAt.toISOString(),
        recipients,
      });
    } catch (error) {
      this.logger.error(`Failed to record ${input.type} on board ${input.boardId}`, error);
    }
  }

  /**
   * The live stream for one user, filtered to the boards they belong to.
   *
   * Membership is read once per connection, then kept current from the bus: a board
   * joined mid-stream is added on its MEMBER_JOINED, and a removal drops the board on
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
