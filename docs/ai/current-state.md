# 当前项目状态

本文只描述当前工作树可由源码确认的状态。未来设想必须写入
[架构决策](decisions.md)并标为 `Proposed`。

## 已确认实现

- npm workspaces monorepo：
  - `packages/shared`：共享 TypeScript 类型和 JSON Schema。
  - `apps/server`：Fastify API、SQLite、进程、文件、部署与导入。
  - `apps/web`：React 管理界面。
- 首次 setup、登录和 Bearer JWT 认证；控制台通过短期一次性 ticket 建立 WebSocket。
- 控制台前端按 ECMA-48 / ISO 6429 对 INFO（绿）、WARN（黄）、ERROR（红）等日志级别着色；服务端仍转发原始纯文本。
- 多实例创建、编辑、删除、启动、停止、重启和控制台命令。
- Vanilla、Paper、Fabric、Forge、NeoForge 部署及 ZIP 导入。
- 实例目录内文件列表、上传、文本读写、删除、重命名和流式下载服务端接口。
- `server.properties` 读写、Java 状态检测、本机节点列表。
- `PanelManager.cmd` 与本机 `POST /api/launcher/shutdown` 安全关闭通道。
- 跨平台便携 `mmdctl`：包内 Node 启动、随机配置生成、后台 PID 指纹、健康检查、安全停止、状态和日志。
- 五目标原生便携组装与最终压缩包冒烟脚本；发布包物理复制 `@mmd/shared`，并生成文件级 manifest。
- GitHub Preview Release 流水线：标签/main/版本门禁、五目标矩阵、生产依赖审计、校验和签名、SBOM 和自动 Release Notes。
- 上传、下载、任务、元数据、控制台和 ZIP 解压均有大小、并发或超时边界。

主要事实源：

- `apps/server/src/index.ts`
- `apps/server/src/routes/`
- `apps/server/src/services/`
- `apps/web/src/App.tsx`
- `packages/shared/src/index.ts`

## 尚未形成完整用户功能

- 文件重命名和下载已有后端接口，但当前前端没有对应调用或可见入口。不得仅因路由存在就宣称 UI 功能完成。
- 远程节点创建由 `REMOTE_NODE_CREATION_ENABLED = false` 禁用；当前只有内置本机节点 `local`。
- 任务元数据写入 SQLite，但队列、worker 和运行控制器位于内存；进程重启后不会续跑任务，而是把遗留的 `pending` / `running` 记录标记为失败，并尝试清理已关联的半成品实例。
- 管理员认证使用浏览器 `localStorage` 中的 JWT；当前没有会话列表、撤销、2FA 或角色权限体系。
- 数据库只有启动期兼容处理，没有通用、版本化迁移框架。
- 所有实例共用面板进程 `PATH` 中解析出的同一个 `java`；没有按 Minecraft 版本管理 Java 运行时。
- 没有完整的自动备份/恢复、系统安装器、远程 Agent 执行协议或生产监控闭环。
- 便携发布流水线已经实现，但各 runner 和公开 Release 的实际结果只能由对应 GitHub Actions 运行确认。

## 固定运行边界

- Node.js `>=22`。
- 便携包固定内置 Node.js `22.23.1`；源码运行仍遵循 `>=22`。
- 默认监听 `127.0.0.1:3000`；Vite 开发端口为 `127.0.0.1:5173`。
- 最终数据根目录优先使用 `MMD_DATA_DIR`，否则使用 `DATA_DIR`；实例固定为该根目录的 `instances/<id>`，不得浏览或管理整台机器。
- 旧版外部实例路径只用于迁移状态判断；面板不会读取、启动、搬迁或删除旧外部目录。
- `JWT_SECRET` 必填；空用户表时 `SETUP_TOKEN` 必填；`LAUNCHER_TOKEN` 仅供本机 PanelManager 关闭接口使用；已配置的三项必须互不相同。
- 部署和导入可保持 `pending` 等待队列容量，UI 必须轮询至终态。

## 声明能力前的最低证据

至少确认以下链路：

1. 共享类型或 schema。
2. 服务端路由和服务。
3. 前端 API 调用。
4. 用户可见入口及错误反馈。
5. 文档。
6. 自动检查与必要的人工行为验证。
