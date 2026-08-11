import os from 'node:os';
import {
  firstJvmValidationError,
  parseJvmArgs,
  serializeJvmArgs,
  type CoreType,
  type JvmValidationContext,
} from '@mmd/shared';
import { getJavaRuntime } from './java-runtime-service.js';

export type ServerJvmValidationInput = {
  coreType?: CoreType | null;
  javaRuntimeId?: string | null;
};

export function serverJvmValidationContext(
  input: ServerJvmValidationInput = {},
): JvmValidationContext {
  const runtime = input.javaRuntimeId ? getJavaRuntime(input.javaRuntimeId) : null;
  return {
    coreType: input.coreType,
    javaMajor: runtime?.major_version ?? null,
    totalMemoryMiB: Math.round(os.totalmem() / 1024 / 1024),
  };
}

/** 保存和启动前使用同一套共享规则，并将合法参数规范化后落库。 */
export function normalizeAndAssertJvmArgs(
  value: string,
  input: ServerJvmValidationInput = {},
): string {
  const error = firstJvmValidationError(value, serverJvmValidationContext(input));
  if (error) throw new Error(error);
  return serializeJvmArgs(parseJvmArgs(value));
}
