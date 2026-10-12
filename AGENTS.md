# Minecraft Mystry Dashboard AI 开发规则

Minecraft Mystry Dashboard（根包名 `minecraft-mystry-dashboard`，当前 `0.2.0-preview.1`）是单机一体的 **Minecraft Java 服务端** Web 管理面板：本机多实例启停、控制台、文件、一键部署与导入。**不是**客户端模组，也不依赖 Fabric/Forge 作为面板自身的模组加载器。

本文件是 Codex、OpenCode、Cursor 和 Grok 的项目级统一入口。详细知识按需读取
[`docs/ai/README.md`](docs/ai/README.md)，不要在工具专用规则中复制项目事实。

## 开工前强制步骤

1. 运行 `git status --short --branch`，确认工作树、当前分支和用户已有修改。
2. 阅读与任务对应的知识库页面，并检查相关源码、配置和测试；不得仅凭文档或提交标题判断现状。
3. 搜索功能完整链路：共享契约、服务端实现、前端调用、可见入口、文档和验证证据。
4. 若源码与知识库冲突，以源码和配置为事实，停止扩大改动，并在同一变更中修正知识库。

事实优先级：

1. 当前源码、配置、`package.json` 和实际命令输出。
2. 通过 `npm.cmd run knowledge:check` 校验的 [`project-facts.json`](docs/ai/project-facts.json)。
3. [`current-state.md`](docs/ai/current-state.md) 与现行项目文档。
4. 历史计划、提交说明和本机草稿。

`.slim/deepwork/**` 是本机历史草稿，不是当前事实源；其中已修复问题不得重新当作现存缺陷。

## 仓库地图

根 `package.json` 使用 npm workspaces：`apps/*`、`packages/*`。当前工作区：

| 包 | 路径 | 职责 |
|---|---|---|
| `@mmd/shared` | `packages/shared` | 前后端共享类型与 JSON Schema |
| `@mmd/server` | `apps/server` | Fastify 5 API、`node:sqlite`、进程/文件/任务 |
| `@mmd/web` | `apps/web` | React 19 + Vite 管理界面 |

服务端路由（均在 `apps/server/src/index.ts` 注册）：`auth`、`console`、`cores`、`files`、`instances`、`launcher`、`nodes`、`system`。

前端路由：`/login`、`/`（总览）、`/deploy`、`/import`、`/nodes`、`/instances/:id/*`。页面入口在 `apps/web/src/pages/`，HTTP 封装在 `apps/web/src/api.ts`。Vite 别名 `@` → `src/`。

源码启动器：Windows `PanelManager.cmd`，Linux/WSL `PanelManager.sh`。便携控制器：`scripts/portable/mmdctl.mjs`。

默认监听 `127.0.0.1:3000`；Vite 开发端口 `127.0.0.1:5173`。Node.js 必须为 22 或更高。Windows PowerShell 使用 `npm.cmd`，避免执行策略拦截 `npm.ps1`。

## 关键架构边界

- 前后端公共请求、响应和字段先修改 `packages/shared`；需要运行时校验时同步 `schemas.ts`，然后先构建 `@mmd/shared`。
- 最终数据根优先 `MMD_DATA_DIR`，否则 `DATA_DIR`，再否则仓库相对路径 `data`。实例唯一工作目录是该根下的 `instances/<id>`。文件操作必须复用 `file-service` 和 `apps/server/src/utils/path.ts` 的校验，不得接受或拼接未验证系统路径。
- 同机已有服务端只能通过 `DATA_DIR/imports` 下的单层目录 ID 交接复制；该目录是只读复制源，不是实例工作目录。不得浏览整机、不得绑定外部绝对安装路径。
- 部署/导入先写入 `DATA_DIR/.mmd-staging/<taskId>/<instanceId>`，成功后再原子移动到 `instances/<id>`。崩溃恢复只清理 marker 匹配的 staging，不得删除已注册实例或最终目录。
- 同一 `DATA_DIR` 只允许一个面板进程在 `initDb` / 任务恢复前取得 `.mmd-panel-lock/`。
- Minecraft 实例默认通过面板进程 `PATH` 中的 `java` 启动，也可按 `javaRuntimeId` 使用面板扫描、注册并在执行前复验的运行时；请求不得提交可执行路径。子进程环境必须走 `getMinecraftChildEnv()` 脱敏，不得把面板密钥或 `DATA_DIR` 传给 Java。
- 四个实例入口（部署、ZIP 导入、已有服务端导入、实例设置）共用结构化 JVM 配置器；数据库只保存规范化 `jvmArgs` 字符串。旧实例非法文本保持原样，但修正前不能保存或启动。
- ZIP 导入走二阶段预览：`/api/import/previews` 预检后再入队；旧 `/api/import` 仅兼容保留。Web 必须使用预览流程。
- 远程节点创建当前关闭（`REMOTE_NODE_CREATION_ENABLED = false`），不得宣称远程 Agent 已可用。当前只有内置本机节点 `local`。
- 数据库没有通用迁移框架。任何 schema 变更必须同时设计现有 `panel.db` 的兼容或一次性迁移。
- 任务元数据在 SQLite，队列和 worker 在内存。进程重启不会续跑，而是把遗留 `pending` / `running` 标为失败。部署/导入任务可能排队并保持 `pending`；前端必须持续显示到 `completed` 或 `failed`。
- 下载必须流式传输；浏览器端不得用 `res.blob()` 整体缓存大文件。
- 用户可见文案和新增/修改的代码注释使用中文。
- 无 ESLint/Prettier；与周围文件风格保持一致（TypeScript + ESM）。不要把 React Router 从已锁定的 `6.30.4` 升到 7。

## 标准变更顺序

按 [`change-playbooks.md`](docs/ai/change-playbooks.md) 执行。声明功能完成前必须同时具备：

1. 共享类型或 schema
2. 服务端路由与服务
3. 前端 API 调用
4. 用户可见入口及错误反馈
5. 文档（至少 `docs/api.md` / 当前状态，视改动范围）
6. 自动检查与必要的人工行为验证

配置、路由、脚本或 AI 入口变化时，同步 [`project-facts.json`](docs/ai/project-facts.json) 并运行 `npm.cmd run knowledge:check`。

## 防错约束

- 保护用户修改：不得回退、覆盖、格式化或提交任务范围外的改动。
- 不得提交 `.env`、`data/`、密钥、数据库、构建产物或机器专用绝对路径。
- 未经用户明确授权，不 push、不改写历史、不删除分支或备份。
- 不对仓库 `data/` 中的用户实例做破坏性测试；数据库演练只用副本。
- API 存在不代表功能完成；必须确认前端调用和用户入口。
- 构建通过只证明可编译，不证明登录、部署、控制台、文件或 UI 行为正确。
- 安全自检通过不等于依赖审计无漏洞；依赖状态必须实时运行审计后才能下结论。
- 密钥 `JWT_SECRET`、`SETUP_TOKEN`、`LAUNCHER_TOKEN` 必须互不相同的 64 位十六进制随机值；日志不得打印密钥或 ticket。

完整禁区见 [`guardrails.md`](docs/ai/guardrails.md)。

## 常用命令

```powershell
npm.cmd install
npm.cmd run build -w @mmd/shared
npm.cmd run dev:server
npm.cmd run dev:web
npm.cmd run typecheck
npm.cmd run test:security -w @mmd/server
npm.cmd run test:regression -w @mmd/server
npm.cmd run test:smoke
npm.cmd run knowledge:check
npm.cmd run verify
```

Linux/macOS 与 CI 使用相同脚本名，入口为 `npm run ...`。源码整合启动可用 `PanelManager.cmd` / `./PanelManager.sh`。

## 验证与交付

按 [`verification.md`](docs/ai/verification.md) 选择与风险匹配的检查。提交前至少运行：

```powershell
npm.cmd run verify
```

若受限沙箱中的 Vite/esbuild 因父目录访问被拒绝而失败，应在获准的正常环境重跑，不得直接判定为代码错误。

UI、布局、路由或客户端状态改动后，在浏览器中按真实用户路径点完相关页面，并检查窄屏与相邻入口，不能只看一次截图。

最终报告必须分别列出：

- 已实现
- 已验证（包含实际命令或人工流程）
- 未验证
- 剩余风险或警告

已知误判案例见 [`known-failures.md`](docs/ai/known-failures.md)，现行架构决策见
[`decisions.md`](docs/ai/decisions.md)。
