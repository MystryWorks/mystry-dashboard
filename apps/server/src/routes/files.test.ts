/**
 * R1-06 认证下载 ticket 协议回归。
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

process.env.JWT_SECRET = 'a'.repeat(64);
process.env.SETUP_TOKEN = 'b'.repeat(64);
process.env.LAUNCHER_TOKEN = 'c'.repeat(64);

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

test('R1-06: 下载完成后状态查询返回 consumed 而非 404（短时 tombstone）', async () => {
  const {
    resetDownloadTicketsForTests,
    reserveDownloadTicket,
    beginDownloadStream,
    completeDownloadStream,
    getDownloadTicketStatus,
  } = await import('../services/download-ticket-service.js');
  resetDownloadTicketsForTests();
  const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {});
  assert.equal(beginDownloadStream(issued.ticket, 'inst-1', 'logs/latest.log')?.userId, 'user-1');
  completeDownloadStream(issued.ticket);
  const status = getDownloadTicketStatus(issued.ticket, 'user-1');
  assert.equal(status?.status, 'consumed');
  assert.equal(getDownloadTicketStatus(issued.ticket, 'user-2'), null);
});

test('R1-06: consumed tombstone 过期后状态查询回落 null', async () => {
  const { mock } = test;
  mock.timers.enable({ now: 1_000_000, apis: ['Date'] });
  try {
    const {
      resetDownloadTicketsForTests,
      reserveDownloadTicket,
      completeDownloadStream,
      getDownloadTicketStatus,
    } = await import('../services/download-ticket-service.js');
    resetDownloadTicketsForTests();
    const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {});
    completeDownloadStream(issued.ticket);
    assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'consumed');
    mock.timers.tick(61_000);
    assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1'), null);
  } finally {
    mock.timers.reset();
  }
});

test('R1-06: reserved ticket 到期时自动释放并保留 expired 状态', async () => {
  const { mock } = test;
  mock.timers.enable({ now: 1_000_000, apis: ['Date', 'setTimeout'] });
  try {
    const {
      resetDownloadTicketsForTests,
      reserveDownloadTicket,
      getDownloadTicketStatus,
    } = await import('../services/download-ticket-service.js');
    const { config } = await import('../config.js');
    resetDownloadTicketsForTests();
    let released = 0;
    const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {
      released += 1;
    });

    mock.timers.tick(config.fileDownloadTicketTtlSeconds * 1000);

    assert.equal(released, 1);
    assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'expired');
  } finally {
    const { resetDownloadTicketsForTests } = await import('../services/download-ticket-service.js');
    resetDownloadTicketsForTests();
    mock.timers.reset();
  }
});

test('R1-06: streaming ticket 不受签发 TTL 回收，结束时只释放一次', async () => {
  const { mock } = test;
  mock.timers.enable({ now: 2_000_000, apis: ['Date', 'setTimeout'] });
  try {
    const {
      resetDownloadTicketsForTests,
      reserveDownloadTicket,
      beginDownloadStream,
      completeDownloadStream,
      getDownloadTicketStatus,
    } = await import('../services/download-ticket-service.js');
    const { config } = await import('../config.js');
    resetDownloadTicketsForTests();
    let released = 0;
    const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {
      released += 1;
    });
    assert.equal(beginDownloadStream(issued.ticket, 'inst-1', 'logs/latest.log')?.userId, 'user-1');

    mock.timers.tick(config.fileDownloadTicketTtlSeconds * 1000 + 1);

    assert.equal(released, 0);
    assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'streaming');
    completeDownloadStream(issued.ticket);
    completeDownloadStream(issued.ticket);
    assert.equal(released, 1);
    assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'consumed');
  } finally {
    const { resetDownloadTicketsForTests } = await import('../services/download-ticket-service.js');
    resetDownloadTicketsForTests();
    mock.timers.reset();
  }
});

test('R1-06: streaming 失败在签发 TTL 后仍可查询失败原因', async () => {
  const { mock } = test;
  mock.timers.enable({ now: 3_000_000, apis: ['Date', 'setTimeout'] });
  try {
    const {
      resetDownloadTicketsForTests,
      reserveDownloadTicket,
      beginDownloadStream,
      failDownloadStream,
      getDownloadTicketStatus,
    } = await import('../services/download-ticket-service.js');
    const { config } = await import('../config.js');
    resetDownloadTicketsForTests();
    const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {});
    assert.equal(beginDownloadStream(issued.ticket, 'inst-1', 'logs/latest.log')?.userId, 'user-1');

    mock.timers.tick(config.fileDownloadTicketTtlSeconds * 1000 + 1);
    failDownloadStream(issued.ticket, '文件下载空闲超时');

    const status = getDownloadTicketStatus(issued.ticket, 'user-1');
    assert.equal(status?.status, 'failed');
    assert.match(status?.error ?? '', /空闲超时/);
  } finally {
    const { resetDownloadTicketsForTests } = await import('../services/download-ticket-service.js');
    resetDownloadTicketsForTests();
    mock.timers.reset();
  }
});

test('R1-06: 开流前 close 应结束等待并移除监听', async () => {
  const { waitForDownloadStreamOpen } = await import('./files.js');
  const stream = new EventEmitter();
  const opening = waitForDownloadStreamOpen(stream);

  stream.emit('close');

  await assert.rejects(opening, /文件下载连接已中止/);
  assert.equal(stream.listenerCount('open'), 0);
  assert.equal(stream.listenerCount('error'), 0);
  assert.equal(stream.listenerCount('close'), 0);
});

test('R1-06: 所属用户取消 reserved ticket 应立即释放槽位并进入取消终态', async () => {
  const {
    resetDownloadTicketsForTests,
    reserveDownloadTicket,
    cancelReservedDownloadTicket,
    getDownloadTicketStatus,
  } = await import('../services/download-ticket-service.js');
  resetDownloadTicketsForTests();
  let released = 0;
  const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {
    released += 1;
  });

  assert.equal(cancelReservedDownloadTicket(issued.ticket, 'user-1', 'inst-1'), 'cancelled');
  assert.equal(released, 1);
  assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'failed');
  assert.match(getDownloadTicketStatus(issued.ticket, 'user-1')?.error ?? '', /已取消/);
});

test('R1-06: 跨用户或跨实例取消 ticket 应拒绝且不释放', async () => {
  const {
    resetDownloadTicketsForTests,
    reserveDownloadTicket,
    cancelReservedDownloadTicket,
    getDownloadTicketStatus,
  } = await import('../services/download-ticket-service.js');
  resetDownloadTicketsForTests();
  let released = 0;
  const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {
    released += 1;
  });

  assert.equal(cancelReservedDownloadTicket(issued.ticket, 'user-2', 'inst-1'), 'not_found');
  assert.equal(cancelReservedDownloadTicket(issued.ticket, 'user-1', 'inst-2'), 'not_found');
  assert.equal(released, 0);
  assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'reserved');
});

test('R1-06: streaming ticket 取消应为 no-op，仍由流终态释放', async () => {
  const {
    resetDownloadTicketsForTests,
    reserveDownloadTicket,
    beginDownloadStream,
    cancelReservedDownloadTicket,
    completeDownloadStream,
    getDownloadTicketStatus,
  } = await import('../services/download-ticket-service.js');
  resetDownloadTicketsForTests();
  let released = 0;
  const issued = reserveDownloadTicket('user-1', 'inst-1', 'logs/latest.log', () => {
    released += 1;
  });
  assert.equal(beginDownloadStream(issued.ticket, 'inst-1', 'logs/latest.log')?.userId, 'user-1');

  assert.equal(cancelReservedDownloadTicket(issued.ticket, 'user-1', 'inst-1'), 'streaming');
  assert.equal(released, 0);
  assert.equal(getDownloadTicketStatus(issued.ticket, 'user-1')?.status, 'streaming');
  completeDownloadStream(issued.ticket);
  assert.equal(released, 1);
});

test('R1-06: 取消路由映射不依赖实例记录，已删除实例仍可释放所属 reserved ticket', async () => {
  const {
    resetDownloadTicketsForTests,
    reserveDownloadTicket,
  } = await import('../services/download-ticket-service.js');
  const { cancelDownloadTicketRoute } = await import('./files.js');
  resetDownloadTicketsForTests();
  let released = 0;
  const issued = reserveDownloadTicket('user-1', 'deleted-inst', 'logs/latest.log', () => {
    released += 1;
  });

  const result = cancelDownloadTicketRoute(issued.ticket, 'user-1', 'deleted-inst');

  assert.deepEqual(result, { statusCode: 204 });
  assert.equal(released, 1);
});
