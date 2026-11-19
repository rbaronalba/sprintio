import { describe, expect, it } from 'vitest';
import { EventsService } from './events.service.js';
import { extractMentions } from '../cards/dto.js';
import { mailSubject } from './mail.js';
import { stubFailingPrisma, stubPrisma, subscribe } from '../../test/support/events.stub.js';

describe('EventsService', () => {
  it('never delivers events from a board the subscriber does not belong to', async () => {
    const service = new EventsService(stubPrisma(['mine']) as never);
    const stream = await subscribe(service, 'u1', 1);

    await service.record({ type: 'CARD_CREATED', boardId: 'someone-elses', actorId: 'u9' });
    await service.record({ type: 'CARD_CREATED', boardId: 'mine', actorId: 'u9' });

    expect(await stream.received).toMatchObject([{ boardId: 'mine' }]);
  });

  it('widens the stream when the subscriber joins a board mid-connection', async () => {
    const service = new EventsService(stubPrisma([]) as never);
    const stream = await subscribe(service, 'u1', 2);

    await service.record({ type: 'MEMBER_JOINED', boardId: 'b2', actorId: 'u1' });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'u9' });

    expect(await stream.received).toMatchObject([{ type: 'MEMBER_JOINED' }, { type: 'CARD_CREATED' }]);
  });

  it('does not let someone else joining widen my stream', async () => {
    const service = new EventsService(stubPrisma([]) as never);
    const stream = await subscribe(service, 'u1', 1);

    await service.record({ type: 'MEMBER_JOINED', boardId: 'b2', actorId: 'someone-else' });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'someone-else' });
    // Only an event on a board u1 actually belongs to should ever arrive.
    await service.record({ type: 'MEMBER_JOINED', boardId: 'b3', actorId: 'u1' });

    expect(await stream.received).toMatchObject([{ boardId: 'b3' }]);
  });

  it('widens the stream for the workspace members a new board lists, and only them', async () => {
    const service = new EventsService(stubPrisma([]) as never);
    const stream = await subscribe(service, 'u1', 2);

    await service.record({ type: 'BOARD_CREATED', boardId: 'other', actorId: 'u9', data: { userIds: ['u2'] } });
    await service.record({ type: 'CARD_CREATED', boardId: 'other', actorId: 'u9' });
    await service.record({ type: 'BOARD_CREATED', boardId: 'b2', actorId: 'u9', data: { userIds: ['u1', 'u2'] } });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'u9' });

    expect(await stream.received).toMatchObject([
      { type: 'BOARD_CREATED', boardId: 'b2' },
      { type: 'CARD_CREATED', boardId: 'b2' },
    ]);
  });

  it('narrows the stream when the subscriber is removed, after telling them', async () => {
    const service = new EventsService(stubPrisma(['b1', 'b2']) as never);
    const stream = await subscribe(service, 'u1', 2);

    await service.record({ type: 'MEMBER_REMOVED', boardId: 'b1', actorId: 'owner', data: { userId: 'u1' } });
    await service.record({ type: 'CARD_CREATED', boardId: 'b1', actorId: 'owner' });
    await service.record({ type: 'CARD_CREATED', boardId: 'b2', actorId: 'owner' });

    expect(await stream.received).toMatchObject([
      { type: 'MEMBER_REMOVED', boardId: 'b1' },
      { type: 'CARD_CREATED', boardId: 'b2' },
    ]);
  });

  it('notifies the targets but never the actor, and marks recipients per subscriber', async () => {
    const prisma = stubPrisma(['b1']);
    const service = new EventsService(prisma as never);
    const target = await subscribe(service, 'target', 1);
    const bystander = await subscribe(service, 'bystander', 1);

    await service.record({
      type: 'CARD_ASSIGNED',
      boardId: 'b1',
      actorId: 'actor',
      notify: ['target', 'actor', 'target'],
    });

    expect(prisma.created).toEqual([{ userId: 'target', eventId: 'e1' }]);
    expect(await target.received).toMatchObject([{ notified: true }]);
    expect(await bystander.received).toMatchObject([{ notified: false }]);
  });

  it('keeps a failed write from breaking the action that triggered it', async () => {
    const service = new EventsService(stubFailingPrisma(['b1']) as never);
    // The card move already happened; logging it must not turn that into a 500.
    await expect(
      service.record({ type: 'CARD_MOVED', boardId: 'b1', actorId: 'u1' }),
    ).resolves.toBeUndefined();
  });
});

describe('mailSubject', () => {
  it('emails only assignment, removal and moves between lists', () => {
    expect(mailSubject('CARD_ASSIGNED', 'Ana', { title: 'Fix login' })).toBe('Ana te ha asignado a "Fix login"');
    expect(mailSubject('CARD_UNASSIGNED', 'Ana', { title: 'Fix login' })).toBe('Ana te ha quitado de "Fix login"');
    expect(mailSubject('CARD_MOVED', 'Ana', { title: 'Fix login', from: 'Doing', to: 'QA' })).toBe(
      'Ana ha movido "Fix login" de Doing a QA',
    );
    expect(mailSubject('COMMENT_ADDED', 'Ana', { title: 'Fix login' })).toBeNull();
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
