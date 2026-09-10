import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { MetricsService, cpuUsage, readProcesses } from './metrics-service.js';

test('CPU 按整机容量归一且拒绝计数回退', () => {
  assert.equal(cpuUsage(1000, 1000, 8), 12.5);
  assert.equal(cpuUsage(16000, 1000, 8), 100);
  assert.equal(cpuUsage(-1, 1000, 8), null);
  assert.equal(cpuUsage(0, 0, 8), null);
});

test('并发请求共享采样，短期缓存不重复查询且缺失磁盘不伪装零空间', async () => {
  const service = new MetricsService(`${os.tmpdir()}/mmd-nonexistent-metrics-${process.pid}`, () => []);
  const first = service.get();
  assert.equal(first, service.get());
  const result = await first;
  assert.equal(result, await service.get());
  assert.equal(result.cpuPercent, null);
  assert.equal(result.disk, null);
  assert.ok(result.memory.totalBytes > 0);
  assert.deepEqual(result.instances, {});
});

test('本平台真实采集仅查询目标进程并返回累计 CPU 和驻留内存', { skip: !['win32', 'linux'].includes(process.platform) }, async () => {
  const rows = await readProcesses([{ id: 'test-only', pid: process.pid }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.pid, process.pid);
  assert.ok(rows[0]!.memoryBytes > 0);
  assert.ok(rows[0]!.cpuMs >= 0);
  assert.ok(rows[0]!.identity);
});

test('真实监测路由拒绝未认证请求，认证后返回资源快照', async () => {
  // 路由测试不初始化数据库，不读写用户实例，也不使用真实密钥。
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.SETUP_TOKEN = randomBytes(32).toString('hex');
  process.env.LAUNCHER_TOKEN = randomBytes(32).toString('hex');
  process.env.MMD_DATA_DIR = os.tmpdir();
  const { systemRoutes } = await import('../routes/system.js');
  const { registerAuthHooks } = await import('../routes/auth.js');
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET });
  registerAuthHooks(app);
  await app.register(systemRoutes);
  try {
    assert.equal((await app.inject('/api/system/metrics')).statusCode, 401);
    const token = app.jwt.sign({ id: 'metrics-test', username: 'metrics-test' });
    const response = await app.inject({ url: '/api/system/metrics', headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.statusCode, 200);
    const data = response.json();
    assert.ok(data.memory.totalBytes > 0);
    assert.ok(data.disk.totalBytes > 0);
    assert.deepEqual(data.instances, {});
    assert.ok(Number.isFinite(Date.parse(data.sampledAt)));
  } finally { await app.close(); }
});
