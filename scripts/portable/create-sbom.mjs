import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`未知参数：${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数 ${token} 缺少值`);
    result[token.slice(2)] = value;
    index += 1;
  }
  return result;
}

function packageNameFromPath(packagePath, entry) {
  if (entry.name) return entry.name;
  const marker = 'node_modules/';
  const index = packagePath.lastIndexOf(marker);
  const relative = index >= 0 ? packagePath.slice(index + marker.length) : packagePath;
  const segments = relative.split('/').filter(Boolean);
  return segments[0]?.startsWith('@')
    ? `${segments[0]}/${segments[1]}`
    : segments[0];
}

function encodePurlName(name) {
  return name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
}

export async function createSbom({
  lockPath = path.resolve('package-lock.json'),
  packagePath = path.resolve('package.json'),
  outputPath = path.resolve('sbom.cdx.json'),
}) {
  const [lock, rootPackage] = await Promise.all([
    fsp.readFile(lockPath, 'utf8').then(JSON.parse),
    fsp.readFile(packagePath, 'utf8').then(JSON.parse),
  ]);
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json 缺少 packages 字段');
  }

  const componentsByRef = new Map();
  for (const [lockEntryPath, entry] of Object.entries(lock.packages)) {
    if (!lockEntryPath.includes('node_modules/') || entry.dev === true || entry.link === true) {
      continue;
    }
    const name = packageNameFromPath(lockEntryPath, entry);
    if (!name || !entry.version) continue;
    const bomRef = `pkg:npm/${encodePurlName(name)}@${encodeURIComponent(entry.version)}`;
    if (componentsByRef.has(bomRef)) continue;
    const component = {
      type: 'library',
      'bom-ref': bomRef,
      name,
      version: entry.version,
      purl: bomRef,
      properties: [
        {
          name: 'mmd:lockfile-path',
          value: lockEntryPath,
        },
      ],
    };
    if (typeof entry.license === 'string' && entry.license.trim()) {
      component.licenses = [{ license: { id: entry.license.trim() } }];
    }
    componentsByRef.set(bomRef, component);
  }

  const components = [...componentsByRef.values()]
    .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
  const document = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: {
        components: [
          {
            type: 'application',
            name: 'mmd-lockfile-sbom',
            version: '1',
          },
        ],
      },
      component: {
        type: 'application',
        'bom-ref': `pkg:npm/${encodePurlName(rootPackage.name)}@${encodeURIComponent(rootPackage.version)}`,
        name: rootPackage.name,
        version: rootPackage.version,
      },
    },
    components,
  };
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { outputPath, componentCount: components.length };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (!args.output) throw new Error('必须通过 --output 指定 SBOM 输出文件');
  const result = await createSbom({
    lockPath: args.lock ? path.resolve(args.lock) : undefined,
    packagePath: args.package ? path.resolve(args.package) : undefined,
    outputPath: path.resolve(args.output),
  });
  console.log(`已生成 CycloneDX SBOM：${result.outputPath}（${result.componentCount} 个生产组件）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
