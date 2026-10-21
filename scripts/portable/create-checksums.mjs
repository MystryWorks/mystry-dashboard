import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

export async function createChecksums(directory) {
  const root = path.resolve(directory);
  const entries = (await fsp.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== 'SHA256SUMS' && name !== 'SHA256SUMS.asc')
    .sort((left, right) => left.localeCompare(right));
  if (entries.length === 0) throw new Error(`目录中没有可生成校验和的文件：${root}`);

  const lines = [];
  for (const name of entries) {
    lines.push(`${await hashFile(path.join(root, name))}  ${name}`);
  }
  const output = path.join(root, 'SHA256SUMS');
  await fsp.writeFile(output, `${lines.join('\n')}\n`, 'utf8');
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2] || 'release';
  createChecksums(directory)
    .then((output) => console.log(`已生成：${output}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
