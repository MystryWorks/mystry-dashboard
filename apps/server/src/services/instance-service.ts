import fs from 'node:fs';
import { nanoid } from 'nanoid';
import type {
  CreateInstanceInput,
  InstanceInfo,
  InstanceStatus,
  UpdateInstanceInput,
} from '@mmd/shared';
import { LOCAL_NODE_ID } from '@mmd/shared';
import { getDb, type InstanceRow } from '../db.js';
import {
  defaultInstanceDir,
  assertSafeDirectoryPath,
  assertSafeInstanceRoot,
  hasValidOwnershipMarker,
  inspectOwnershipMarker,
  removeOwnershipMarker,
  writeOwnershipMarker,
  nowIso,
} from '../utils/path.js';
import { processManager } from './process-manager.js';
import { nodeExists } from './node-service.js';
import { getJavaRuntime } from './java-runtime-service.js';

/** 校验运行时引用：只能引用注册表中已验证的运行时，null 表示 PATH 中的 java。 */
function assertValidJavaRuntime(javaRuntimeId: string | null | undefined): void {
  if (javaRuntimeId === null || javaRuntimeId === undefined) return;
  const runtime = getJavaRuntime(javaRuntimeId);
  if (!runtime || !runtime.available) {
    throw new Error('所选 Java 运行时不存在或不可用，请重新探测后再选择');
  }
}

function rowToInfo(row: InstanceRow): InstanceInfo {
  const requiresMigration = row.install_path !== null;
  return {
    id: row.id,
    name: row.name,
    coreType: row.core_type as InstanceInfo['coreType'],
    mcVersion: row.mc_version,
    jarFile: row.jar_file,
    javaPath: 'java',
    jvmArgs: row.jvm_args,
    installPath: row.install_path === null ? defaultInstanceDir(row.id) : null,
    requiresMigration,
    status: processManager.getStatus(row.id) as InstanceStatus,
    nodeId: row.node_id,
    javaRuntimeId: row.java_runtime_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptEula: Boolean(row.accept_eula),
  };
}

function cleanupCreatedDirectory(
  id: string,
  dir: string,
  marker: string,
  markerWritten: boolean,
  directoryCreatedByCall: boolean,
): void {
  if (markerWritten) {
    removeOwnershipMarker(id, dir, marker);
  }
  if (!directoryCreatedByCall || !fs.existsSync(dir)) return;
  try {
    assertSafeInstanceRoot(dir);
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // 清理失败不能覆盖原始数据库/文件系统错误，也不能冒险删除非空目录。
  }
}

export function listInstances(): InstanceInfo[] {
  const rows = getDb()
    .prepare('SELECT * FROM instances ORDER BY created_at DESC')
    .all() as InstanceRow[];
  return rows.map(rowToInfo);
}

export function getInstance(id: string): InstanceInfo | null {
  const row = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(id) as
    | InstanceRow
    | undefined;
  return row ? rowToInfo(row) : null;
}

export function getInstanceRow(id: string): InstanceRow | null {
  const row = getDb().prepare('SELECT * FROM instances WHERE id = ?').get(id) as
    | InstanceRow
    | undefined;
  return row ?? null;
}

export function createInstance(input: CreateInstanceInput): InstanceInfo {
  const id = nanoid(12);
  const now = nowIso();
  const nodeId = input.nodeId?.trim() || LOCAL_NODE_ID;
  if (!nodeExists(nodeId)) {
    throw new Error('所选节点不存在');
  }
  if (nodeId !== LOCAL_NODE_ID) {
    // 阶段一仅打通节点注册闭环，远程节点尚不支持实际部署/执行（阶段二/三接入 Agent 后开放）
    throw new Error('远程节点暂不支持创建实例，敬请期待后续版本');
  }
  const dir = defaultInstanceDir(id);
  const ownershipMarker = nanoid(32);
  let markerWritten = false;
  let directoryCreatedByCall = false;

  assertValidJavaRuntime(input.javaRuntimeId);

  try {
    const existedBefore = fs.existsSync(dir);
    assertSafeDirectoryPath(dir);
    fs.mkdirSync(dir, { recursive: true });
    directoryCreatedByCall = !existedBefore;
    assertSafeInstanceRoot(dir);
    if (fs.readdirSync(dir).length > 0) {
      throw new Error('默认实例目录必须为空，拒绝接管已有目录');
    }
    writeOwnershipMarker(id, dir, ownershipMarker);
    markerWritten = true;
    // 简单可写探测
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (err) {
    cleanupCreatedDirectory(id, dir, ownershipMarker, markerWritten, directoryCreatedByCall);
    throw new Error(
      `无法创建或写入安装目录：${dir}（${err instanceof Error ? err.message : String(err)}）`,
    );
  }

  try {
    const result = getDb()
      .prepare(
        `INSERT INTO instances
        (id, name, core_type, mc_version, jar_file, java_path, jvm_args, accept_eula, install_path, ownership_marker, node_id, java_runtime_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.coreType ?? 'custom',
        input.mcVersion ?? null,
        input.jarFile ?? 'server.jar',
        'java',
        input.jvmArgs ?? '-Xms1G -Xmx2G',
        input.acceptEula ? 1 : 0,
        null,
        ownershipMarker,
        nodeId,
        input.javaRuntimeId ?? null,
        now,
        now,
      );
    if (Number(result.changes) !== 1) {
      throw new Error('创建实例失败：数据库未写入实例记录');
    }
  } catch (err) {
    cleanupCreatedDirectory(id, dir, ownershipMarker, markerWritten, directoryCreatedByCall);
    throw err;
  }

  return getInstance(id)!;
}

/** 将已 promote 到 instances/<id> 的目录注册进数据库（部署/导入任务完成时调用）。 */
export function registerPromotedInstance(id: string, input: CreateInstanceInput): InstanceInfo {
  const now = nowIso();
  const nodeId = input.nodeId?.trim() || LOCAL_NODE_ID;
  if (!nodeExists(nodeId)) {
    throw new Error('所选节点不存在');
  }
  if (nodeId !== LOCAL_NODE_ID) {
    throw new Error('远程节点暂不支持创建实例，敬请期待后续版本');
  }
  assertValidJavaRuntime(input.javaRuntimeId);

  const dir = defaultInstanceDir(id);
  if (!fs.existsSync(dir)) {
    throw new Error('实例目录不存在，无法注册实例');
  }
  assertSafeInstanceRoot(dir);
  const entries = fs.readdirSync(dir);
  if (entries.length === 0) {
    throw new Error('实例目录为空，无法注册实例');
  }

  const ownershipMarker = nanoid(32);
  writeOwnershipMarker(id, dir, ownershipMarker);
  fs.accessSync(dir, fs.constants.W_OK);

  try {
    const result = getDb()
      .prepare(
        `INSERT INTO instances
        (id, name, core_type, mc_version, jar_file, java_path, jvm_args, accept_eula, install_path, ownership_marker, node_id, java_runtime_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.coreType ?? 'custom',
        input.mcVersion ?? null,
        input.jarFile ?? 'server.jar',
        'java',
        input.jvmArgs ?? '-Xms1G -Xmx2G',
        input.acceptEula ? 1 : 0,
        null,
        ownershipMarker,
        nodeId,
        input.javaRuntimeId ?? null,
        now,
        now,
      );
    if (Number(result.changes) !== 1) {
      throw new Error('创建实例失败：数据库未写入实例记录');
    }
  } catch (err) {
    removeOwnershipMarker(id, dir, ownershipMarker);
    throw err;
  }

  return getInstance(id)!;
}

export function updateInstance(id: string, input: UpdateInstanceInput): InstanceInfo {
  const existing = getInstanceRow(id);
  if (!existing) throw new Error('实例不存在');
  assertValidJavaRuntime(input.javaRuntimeId);

  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE instances SET
        name = ?,
        jar_file = ?,
        java_path = ?,
        jvm_args = ?,
        accept_eula = ?,
        java_runtime_id = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      input.name ?? existing.name,
      input.jarFile ?? existing.jar_file,
      'java',
      input.jvmArgs ?? existing.jvm_args,
      input.acceptEula !== undefined ? (input.acceptEula ? 1 : 0) : existing.accept_eula,
      input.javaRuntimeId === undefined ? existing.java_runtime_id : input.javaRuntimeId,
      now,
      id,
    );

  return getInstance(id)!;
}

export function deleteInstance(id: string): void {
  if (processManager.isRunning(id)) {
    throw new Error('请先停止实例再删除');
  }
  const row = getInstanceRow(id);
  if (!row) return;
  if (row.install_path !== null) {
    getDb().prepare('DELETE FROM instances WHERE id = ?').run(id);
    processManager.forget(id);
    return;
  }
  const dir = defaultInstanceDir(row.id);
  const canRemoveDirectory = hasValidOwnershipMarker(row);
  if (canRemoveDirectory && fs.existsSync(dir)) {
    assertSafeInstanceRoot(dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const result = getDb().prepare('DELETE FROM instances WHERE id = ?').run(id);
  if (Number(result.changes) !== 1) {
    throw new Error('删除实例失败：数据库记录未删除');
  }
  processManager.forget(id);
}

/** 接管同一实例 ID 对应的默认目录，不读取或操作旧的外部目录。 */
export function adoptManagedDirectory(id: string): InstanceInfo {
  if (processManager.isRunning(id)) {
    throw new Error('请先停止实例再接管目录');
  }

  const row = getInstanceRow(id);
  if (!row) throw new Error('实例不存在');
  if (row.install_path === null) {
    throw new Error('实例已经是面板托管目录，无需接管');
  }

  const dir = defaultInstanceDir(id);
  try {
    assertSafeInstanceRoot(dir);
    if (fs.readdirSync(dir).length === 0) {
      throw new Error('默认实例目录不能为空');
    }
  } catch (err) {
    throw new Error(
      `无法接管面板托管目录：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let ownershipMarker: string;
  let markerWrittenByCall = false;
  try {
    const marker = inspectOwnershipMarker(id, dir);
    if (marker.exists) {
      if (marker.marker === null) {
        throw new Error('无法接管面板托管目录：ownership marker 无效或属于其他实例');
      }
      ownershipMarker = marker.marker;
    } else {
      ownershipMarker = nanoid(32);
      writeOwnershipMarker(id, dir, ownershipMarker);
      markerWrittenByCall = true;
    }

    const result = getDb()
      .prepare(
        `UPDATE instances SET
          java_path = ?,
          install_path = NULL,
          ownership_marker = ?,
          updated_at = ?
        WHERE id = ? AND install_path IS NOT NULL`,
      )
      .run('java', ownershipMarker, nowIso(), id);
    if (Number(result.changes) !== 1) {
      throw new Error('接管失败：实例状态已变化，请重试');
    }
  } catch (err) {
    if (markerWrittenByCall) {
      removeOwnershipMarker(id, dir, ownershipMarker!);
    }
    throw err;
  }

  return getInstance(id)!;
}

export function updateInstanceMeta(
  id: string,
  patch: Partial<Pick<InstanceRow, 'core_type' | 'mc_version' | 'jar_file' | 'accept_eula'>>,
): void {
  const existing = getInstanceRow(id);
  if (!existing) throw new Error('实例不存在');
  getDb()
    .prepare(
      `UPDATE instances SET
        core_type = ?,
        mc_version = ?,
        jar_file = ?,
        java_path = ?,
        accept_eula = ?,
        updated_at = ?
      WHERE id = ?`,
    )
    .run(
      patch.core_type ?? existing.core_type,
      patch.mc_version !== undefined ? patch.mc_version : existing.mc_version,
      patch.jar_file ?? existing.jar_file,
      'java',
      patch.accept_eula !== undefined ? patch.accept_eula : existing.accept_eula,
      nowIso(),
      id,
    );
}
