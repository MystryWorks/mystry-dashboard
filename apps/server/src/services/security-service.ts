import type { FastifyReply, FastifyRequest } from 'fastify';

type RateLimitOptions = {
  max: number;
  windowMs: number;
  name: string;
};

type Bucket = {
  count: number;
  resetAt: number;
};

export type LoginFailureLimiter = {
  isBlocked: (request: FastifyRequest, reply: FastifyReply, username: string) => boolean;
  recordFailure: (request: FastifyRequest, reply: FastifyReply, username: string) => void;
  reset: (request: FastifyRequest, username: string) => void;
};

/**
 * 轻量内存限流器。面板是单进程服务，使用 Fastify hook 可以避免引入与 Fastify 版本耦合的插件。
 * 未启用 proxy trust，因此这里使用 Fastify 已验证的 request.ip，不采信任意 X-Forwarded-For。
 */
export function createRateLimitHook(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  let lastCleanup = 0;

  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const now = Date.now();
    if (now - lastCleanup > options.windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastCleanup = now;
    }

    const route = request.routeOptions.url || request.url.split('?')[0];
    const key = `${options.name}:${request.ip}:${route}`;
    const current = buckets.get(key);
    const bucket = current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    reply.header('X-RateLimit-Limit', String(options.max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      reply.code(429).send({ error: '请求过于频繁，请稍后再试' });
    }
  };
}
/**
 * 登录失败限流器：只累计密码验证失败；成功登录会清除记录，避免正常管理员操作被锁定。
 */
export function createLoginFailureLimiter(options: RateLimitOptions): LoginFailureLimiter {
  const buckets = new Map<string, Bucket>();
  let lastCleanup = 0;

  function cleanup(now: number): void {
    if (now - lastCleanup <= options.windowMs) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    lastCleanup = now;
  }

  function getKey(request: FastifyRequest, username: string): string {
    // 用户名大小写不能成为绕过失败计数的手段；实际认证仍沿用原有大小写语义。
    return [options.name, request.ip, username.trim().toLowerCase()].join(':');
  }

  function getActiveBucket(key: string, now: number): Bucket | undefined {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt > now) return bucket;
    buckets.delete(key);
    return undefined;
  }

  function setHeaders(reply: FastifyReply, bucket: Bucket, now: number): void {
    reply.header('X-RateLimit-Limit', String(options.max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count >= options.max) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    }
  }

  return {
    isBlocked(request, reply, username) {
      const now = Date.now();
      cleanup(now);
      const bucket = getActiveBucket(getKey(request, username), now);
      if (!bucket) return false;
      setHeaders(reply, bucket, now);
      if (bucket.count < options.max) return false;
      reply.code(429).send({ error: '请求过于频繁，请稍后再试' });
      return true;
    },
    recordFailure(request, reply, username) {
      const now = Date.now();
      cleanup(now);
      const key = getKey(request, username);
      const bucket = getActiveBucket(key, now) ?? { count: 0, resetAt: now + options.windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);
      setHeaders(reply, bucket, now);
    },
    reset(request, username) {
      buckets.delete(getKey(request, username));
    },
  };
}
