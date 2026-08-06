import { randomBytes } from 'node:crypto';
import type {
  FileDownloadTicketResult,
  FileDownloadTicketStatus,
  FileDownloadTicketStatusResult,
} from '@mmd/shared';
import { config } from '../config.js';

type DownloadTicketRecord = {
  userId: string;
  instanceId: string;
  path: string;
  expiresAt: number;
  status: FileDownloadTicketStatus;
  error?: string;
  releaseSlot: () => void;
};

/** @deprecated 仅测试兼容；生产路径应使用 reserveDownloadTicket。 */
export type ClaimedDownloadTicket = {
  userId: string;
  ticket: string;
  record: Omit<DownloadTicketRecord, 'releaseSlot' | 'status' | 'error'> & {
    expiresAt: number;
  };
};

const tickets = new Map<string, DownloadTicketRecord>();

function noopRelease(): void {}

function releaseTicketSlot(record: DownloadTicketRecord): void {
  record.releaseSlot();
  record.releaseSlot = noopRelease;
}

function pruneExpired(now = Date.now()): void {
  for (const [ticket, value] of tickets) {
    if (value.expiresAt > now) continue;
    if (value.status === 'reserved' || value.status === 'streaming') {
      releaseTicketSlot(value);
    }
    value.status = 'expired';
    tickets.delete(ticket);
  }
}

/** POST 签发：预占下载槽并进入 reserved 状态。 */
export function reserveDownloadTicket(
  userId: string,
  instanceId: string,
  relativePath: string,
  releaseSlot: () => void,
): FileDownloadTicketResult {
  const now = Date.now();
  pruneExpired(now);
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId,
    instanceId,
    path: relativePath,
    expiresAt: now + config.fileDownloadTicketTtlSeconds * 1000,
    status: 'reserved',
    releaseSlot,
  });
  return { ticket, expiresIn: config.fileDownloadTicketTtlSeconds };
}

/** 兼容旧测试：不占槽签发（新路由不得调用）。 */
export function issueDownloadTicket(
  userId: string,
  instanceId: string,
  relativePath: string,
): FileDownloadTicketResult {
  return reserveDownloadTicket(userId, instanceId, relativePath, noopRelease);
}

export function getDownloadTicketStatus(
  ticket: string,
  userId: string,
): FileDownloadTicketStatusResult | null {
  const now = Date.now();
  pruneExpired(now);
  const value = tickets.get(ticket);
  if (!value || value.userId !== userId) return null;
  if (value.expiresAt <= now) {
    return { status: 'expired', error: '下载票据已过期' };
  }
  return {
    status: value.status,
    ...(value.error ? { error: value.error } : {}),
  };
}

/** GET 开流前：reserved → streaming。 */
export function beginDownloadStream(
  ticket: string,
  instanceId: string,
  relativePath: string,
): { userId: string } | null {
  const now = Date.now();
  pruneExpired(now);
  const value = tickets.get(ticket);
  if (!value) return null;
  if (value.expiresAt <= now) {
    if (value.status === 'reserved') releaseTicketSlot(value);
    value.status = 'expired';
    tickets.delete(ticket);
    return null;
  }
  if (value.instanceId !== instanceId || value.path !== relativePath) {
    return null;
  }
  if (value.status !== 'reserved') return null;
  value.status = 'streaming';
  return { userId: value.userId };
}

export function completeDownloadStream(ticket: string): void {
  const value = tickets.get(ticket);
  if (!value) return;
  releaseTicketSlot(value);
  value.status = 'consumed';
  tickets.delete(ticket);
}

export function failDownloadStream(ticket: string, error: string): void {
  const value = tickets.get(ticket);
  if (!value) return;
  if (value.status === 'reserved' || value.status === 'streaming') {
    releaseTicketSlot(value);
  }
  value.status = 'failed';
  value.error = error;
}

/**
 * 立即从池中取出 ticket，防止并发重放（遗留 API；新 GET 使用 beginDownloadStream）。
 */
export function claimDownloadTicket(
  ticket: string,
  instanceId: string,
  relativePath: string,
): ClaimedDownloadTicket | null {
  const began = beginDownloadStream(ticket, instanceId, relativePath);
  if (!began) return null;
  const value = tickets.get(ticket);
  if (!value) return null;
  return {
    userId: began.userId,
    ticket,
    record: {
      userId: value.userId,
      instanceId: value.instanceId,
      path: value.path,
      expiresAt: value.expiresAt,
    },
  };
}

export function restoreDownloadTicket(claimed: ClaimedDownloadTicket): void {
  const value = tickets.get(claimed.ticket);
  if (!value || value.status !== 'streaming') return;
  if (value.expiresAt <= Date.now()) {
    releaseTicketSlot(value);
    value.status = 'expired';
    tickets.delete(claimed.ticket);
    return;
  }
  value.status = 'reserved';
}

/** 校验并立即消费 ticket；无论是否匹配，成功找到的 ticket 都不会再次可用。 */
export function consumeDownloadTicket(
  ticket: string,
  instanceId: string,
  relativePath: string,
): { userId: string } | null {
  const claimed = claimDownloadTicket(ticket, instanceId, relativePath);
  if (!claimed) return null;
  completeDownloadStream(ticket);
  return { userId: claimed.userId };
}

/** 测试专用：清空内存票据。 */
export function resetDownloadTicketsForTests(): void {
  for (const value of tickets.values()) {
    releaseTicketSlot(value);
  }
  tickets.clear();
}
