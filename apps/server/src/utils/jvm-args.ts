/**
 * 把用户输入的 JVM 参数字符串解析为 spawn 可直接使用的参数数组。
 * 支持单双引号分组，并保留 Windows 路径中普通的反斜杠。
 */
export function parseJvmArgs(value: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let tokenStarted = false;

  const pushCurrent = () => {
    if (!tokenStarted) return;
    args.push(current);
    current = '';
    tokenStarted = false;
  };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;

    if (quote) {
      if (character === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }
      if (character === '\\') {
        const next = value[index + 1];
        if (next === quote) {
          current += next;
          tokenStarted = true;
          index += 1;
          continue;
        }
      }
      current += character;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      pushCurrent();
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '\\') {
      const next = value[index + 1];
      if (next !== undefined && (/\s/.test(next) || next === '"' || next === "'")) {
        current += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
    }
    current += character;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error('JVM 参数包含未闭合的引号');
  }
  pushCurrent();
  return args;
}

/** 把参数数组序列化为 Java @argfile，每行严格对应一个参数。 */
export function serializeJvmArgFile(args: readonly string[]): string {
  return args
    .map((argument) => `"${argument.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join('\n');
}
