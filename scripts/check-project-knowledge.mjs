import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FACTS_PATH = 'docs/ai/project-facts.json';
const ROUTES_DIR = 'apps/server/src/routes';
const SERVER_INDEX = 'apps/server/src/index.ts';
const SERVER_CONFIG = 'apps/server/src/config.ts';
const ENV_EXAMPLE = '.env.example';

function normalized(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en'));
}

function relativePath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, 'utf8'));
}

function compareLists(errors, label, expected, actual) {
  const expectedSet = new Set(normalized(expected));
  const actualSet = new Set(normalized(actual));
  const missing = [...expectedSet].filter((item) => !actualSet.has(item));
  const extra = [...actualSet].filter((item) => !expectedSet.has(item));

  if (missing.length > 0) {
    errors.push(`${label} 缺少：${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    errors.push(`${label} 出现未登记项：${extra.join(', ')}`);
  }
}

export function extractConfigEnvironmentVariables(source) {
  const names = [];
  const directPattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  const parserPattern = /(?:parsePositiveInt|parseSecret)\(\s*['"]([A-Z][A-Z0-9_]*)['"]/g;

  for (const match of source.matchAll(directPattern)) names.push(match[1]);
  for (const match of source.matchAll(parserPattern)) names.push(match[1]);
  return normalized(names);
}

export function extractEnvExampleVariables(source) {
  const names = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match) names.push(match[1]);
  }
  return normalized(names);
}

async function walkFiles(root, current, extension) {
  if (!(await exists(current))) return [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, target, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(relativePath(root, target));
    }
  }
  return files;
}

async function collectMarkdownFiles(root) {
  const files = [];
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(entry.name);
  }
  files.push(...await walkFiles(root, path.join(root, 'docs'), '.md'));
  files.push(...await walkFiles(root, path.join(root, '.github'), '.md'));
  return normalized(files);
}

function parseMarkdownTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/u, 1)[0];
}

export async function findMarkdownLinkErrors(root, markdownFiles) {
  const errors = [];
  const linkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;

  for (const markdownFile of markdownFiles) {
    const absoluteFile = path.join(root, markdownFile);
    const source = await fs.readFile(absoluteFile, 'utf8');

    for (const match of source.matchAll(linkPattern)) {
      const rawTarget = parseMarkdownTarget(match[1]);
      if (
        rawTarget.length === 0
        || rawTarget.startsWith('#')
        || /^[a-z][a-z0-9+.-]*:/iu.test(rawTarget)
      ) {
        continue;
      }

      const withoutAnchor = rawTarget.split('#', 1)[0].split('?', 1)[0];
      if (withoutAnchor.length === 0) continue;

      let decodedTarget;
      try {
        decodedTarget = decodeURIComponent(withoutAnchor);
      } catch {
        errors.push(`${markdownFile} 包含无法解码的链接：${rawTarget}`);
        continue;
      }

      const resolved = decodedTarget.startsWith('/')
        ? path.join(root, decodedTarget.slice(1))
        : path.resolve(path.dirname(absoluteFile), decodedTarget);
      const relativeTarget = path.relative(root, resolved);
      if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
        errors.push(`${markdownFile} 的本地链接越出仓库：${rawTarget}`);
        continue;
      }
      if (!(await exists(resolved))) {
        errors.push(`${markdownFile} 的本地链接不存在：${rawTarget}`);
      }
    }
  }
  return errors;
}

async function requirePaths(root, errors, label, paths) {
  for (const item of paths) {
    if (!(await exists(path.join(root, item)))) {
      errors.push(`${label}不存在：${item}`);
    }
  }
}

export async function checkProjectKnowledge(root) {
  const errors = [];
  const factsFile = path.join(root, FACTS_PATH);
  if (!(await exists(factsFile))) {
    return [`机器事实文件不存在：${FACTS_PATH}`];
  }

  let facts;
  try {
    facts = await readJson(factsFile);
  } catch (error) {
    return [`机器事实文件无法解析：${error instanceof Error ? error.message : String(error)}`];
  }

  if (facts.schemaVersion !== 1) {
    errors.push(`不支持的机器事实 schemaVersion：${String(facts.schemaVersion)}`);
  }

  const packageFile = path.join(root, 'package.json');
  let packageJson;
  try {
    packageJson = await readJson(packageFile);
  } catch (error) {
    errors.push(`package.json 无法解析：${error instanceof Error ? error.message : String(error)}`);
    return errors;
  }

  if (packageJson.engines?.node !== facts.nodeEngine) {
    errors.push(`Node 版本漂移：package.json=${String(packageJson.engines?.node)}，知识库=${String(facts.nodeEngine)}`);
  }
  compareLists(errors, 'workspaces', facts.workspaces ?? [], packageJson.workspaces ?? []);

  for (const [name, expectedCommand] of Object.entries(facts.requiredScripts ?? {})) {
    const actualCommand = packageJson.scripts?.[name];
    if (actualCommand !== expectedCommand) {
      errors.push(`脚本 ${name} 漂移：package.json=${String(actualCommand)}，知识库=${String(expectedCommand)}`);
    }
  }

  await requirePaths(root, errors, '入口文件', Object.values(facts.entrypoints ?? {}));
  await requirePaths(root, errors, '知识库文档', facts.knowledgeDocuments ?? []);
  await requirePaths(root, errors, '事实源路径', facts.sourcePaths ?? []);
  await requirePaths(root, errors, 'AI 入口', Object.values(facts.aiEntrypoints ?? {}));

  const routeDirectory = path.join(root, ROUTES_DIR);
  if (!(await exists(routeDirectory))) {
    errors.push(`服务端路由目录不存在：${ROUTES_DIR}`);
  } else {
    const actualRouteFiles = (await fs.readdir(routeDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => entry.name);
    const expectedRouteFiles = (facts.routeModules ?? []).map((route) => route.file);
    compareLists(errors, '服务端路由清单', expectedRouteFiles, actualRouteFiles);
  }

  const serverIndexPath = path.join(root, SERVER_INDEX);
  if (!(await exists(serverIndexPath))) {
    errors.push(`服务端入口不存在：${SERVER_INDEX}`);
  } else {
    const serverIndex = await fs.readFile(serverIndexPath, 'utf8');
    for (const route of facts.routeModules ?? []) {
      const registrationPattern = new RegExp(`\\bapp\\.register\\(\\s*${route.register}\\b`, 'u');
      if (!registrationPattern.test(serverIndex)) {
        errors.push(`路由 ${route.file} 未在 ${SERVER_INDEX} 注册为 ${route.register}`);
      }
    }
  }

  const configPath = path.join(root, SERVER_CONFIG);
  const envExamplePath = path.join(root, ENV_EXAMPLE);
  if (!(await exists(configPath))) {
    errors.push(`服务端配置不存在：${SERVER_CONFIG}`);
  } else if (!(await exists(envExamplePath))) {
    errors.push(`环境变量模板不存在：${ENV_EXAMPLE}`);
  } else {
    const configSource = await fs.readFile(configPath, 'utf8');
    const envExampleSource = await fs.readFile(envExamplePath, 'utf8');
    const expectedVariables = facts.environmentVariables ?? [];
    compareLists(
      errors,
      `${SERVER_CONFIG} 环境变量`,
      expectedVariables,
      extractConfigEnvironmentVariables(configSource),
    );
    compareLists(
      errors,
      `${ENV_EXAMPLE} 环境变量`,
      expectedVariables,
      extractEnvExampleVariables(envExampleSource),
    );
  }

  for (const requirement of facts.requiredContent ?? []) {
    const target = path.join(root, requirement.path);
    if (!(await exists(target))) {
      errors.push(`内容检查文件不存在：${requirement.path}`);
      continue;
    }
    const content = await fs.readFile(target, 'utf8');
    for (const fragment of requirement.includes ?? []) {
      if (!content.includes(fragment)) {
        errors.push(`${requirement.path} 缺少必要内容：${fragment}`);
      }
    }
  }

  const ignoreFile = path.join(root, '.ignore');
  if (await exists(ignoreFile)) {
    const ignoreLines = (await fs.readFile(ignoreFile, 'utf8'))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!ignoreLines.includes('.slim/deepwork/')) {
      errors.push('.ignore 未排除 .slim/deepwork/');
    }
    if (ignoreLines.some((line) => line === '!.slim/deepwork/' || line === '!.slim/deepwork/**')) {
      errors.push('.ignore 不得重新包含 .slim/deepwork/** 历史草稿');
    }
  }

  const markdownFiles = await collectMarkdownFiles(root);
  errors.push(...await findMarkdownLinkErrors(root, markdownFiles));
  return normalized(errors);
}

async function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const errors = await checkProjectKnowledge(root);
  if (errors.length > 0) {
    console.error('项目知识库检查失败：');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('项目知识库检查通过');
}

const executedFile = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (executedFile === import.meta.url) {
  await main();
}
