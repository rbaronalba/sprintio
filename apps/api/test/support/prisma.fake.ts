import type { Role, Session, User } from '../../src/generated/prisma/client.js';
import type { AuthService } from '../../src/auth/auth.service.js';

/** In-memory stand-in for the slice of Prisma that AuthService uses. */
export function createPrismaMock() {
  const users = new Map<string, User>();
  const sessions = new Map<string, Session>();
  let seq = 0;
  const matches = (s: Session, where: Partial<Record<keyof Session, unknown>>) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'lt' in v
        ? (s[k as keyof Session] as Date) < (v as { lt: Date }).lt
        : v && typeof v === 'object' && 'in' in v
          ? (v as { in: unknown[] }).in.includes(s[k as keyof Session])
          : v && typeof v === 'object' && 'not' in v
            ? s[k as keyof Session] !== (v as { not: unknown }).not
            : v && typeof v === 'object' && !(v instanceof Date)
              ? (() => { throw new Error(`prisma fake: unsupported where operator on ${k}`); })()
              : s[k as keyof Session] === v,
    );

  return {
    users,
    sessions,
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string; microsoftId?: string } }) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.microsoftId) return [...users.values()].find((u) => u.microsoftId === where.microsoftId) ?? null;
        return [...users.values()].find((u) => u.email === where.email) ?? null;
      },
      create: async ({ data }: { data: { email: string; passwordHash?: string; microsoftId?: string } }) => {
        const user: User = {
          id: `user_${++seq}`,
          email: data.email,
          displayName: null,
          passwordHash: data.passwordHash ?? null,
          microsoftId: data.microsoftId ?? null,
          role: 'DEVELOPER' as Role,
          disabledAt: null,
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
        const s: Session = { id: `s_${++seq}`, prevTokenHash: null, rotatedAt: null, createdAt: new Date(Date.now() + seq), ...data };
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
      findMany: async ({ where, skip = 0 }: { where: { userId: string }; skip?: number }) =>
        [...sessions.values()]
          .filter((s) => s.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(skip),
      deleteMany: async ({ where }: { where: Partial<Record<keyof Session, unknown>> }) => {
        const hit = [...sessions.values()].filter((s) => matches(s, where));
        hit.forEach((s) => sessions.delete(s.id));
        return { count: hit.length };
      },
    },
  };
}

/** Signs the same user in `times` times, one session per call. */
export async function loginTimes(service: AuthService, email: string, password: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await service.login(email, password);
}
