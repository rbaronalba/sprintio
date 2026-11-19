import { vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import type { EventsService, StreamMessage } from '../../src/events/events.service.js';

/** Minimal prisma stub: enough for record() and the membership lookup, nothing more. */
export function stubPrisma(boardIds: string[]) {
  const created: unknown[] = [];
  return {
    created,
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

/** Same stub, but the event write fails as if the database were down. */
export function stubFailingPrisma(boardIds: string[]) {
  const prisma = stubPrisma(boardIds);
  prisma.event.create = vi.fn(async () => {
    throw new Error('database is down');
  });
  return prisma;
}

/**
 * Opens a stream for `userId` that completes after `count` messages. Resolves once the
 * membership lookup has settled, so anything recorded afterwards is seen by the stream.
 * The messages are behind `received` so awaiting this does not wait for them.
 */
export async function subscribe(service: EventsService, userId: string, count: number) {
  const received: Promise<StreamMessage[]> = firstValueFrom(service.streamFor(userId).pipe(take(count), toArray()));
  await new Promise((resolve) => setTimeout(resolve));
  return { received };
}
