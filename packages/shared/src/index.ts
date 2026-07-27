/** 实例运行状态 */
export type InstanceStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

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
}

export interface UpdateInstanceInput {
  name?: string;
  jarFile?: string;
  jvmArgs?: string;
  acceptEula?: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
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
}

export interface JavaDetectResult {
  available: boolean;
  version: string | null;
}

export interface TaskInfo {
  id: string;
  type: 'download' | 'extract' | 'deploy' | 'import';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  result?: { instanceId?: string };
  error?: string;
  createdAt: string;
  updatedAt: string;
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
  setupBodySchema,
  loginBodySchema,
  createNodeBodySchema,
  updateNodeBodySchema,
} from './schemas.js';
