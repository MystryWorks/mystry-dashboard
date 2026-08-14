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
- 多实例创建、编辑、删除、启动、停止、强制停止、重启和控制台命令。
- Vanilla、Paper、Fabric、Forge、NeoForge 部署及 ZIP 导入。
- ZIP 导入采用二阶段预览：Web 先调用 `/api/import/previews` 流式上传并验证中央目录，只读取根目录或单一顶层目录中最大 64 KiB 的 `user_jvm_args.txt`；确认后同一临时 ZIP 才交给后台任务。预览随机 ID 按用户隔离、默认 30 分钟、每用户一个/全局两个，队列满保留，取消/过期/关闭/重启清理且不写数据库；旧 `/api/import` 兼容保留。
- 面板外已有服务端交接：只列出 `DATA_DIR/imports` 直接子目录，只读扫描并以后台任务复制到新托管实例；拒绝 symlink/junction、特殊文件、ownership marker、超配额和磁盘空间不足，源目录始终保留。
- 实例目录内文件列表、上传、文本读写、删除、同目录重命名；目标已存在时重命名返回 `409` 且不覆盖。普通文件通过一次性 download ticket 流式下载（JWT 签发、并发槽预留、`GET` 状态查询、失败回传 SPA；禁止 `blob()` 整包缓存），Web 文件页提供下载与重命名入口。下载窗在用户手势中 `window.open` 且不把 `noopener` 放进 feature（避免现代浏览器返回 `null` 被误判为拦截），打开后再断开 `opener`。票据完成（`consumed`）或过期（`expired`）后保留 60 秒按用户隔离的内存 tombstone，状态查询返回终态而非 404，避免前端轮询把成功下载误判为过期。
- 同 `DATA_DIR` 仅允许一个面板进程进入 `initDb` / 任务恢复：`.mmd-panel-lock/` 目录锁 + `owner.json`（存活 PID 拒绝启动；仅原 PID 不存在时可 quarantine 后接管）。
- 部署/导入/ZIP 先写入 `DATA_DIR/.mmd-staging/<taskId>/<instanceId>`（marker 含 task/instance/token），校验通过后原子移动到 `instances/<id>`；崩溃恢复只清理 marker 匹配且任务未完成的 staging，**不会**因 `result.instanceId` 删除已注册实例或最终目录（见 D-016）。
- 实例 start/stop/restart/delete/adopt 互斥：启停、删除与接管走同一把实例操作锁；start 在首个异步步骤前占位 `starting`；普通 stop 只写 `stop\n`，超时返回仍在停止中且**不**隐式 `SIGKILL`；`force=1` 为唯一强杀路径（UI 二次确认）。面板关闭先标记 `shuttingDown` 并等待未完成的实例操作；`start` 在 spawn 前若已关闭则取消，避免留下无主 Java。
- `server.properties` 读写、Java 状态检测、本机节点列表。
- 响应式布局：`apps/web` 覆盖 390px 到 1920px 窗口宽度；`<=1024px` 侧边栏变为抽屉菜单，`<=768px` 实例/节点表格转为卡片列表，表单、弹窗和控制台同步适配窄屏。总览固定保留「一键部署 / 导入已有服务端」两列主入口，空实例为次级入口；实例行只直接展示当前可执行的启动/停止，重启、强制停止和删除收进「更多操作」。
- `PanelManager.cmd`（Windows）与 `PanelManager.sh`（Linux / WSL 源码）均复用本机 `POST /api/launcher/shutdown` 安全关闭通道。
- 跨平台 `mmdctl`：自动随机配置、后台 PID 指纹、健康检查、安全停止、状态和日志；便携包使用包内 Node，Linux 源码入口在依赖/构建预检后复用同一控制器。
- 目标平台原生便携组装与最终压缩包冒烟脚本；发布包物理复制 `@mmd/shared`，并生成文件级 manifest。
- GitHub Preview Release 流水线：标签/main/版本门禁、Windows x64 与 Linux x64 矩阵、生产依赖审计、校验和签名、SBOM 和自动 Release Notes。
- 上传、下载、任务、元数据、控制台和 ZIP 解压均有大小、并发或超时边界。
- 任务中心：`GET /api/tasks` 返回最近 50 条任务；前端侧边栏与移动顶栏各有一个铃铛入口（共享单例轮询，429 退避、页面隐藏暂停），离开部署/导入页后仍可查看任务到终态。
- 危险操作防护：重启与强制停止需弹窗确认；运行/启动/停止中的实例禁止删除；删除实例需输入实例名二次确认（待迁移实例仅移除记录，免输名）；文件/目录与远程节点删除也使用统一确认弹窗，执行期间禁止 Escape 或遮罩绕过 busy 锁。
- 控制台 WebSocket 断线后指数退避自动重连（1s→30s 封顶，重新申请一次性 ticket）。
- 前端任一请求收到 401（登录/setup/status 除外）会清空登录态并自动跳回登录页。
- server.properties 编辑为引导化表单：常用键按「基础/多人与权限/世界/性能」分组；服务端保留注释、空行、重复键与 `:` 分隔符，引导保存只改每个 key 的最后一次定义，并原子写入。应用使用 Data Router 支持 SPA 导航阻塞；配置与实例设置页跟踪未保存状态，无变化时禁用保存，保存期间锁定表单，切换页面前使用统一确认弹窗，浏览器离开则使用 beforeunload；配置保存后明确提示重启生效。
- 总览提供「创建空实例」：`POST /api/instances`（custom）成功后跳转实例文件页上传 Jar。
- 部署、导入、创建空实例和实例设置共用 `JvmSettingsEditor`：基础区为内存与兼容/G1/Paper Aikar 预设，高级区为手动 Xms 与附加参数，显示规范化参数预览和结构化诊断。预设常量含版本、适用核心/Java、来源与复核日期；服务端在实例保存、部署/导入入队和启动前使用同一共享校验。旧实例非法文本保持原样，但修正前不能保存或启动（见 D-018）。
- 任务中心区分首次读取、空列表和轮询失败；失败时显示「状态可能已过期」、上次成功刷新时间与重试，弹层打开后接收焦点并支持 Escape 返回入口。部署/导入 worker 一旦完成 promote/注册即视为成功，超时或关闭不得把已落地实例改写成失败；ZIP 导入在 promote 到 `instances/<id>` 之后不再检查 abort，必须继续注册。任务中心对失败但带 `result.instanceId` 的记录仍给出实例链接。部署/导入表单提交后锁定，进度值限制在 0–100 并带 progressbar 语义；已有服务端来源列表仅做有界 ModLoader 预检，预检超时仍可提交，完整扫描在导入任务中执行。
- Java 多运行时：`GET /api/system/java-runtimes` 扫描 JAVA_HOME 与常见安装目录，候选必须文件名为 java/java.exe 且 `-version` 输出可解析才写入 `java_runtimes` 注册表；`detectJava` / 执行前复验 / Minecraft 与 installer 子进程均使用 `getMinecraftChildEnv()` 脱敏环境（不继承面板密钥与 `DATA_DIR`）。实例可通过 `javaRuntimeId` 绑定运行时（默认仍用 PATH 中的 java），启动和 Forge/NeoForge Installer 会在执行前再次验证绑定条目；四个 JVM 配置入口共用运行时选择器的加载结果和实际 Java 主版本，PATH 默认 Java 与已选注册表运行时都按 MC 版本给出 mismatch 告警（`recommendedJavaMajor`：1.20.5+ → 21，1.17–1.20.4 → 17，更早 → 8）。
- 新建数据根与子目录在 Unix 上默认 `0700`、敏感文件 `0600`，过宽权限会拒绝启动；Windows 上记录 ACL 无法自动校验时的阻断级警告（见 `data-dir-permissions.ts`）。
- `PanelManager.ps1` 安全停服：`Get-PanelHealth` 校验 PID、状态文件指纹与健康 JSON 一致后才发送 `X-Launcher-Token`（伪造健康服务测试断言永不发送 token）。
- Paper/Fabric 等 core 缓存键基于解析后的不可变版本/build，旧 `latest` 键不再误命中。
- 发布工作流（`.github/workflows/portable-release.yml`）：Actions 使用固定 commit SHA；Windows job 显式 `npm run windows:test`；`RELEASE_GPG_FINGERPRINT` 与仓库内发布公钥/指纹文件用于签名链门禁；`package-portable.mjs` 优先 `git rev-parse HEAD`，脏工作树拒绝正式打包。**本机未验证** GitHub Environment 私钥注入、真实 GPG 签名与双平台 Actions smoke 结果。
- 亮/暗双主题：CSS 变量按 `[data-theme]` 拆分，index.html 内联脚本在渲染前定主题（默认跟随 `prefers-color-scheme`），选择持久化 `mmd_theme`；切换按钮在侧边栏底部与移动顶栏，控制台终端区域保持暗色。

主要事实源：

- `apps/server/src/index.ts`
- `apps/server/src/routes/`
- `apps/server/src/services/`
- `apps/web/src/App.tsx`
- `packages/shared/src/index.ts`

## 尚未形成完整用户功能

- 远程节点创建由 `REMOTE_NODE_CREATION_ENABLED = false` 禁用；当前只有内置本机节点 `local`。
- 任务元数据写入 SQLite，但队列、worker 和运行控制器位于内存；进程重启后不会续跑任务，而是把遗留的 `pending` / `running` 记录标记为失败，并**仅**清理可证明位于 `.mmd-staging` 且 marker 匹配的半成品目录。
- 管理员认证使用浏览器 `localStorage` 中的 JWT；当前没有会话列表、撤销、2FA 或角色权限体系。
- 数据库只有启动期兼容处理，没有通用、版本化迁移框架。
- 实例默认使用面板进程 `PATH` 中的 `java`，也可绑定 `java_runtimes` 注册表中当前可用的运行时；绑定条目消失、路径变化或执行前验证失败时必须重新探测和选择。
- 没有完整的自动备份/恢复、系统安装器、远程 Agent 执行协议或生产监控闭环。
- 便携发布流水线已经实现，但 Windows x64 / Linux x64 runner 和公开 Release 的实际结果只能由对应 GitHub Actions 运行确认。Linux ARM64 与 macOS 打包能力仍在脚本中，不纳入本 Preview 公开发布。
- 公开发布前须通过 `npm.cmd run audit:production`（拒绝 high/critical）。2026-08-07 本机结果为 0 critical、0 high、2 moderate（React Router 6）；moderate 须写入发布说明，不得用 `--force` 贸然升到 React Router 7。
- **Beta 发布剩余事项**：批次 A–F 已随 `7d94c83` 提交并全部纳入 Git 跟踪（R0-06 对 Git 跟踪已关闭），根 `verify` 已串联 `npm run test:regression -w @mmd/server`（本机 18 pass / 2 skip，R1-02 Unix 权限在 Windows skip）。签名链已配置：发布密钥指纹 `F0272DFEE5F03A9907C4FA492E4ECE89B8DECEF8`，公钥/指纹已写入 `.github/`，`release` Environment 的 `RELEASE_GPG_PRIVATE_KEY`/`RELEASE_GPG_PASSPHRASE`/`RELEASE_GPG_FINGERPRINT` 已设置（2026-08-07）；GitHub Free 不支持 Environment 保护规则（required_reviewers / wait_timer 均返回 422），以工作流内置门禁（tag 必须为 `origin/main` 祖先、与版本一致、工作树干净、verify+audit 通过）替代。§8.2 人工清单、双平台 CI 最终 Release 压缩包 smoke 与真实 Release 签名验证仍未执行。`main` 仅含初始提交时代的旧快照（落后 `dev` 28 commits，无 workflows/scripts/docs/ai），发布工作流的 tag 门禁要求 tag 提交是 `origin/main` 祖先，因此必须先同步 `main`（fast-forward 到 `dev`，实测无冲突）才能打标签。

## 固定运行边界

- Node.js `>=22`。
- 便携包固定内置 Node.js `22.23.1`；源码运行仍遵循 `>=22`。
- 默认监听 `127.0.0.1:3000`；Vite 开发端口为 `127.0.0.1:5173`。
- 最终数据根目录优先使用 `MMD_DATA_DIR`，否则使用 `DATA_DIR`；实例固定为该根目录的 `instances/<id>`，不得浏览或管理整台机器。
- 同机目录交接只接收 `DATA_DIR/imports` 下的单层目录 ID，不能提交绝对路径；该目录仅为复制源，不是实例工作目录。
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
