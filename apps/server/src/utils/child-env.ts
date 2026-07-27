/**
 * 子进程只继承 Java/Minecraft 所需的运行环境，避免把 JWT_SECRET、DATA_DIR 等面板配置传给第三方程序。
 */
export function getMinecraftChildEnv(): NodeJS.ProcessEnv {
  const keys = process.platform === 'win32'
    ? [
        'PATH',
        'Path',
        'JAVA_HOME',
        'SystemRoot',
        'WINDIR',
        'ComSpec',
        'PATHEXT',
        'TEMP',
        'TMP',
        'USERPROFILE',
      ]
    : ['PATH', 'JAVA_HOME', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR'];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
