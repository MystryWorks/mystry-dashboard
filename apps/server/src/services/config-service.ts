import fs from 'node:fs';
import { getInstanceDir, resolveSafePath } from '../utils/path.js';

export type PropertiesMap = Record<string, string>;

/** 解析 Java properties 风格的 server.properties */
export function parseProperties(content: string): PropertiesMap {
  const result: PropertiesMap = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1);
    result[key] = value;
  }
  return result;
}

export function stringifyProperties(map: PropertiesMap): string {
  const lines = Object.entries(map).map(([k, v]) => `${k}=${v}`);
  return `${lines.join('\n')}\n`;
}

export function readServerProperties(instanceId: string): PropertiesMap {
  const root = getInstanceDir(instanceId);
  const file = resolveSafePath(root, 'server.properties');
  if (!fs.existsSync(file)) {
    return {
      'server-port': '25565',
      gamemode: 'survival',
      difficulty: 'easy',
      'max-players': '20',
      motd: 'A Minecraft Server',
      'online-mode': 'true',
    };
  }
  return parseProperties(fs.readFileSync(file, 'utf8'));
}

export function writeServerProperties(instanceId: string, map: PropertiesMap): void {
  const root = getInstanceDir(instanceId);
  const file = resolveSafePath(root, 'server.properties');
  fs.writeFileSync(file, stringifyProperties(map), 'utf8');
}

export function ensureEula(instanceId: string, accept: boolean): void {
  if (!accept) return;
  const root = getInstanceDir(instanceId);
  fs.writeFileSync(resolveSafePath(root, 'eula.txt'), 'eula=true\n', 'utf8');
}
