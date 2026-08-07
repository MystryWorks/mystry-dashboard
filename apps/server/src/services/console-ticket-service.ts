import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

type ConsoleTicket = {
  userId: string;
  instanceId: string;
  expiresAt: number;
};

const tickets = new Map<string, ConsoleTicket>();

/** 未过期票据数量上限，防止异常客户端反复签发耗尽内存。 */
const MAX_CONSOLE_TICKETS = 1000;

function pruneExpired(now = Date.now()): void {
  for (const [ticket, value] of tickets) {
    if (value.expiresAt <= now) tickets.delete(ticket);
  }
}

export function issueConsoleTicket(userId: string, instanceId: string): {
  ticket: string;
  expiresIn: number;
} {
  const now = Date.now();
  pruneExpired(now);
  if (tickets.size >= MAX_CONSOLE_TICKETS) {
    throw new Error('控制台票据数量已达上限，请稍后重试');
  }
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId,
    instanceId,
    expiresAt: now + config.consoleTicketTtlSeconds * 1000,
  });
  return { ticket, expiresIn: config.consoleTicketTtlSeconds };
}

/** 校验并立即消费 ticket；无论实例是否匹配，成功找到的 ticket 都不会再次可用。 */
export function consumeConsoleTicket(
  ticket: string,
  instanceId: string,
): { userId: string } | null {
  const now = Date.now();
  const value = tickets.get(ticket);
  if (!value) return null;
  tickets.delete(ticket);
  if (value.expiresAt <= now || value.instanceId !== instanceId) return null;
  return { userId: value.userId };
}
