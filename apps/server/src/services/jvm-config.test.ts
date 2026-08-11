import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JVM_PRESETS,
  automaticInitialMemoryMiB,
  buildJvmArgs,
  inspectJvmArgFile,
  inspectJvmArgs,
  parseJvmArgFile,
  parseJvmArgs,
  recommendedMaxMemoryMiB,
  serializeJvmArgFile,
  serializeJvmArgs,
  validateJvmArgs,
} from '@mmd/shared';

test('JVM 参数解析保留引号、Windows 路径和 UNC 路径', () => {
  const parsed = parseJvmArgs(
    String.raw`-Xms1G -Xmx2G "-Dpath=C:\Program Files\Java" '-Dunc=\\server\share folder'`,
  );
  assert.deepEqual(parsed, [
    '-Xms1G',
    '-Xmx2G',
    String.raw`-Dpath=C:\Program Files\Java`,
    String.raw`-Dunc=\\server\share folder`,
  ]);
  assert.deepEqual(parseJvmArgs(serializeJvmArgs(parsed)), parsed);
  assert.deepEqual(parseJvmArgFile(serializeJvmArgFile(parsed)), parsed);
  assert.throws(() => parseJvmArgs('-Xms1G "-Xmx2G'), /未闭合/);
});

test('user_jvm_args.txt 忽略空行和注释并可规范化', () => {
  const raw = [
    '# Forge 生成的说明',
    '',
    '-Xms1G',
    '-Xmx4G',
    '  # 不执行这一行',
    '"-Dfolder=C:\\\\Minecraft Server"',
    '-Dkept=true # 行尾注释',
  ].join('\r\n');
  assert.deepEqual(parseJvmArgFile(raw), [
    '-Xms1G',
    '-Xmx4G',
    String.raw`-Dfolder=C:\Minecraft Server`,
    '-Dkept=true',
  ]);
  const detected = inspectJvmArgFile(raw);
  assert.equal(detected.canonicalArgs, String.raw`-Xms1G -Xmx4G -Dfolder=C:\Minecraft\ Server -Dkept=true`);
  assert.equal(detected.issues.length, 0);
});

test('推荐内存按四分之一、512 MiB、系统保留和上下限计算', () => {
  assert.equal(recommendedMaxMemoryMiB(null), 2048);
  assert.equal(recommendedMaxMemoryMiB(32 * 1024), 8192);
  assert.equal(recommendedMaxMemoryMiB(8 * 1024), 2048);
  assert.equal(recommendedMaxMemoryMiB(4 * 1024), 2048);
  assert.equal(recommendedMaxMemoryMiB(3 * 1024), 1024);
  assert.equal(automaticInitialMemoryMiB('compatibility', 8192), 1024);
  assert.equal(automaticInitialMemoryMiB('g1-balanced', 8192), 1024);
  assert.equal(automaticInitialMemoryMiB('paper-aikar', 8192), 8192);
});

test('三个 JVM 预设可生成并反向识别', () => {
  assert.deepEqual(JVM_PRESETS.map((preset) => preset.id), [
    'compatibility',
    'g1-balanced',
    'paper-aikar',
  ]);
  const compatibility = buildJvmArgs({ xmsMiB: 1024, xmxMiB: 2048, presetId: 'compatibility' });
  const g1 = buildJvmArgs({ xmsMiB: 1024, xmxMiB: 4096, presetId: 'g1-balanced' });
  const paper = buildJvmArgs({ xmsMiB: 6144, xmxMiB: 6144, presetId: 'paper-aikar' });
  assert.equal(inspectJvmArgs(compatibility).presetId, 'compatibility');
  assert.equal(inspectJvmArgs(g1).presetId, 'g1-balanced');
  assert.equal(inspectJvmArgs(paper, { coreType: 'paper', javaMajor: 21 }).presetId, 'paper-aikar');
  assert.equal(validateJvmArgs(paper, { coreType: 'paper', javaMajor: 21 }).length, 0);
});

test('冲突内存、GC 和面板负责的启动参数会阻止保存', () => {
  const issues = validateJvmArgs(
    '-Xms4G -Xms2G -Xmx1G -XX:+UseG1GC -XX:+UseG1GC -jar server.jar nogui @args.txt',
  );
  const codes = new Set(issues.filter((item) => item.severity === 'error').map((item) => item.code));
  assert.equal(codes.has('XMS_COUNT'), true);
  assert.equal(codes.has('GC_CONFLICT'), true);
  assert.equal(codes.has('PANEL_OWNED_ARGUMENT'), true);

  const memoryOrder = validateJvmArgs('-Xms4G -Xmx2G');
  assert.equal(memoryOrder.some((item) => item.code === 'MEMORY_ORDER'), true);
  const advancedMemory = buildJvmArgs({
    xmsMiB: 1024,
    xmxMiB: 2048,
    presetId: 'compatibility',
    extraArgs: '-Xmx4G',
  });
  assert.equal(validateJvmArgs(advancedMemory).some((item) => item.code === 'XMX_COUNT'), true);
});

test('预设限制与旧参数错误均保留为结构化诊断', () => {
  const paper = buildJvmArgs({ xmsMiB: 4096, xmxMiB: 4096, presetId: 'paper-aikar' });
  const mismatch = validateJvmArgs(paper, { coreType: 'forge', javaMajor: 22 });
  assert.equal(mismatch.some((item) => item.code === 'PRESET_CORE_MISMATCH'), true);
  assert.equal(mismatch.some((item) => item.code === 'PRESET_JAVA_MISMATCH'), true);
  assert.equal(mismatch.some((item) => item.code === 'PAPER_MEMORY_LOW' && item.severity === 'warning'), true);

  const oldValue = '-Xms1G "-Xmx2G';
  const inspected = inspectJvmArgs(oldValue);
  assert.equal(inspected.raw, oldValue);
  assert.equal(inspected.canonicalArgs, null);
  assert.equal(inspected.extraArgs, oldValue);
  assert.equal(inspected.issues[0]?.code, 'PARSE_ERROR');
});

test('服务端在实例保存和任务入队前拒绝非法参数', async (t) => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-jvm-validation-'));
  process.env.DATA_DIR = dataRoot;
  process.env.JWT_SECRET = 'a'.repeat(64);
  process.env.SETUP_TOKEN = 'b'.repeat(64);
  process.env.LAUNCHER_TOKEN = 'c'.repeat(64);
  const { initDb, closeDb, getDb } = await import('../db.js');
  const { createInstance, getInstance, updateInstance } = await import('./instance-service.js');
  const { deployCore } = await import('./core-depot.js');
  const { getTaskActivity } = await import('./task-service.js');
  initDb();
  t.after(() => {
    closeDb();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  assert.throws(
    () => createInstance({ name: '非法内存', jvmArgs: '-Xms4G -Xmx2G' }),
    /初始内存不能大于最大内存/,
  );
  const instance = createInstance({ name: '合法实例', jvmArgs: '-Xms1G -Xmx2G' });
  assert.throws(
    () => updateInstance(instance.id, { jvmArgs: '-Xms1G -Xmx2G -jar server.jar' }),
    /由面板管理/,
  );
  assert.equal(getInstance(instance.id)?.jvmArgs, '-Xms1G -Xmx2G');
  getDb().prepare('UPDATE instances SET jvm_args = ? WHERE id = ?').run('-Xmx2G', instance.id);
  assert.throws(
    () => updateInstance(instance.id, { name: '不能绕过旧参数错误' }),
    /必须且只能包含一个 -Xms/,
  );
  getDb().prepare('UPDATE instances SET jvm_args = ? WHERE id = ?').run('-Xms1G -Xmx2G', instance.id);

  const activityBefore = getTaskActivity();
  await assert.rejects(
    () => deployCore({
      name: '非法部署',
      coreType: 'paper',
      mcVersion: '1.21.1',
      jvmArgs: '-Xms1G -Xmx2G nogui',
    }),
    /由面板管理/,
  );
  assert.deepEqual(getTaskActivity(), activityBefore);
});
