import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { getDb, type UserRow } from '../db.js';
import { nowIso } from '../utils/path.js';

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
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as
    | UserRow
    | undefined;
  if (!row) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, username: row.username };
}

export function getUserById(id: string): { id: string; username: string } | null {
  const row = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(id) as
    | { id: string; username: string }
    | undefined;
  return row ?? null;
}
