import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { STAGING_ROOT_DIR } from './services/task-staging-service.js';
import {
  finalizeSensitiveDataFiles,
  prepareSecureDataLayout,
} from './utils/data-dir-permissions.js';

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
};

export type InstanceRow = {
  id: string;
  name: string;
  core_type: string;
  mc_version: string | null;
  jar_file: string;
  java_path: string;
  jvm_args: string;
  accept_eula: number;
  install_path: string | null;
  /** 默认托管目录的 ownership marker；旧实例为空 */
  ownership_marker: string | null;
  /** 所属节点 ID，默认为内置本机节点 'local' */
  node_id: string;
  /** 绑定的 Java 运行时 ID（java_runtimes.id）；NULL 表示使用 PATH 中的 java */
  java_runtime_id: string | null;
  created_at: string;
  updated_at: string;
};

/** 面板探测并验证过的 Java 运行时；路径只允许来自面板扫描，不接受请求提交 */
export type JavaRuntimeRow = {
  id: string;
  path: string;
  version: string | null;
  major_version: number | null;
  source: 'env' | 'scan';
  verified_at: string;
  /** 最近一次完整扫描是否仍发现并验证此运行时 */
  available: number;
};

/** 节点：本机节点（内置，id='local'）或远程 Agent 节点 */
export type NodeRow = {
  id: string;
  name: string;
  /** 节点密钥的哈希值（sha256 hex）；本机节点无需密钥，为空字符串 */
  secret_hash: string;
  is_local: number;
  /** Agent 上报的主机信息（JSON 字符串），本机节点可为空 */
  host_info: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskRow = {
  id: string;
  type: string;
  status: string;
  /** 任务文件阶段：staging / finalizing / completed / failed；旧库可为 NULL */
  phase: string | null;
  progress: number;
  message: string;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

let db: DatabaseSync | undefined;

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('数据库尚未初始化');
  }
  return db;
}

export function initDb(): void {
  prepareSecureDataLayout(config.dataDir, [
    'instances',
    'imports',
    path.join('cache', 'cores'),
    'uploads',
    STAGING_ROOT_DIR,
    '.mmd-panel-lock',
  ]);

  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  finalizeSensitiveDataFiles(config.dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      core_type TEXT NOT NULL DEFAULT 'custom',
      mc_version TEXT,
      jar_file TEXT NOT NULL DEFAULT 'server.jar',
      java_path TEXT NOT NULL DEFAULT 'java',
      jvm_args TEXT NOT NULL DEFAULT '-Xms1G -Xmx2G',
      accept_eula INTEGER NOT NULL DEFAULT 0,
      install_path TEXT,
      ownership_marker TEXT,
      node_id TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      secret_hash TEXT NOT NULL DEFAULT '',
      is_local INTEGER NOT NULL DEFAULT 0,
      host_info TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS java_runtimes (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      version TEXT,
      major_version INTEGER,
      source TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      available INTEGER NOT NULL DEFAULT 1
    );
  `);

  // 兼容已有数据库：补齐实例目录安全字段
  let cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'install_path')) {
    db.exec('ALTER TABLE instances ADD COLUMN install_path TEXT');
  }
  if (!cols.some((c) => c.name === 'node_id')) {
    db.exec("ALTER TABLE instances ADD COLUMN node_id TEXT NOT NULL DEFAULT 'local'");
  }
  cols = db.prepare(`PRAGMA table_info(instances)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'ownership_marker')) {
    db.exec('ALTER TABLE instances ADD COLUMN ownership_marker TEXT');
  }
  if (!cols.some((c) => c.name === 'java_runtime_id')) {
    db.exec('ALTER TABLE instances ADD COLUMN java_runtime_id TEXT');
  }
  const runtimeCols = db.prepare('PRAGMA table_info(java_runtimes)').all() as Array<{ name: string }>;
  if (!runtimeCols.some((c) => c.name === 'available')) {
    db.exec('ALTER TABLE java_runtimes ADD COLUMN available INTEGER NOT NULL DEFAULT 1');
  }

  let taskCols = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  if (!taskCols.some((c) => c.name === 'phase')) {
    db.exec('ALTER TABLE tasks ADD COLUMN phase TEXT');
  }
  taskCols = db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>;
  migrateLegacyTaskPhases(taskCols);

  ensureLocalNode();

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (Number(userCount.c) === 0 && config.setupToken === null) {
    throw new Error('用户表为空且未配置 SETUP_TOKEN，拒绝启动');
  }
}

/** 为旧任务行补齐 phase，幂等且可重复执行。 */
function migrateLegacyTaskPhases(taskCols: Array<{ name: string }>): void {
  if (!taskCols.some((c) => c.name === 'phase')) return;
  getDb().exec(`
    UPDATE tasks SET phase = 'completed'
    WHERE phase IS NULL AND status = 'completed';
    UPDATE tasks SET phase = 'failed'
    WHERE phase IS NULL AND status = 'failed';
    UPDATE tasks SET phase = 'staging'
    WHERE phase IS NULL AND status IN ('pending', 'running');
  `);
}

/** 确保内置本机节点存在（面板自身，代表当前直接 spawn 的本机执行能力） */
function ensureLocalNode(): void {
  const row = getDb().prepare('SELECT id FROM nodes WHERE id = ?').get('local');
  if (row) return;
  const now = new Date().toISOString();
  getDb().prepare(
    `INSERT INTO nodes (id, name, secret_hash, is_local, host_info, created_at, updated_at)
     VALUES ('local', '本机节点', '', 1, NULL, ?, ?)`,
  ).run(now, now);
}
