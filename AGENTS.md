# Minecraft Mystery Dashboard AI 开发规则

本文件是 Codex、OpenCode 和 Cursor 的项目级统一入口。详细知识按需读取
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

## 关键架构边界

- 根 `package.json` 使用 npm workspaces：`packages/shared`、`apps/server`、`apps/web`。
- Node.js 必须为 22 或更高版本。Windows PowerShell 使用 `npm.cmd`，避免执行策略拦截 `npm.ps1`。
- 前后端公共请求、响应和字段先修改 `packages/shared`；需要运行时校验时同步 `schemas.ts`，然后先构建 `@mmd/shared`。
- 实例唯一工作目录是 `DATA_DIR/instances/<id>`。文件操作必须复用 `file-service` 和 `apps/server/src/utils/path.ts` 的校验，不得接受或拼接未验证系统路径。
- Minecraft 进程只能通过面板进程 `PATH` 中的 `java` 启动。远程节点创建当前关闭，不得宣称远程 Agent 已可用。
- 数据库没有通用迁移框架。任何 schema 变更必须同时设计现有 `panel.db` 的兼容或一次性迁移。
- 部署/导入任务可能排队并保持 `pending`；前端必须持续显示到 `completed` 或 `failed`。
- 用户可见文案和新增/修改的代码注释使用中文。

## 防错约束

- 保护用户修改：不得回退、覆盖、格式化或提交任务范围外的改动。
- 不得提交 `.env`、`data/`、密钥、数据库、构建产物或机器专用绝对路径。
- 未经用户明确授权，不 push、不改写历史、不删除分支或备份。
- API 存在不代表功能完成；必须确认前端调用和用户入口。下载不得用 `res.blob()` 整体缓存大文件。
- 构建通过只证明可编译，不证明登录、部署、控制台、文件或 UI 行为正确。
- 安全自检通过不等于依赖审计无漏洞；依赖状态必须实时运行审计后才能下结论。

完整禁区见 [`guardrails.md`](docs/ai/guardrails.md)，标准变更顺序见
[`change-playbooks.md`](docs/ai/change-playbooks.md)。

## 验证与交付

按 [`verification.md`](docs/ai/verification.md) 选择与风险匹配的检查。提交前至少运行：

```powershell
npm.cmd run verify
```

若受限沙箱中的 Vite/esbuild 因父目录访问被拒绝而失败，应在获准的正常环境重跑，不得直接判定为代码错误。

最终报告必须分别列出：

- 已实现
- 已验证（包含实际命令或人工流程）
- 未验证
- 剩余风险或警告

已知误判案例见 [`known-failures.md`](docs/ai/known-failures.md)，现行架构决策见
[`decisions.md`](docs/ai/decisions.md)。
