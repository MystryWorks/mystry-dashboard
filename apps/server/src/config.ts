import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function resolveFromHome(value: string, homeDir: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(homeDir, value);
}

const configuredHome = process.env.MMD_HOME?.trim();
const homeDir = configuredHome ? path.resolve(configuredHome) : repoRoot;
const configuredConfigPath = process.env.MMD_CONFIG_PATH?.trim();
const configPath = configuredConfigPath
  ? resolveFromHome(configuredConfigPath, homeDir)
  : path.join(homeDir, configuredHome ? 'config' : '', configuredHome ? 'panel.env' : '.env');

// 开发模式默认读取仓库 .env；便携包由 mmdctl 指向 config/panel.env。
dotenv.config({ path: configPath });

const configuredDataDir = process.env.MMD_DATA_DIR?.trim() || process.env.DATA_DIR?.trim() || 'data';
const dataDir = resolveFromHome(configuredDataDir, homeDir);

function parsePositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

function parseOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS === undefined
    ? 'http://127.0.0.1:5173,http://localhost:5173'
    : process.env.CORS_ORIGINS;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseSecret(name: string, required: boolean): string | null {
  const value = process.env[name];
  if (value === undefined || (value === '' && !required)) {
    if (required) {
      throw new Error(`${name} 必须配置且必须为 64 位十六进制字符串`);
    }
    return null;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} 必须为 64 位十六进制字符串`);
  }
  return value;
}

export function assertDistinctSecrets(entries: ReadonlyArray<readonly [string, string | null]>): void {
  const configured = entries.filter((entry): entry is readonly [string, string] => entry[1] !== null);
  for (let index = 0; index < configured.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < configured.length; otherIndex += 1) {
      const current = configured[index]!;
      const other = configured[otherIndex]!;
      if (current[1].toLowerCase() === other[1].toLowerCase()) {
        throw new Error(`${current[0]} 与 ${other[0]} 必须使用不同的随机值`);
      }
    }
  }
}

const host = process.env.HOST || '127.0.0.1';
const jwtSecret = parseSecret('JWT_SECRET', true)!;
const setupToken = parseSecret('SETUP_TOKEN', false);
const launcherToken = parseSecret('LAUNCHER_TOKEN', false);
assertDistinctSecrets([
  ['JWT_SECRET', jwtSecret],
  ['SETUP_TOKEN', setupToken],
  ['LAUNCHER_TOKEN', launcherToken],
]);

export const config = {
  host,
  port: parsePositiveInt('PORT', 3000),
  jwtSecret,
  setupToken,
  launcherToken,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN?.trim() || '2h',
  corsOrigins: parseOrigins(),
  repoRoot,
  homeDir,
  configPath,
  dataDir,
  processFingerprint: process.env['MMD_PROCESS_FINGERPRINT']?.trim() || null,
  dbPath: path.join(dataDir, 'panel.db'),
  instancesDir: path.join(dataDir, 'instances'),
  cacheDir: path.join(dataDir, 'cache', 'cores'),
  uploadDir: path.join(dataDir, 'uploads'),
  maxJsonBodyBytes: parsePositiveInt('MAX_JSON_BODY_BYTES', 1048576),
  maxTextFileBytes: parsePositiveInt('MAX_TEXT_FILE_BYTES', 1048576),
  maxCommandBytes: parsePositiveInt('MAX_COMMAND_BYTES', 4096),
  maxConsoleBufferBytes: parsePositiveInt('MAX_CONSOLE_BUFFER_BYTES', 1048576),
  maxConsoleChunkBytes: parsePositiveInt('MAX_CONSOLE_CHUNK_BYTES', 65536),
  /** 单个上传文件上限，默认 512MB */
  maxUploadBytes: parsePositiveInt('MAX_UPLOAD_BYTES', 512 * 1024 * 1024),
  uploadIdleTimeoutMs: parsePositiveInt('UPLOAD_IDLE_TIMEOUT_MS', 30_000),
  maxConcurrentUploads: parsePositiveInt('MAX_CONCURRENT_UPLOADS', 1),
  maxConcurrentFileDownloads: parsePositiveInt('MAX_CONCURRENT_FILE_DOWNLOADS', 4),
  fileDownloadIdleTimeoutMs: parsePositiveInt('FILE_DOWNLOAD_IDLE_TIMEOUT_MS', 60_000),
  maxConcurrentTasks: parsePositiveInt('MAX_CONCURRENT_TASKS', 1),
  maxQueuedTasks: parsePositiveInt('MAX_QUEUED_TASKS', 2),
  taskTimeoutMs: parsePositiveInt('TASK_TIMEOUT_MS', 1800000),
  maxCoreDownloadBytes: parsePositiveInt('MAX_CORE_DOWNLOAD_BYTES', 536870912),
  coreDownloadTimeoutMs: parsePositiveInt('CORE_DOWNLOAD_TIMEOUT_MS', 300000),
  httpRequestTimeoutMs: parsePositiveInt('HTTP_REQUEST_TIMEOUT_MS', 900_000),
  httpConnectionTimeoutMs: parsePositiveInt('HTTP_CONNECTION_TIMEOUT_MS', 300_000),
  httpKeepAliveTimeoutMs: parsePositiveInt('HTTP_KEEP_ALIVE_TIMEOUT_MS', 72_000),
  maxCoreMetadataBytes: parsePositiveInt('MAX_CORE_METADATA_BYTES', 2_097_152),
  coreMetadataTimeoutMs: parsePositiveInt('CORE_METADATA_TIMEOUT_MS', 15_000),
  maxConsoleIncomingBytes: parsePositiveInt('MAX_CONSOLE_INCOMING_BYTES', 4_352),
  maxConsoleConnections: parsePositiveInt('MAX_CONSOLE_CONNECTIONS', 20),
  maxConsoleCommandsPerWindow: parsePositiveInt('MAX_CONSOLE_COMMANDS_PER_WINDOW', 60),
  consoleCommandWindowMs: parsePositiveInt('CONSOLE_COMMAND_WINDOW_MS', 60_000),
  maxConsoleStdinBytes: parsePositiveInt('MAX_CONSOLE_STDIN_BYTES', 65_536),
  installerKillGraceMs: parsePositiveInt('INSTALLER_KILL_GRACE_MS', 5_000),
  maxInstallerOutputBytes: parsePositiveInt('MAX_INSTALLER_OUTPUT_BYTES', 65536),
  /** ZIP 安全配额 */
  maxZipEntries: parsePositiveInt('MAX_ZIP_ENTRIES', 10_000),
  maxZipEntryBytes: parsePositiveInt('MAX_ZIP_ENTRY_BYTES', 1024 * 1024 * 1024),
  maxZipUncompressedBytes: parsePositiveInt(
    'MAX_ZIP_UNCOMPRESSED_BYTES',
    2 * 1024 * 1024 * 1024,
  ),
  maxZipCentralDirectoryBytes: parsePositiveInt(
    'MAX_ZIP_CENTRAL_DIRECTORY_BYTES',
    32 * 1024 * 1024,
  ),
  consoleTicketTtlSeconds: parsePositiveInt('CONSOLE_TICKET_TTL_SECONDS', 60),
  rateLimitMax: parsePositiveInt('RATE_LIMIT_MAX', 120),
  rateLimitWindowMs: parsePositiveInt('RATE_LIMIT_WINDOW_MS', 60_000),
  authRateLimitMax: parsePositiveInt('AUTH_RATE_LIMIT_MAX', 5),
  authRateLimitWindowMs: parsePositiveInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60_000),
  webDist: path.resolve(__dirname, '../../web/dist'),
};
