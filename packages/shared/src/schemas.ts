/**
 * 前后端共用的 JSON Schema（Fastify AJV 校验）。
 * 与 index.ts 中的 TypeScript 类型保持同步，避免路由内手工双写漂移。
 */

/** 核心类型枚举（含 custom） */
export const CORE_TYPE_ENUM = [
  'vanilla',
  'paper',
  'fabric',
  'forge',
  'neoforge',
  'custom',
] as const;

/** 可一键部署的核心类型（不含 custom） */
export const DEPLOYABLE_CORE_TYPE_ENUM = [
  'vanilla',
  'paper',
  'fabric',
  'forge',
  'neoforge',
] as const;

export const createInstanceBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    jarFile: { type: 'string', maxLength: 1024 },
    jvmArgs: { type: 'string', maxLength: 8192 },
    coreType: { type: 'string', enum: [...CORE_TYPE_ENUM] },
    mcVersion: { type: 'string', maxLength: 64 },
    acceptEula: { type: 'boolean' },
    nodeId: { type: 'string', maxLength: 255 },
    javaRuntimeId: { type: ['string', 'null'], maxLength: 255 },
  },
} as const;

export const updateInstanceBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    jarFile: { type: 'string', maxLength: 1024 },
    jvmArgs: { type: 'string', maxLength: 8192 },
    acceptEula: { type: 'boolean' },
    javaRuntimeId: { type: ['string', 'null'], maxLength: 255 },
  },
} as const;

export const deployCoreBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'coreType', 'mcVersion'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    coreType: { type: 'string', enum: [...DEPLOYABLE_CORE_TYPE_ENUM] },
    mcVersion: { type: 'string', maxLength: 64 },
    build: { type: 'integer' },
    loaderVersion: { type: 'string', maxLength: 128 },
    installerVersion: { type: 'string', maxLength: 128 },
    jvmArgs: { type: 'string', maxLength: 8192 },
    acceptEula: { type: 'boolean' },
    javaRuntimeId: { type: ['string', 'null'], maxLength: 255 },
  },
} as const;

export const importExistingServerBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'sourceId'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    sourceId: { type: 'string', minLength: 1, maxLength: 255 },
    coreType: { type: 'string', enum: [...CORE_TYPE_ENUM] },
    mcVersion: { type: 'string', maxLength: 64 },
    jvmArgs: { type: 'string', maxLength: 8192 },
    acceptEula: { type: 'boolean' },
    javaRuntimeId: { type: ['string', 'null'], maxLength: 255 },
  },
} as const;

export const confirmZipImportBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    coreType: { type: 'string', enum: [...CORE_TYPE_ENUM] },
    mcVersion: { type: 'string', maxLength: 64 },
    jvmArgs: { type: 'string', maxLength: 8192 },
    acceptEula: { type: 'boolean' },
    javaRuntimeId: { type: ['string', 'null'], maxLength: 255 },
  },
} as const;

export const setupBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 2, maxLength: 64 },
    password: { type: 'string', minLength: 12, maxLength: 128 },
  },
} as const;

export const loginBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 128 },
    password: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export const createNodeBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

export const updateNodeBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;

/** 实例内相对路径最大长度（与 file 路由一致） */
const maxInstanceRelativePathLength = 1024;

/** POST /api/instances/:id/files/download-ticket 请求体 */
export const fileDownloadTicketBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', maxLength: maxInstanceRelativePathLength },
  },
} as const;

/** GET /api/instances/:id/files/download 查询参数 */
export const fileDownloadQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', maxLength: maxInstanceRelativePathLength },
    /** 一次性下载 ticket；有 ticket 时可不带 JWT */
    ticket: { type: 'string', minLength: 1, maxLength: 128 },
  },
} as const;
