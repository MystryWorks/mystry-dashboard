import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loginBodySchema, setupBodySchema } from '@mmd/shared';
import { needsSetup, setupAdmin, verifyLogin, getUserById } from '../services/auth-service.js';
import { config } from '../config.js';
import { createLoginFailureLimiter, createRateLimitHook } from '../services/security-service.js';

export type JwtUser = { id: string; username: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

function isValidSetupToken(value: string | string[] | undefined): boolean {
  if (config.setupToken === null || typeof value !== 'string') return false;
  const expected = Buffer.from(config.setupToken, 'utf8');
  const actual = Buffer.from(value, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const strictAuthLimit = createRateLimitHook({
    name: 'auth',
    max: config.authRateLimitMax,
    windowMs: config.authRateLimitWindowMs,
  });
  const loginFailureLimit = createLoginFailureLimiter({
    name: 'login-failure',
    max: config.authRateLimitMax,
    windowMs: config.authRateLimitWindowMs,
  });

  app.get('/api/auth/status', async () => ({ needsSetup: needsSetup() }));

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/setup',
    {
      attachValidation: true,
      schema: { body: setupBodySchema },
      preHandler: [strictAuthLimit],
    },
    async (req, reply) => {
      if (!isValidSetupToken(req.headers['x-setup-token'])) {
        return reply.code(401).send({ error: '初始化令牌无效' });
      }
      if (req.validationError) {
        return reply.code(400).send({ error: '用户名或密码格式不正确' });
      }
      try {
        const user = setupAdmin(req.body.username, req.body.password);
        const token = await reply.jwtSign(user, { expiresIn: config.jwtExpiresIn });
        return { token, user };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(message === '管理员已初始化' ? 409 : 400).send({ error: message });
      }
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    {
      attachValidation: true,
      schema: { body: loginBodySchema },
    },
    async (req, reply) => {
      if (req.validationError) {
        return reply.code(400).send({ error: '用户名或密码格式不正确' });
      }
      if (loginFailureLimit.isBlocked(req, reply, req.body.username)) return reply;
      const user = verifyLogin(req.body.username, req.body.password);
      if (!user) {
        loginFailureLimit.recordFailure(req, reply, req.body.username);
        return reply.code(401).send({ error: '用户名或密码错误' });
      }
      loginFailureLimit.reset(req, req.body.username);
      const token = await reply.jwtSign(user, { expiresIn: config.jwtExpiresIn });
      return { token, user };
    },
  );

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = getUserById(req.user.id);
    if (!user) {
      return reply.code(401).send({ error: '未登录' });
    }
    return { user };
  });
}

export function registerAuthHooks(app: FastifyInstance): void {
  app.decorate('authenticate', async (req: FastifyRequest, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: '未授权' });
    }
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}
