import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Role, User } from '../generated/prisma/client.js';

function createPrismaMock() {
  const users = new Map<string, User>();
  let seq = 0;

  return {
    users,
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.get(where.id) ?? null;
        return [...users.values()].find((u) => u.email === where.email) ?? null;
      },
      create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
        const user: User = {
          id: `user_${++seq}`,
          email: data.email,
          passwordHash: data.passwordHash,
          role: 'DEVELOPER' as Role,
          refreshTokenHash: null,
          refreshTokenExpiresAt: null,
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

  it('registers a user with a hashed password and issues tokens', async () => {
    const result = await service.register('dev@sprintio.test', 'password123');

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user).toMatchObject({ email: 'dev@sprintio.test', role: 'DEVELOPER' });

    const stored = [...prisma.users.values()][0];
    expect(stored.passwordHash).not.toBe('password123');
    expect(stored.passwordHash).toContain(':');
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

  it('rotates the refresh token on every use', async () => {
    const { refreshToken: firstToken } = await service.register('dev@sprintio.test', 'password123');

    const { refreshToken: secondToken } = await service.refresh(firstToken);
    expect(secondToken).not.toBe(firstToken);

    const { refreshToken: thirdToken } = await service.refresh(secondToken);
    expect(thirdToken).not.toBe(secondToken);
  });

  it('kills the session when a rotated-out refresh token is reused', async () => {
    const { refreshToken: firstToken } = await service.register('dev@sprintio.test', 'password123');
    const { refreshToken: secondToken } = await service.refresh(firstToken);

    // Replaying the old token signals a stolen token: the whole session dies.
    await expect(service.refresh(firstToken)).rejects.toThrow();
    await expect(service.refresh(secondToken)).rejects.toThrow();
  });

  it('clears the session on logout so the refresh token stops working', async () => {
    const { refreshToken, user } = await service.register('dev@sprintio.test', 'password123');

    await service.logout(user.sub);

    await expect(service.refresh(refreshToken)).rejects.toThrow();
  });
});
