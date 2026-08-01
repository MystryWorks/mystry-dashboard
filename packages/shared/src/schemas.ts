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
    name: { type: 'string' },
    jarFile: { type: 'string' },
    jvmArgs: { type: 'string' },
    coreType: { type: 'string', enum: [...CORE_TYPE_ENUM] },
    mcVersion: { type: 'string' },
    acceptEula: { type: 'boolean' },
    nodeId: { type: 'string' },
    javaRuntimeId: { type: ['string', 'null'] },
  },
} as const;

export const updateInstanceBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    jarFile: { type: 'string' },
    jvmArgs: { type: 'string' },
    acceptEula: { type: 'boolean' },
    javaRuntimeId: { type: ['string', 'null'] },
  },
} as const;

export const deployCoreBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'coreType', 'mcVersion'],
  properties: {
    name: { type: 'string' },
    coreType: { type: 'string', enum: [...DEPLOYABLE_CORE_TYPE_ENUM] },
    mcVersion: { type: 'string' },
    build: { type: 'integer' },
    loaderVersion: { type: 'string' },
    installerVersion: { type: 'string' },
    jvmArgs: { type: 'string' },
    acceptEula: { type: 'boolean' },
    javaRuntimeId: { type: ['string', 'null'] },
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
