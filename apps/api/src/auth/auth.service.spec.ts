import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { afterEach, vi } from 'vitest';
import { scryptSync } from 'node:crypto';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Role, Session, User } from '../generated/prisma/client.js';

function createPrismaMock() {
  const users = new Map<string, User>();
  const sessions = new Map<string, Session>();
  let seq = 0;
  const matches = (s: Session, where: Partial<Record<keyof Session, unknown>>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'lt' in v
        ? (s[k as keyof Session] as Date) < (v as { lt: Date }).lt
        : s[k as keyof Session] === v,
    );

  return {
    users,
    sessions,
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.get(where.id) ?? null;
        return [...users.values()].find((u) => u.email === where.email) ?? null;
      },
      create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
        const user: User = {
          id: `user_${++seq}`,
          email: data.email,
          displayName: null,
          passwordHash: data.passwordHash,
          role: 'DEVELOPER' as Role,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.set(user.id, user);
        return user;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<User> }) => {
        const user = users.get(where.id)!;
        Object.assign(user, data);
        return user;
      },
    },
    session: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const s = sessions.get(where.id);
        return s ? { ...s } : null;
      },
      create: async ({ data }: { data: Pick<Session, 'userId' | 'tokenHash' | 'expiresAt'> }) => {
        const s: Session = { id: `s_${++seq}`, prevTokenHash: null, rotatedAt: null, createdAt: new Date(), ...data };
        sessions.set(s.id, s);
        return s;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Session> }) =>
        Object.assign(sessions.get(where.id)!, data),
      updateMany: async ({ where, data }: { where: Partial<Session>; data: Partial<Session> }) => {
        const hit = [...sessions.values()].filter((s) => matches(s, where));
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Partial<Record<keyof Session, unknown>> }) => {
        const hit = [...sessions.values()].filter((s) => matches(s, where));
        hit.forEach((s) => sessions.delete(s.id));
        return { count: hit.length };
      },
    },
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof createPrismaMock>;

  beforeEach(async () => {
    prisma = createPrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ global: true, secret: 'test-secret' })],
      providers: [AuthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => vi.useRealTimers());

  it('registers a user with a hashed password and issues tokens', async () => {
    const result = await service.register('dev@sprintio.test', 'password123');

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user).toMatchObject({ email: 'dev@sprintio.test', role: 'DEVELOPER' });

    const stored = [...prisma.users.values()][0];
    expect(stored.passwordHash).toMatch(/^scrypt\$131072\$8\$1\$/);
  });

  it('rejects registering the same email twice', async () => {
    await service.register('dev@sprintio.test', 'password123');
    await expect(service.register('dev@sprintio.test', 'password123')).rejects.toThrow();
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await service.register('dev@sprintio.test', 'password123');

    const login = await service.login('dev@sprintio.test', 'password123');
    expect(login.accessToken).toBeTruthy();

    await expect(service.login('dev@sprintio.test', 'wrong-password')).rejects.toThrow();
    await expect(service.login('nobody@sprintio.test', 'password123')).rejects.toThrow();
  });

  it('upgrades a legacy salt:hash password on login', async () => {
    const { user } = await service.register('dev@sprintio.test', 'password123');
    const legacy = `abcd:${scryptSync('password123', 'abcd', 64).toString('hex')}`;
    prisma.users.get(user.sub)!.passwordHash = legacy;

    await service.login('dev@sprintio.test', 'password123');
    expect(prisma.users.get(user.sub)!.passwordHash).toMatch(/^scrypt\$131072\$/);
  });

  it('rotates the refresh token on every use', async () => {
    const { refreshToken: firstToken } = await service.register('dev@sprintio.test', 'password123');

    const { refreshToken: secondToken } = await service.refresh(firstToken!);
    expect(secondToken).not.toBe(firstToken);

    const { refreshToken: thirdToken } = await service.refresh(secondToken!);
    expect(thirdToken).not.toBe(secondToken);
  });

  it('lets a tab that lost a concurrent refresh race through without a new cookie', async () => {
    const { refreshToken: firstToken } = await service.register('dev@sprintio.test', 'password123');
    await service.refresh(firstToken!);

    const loser = await service.refresh(firstToken!);
    expect(loser.accessToken).toBeTruthy();
    expect(loser.refreshToken).toBeNull();
  });

  it('kills the session when a rotated-out refresh token is reused after the grace window', async () => {
    const { refreshToken: firstToken } = await service.register('dev@sprintio.test', 'password123');
    const { refreshToken: secondToken } = await service.refresh(firstToken!);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    // Replaying the old token signals a stolen token: the whole session dies.
    await expect(service.refresh(firstToken!)).rejects.toThrow();
    await expect(service.refresh(secondToken!)).rejects.toThrow();
  });

  it('logs out only the device holding the cookie', async () => {
    const laptop = await service.register('dev@sprintio.test', 'password123');
    const phone = await service.login('dev@sprintio.test', 'password123');

    await service.logout(laptop.user.sub, laptop.refreshToken!);

    await expect(service.refresh(laptop.refreshToken!)).rejects.toThrow();
    await expect(service.refresh(phone.refreshToken!)).resolves.toBeTruthy();
  });
});
