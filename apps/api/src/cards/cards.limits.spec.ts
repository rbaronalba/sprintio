import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseUpsertCard } from './dto.js';
import { CardsService } from './cards.service.js';

describe('card limits', () => {
  it('rejects out-of-range and non-finite positions', () => {
    expect(() => parseUpsertCard({ position: 1e12 })).toThrow(BadRequestException);
    expect(() => parseUpsertCard({ position: Infinity })).toThrow(BadRequestException);
    expect(parseUpsertCard({ position: 1500 }).position).toBe(1500);
  });

  it('refuses a new card when the list is full', async () => {
    const prisma = {
      list: { findFirst: async () => ({ id: 'l1' }) },
      card: { count: async () => 200 },
    };
    const cards = new CardsService(prisma as never, { record: async () => {} } as never);
    await expect(cards.create('u1', 'l1', 'x')).rejects.toThrow('Card limit reached');
  });

  it('clears the completion flag when the due date is cleared, whatever the body says', () => {
    // Order matters here: a client sending both must not end up with dueDone on a
    // card that has no due date.
    expect(parseUpsertCard({ dueDate: null, dueDone: true })).toEqual({
      dueDate: null,
      dueDone: false,
    });
    expect(parseUpsertCard({ dueDone: true })).toEqual({ dueDone: true });
  });
});
