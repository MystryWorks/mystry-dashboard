import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32'
  ? process.env.ComSpec || 'cmd.exe'
  : 'npm';
const npmArguments = process.platform === 'win32'
  ? [
      '/d',
      '/s',
      '/c',
      'npm.cmd audit --omit=dev --json --registry=https://registry.npmjs.org',
    ]
  : ['audit', '--omit=dev', '--json', '--registry=https://registry.npmjs.org'];
const result = spawnSync(
  npmCommand,
  npmArguments,
  {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (result.error) {
  console.error(`无法执行 npm audit：${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error(result.stderr || result.stdout || 'npm audit 未返回有效 JSON');
  process.exit(1);
}

if (!report?.metadata?.vulnerabilities) {
  console.error(report?.error?.summary || 'npm audit 报告缺少漏洞统计');
  process.exit(1);
}

const counts = report.metadata.vulnerabilities;
console.log(
  `生产依赖审计：critical=${counts.critical ?? 0}，high=${counts.high ?? 0}，`
    + `moderate=${counts.moderate ?? 0}，low=${counts.low ?? 0}`,
);

if ((counts.critical ?? 0) > 0 || (counts.high ?? 0) > 0) {
  console.error('存在未解决的 high/critical 生产依赖漏洞，禁止生成公开便携包。');
  process.exit(1);
}

if ((counts.moderate ?? 0) > 0 || (counts.low ?? 0) > 0) {
  console.warn('仍有中低风险公告；发布说明必须记录，并在依赖提供修复版后及时升级。');
}
