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
  expiresTimer: NodeJS.Timeout | null;
};

/** @deprecated 仅测试兼容；生产路径应使用 reserveDownloadTicket。 */
export type ClaimedDownloadTicket = {
  userId: string;
  ticket: string;
  record: Omit<DownloadTicketRecord, 'releaseSlot' | 'status' | 'error' | 'expiresTimer'> & {
    expiresAt: number;
  };
};

const tickets = new Map<string, DownloadTicketRecord>();

/** 过期票据的短时 tombstone：让状态查询在过期后仍能返回 expired，而不是 404 */
const expiredTickets = new Map<string, { userId: string; expiresAt: number }>();
const EXPIRED_TOMBSTONE_MS = 60_000;

/** 已消费票据的短时 tombstone：下载完成后仍能返回 consumed，避免前端误判 404 为过期 */
const consumedTickets = new Map<string, { userId: string; expiresAt: number }>();
const CONSUMED_TOMBSTONE_MS = 60_000;

/** 失败下载的短时 tombstone：让浏览器持续轮询时能收到具体失败原因。 */
const failedTickets = new Map<string, { userId: string; error: string; expiresAt: number }>();
const FAILED_TOMBSTONE_MS = 60_000;

export type CancelReservedDownloadTicketResult = 'cancelled' | 'streaming' | 'not_found';

function noopRelease(): void {}

function releaseTicketSlot(record: DownloadTicketRecord): void {
  record.releaseSlot();
  record.releaseSlot = noopRelease;
}

function clearReservedExpiry(record: DownloadTicketRecord): void {
  if (!record.expiresTimer) return;
  clearTimeout(record.expiresTimer);
  record.expiresTimer = null;
}

function expireReservedTicket(ticket: string, record: DownloadTicketRecord, now = Date.now()): void {
  if (tickets.get(ticket) !== record || record.status !== 'reserved' || record.expiresAt > now) return;
  clearReservedExpiry(record);
  releaseTicketSlot(record);
  tickets.delete(ticket);
  expiredTickets.set(ticket, { userId: record.userId, expiresAt: now + EXPIRED_TOMBSTONE_MS });
}

function scheduleReservedExpiry(ticket: string, record: DownloadTicketRecord): void {
  clearReservedExpiry(record);
  const delay = Math.max(0, record.expiresAt - Date.now());
  record.expiresTimer = setTimeout(() => {
    record.expiresTimer = null;
    expireReservedTicket(ticket, record);
  }, delay);
  record.expiresTimer.unref?.();
}

function pruneExpired(now = Date.now()): void {
  for (const [ticket, value] of tickets) {
    if (value.status === 'reserved' && value.expiresAt <= now) {
      expireReservedTicket(ticket, value, now);
    }
  }
  for (const [ticket, value] of expiredTickets) {
    if (value.expiresAt <= now) expiredTickets.delete(ticket);
  }
  for (const [ticket, value] of consumedTickets) {
    if (value.expiresAt <= now) consumedTickets.delete(ticket);
  }
  for (const [ticket, value] of failedTickets) {
    if (value.expiresAt <= now) failedTickets.delete(ticket);
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
  const record: DownloadTicketRecord = {
    userId,
    instanceId,
    path: relativePath,
    expiresAt: now + config.fileDownloadTicketTtlSeconds * 1000,
    status: 'reserved',
    releaseSlot,
    expiresTimer: null,
  };
  tickets.set(ticket, record);
  scheduleReservedExpiry(ticket, record);
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
  if (value) {
    if (value.userId !== userId) return null;
    return {
      status: value.status,
      ...(value.error ? { error: value.error } : {}),
    };
  }
  const tombstone = expiredTickets.get(ticket);
  if (tombstone && tombstone.userId === userId) {
    return { status: 'expired', error: '下载票据已过期' };
  }
  const consumed = consumedTickets.get(ticket);
  if (consumed && consumed.userId === userId) {
    return { status: 'consumed' };
  }
  const failed = failedTickets.get(ticket);
  if (failed && failed.userId === userId) {
    return { status: 'failed', error: failed.error };
  }
  return null;
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
  if (value.instanceId !== instanceId || value.path !== relativePath) {
    return null;
  }
  if (value.status !== 'reserved') return null;
  clearReservedExpiry(value);
  value.status = 'streaming';
  return { userId: value.userId };
}

/** 仅允许签发该票据的用户在原生 GET 开流前取消预占槽位。 */
export function cancelReservedDownloadTicket(
  ticket: string,
  userId: string,
  instanceId: string,
): CancelReservedDownloadTicketResult {
  pruneExpired();
  const value = tickets.get(ticket);
  if (!value || value.userId !== userId || value.instanceId !== instanceId) return 'not_found';
  if (value.status === 'streaming') return 'streaming';
  if (value.status !== 'reserved') return 'not_found';

  clearReservedExpiry(value);
  releaseTicketSlot(value);
  tickets.delete(ticket);
  failedTickets.set(ticket, {
    userId: value.userId,
    error: '下载已取消',
    expiresAt: Date.now() + FAILED_TOMBSTONE_MS,
  });
  return 'cancelled';
}

export function completeDownloadStream(ticket: string): void {
  const value = tickets.get(ticket);
  if (!value) return;
  clearReservedExpiry(value);
  releaseTicketSlot(value);
  tickets.delete(ticket);
  consumedTickets.set(ticket, {
    userId: value.userId,
    expiresAt: Date.now() + CONSUMED_TOMBSTONE_MS,
  });
}

export function failDownloadStream(ticket: string, error: string): void {
  const value = tickets.get(ticket);
  if (!value) return;
  clearReservedExpiry(value);
  releaseTicketSlot(value);
  tickets.delete(ticket);
  failedTickets.set(ticket, {
    userId: value.userId,
    error,
    expiresAt: Date.now() + FAILED_TOMBSTONE_MS,
  });
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
    clearReservedExpiry(value);
    releaseTicketSlot(value);
    tickets.delete(claimed.ticket);
    expiredTickets.set(claimed.ticket, {
      userId: value.userId,
      expiresAt: Date.now() + EXPIRED_TOMBSTONE_MS,
    });
    return;
  }
  value.status = 'reserved';
  scheduleReservedExpiry(claimed.ticket, value);
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
    clearReservedExpiry(value);
    releaseTicketSlot(value);
  }
  tickets.clear();
  expiredTickets.clear();
  consumedTickets.clear();
  failedTickets.clear();
}
