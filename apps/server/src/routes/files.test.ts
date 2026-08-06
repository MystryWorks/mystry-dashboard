/**
 * R1-06 认证下载 ticket 协议回归。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('R1-06: ticket 一次性消费与重放拒绝（内存服务）', async () => {
  const {
    resetDownloadTicketsForTests,
    issueDownloadTicket,
    consumeDownloadTicket,
    beginDownloadStream,
  } = await import('../services/download-ticket-service.js');
  resetDownloadTicketsForTests();
  const issued = issueDownloadTicket('user-1', 'inst-1', 'logs/latest.log');
  assert.equal(consumeDownloadTicket(issued.ticket, 'inst-1', 'logs/latest.log')?.userId, 'user-1');
  assert.equal(consumeDownloadTicket(issued.ticket, 'inst-1', 'logs/latest.log'), null);
  assert.equal(beginDownloadStream(issued.ticket, 'inst-1', 'logs/latest.log'), null);
});

test('R1-06: POST 签发时应预占并发下载槽', async () => {
  const { resetDownloadTicketsForTests, reserveDownloadTicket } = await import('../services/download-ticket-service.js');
  const { config } = await import('../config.js');
  const {
    acquireFileDownloadSlot,
    FileDownloadCapacityError,
  } = await import('../services/file-service.js');
  resetDownloadTicketsForTests();
  const releases: Array<() => void> = [];
  for (let index = 0; index < config.maxConcurrentFileDownloads; index += 1) {
    releases.push(acquireFileDownloadSlot());
    reserveDownloadTicket('user-1', 'inst-1', `file-${index}.txt`, releases[index]!);
  }
  assert.throws(() => acquireFileDownloadSlot(), FileDownloadCapacityError);
  for (const release of releases) release();
});

test('R1-06: GET 开流失败应通过 ticket 状态查询反馈 SPA', async () => {
  const {
    resetDownloadTicketsForTests,
    reserveDownloadTicket,
    failDownloadStream,
    getDownloadTicketStatus,
  } = await import('../services/download-ticket-service.js');
  resetDownloadTicketsForTests();
  let released = false;
  const issued = reserveDownloadTicket('user-1', 'inst-1', 'missing.txt', () => {
    released = true;
  });
  failDownloadStream(issued.ticket, '文件不存在');
  assert.equal(released, true);
  const status = getDownloadTicketStatus(issued.ticket, 'user-1');
  assert.equal(status?.status, 'failed');
  assert.match(status?.error ?? '', /文件不存在/);
});
