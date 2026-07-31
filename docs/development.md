# 开发指南

## 前置步骤

```bash
npm install
npm run build -w @mmd/shared
```

修改 `packages/shared` 后需重新构建 shared，server / web 才能拿到最新类型。

独立类型检查（不产出构建物）：

```bash
npm run build -w @mmd/shared
npm run typecheck
```

## 工作区包

### `@mmd/shared`

```bash
npm run build -w @mmd/shared
```

输出：`packages/shared/dist/`。新增前后端共用字段时应先改此处；请求体校验 schema 放在 `src/schemas.ts`，由路由直接引用。

### `@mmd/server`

- 开发：`npm run dev -w @mmd/server`（通常通过根目录 `npm run dev:server`）
- 构建：`npm run build -w @mmd/server`
- 入口：`apps/server/src/index.ts`

### `@mmd/web`

- 开发：`npm run dev -w @mmd/web`
- 构建：`npm run build -w @mmd/web`
- 别名：`@` → `src/`

## 添加 REST 接口的建议流程

1. 在 `packages/shared` 中补充请求 / 响应类型（如需要），并同步 `schemas.ts` 中对应 JSON Schema。
2. 在 `apps/server/src/services/` 实现业务逻辑。
3. 在 `apps/server/src/routes/` 注册路由，挂 `authenticate`（若需登录），body schema 优先从 `@mmd/shared` 引入。
4. 在 `apps/web/src/api.ts` 或页面中调用。
5. 更新 [API 参考](api.md)。

## 路径与安全

- 实例目录解析：`apps/server/src/utils/path.ts`（`resolveDirFromRow` 等）。
- 文件操作必须经过 `file-service` 的路径校验，避免目录穿越。

## 进程与控制台

- 所有实例进程由单例 `processManager` 管理。
- 扩展多实例并发时注意：`start` / `stop` 已有状态锁，避免重复 spawn。
- 控制台事件：`output`、`status`（EventEmitter）。

## 数据库

- 初始化：`initDb()` 在 `index.ts` 启动时调用。
- 表结构变更：当前无迁移框架；改表时需手动处理已有 `panel.db` 或编写一次性迁移脚本。

## 代码风格

- 与现有文件保持一致：ESM（`import`）、TypeScript、服务端文件后缀 `.ts` 编译为 `.js`。
- 用户可见文案与注释使用中文（与项目一致）。
- 避免无关重构；小范围修复优先。

## AI 项目知识库

- 根目录 `AGENTS.md` 是 Codex、OpenCode、Cursor 的统一强制入口，详细资料位于 `docs/ai/`。
- 路由、环境变量、workspaces、入口或验证脚本变化时，必须同步 `docs/ai/project-facts.json`。
- 当前事实、计划、已否决方案和历史故障必须分层记录，不得把旧计划当成已实现能力。
- 快速检查：`npm run knowledge:check`；检查器负向测试：`npm run knowledge:test`。
- 完整门禁：`npm run verify`。Windows PowerShell 从终端直接执行时使用 `npm.cmd run verify`。

## 本地验证清单

- [ ] `npm run knowledge:check` 与 `npm run knowledge:test` 无错误
- [ ] `npm run typecheck` 无错误
- [ ] `GET /api/health` 返回 ok
- [ ] 登录 / setup 流程
- [ ] 创建或部署实例并启动
- [ ] WebSocket 控制台有输出且可发命令
- [ ] 文件列表与 `server.properties` 读写
- [ ] `npm run build` 无错误，`npm start` 可打开整合页面

## 便携包开发与发布

便携工具位于 `scripts/portable/`。每个压缩包必须在相同操作系统和架构的原生 runner 上组装，再从最终压缩包解压验证：

```bash
npm run portable:test
npm run audit:production
npm run build
node scripts/portable/package-portable.mjs --platform win32 --arch x64 --output-dir release
node scripts/portable/smoke-portable.mjs release/mmd-v0.2.0-preview.1-windows-x64.zip
```

`package-portable.mjs` 会从官方 Node.js 发布站下载固定版本运行时并按 `SHASUMS256.txt` 校验，使用 `npm ci --omit=dev` 创建独立生产依赖树，物理复制 `@mmd/shared`，并拒绝包内符号链接。不要从当前仓库的 `node_modules` 直接打包。

`.github/workflows/portable-release.yml` 在五目标矩阵全部通过后生成 Release。发布前还必须通过 `npm run verify` 和 `npm run audit:production`；签名密钥缺失会阻止公开 Release。维护操作和数据升级流程见 [便携预览版](portable-release.md)。

## 相关文档

- [贡献指南](../CONTRIBUTING.md)
- [架构设计](architecture.md)
- [配置说明](configuration.md)
- [便携预览版](portable-release.md)
- [AI 项目知识库](ai/README.md)
