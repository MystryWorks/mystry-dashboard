import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { getDb, type UserRow } from '../db.js';
import { nowIso } from '../utils/path.js';

/** bcrypt 只使用前 72 字节，超出部分静默截断会导致不同密码可互相登录；初始化时即拒绝超长密码。 */
const BCRYPT_MAX_BYTES = 72;

/** 用户不存在时也执行一次 bcrypt 比较，抹平「用户是否存在」的时序差异。 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export function needsSetup(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  return row.c === 0;
}

export function setupAdmin(username: string, password: string): { id: string; username: string } {
  const normalizedUsername = username.trim();
  if (normalizedUsername.length < 2) throw new Error('用户名至少 2 个字符');
  if (normalizedUsername.length > 64) throw new Error('用户名最多 64 个字符');
  if (password.length < 12) throw new Error('密码至少 12 位');
  if (password.length > 128) throw new Error('密码最多 128 位');
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) {
    throw new Error(`密码最多 ${BCRYPT_MAX_BYTES} 字节（bcrypt 截断上限）`);
  }

  const id = nanoid(12);
  const hash = bcrypt.hashSync(password, 10);
  const result = getDb()
    .prepare(
      `INSERT INTO users (id, username, password_hash, created_at)
       SELECT ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM users)`,
    )
    .run(id, normalizedUsername, hash, nowIso());
  if (Number(result.changes) === 0) {
    throw new Error('管理员已初始化');
  }
  return { id, username: normalizedUsername };
}

export function verifyLogin(
  username: string,
  password: string,
): { id: string; username: string } | null {
  // 超过 72 字节的密码必然与任何合法哈希不匹配，直接拒绝可避免截断误匹配。
  if (Buffer.byteLength(password, 'utf8') > BCRYPT_MAX_BYTES) return null;
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as
    | UserRow
    | undefined;
  // 用户不存在时也执行一次 bcrypt 比较，避免通过响应时间枚举用户名。
  if (!bcrypt.compareSync(password, row ? row.password_hash : DUMMY_PASSWORD_HASH)) return null;
  if (!row) return null;
  return { id: row.id, username: row.username };
}

export function getUserById(id: string): { id: string; username: string } | null {
  const row = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(id) as
    | { id: string; username: string }
    | undefined;
  return row ?? null;
}
