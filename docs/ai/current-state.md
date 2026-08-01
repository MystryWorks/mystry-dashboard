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
- 响应式布局：`apps/web` 覆盖 390px 到 1920px 窗口宽度；`<=1024px` 侧边栏变为抽屉菜单，`<=768px` 实例/节点表格转为卡片列表，表单、弹窗和控制台同步适配窄屏。
- `PanelManager.cmd` 与本机 `POST /api/launcher/shutdown` 安全关闭通道。
- 跨平台便携 `mmdctl`：包内 Node 启动、随机配置生成、后台 PID 指纹、健康检查、安全停止、状态和日志。
- 五目标原生便携组装与最终压缩包冒烟脚本；发布包物理复制 `@mmd/shared`，并生成文件级 manifest。
- GitHub Preview Release 流水线：标签/main/版本门禁、五目标矩阵、生产依赖审计、校验和签名、SBOM 和自动 Release Notes。
- 上传、下载、任务、元数据、控制台和 ZIP 解压均有大小、并发或超时边界。
- 任务中心：`GET /api/tasks` 返回最近 50 条任务；前端侧边栏与移动顶栏各有一个铃铛入口（共享单例轮询，429 退避、页面隐藏暂停），离开部署/导入页后仍可查看任务到终态。
- 危险操作防护：重启需弹窗确认；运行/启动/停止中的实例禁止删除；删除实例需输入实例名二次确认（待迁移实例仅移除记录，免输名）。
- 控制台 WebSocket 断线后指数退避自动重连（1s→30s 封顶，重新申请一次性 ticket）。
- 前端任一请求收到 401（登录/setup/status 除外）会清空登录态并自动跳回登录页。
- server.properties 编辑为引导化表单：常用键按「基础/多人与权限/世界/性能」分组，提供中文说明与开关、下拉、数字控件；未收录键折叠进「高级选项」文本编辑，保存仍提交完整键值记录。
- Java 多运行时：`GET /api/system/java-runtimes` 扫描 JAVA_HOME 与常见安装目录，候选必须文件名为 java/java.exe 且 `-version` 输出可解析才写入 `java_runtimes` 注册表；扫描使用脱敏环境、合并并限频刷新，最近一次扫描未发现的条目会标为不可用。实例可通过 `javaRuntimeId` 绑定运行时（默认仍用 PATH 中的 java），启动和 Forge/NeoForge Installer 会在执行前再次验证绑定条目；部署页与实例设置页提供选择器，并按 MC 版本给出推荐 Java 版本与 mismatch 告警（`recommendedJavaMajor`：1.20.5+ → 21，1.17–1.20.4 → 17，更早 → 8）。
- 亮/暗双主题：CSS 变量按 `[data-theme]` 拆分，index.html 内联脚本在渲染前定主题（默认跟随 `prefers-color-scheme`），选择持久化 `mmd_theme`；切换按钮在侧边栏底部与移动顶栏，控制台终端区域保持暗色。

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
- 实例默认使用面板进程 `PATH` 中的 `java`，也可绑定 `java_runtimes` 注册表中当前可用的运行时；绑定条目消失、路径变化或执行前验证失败时必须重新探测和选择。
- 没有完整的自动备份/恢复、系统安装器、远程 Agent 执行协议或生产监控闭环。
- 便携发布流水线已经实现，但各 runner 和公开 Release 的实际结果只能由对应 GitHub Actions 运行确认。

## 固定运行边界

- Node.js `>=22`。
- 便携包固定内置 Node.js `22.23.1`；源码运行仍遵循 `>=22`。
- 默认监听 `127.0.0.1:3000`；Vite 开发端口为 `127.0.0.1:5173`。
- 最终数据根目录优先使用 `MMD_DATA_DIR`，否则使用 `DATA_DIR`；实例固定为该根目录的 `instances/<id>`，不得浏览或管理整台机器。
- 旧版外部实例路径只用于迁移状态判断；面板不会读取、启动、搬迁或删除旧外部目录。
- `JWT_SECRET` 必填；空用户表时 `SETUP_TOKEN` 必填；`LAUNCHER_TOKEN` 仅供本机 PanelManager 关闭接口使用；已配置的三项必须互不相同。
- Java 可执行路径只允许来自面板扫描注册（见 D-014）；请求只能提交运行时 ID，不得提交任意路径。
- 部署和导入可保持 `pending` 等待队列容量，UI 必须轮询至终态。

## 声明能力前的最低证据

至少确认以下链路：

1. 共享类型或 schema。
2. 服务端路由和服务。
3. 前端 API 调用。
4. 用户可见入口及错误反馈。
5. 文档。
6. 自动检查与必要的人工行为验证。
