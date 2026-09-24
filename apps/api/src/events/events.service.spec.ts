import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { EventsService } from './events.service.js';
import { extractMentions } from '../cards/dto.js';

/** Minimal prisma stub: enough for record() and the membership lookup, nothing more. */
function stubPrisma(boardIds: string[], created: unknown[] = []) {
  return {
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'e1',
        createdAt: new Date('2026-09-23T10:00:00Z'),
        ...data,
        actor: { email: 'actor@sprintio.test' },
      })),
    },
    notification: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
    boardMember: {
      findMany: vi.fn(async () => boardIds.map((boardId) => ({ boardId }))),
    },
  };
}

describe('EventsService', () => {
  it('never delivers events from a board the subscriber does not belong to', async () => {
    const service = new EventsService(stubPrisma(['mine']) as never);
    const received = firstValueFrom(service.streamFor('u1').pipe(take(1), toArray()));
    // Let the membership lookup settle before anything is published.
    await new Promise((resolve) => setTimeout(resolve));

    await service.record({ type: 'CARD_CREATED', boardId: 'someone-elses', actorId: 'u9' });
    await service.record({ type: 'CARD_CREATED', boardId: 'mine', actorId: 'u9' });

    const messages = await received;
    expect(messages.map((m) => m.boardId)).toEqual(['mine']);
  });

  it('widens the stream when the subscriber joins a board mid-connection', async () => {
    const service = new EventsService(stubPrisma([]) as never);
    const received = firstValueFrom(service.streamFor('u1').pipe(take(2), toArray()));
    await new Promise((resolve) => setTimeout(resolve));

    await service.record({ type: 'MEMBER_JOINED', boardId: 'b2', actorId: 'u1' });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'u9' });

    const messages = await received;
    expect(messages.map((m) => m.type)).toEqual(['MEMBER_JOINED', 'CARD_CREATED']);
  });

  it('does not let someone else joining widen my stream', async () => {
    const service = new EventsService(stubPrisma([]) as never);
    const received = firstValueFrom(service.streamFor('u1').pipe(take(1), toArray()));
    await new Promise((resolve) => setTimeout(resolve));

    await service.record({ type: 'MEMBER_JOINED', boardId: 'b2', actorId: 'someone-else' });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'someone-else' });
    // Only an event on a board u1 actually belongs to should ever arrive.
    await service.record({ type: 'MEMBER_JOINED', boardId: 'b3', actorId: 'u1' });

    const messages = await received;
    expect(messages[0]?.boardId).toBe('b3');
  });

  it('narrows the stream when the subscriber is removed, after telling them', async () => {
    const service = new EventsService(stubPrisma(['b1', 'b2']) as never);
    const received = firstValueFrom(service.streamFor('u1').pipe(take(2), toArray()));
    await new Promise((resolve) => setTimeout(resolve));

    await service.record({ type: 'MEMBER_REMOVED', boardId: 'b1', actorId: 'owner', data: { userId: 'u1' } });
    await service.record({ type: 'CARD_CREATED', boardId: 'b1', actorId: 'owner' });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'owner' });

    const messages = await received;
    expect(messages.map((m) => `${m.type}@${m.boardId}`)).toEqual(['MEMBER_REMOVED@b1', 'CARD_CREATED@b2']);
  });

  it('notifies the targets but never the actor, and marks recipients per subscriber', async () => {
    const created: unknown[] = [];
    const service = new EventsService(stubPrisma(['b1'], created) as never);
    const mine = firstValueFrom(service.streamFor('target').pipe(take(1), toArray()));
    const theirs = firstValueFrom(service.streamFor('bystander').pipe(take(1), toArray()));
    await new Promise((resolve) => setTimeout(resolve));

    await service.record({
      type: 'CARD_ASSIGNED',
      boardId: 'b1',
      actorId: 'actor',
      notify: ['target', 'actor', 'target'],
    });

    expect(created).toEqual([{ userId: 'target', eventId: 'e1' }]);
    expect((await mine)[0].notified).toBe(true);
    expect((await theirs)[0].notified).toBe(false);
  });

  it('keeps a failed write from breaking the action that triggered it', async () => {
    const prisma = stubPrisma(['b1']);
    prisma.event.create = vi.fn(async () => {
      throw new Error('database is down');
    });
    const service = new EventsService(prisma as never);
    // The card move already happened; logging it must not turn that into a 500.
    await expect(
      service.record({ type: 'CARD_MOVED', boardId: 'b1', actorId: 'u1' }),
    ).resolves.toBeUndefined();
  });
});

describe('mentions', () => {
  it('picks out emails, lowercases them and drops duplicates', () => {
    expect(extractMentions('ping @Dev@sprintio.test and @dev@sprintio.test again')).toEqual([
      'dev@sprintio.test',
    ]);
  });

  it('ignores text that is not an email mention', () => {
    expect(extractMentions('email me at dev@sprintio.test')).toEqual([]);
    expect(extractMentions('@nobody no domain here')).toEqual([]);
  });
});
