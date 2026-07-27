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
