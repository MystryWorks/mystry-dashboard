import type { DetectedJvmConfig } from './jvm-config.js';

/** 本机资源快照；空值表示尚无有效采样，不等同于零占用。 */
export interface DashboardMetrics {
  sampledAt: string;
  cpuPercent: number | null;
  memory: { usedBytes: number; totalBytes: number };
  disk: { availableBytes: number; totalBytes: number } | null;
  warnings: string[];
  instances: Record<string, {
    cpuPercent: number | null;
    memoryBytes: number | null;
    state: 'ready' | 'collecting' | 'unavailable';
  }>;
}

/** 实例运行状态 */
export type InstanceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/** 实例生命周期操作冲突（HTTP 409） */
export interface InstanceOperationConflictResult {
  code: 'INSTANCE_OPERATION_CONFLICT';
  error: string;
}

/** 普通停止宽限期过后进程仍在退出（HTTP 202） */
export interface InstanceStopPendingResult {
  code: 'INSTANCE_STOP_PENDING';
  error: string;
  status: 'stopping';
  stillStopping: true;
}

export function isInstanceStopPendingResult(value: unknown): value is InstanceStopPendingResult {
  return value !== null
    && typeof value === 'object'
    && 'stillStopping' in value
    && (value as InstanceStopPendingResult).stillStopping === true;
}

/** 服务端核心类型 */
export type CoreType = 'vanilla' | 'paper' | 'fabric' | 'forge' | 'neoforge' | 'custom';

/** 内置本机节点 ID（面板自身，始终存在） */
export const LOCAL_NODE_ID = 'local';

/**
 * 是否开放「创建远程节点」。
 * 阶段一仅本机执行；Agent 接入（阶段二/三）后再改为 true。
 */
export const REMOTE_NODE_CREATION_ENABLED = false;

/** 节点在线状态（运行期，非持久化） */
export type NodeStatus = 'online' | 'offline';

/** 节点上报的主机信息（Agent 连接时携带，本机节点为面板自身信息） */
export interface NodeHostInfo {
  platform?: string;
  arch?: string;
  cpuCount?: number;
  totalMemMb?: number;
  agentVersion?: string;
}

/** 节点元数据（前后端共享） */
export interface NodeInfo {
  id: string;
  name: string;
  /** 是否为面板内置的本机节点（不可删除/不可重置密钥） */
  isLocal: boolean;
  status: NodeStatus;
  lastSeenAt: string | null;
  hostInfo: NodeHostInfo | null;
  /** 该节点下挂载的实例数量 */
  instanceCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNodeInput {
  name: string;
}

export interface UpdateNodeInput {
  name?: string;
}

/** 创建节点 / 重置密钥的返回：secret 仅在此刻返回一次，请立即抄录到 Agent 配置中 */
export interface NodeSecretResult {
  node: NodeInfo;
  secret: string;
}

/** 实例元数据（前后端共享） */
export interface InstanceInfo {
  id: string;
  name: string;
  coreType: CoreType;
  mcVersion: string | null;
  jarFile: string;
  javaPath: string;
  jvmArgs: string;
  /** 实际安装目录（自定义绝对路径或默认 data/instances/<id>） */
  installPath: string | null;
  requiresMigration: boolean;
  status: InstanceStatus;
  /** 所属节点 ID；默认为内置本机节点 LOCAL_NODE_ID */
  nodeId: string;
  /** 绑定的 Java 运行时 ID；null 表示使用面板 PATH 中的 java */
  javaRuntimeId: string | null;
  createdAt: string;
  updatedAt: string;
  acceptEula: boolean;
}

export interface CreateInstanceInput {
  name: string;
  jarFile?: string;
  jvmArgs?: string;
  coreType?: CoreType;
  mcVersion?: string;
  acceptEula?: boolean;
  /** 所属节点 ID；留空则使用本机节点。非本机节点在 Agent 接入前会创建失败 */
  nodeId?: string;
  /** Java 运行时 ID（必须来自面板探测清单）；留空/null 使用 PATH 中的 java */
  javaRuntimeId?: string | null;
}

export interface UpdateInstanceInput {
  name?: string;
  jarFile?: string;
  jvmArgs?: string;
  acceptEula?: boolean;
  /** Java 运行时 ID（必须来自面板探测清单）；null 恢复为 PATH 中的 java */
  javaRuntimeId?: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
}

/** POST /api/instances/:id/files/download-ticket 请求体 */
export interface FileDownloadTicketInput {
  path: string;
}

/** 一次性文件下载 ticket；随后用 query 参数访问 GET .../files/download */
export interface FileDownloadTicketResult {
  ticket: string;
  expiresIn: number;
}

/**
 * 下载 ticket 生命周期状态（R1-06 状态查询 API）。
 */
export type FileDownloadTicketStatus =
  | 'reserved'
  | 'streaming'
  | 'failed'
  | 'expired'
  | 'consumed';

/** GET /api/instances/:id/files/download-ticket/:ticket/status 响应 */
export interface FileDownloadTicketStatusResult {
  status: FileDownloadTicketStatus;
  /** 占槽或开流失败时的中文说明 */
  error?: string;
}

export interface CoreVersionInfo {
  version: string;
  builds?: number[];
}

export interface DeployCoreInput {
  name: string;
  coreType: Exclude<CoreType, 'custom'>;
  mcVersion: string;
  /** Paper build 号；不传则取最新 */
  build?: number;
  /** Fabric loader / Forge / NeoForge 版本；不传则取最新 */
  loaderVersion?: string;
  /** Fabric installer 版本；不传则取最新 */
  installerVersion?: string;
  jvmArgs?: string;
  acceptEula?: boolean;
  /** Java 运行时 ID（必须来自面板探测清单）；留空/null 使用 PATH 中的 java */
  javaRuntimeId?: string | null;
}

/** DATA_DIR/imports 下可交给面板复制接管的已有服务端目录。 */
export interface ExistingServerSourceInfo {
  /** 交接区内的单层目录名，不是系统绝对路径。 */
  id: string;
  /** 自动探测到的 jar 或 Forge/NeoForge args 启动目标。 */
  launchTarget: string | null;
  /** 根据启动文件推断的核心类型；无法识别时为 custom。 */
  coreType: CoreType;
  modifiedAt: string;
  ready: boolean;
  /** 从 user_jvm_args.txt 检测出的参数；不存在该文件时省略。 */
  detectedJvmConfig?: DetectedJvmConfig;
  error?: string;
}

export interface ExistingServerSourceListResult {
  sources: ExistingServerSourceInfo[];
}

/** 从固定交接区复制已有服务端并创建面板托管实例。 */
export interface ImportExistingServerInput {
  name: string;
  sourceId: string;
  coreType?: CoreType;
  mcVersion?: string;
  jvmArgs?: string;
  acceptEula?: boolean;
  /** Java 运行时 ID（必须来自面板探测清单）；留空/null 使用 PATH 中的 java。 */
  javaRuntimeId?: string | null;
}

export interface JavaDetectResult {
  available: boolean;
  version: string | null;
  majorVersion: number | null;
}

/** ZIP 上传后等待用户确认 JVM 设置的临时预览。 */
export interface ImportPreviewInfo {
  id: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
  detectedJvmConfig?: DetectedJvmConfig;
}

export interface ConfirmZipImportInput {
  name: string;
  coreType?: CoreType;
  mcVersion?: string;
  jvmArgs?: string;
  acceptEula?: boolean;
  javaRuntimeId?: string | null;
}

/** 面板探测并执行 -version 验证过的 Java 运行时（绝对路径由面板扫描产生，不接受用户提交） */
export interface JavaRuntimeInfo {
  /** 稳定 ID：规范化路径的哈希，重扫后不变 */
  id: string;
  /** java 可执行文件绝对路径 */
  path: string;
  /** -version 输出中的完整版本串，如 "17.0.2" */
  version: string | null;
  /** 主版本号，如 8 / 17 / 21 */
  majorVersion: number | null;
  /** 探测来源：JAVA_HOME 环境变量或常见安装目录扫描 */
  source: 'env' | 'scan';
  verifiedAt: string;
  /** 最近一次完整扫描是否仍发现并验证此运行时 */
  available: boolean;
}

/** GET /api/system/java-runtimes 响应 */
export interface JavaRuntimeListResult {
  runtimes: JavaRuntimeInfo[];
}

/**
 * 按 Minecraft 版本推荐 Java 主版本号；无法识别版本格式时返回 null。
 * 1.20.5+ → 21；1.17–1.20.4 → 17；1.16.5 及更早 → 8。
 */
export function recommendedJavaMajor(mcVersion: string | null | undefined): number | null {
  if (!mcVersion) return null;
  const match = mcVersion.match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  const minor = Number(match[1]);
  const patch = Number(match[2] ?? 0);
  if (minor >= 21) return 21;
  if (minor === 20) return patch >= 5 ? 21 : 17;
  if (minor >= 17) return 17;
  return 8;
}

export interface TaskInfo {
  id: string;
  type: 'download' | 'extract' | 'deploy' | 'import';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  result?: { instanceId?: string; stagingToken?: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 任务中心列表响应（GET /api/tasks） */
export interface TaskListResult {
  tasks: TaskInfo[];
}

export interface AuthSetupStatus {
  needsSetup: boolean;
}

export interface LoginInput {
  username: string;
  password: string;
}

export interface SetupInput {
  username: string;
  password: string;
}

export interface AuthUser {
  id: string;
  username: string;
}

export interface ConsoleMessage {
  type: 'output' | 'status' | 'error' | 'history';
  data: string;
  status?: InstanceStatus;
}

export {
  CORE_TYPE_ENUM,
  DEPLOYABLE_CORE_TYPE_ENUM,
  createInstanceBodySchema,
  updateInstanceBodySchema,
  deployCoreBodySchema,
  importExistingServerBodySchema,
  confirmZipImportBodySchema,
  setupBodySchema,
  loginBodySchema,
  createNodeBodySchema,
  updateNodeBodySchema,
  fileDownloadTicketBodySchema,
  fileDownloadQuerySchema,
} from './schemas.js';

export type {
  DetectedJvmConfig,
  JvmPresetDefinition,
  JvmPresetId,
  JvmValidationContext,
  JvmValidationIssue,
  ParsedJvmConfig,
} from './jvm-config.js';

export {
  JVM_PRESETS,
  automaticInitialMemoryMiB,
  buildJvmArgs,
  firstJvmValidationError,
  inspectJvmArgFile,
  inspectJvmArgs,
  parseJvmArgFile,
  parseJvmArgs,
  recommendedMaxMemoryMiB,
  serializeJvmArgFile,
  serializeJvmArgs,
  validateJvmArgs,
} from './jvm-config.js';
