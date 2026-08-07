# Beta 发布修复计划

> 状态：`In Progress`（批次 A–F 已随提交 `7d94c83` 合入 **dev** 并全部纳入 Git 跟踪；根 `verify` 已串联 `test:regression`；批次 G 于 **2026-08-07** 在本机 Windows 跑通 `knowledge:*`、`typecheck`、`test:security`、`test:regression`、`windows:test`、`build`、`verify`、`audit:production`）  
> 基线：2026-08-06 审查 + 2026-08-07 门禁复验  
> 目标：将当前项目从“可供内部试用”提升为可向真实 Minecraft 管理员发布的公开 Beta。  
> **未满足 §8.3 公开 Beta 准入**：§8.2 人工清单、双平台 CI 最终包 smoke、真实 Release 运行与签名验证、`dev` 合入 `main` 后打标签。签名密钥与 `release` Environment 三个密钥已配置（2026-08-07）；GitHub Free 不支持 Environment 保护规则（required_reviewers / wait_timer 均返回 422），以工作流内置门禁与标签权限规则作为替代，见 §7.2.5。

### 工作树实施进度（相对 §2 清单）

| ID | 工作树状态 | 本机自动证据 | 仍缺 |
|---|---|---|---|
| R0-01 | 已实现 | `data-lock.test.ts` | 双进程人工演练 |
| R0-02 | 已实现 | `process-manager.test.ts` | 真实 MC 并发 start |
| R0-03 | 已实现 | `process-manager.test.ts` | 真实 MC 停服宽限期 |
| R0-04 | 已实现 | `task-service.test.ts`、`security-self-test` | 各阶段注入崩溃人工 |
| R0-05 | 已实现 | `file-service.test.ts` | UI 冲突保留（骨架已有） |
| R0-06 | 已关闭 | `7d94c83` 已纳入 Git 跟踪；根 `verify` 已串联 `test:regression` | 干净 checkout 构建与双平台 CI 终验 |
| R1-01 | 已实现 | `java-detect.test.ts` | — |
| R1-02 | 部分 | Unix 用例在 Windows CI skip | 本机 ACL 仅警告 |
| R1-03 | 已实现 | `windows:test` R1-03 | — |
| R1-04/05 | 部分 | 工作流 SHA pin、`windows:test` in release job | Actions 真实签名/smoke 未验 |
| R1-06 | 已实现 | `files.test.ts`、回归套件 | 浏览器大文件下载人工 |
| R2-01..07 | 已实现（工作树） | `config-service`/`core-depot`/Web 改动 + 部分测试 | §8.2 可访问性与任务 UI 人工 |

## 1. 发布结论与范围

当前代码能够完成初始化、登录、实例管理、部署/导入、文件操作和 Windows x64 便携包启动，但不满足公开 Beta 的数据完整性与供应链要求。发布前必须完成本计划中所有 `P0` 和 `P1` 项，并通过第 8 节的发布门禁。

本计划优先保护已有世界、实例目录、数据库和密钥。发生不确定状态时，策略应为“保留数据并报告待处理项”，而不是自动删除目录来追求整洁。

### 1.1 目标

- 防止重复面板、并发操作、崩溃恢复和普通停止导致世界或实例目录损坏。
- 使 Java 探测、数据目录、PanelManager 和发布流水线符合最小权限与可验证发布原则。
- 让文件下载、空实例创建、任务状态和移动端交互形成可用的完整用户链路。
- 为所有高风险路径补充可重复执行的自动化测试和最终包人工验收证据。
- 在不引入远程 Agent、整机目录浏览或任意 Java 可执行路径的前提下完成 Beta。

### 1.2 非目标

- 不在本轮实现远程节点执行协议、自动备份/恢复、角色权限、2FA 或通用数据库迁移框架。
- 不改变实例唯一目录 `DATA_DIR/instances/<id>`、本机节点优先和 Java 运行时只能按注册 ID 引用的既有安全边界。
- 不为了兼容已损坏或来源不明的实例目录而放松 ownership marker、路径或 symlink/junction 校验。

### 1.3 实施原则

1. 每个阶段先添加失败测试，再修改实现；测试必须使用独立临时数据目录，不能触碰真实 `data/`。
2. 文件系统和 SQLite 无法组成跨介质事务时，优先采用 staging、原子移动、显式状态和保守恢复。
3. 所有新增 API 字段先进入 `packages/shared` 类型和 schema，再接入服务端、前端、文档和测试。
4. 不把安全自检、TypeScript 通过或构建成功当作行为正确性的替代证据。
5. 每个提交只解决一个可验收主题；不得混入 `.env`、数据库、构建产物、浏览器快照或用户无关修改。

## 2. 问题清单与优先级

| ID | 优先级 | 问题 | 主要位置 | 发布条件 |
|---|---|---|---|---|
| R0-01 | P0 | 第二个面板在端口绑定失败前可恢复并删除第一个面板的活动任务实例 | `index.ts`、`task-service.ts` | 同一数据目录只能有一个服务进程进入数据库和任务恢复逻辑 |
| R0-02 | P0 | 同一实例的并发启动可产生失管 Java 进程 | `process-manager.ts` | 启动、停止、重启、删除互斥，任何时刻至多一个受管进程 |
| R0-03 | P0 | 普通停止超时后隐式 `SIGKILL`，与 UI 的危险操作语义冲突 | `process-manager.ts`、实例页面 | 普通停止永不隐式强杀；强杀必须显式确认 |
| R0-04 | P0 | 任务已完成文件写入但尚未标记 completed 时崩溃，恢复会删掉完整实例 | `task-service.ts`、部署/导入服务 | 恢复仅清理可证明是 staging 的半成品，绝不删最终实例 |
| R0-05 | P0 | 重命名可覆盖已有目标文件 | `file-service.ts` | 服务端无覆盖语义，冲突返回可识别错误 |
| R0-06 | P0 | 下载票据服务文件尚未受 Git 跟踪 | `files.ts`、`download-ticket-service.ts` | 干净 checkout 可构建、测试和打包 |
| R1-01 | P1 | PATH Java 探测继承面板密钥环境 | `java-detect.ts` | 所有第三方 Java 子进程使用脱敏环境 |
| R1-02 | P1 | 源码运行及已有宽权限数据目录可能向其他本机账户泄露数据库和世界文件 | `db.ts`、`config.ts` | Unix 权限受控并校验；Windows ACL 边界有明确处理 |
| R1-03 | P1 | PanelManager 可向伪造的本机健康接口发送 `LAUNCHER_TOKEN` | `panel-manager.ps1` | 发送令牌前验证 PID、指纹和健康响应三者一致 |
| R1-04 | P1 | 发布工作流使用可变 Actions 标签，且缺少可验证签名身份 | `portable-release.yml`、发布文档 | Actions 固定 SHA；公钥、指纹和签名者校验完整 |
| R1-05 | P1 | Windows 发布 job 未实际执行 PanelManager 测试 | 发布工作流 | Windows runner 执行 Windows 专属测试 |
| R1-06 | P1 | 下载 GET 阶段的容量/开流失败无法反馈到 SPA，ticket 契约也未共用 schema | 文件路由、`api.ts` | 用户能看到失败；共享契约、路由与前端受测试约束 |
| R2-01 | P2 | 保存 `server.properties` 会丢弃合法 properties 语义和注释，写入不可原子恢复 | `config-service.ts` | 保留行结构并原子写入 |
| R2-02 | P2 | 打开交接目录列表时可同步递归扫描超大 ModLoader 目录并阻塞事件循环 | 导入服务、启动目标探测 | 列表探测有异步、深度、数量和时间边界 |
| R2-03 | P2 | “最新” Paper/Fabric 部署可复用旧缓存 | `core-depot.ts` | 缓存键基于实际解析出的不可变版本 |
| R2-04 | P2 | Web 没有创建空实例入口，独立 `server.jar` 无法形成上传闭环 | 总览页、实例 API | 用户可在界面创建受管空实例并上传 Jar |
| R2-05 | P2 | 部署控件缺少可访问名称，移动抽屉未管理焦点 | 部署页、选择器、`App.tsx` | 键盘和读屏可完成部署、设置与移动导航 |
| R2-06 | P2 | 任务中心轮询失败后可能静默显示旧任务状态 | `task-center-store.ts`、任务中心 | 任何轮询失联都明确标注状态可能过期 |
| R2-07 | P2 | `MMD_HOME` 包装脚本与文档不一致，变更日志存在重复和过时描述 | wrapper、文档 | 行为、文档和发布说明一致 |

## 3. 阶段 0：冻结基线与建立测试骨架

本阶段不改变用户可见功能，只建立可安全实施后续修复的基线。

### 3.1 整理待发布源码

1. 将 `apps/server/src/services/download-ticket-service.ts` 纳入目标提交，确认导入路径与编译产物一致。
2. 从干净临时 checkout 执行 `npm ci`、`npm run verify`、Windows/Linux 对应打包命令；不能只在含未跟踪文件的工作树中验证。
3. 不提交 `.env`、`data/`、`release/`、`dist/`、`.playwright-mcp/` 或机器专用临时目录。
4. 仅在所有修复提交完成、合入 `main` 且版本号匹配后创建 `v<version>` 标签；当前 `dev` 工作树不是发布输入。

**验收标准**

- `git ls-files --error-unmatch apps/server/src/services/download-ticket-service.ts` 成功。
- 新 clone 中不依赖本机未跟踪文件即可完成 `npm ci && npm run verify`。
- 发布候选提交的 `git status --short` 为空。

### 3.2 拆分高风险测试

现有 `security-self-test.ts` 覆盖面广，但无法清晰定位并发、恢复和路由问题。将其保留为总回归，同时新增可单独执行的 Node `node:test` 用例。

| 测试组 | 建议位置 | 必测行为 |
|---|---|---|
| 数据目录锁 | `apps/server/src/services/data-lock.test.ts` | 双启动、陈旧锁、锁释放、监听失败后的释放 |
| 任务恢复 | `apps/server/src/services/task-service.test.ts` | staging 清理、完成实例保留、旧库升级、恢复幂等 |
| 进程生命周期 | `apps/server/src/services/process-manager.test.ts` | 并发 start、重复 stop、正常退出、停止超时、强杀、restart |
| 文件安全 | `apps/server/src/services/file-service.test.ts` | 重命名冲突、根目录/marker 保护、文件和目录语义 |
| 下载路由 | `apps/server/src/routes/files.test.ts` | ticket、重放、过期、无 JWT GET、容量归还、响应头、错误状态 |
| Java 子进程 | `apps/server/src/services/java-detect.test.ts` | 环境脱敏、超时、不可用 Java |
| Web 交互 | `apps/web/src/**/*.test.tsx` | 表单关联、下载错误、任务失联、抽屉焦点、空实例创建 |

Web 测试可引入仅开发期使用的 Vitest、React Testing Library 和浏览器端到端工具。新增依赖前必须运行生产依赖审计，确保它们不进入便携包生产依赖。

**验收标准**

- 每个 R0/R1 项至少有一个失败回归用例和一个成功路径用例。
- 自动测试使用随机临时数据根、随机端口和受控 fake child process；并行运行时互不影响。
- 测试脚本加入根 `verify` 前，先单独在 Windows 和 Linux CI 中证明稳定。

## 4. 阶段 1：数据完整性与进程生命周期

本阶段必须先完成，完成前不得开始公开 Beta。

### 4.1 R0-01：数据目录生命周期锁

**设计**

1. 新增 `data-lock-service.ts`，在数据根中以原子目录创建方式取得面板生命周期锁，例如 `DATA_DIR/.mmd-panel-lock/owner.json`。
2. `owner.json` 记录 PID、创建时间、随机进程指纹和产品版本；目录本身的存在才是锁，不以 JSON 内容作为锁定依据。
3. 在 `buildApp()` 调用 `initDb()` 和 `recoverInterruptedTasks()` 之前取得锁。所有正式服务启动入口都必须经过该路径。
4. 正常 `app.close()`、监听失败和初始化异常都必须在 `finally` 中释放自己持有的锁。
5. 遇到已有锁时，先验证记录 PID 是否仍存活。PID 存活或信息无法可靠确认时，拒绝启动且不读写数据库、不恢复任务、不发送关闭令牌。
6. 只有 PID 明确不存在时，才能用原子改名将旧锁移入唯一 quarantine 名称，再取得新锁。竞争者只能有一个改名成功者；不得直接无条件删除旧锁。
7. 锁恢复失败必须给出可操作的中文错误，说明数据目录、记录 PID 和人工检查步骤；不得自动删除真实实例目录。

**影响范围**

- `apps/server/src/index.ts`、`db.ts`、任务恢复入口、PanelManager、`mmdctl` 和启动测试。
- 不改变实例目录布局，也不向 HTTP API 暴露锁文件路径。

**验收标准**

- 主进程运行部署/导入时，以相同 `DATA_DIR` 和相同或不同端口启动第二个服务，第二个服务在任何数据库写入前退出。
- 主任务、`tasks` 行、实例目录和 ownership marker 在第二次启动后保持不变。
- 主进程正常关闭后，下一次启动可取得锁；模拟陈旧锁时仅在原 PID 不存在后可恢复。

### 4.2 R0-04：任务 staging 与保守恢复

**设计**

1. 不再把 `TaskInfo.result.instanceId` 同时当作“待清理半成品”和“已完成结果”。为任务引入明确的持久化阶段，例如 `staging`、`finalizing`、`completed`、`failed`，并把 staging 资源单独记录。
2. 部署、ZIP 导入和已有目录复制都先写入任务专属的同卷 staging 目录，例如 `DATA_DIR/.mmd-staging/<taskId>/<instanceId>`。staging marker 必须包含 task ID、实例 ID 和随机 token。
3. 只有下载、解压/复制、启动目标探测、EULA 和元数据验证全部成功后，才将 staging 目录原子移动到 `instances/<id>`，并写入最终 ownership marker。
4. 最终目录移动和 SQLite 中“实例可见 + 任务 completed + result.instanceId”的更新必须以最小窗口完成。文件系统与 SQLite 不能原子提交时，宁可留下可识别的最终孤儿目录，也不能在启动恢复时递归删除它。
5. 启动恢复只删除同时满足“位于 `.mmd-staging`、marker 完整匹配任务记录、任务未完成”的目录。旧版 `pending/running` 任务一律标记失败，但不再仅因 `result_json.instanceId` 调用 `deleteInstance()`。
6. 对历史半成品和最终孤儿目录提供只读诊断信息及显式管理员恢复/清理流程；任何清理必须显示目录、marker、任务 ID，并要求确认。
7. 新增任务字段时编写一次性、幂等、事务化兼容迁移，并在旧 `panel.db` 副本上演练升级和失败恢复。

**影响范围**

- `task-service.ts`、`db.ts`、`core-depot.ts`、`import-service.ts`、`existing-server-import-service.ts`、`instance-service.ts`、任务 API、任务中心和文档。
- 此项应在实现时新增架构决策记录，说明 staging 与“保留优先”的崩溃恢复模型；不得现在就把未来方案写成已实现事实。

**验收标准**

- 在每个阶段注入崩溃：创建 staging 后、文件完成后、移动最终目录后、任务 completed 前。
- 重启后，staging 半成品被安全清理；最终目录和世界文件绝不被自动删除。
- 每个部署、ZIP 导入和已有目录交接都从 `pending/running` 正确进入终态，任务中心显示明确结果。
- 旧数据库升级后，历史任务可读、实例记录不丢失、迁移可重复执行。

### 4.3 R0-02 与 R0-03：实例操作串行化与停止语义

**设计**

1. 为每个实例建立操作互斥器，覆盖 start、stop、restart、delete、adopt，以及会影响启动参数的更新。锁必须在第一个异步 `await` 前取得。
2. start 在验证 Java 运行时前就写入内部 `starting` 保留状态；spawn 失败时在同一 `finally` 中释放保留状态。任何并发 start 看到 `starting` 都返回稳定的冲突错误。
3. 子进程的 `error` 和 `exit` 回调只能处理其创建时的 `ManagedProcess` 对象。旧 child 的退出不得 archive 或删除新 child 的 Map 条目。
4. 普通 stop 只发送 `stop\n` 并等待退出。超过新的、文档化的宽限期后返回“仍在停止中”的可识别结果，不发送 `SIGKILL`。
5. force stop 是唯一可以强制结束的路径，必须由 `force=1` 和 UI 二次确认共同触发。接口等待 exit 或返回仍在终止中的状态，避免后续 delete/restart 错认进程已退出。
6. restart 调用普通 stop 后只有在确认旧 child 已退出时才 start；超时则保留停止状态并提示用户显式选择强制停止，绝不自动升级为强杀。
7. 面板关闭沿用普通 stop 语义。若实例未在宽限期内退出，面板记录并报告未完成关闭，而不是悄悄杀死世界进程。

**HTTP 与 UI 约定**

- 定义共享的实例操作冲突和停止超时响应类型；建议使用 `409` 表示正在启动/停止，使用 `202` 或明确状态对象表示异步停止仍在进行。
- 总览与详情根据服务端状态禁用不可能的操作：运行中不能 start，已停止不能 stop，`starting/stopping` 时禁止 start/restart/delete。
- 普通停止超时显示“服务仍在保存，请等待或选择强制停止”，仅在用户点击后打开现有危险确认弹窗。

**验收标准**

- 同时发送两个 start 请求，只调用一次 spawner，且只有一个受管 child。
- 旧 child 在新 child 已存在后退出，不影响新 child 状态、控制台或 Map。
- 模拟超过宽限期的正常停止，断言没有 `SIGKILL`；模拟明确 force stop，断言才会强杀。
- restart 在 stop 未完成时不 spawn 新进程；进程退出后正常重启。
- 删除、接管和设置更新无法与生命周期操作交叉执行。

### 4.4 R0-05：无覆盖重命名

**设计**

1. 服务端强制源和目标在同一逻辑目录，避免 API 与“同目录重命名”界面承诺不一致。
2. 在同一实例的文件变更锁内检查源是允许的普通文件或目录、目标不是 ownership marker、目标不存在。
3. 使用不会替换既有目标的实现；若目标平台无法提供原子 no-replace 操作，应采用目标预留和可恢复移动方案，而不是退回 `renameSync()` 覆盖语义。
4. 目标存在时返回 `409` 和固定中文错误；前端在弹窗中显示冲突并保留用户输入。
5. 所有错误分支都保持源和已有目标不变。

**验收标准**

- 文件对文件、目录对目录、文件对目录和目录对文件的重名均返回冲突，两个原有对象内容不变。
- 并发 rename 请求只有一个成功；路径逃逸、根目录和 marker 仍被拒绝。
- UI 在冲突后不关闭弹窗、不清空新名称。

## 5. 阶段 2：安全边界与下载可靠性

### 5.1 R1-01：统一第三方子进程环境

1. 让 `detectJava()`、`verifyJavaExecutable()`、`mmdctl` 的 PATH Java 检查和所有 installer/Minecraft spawn 复用同一个最小环境构造器。
2. 白名单只保留启动 Java 所需的 PATH、JAVA_HOME、系统目录、临时目录、locale 和必要用户目录；绝不继承 `JWT_SECRET`、`SETUP_TOKEN`、`LAUNCHER_TOKEN`、`DATA_DIR`、`MMD_*` 或其他面板配置。
3. 将 `execFile` 包装为可注入 runner，测试中断言每个敏感变量均为 `undefined`。
4. 保持默认 PATH Java 的产品能力，但在文档中说明 PATH 必须由运行面板的账户控制。

**验收标准**

- 所有 Java 探测和启动测试均断言敏感环境变量未传入子进程。
- 真实 PATH Java、已注册运行时、无 Java 和超时错误仍有明确反馈。

### 5.2 R1-02：数据目录权限

1. 新建数据根、`instances`、`uploads`、`cache`、`imports`、staging、锁目录和数据库时，在 Unix 使用目录 `0700`、敏感文件 `0600`。
2. 启动时检查已有 Unix 路径的所有者与权限；发现 group/other 可读写时拒绝启动或在用户明确允许的修复流程中收紧权限，不能静默扩大权限。
3. Windows 由 `mmdctl` 和 PanelManager 明确创建仅当前用户可访问的运行目录；若无法可靠验证 ACL，至少发出阻断级警告并在发布文档中说明支持边界。
4. 对 SQLite 的 `panel.db`、WAL、SHM、日志、配置备份和临时上传文件分别检查，不能只处理顶层目录。

**验收标准**

- Linux CI 或容器测试断言创建后 mode 符合要求，并拒绝不安全的既有权限。
- Windows 手工验证新便携目录的 ACL，确认普通其他本机账户不能读取配置、数据库和实例目录。

### 5.3 R1-06：下载 ticket 的完整协议

**设计**

1. 在 `packages/shared/src/index.ts` 和 `schemas.ts` 定义并导出 ticket 创建、状态和错误响应的类型/schema；路由和 `apps/web/src/api.ts` 必须直接复用。
2. `POST /download-ticket` 在签发时验证文件并预留一个下载容量槽。ticket 到期、取消、开流失败或最终传输结束必须恰好释放一次预留。
3. ticket 记录短生命周期状态，例如 `reserved`、`streaming`、`failed`、`expired`。状态查询要求原用户 Bearer JWT，不能把 ticket 状态公开给未认证请求。
4. 前端在用户点击时同步打开受控空白下载窗口，避免等待异步 ticket 后被浏览器拦截；随后导航至流式 GET。
5. 当前页通过认证状态查询确认传输已开始或失败。失败时显示中文错误并关闭/保留空白下载窗口；整个过程不得使用 `res.blob()`、`arrayBuffer()` 或将文件主体载入内存。
6. 带 ticket 的 GET 保持无 Authorization 的浏览器导航能力，继续使用 `Content-Disposition`，并测试重放、实例/路径不匹配和并发容量。

**验收标准**

- POST 容量已满时当前页立即得到 `429`；GET 开流失败时当前页得到失败状态。
- 一次性 ticket 不能重放，过期和错误路径不泄露文件存在性。
- 大文件下载仍从服务端 stream 到浏览器；内存使用不随文件总大小线性增长。
- Fastify 注入测试覆盖路由，浏览器端到端测试覆盖真实新窗口、错误反馈和弹窗策略。

### 5.4 R1-03：PanelManager 的受管进程证明

1. 让 Windows PanelManager 使用与 `mmdctl` 相同的随机进程指纹、PID、启动时间和状态文件格式。
2. 启动时向 Node 进程传入随机 `MMD_PROCESS_FINGERPRINT`；健康接口返回该值。
3. stop、restart、rebuild 前必须同时验证：状态文件 PID 存活、健康接口的 `service` 正确、健康接口指纹匹配状态文件。任一失败都不得发送 `LAUNCHER_TOKEN`。
4. 状态缺失、端口被未知服务占用或 PID 不匹配时只报告错误和日志位置，不尝试接管、杀死或认证未知进程。
5. 在 Windows runner 中模拟伪造健康服务，断言请求中永远没有 launcher token。

## 6. 阶段 3：功能可靠性、可访问性与性能

### 6.1 R2-01：保留式 `server.properties` 编辑

1. 将当前 `Record<string, string>` 解析替换为保留行顺序、注释、空行、分隔符、续行、转义和重复键的 properties 文档模型。
2. 引导表单只修改对应 key 的最后一个有效定义；未收录项保留原始文本或在高级模式中明确编辑，不重建整份文件。
3. 保存采用同目录临时文件、`fsync`、原子替换和失败保留原文件的流程。平台不支持直接替换时使用经过测试的备份/恢复步骤。
4. 保存前后均遵守文本大小、普通文件和 symlink/junction 校验。

**验收标准**

- 含注释、`:`、空白分隔符、续行、转义、重复键和尾随空白的 fixture 保存后，除用户修改 key 外字节语义不变。
- 模拟写入或替换失败时，旧文件仍完整可读。
- 文档删除“与直接编辑完全等价”等无法保证的表述，改为准确说明保留规则。

### 6.2 R2-02：有界已有服务端探测

1. 将 `findModLoaderArgsFile()` 改为支持 `AbortSignal`、最大深度、最大条目数和截止时间的异步扫描。
2. `GET /api/import/sources` 只做轻量、受限的启动目标预检；完整递归校验只在后台导入任务中执行，并复用现有条目/字节配额。
3. 超限、超时、symlink/junction 和特殊文件都返回“不可用于交接”的明确状态，不阻塞整个 Fastify 事件循环。
4. 如需缓存预检结果，缓存必须有目录 mtime 失效策略，且不替代导入时的再次校验。

**验收标准**

- 人工创建或测试夹具模拟大规模 `libraries/` 树时，来源列表请求在预算内返回，健康接口仍可响应。
- 完整导入仍能识别合法 Forge/NeoForge args 文件，并拒绝超限目录。

### 6.3 R2-03：核心缓存使用解析后的版本

1. 先解析 Paper build 或 Fabric loader/installer，再生成缓存键。
2. 缓存键包含核心类型、MC 版本、实际 build/loader/installer 版本，以及可用时的不可变下载标识或校验和。
3. 旧 `latest` 缓存不能再被新代码当作最新版本；可保留为未引用的历史缓存，由显式维护命令清理。
4. 为并发下载合并、缓存命中和上游版本变化增加 mock 网络测试。

### 6.4 R2-04 至 R2-06：Web 完整链路和可访问性

1. 在总览增加“创建空实例/上传自定义 Jar”入口，调用既有 `POST /api/instances`，创建成功后跳转文件页；名称、EULA、JVM 参数和 Java 运行时沿用共享 schema。
2. 为部署、设置和文件表单补齐唯一 `id`、`htmlFor` 或包裹式 label。`LazyScrollSelect` 接收可访问名称，并实现 Arrow、Home、End、Enter、Escape、焦点回归和选中状态。
3. 移动抽屉打开时把焦点放到第一个导航项，关闭时回到菜单按钮；背景必须不可交互，焦点不能逃到主题、任务中心或主内容。
4. 任务中心无论是否已有缓存任务，在轮询失败时都显示“状态可能已过期”、最后成功时间和重试入口。
5. 部署/导入的异步元数据请求使用 AbortController 或请求序号，防止切换核心类型后旧响应覆盖新状态。
6. 所有实例操作按钮根据服务端状态禁用；不能把可预测的 `409` 当作常规用户交互。

**验收标准**

- 仅用键盘可创建空实例、部署、选择版本、打开/关闭抽屉、保存设置和下载文件。
- 读屏快照可识别每个关键控件的名称、状态和错误。
- 390px、768px、1024px、1440px 下验证抽屉、表格卡片化、弹窗、控制台和任务中心。
- 后端网络失败、429、401、任务失败和下载失败均有当前页可见反馈。

### 6.5 R2-07：文档与运行行为同步

1. Windows `.cmd` 和 Unix `.sh` wrapper 要么尊重已有 `MMD_HOME`，要么删除“可覆盖应用根目录”的文档承诺；推荐两端都尊重用户显式设置。
2. 快速开始只列出当前公开产物 Windows x64 和 Linux x64；macOS 仅说明本地组装状态，不暗示可下载。
3. 合并重复 changelog 条目，移除“强杀/下载/重命名仅后端存在”等过时文字。
4. 每个已实现阶段更新 `current-state.md`、`decisions.md`、API、用户指南、配置、发布说明和 `project-facts.json`，并运行知识库检查。

## 7. 阶段 4：可信发布流水线

### 7.1 Git 与构建可复现性

1. `package-portable.mjs` 优先使用 checkout 的 `git rev-parse HEAD` 写入 manifest，而不是 workflow dispatch 的 `GITHUB_SHA`。
2. 打包前断言工作树干净，并在 CI 中从 tag checkout 执行；本地临时验证可允许显式开发开关，但不能生成可发布资产。
3. Windows 和 Linux build job 都从同一经过 prepare 校验的 tag commit 组装，并输出 commit SHA、Node 运行时版本和文件 manifest。

### 7.2 Actions 与签名

1. 将所有第三方 GitHub Actions 固定为完整 commit SHA，并记录更新来源和审查日期；使用 Dependabot 或受控流程更新 SHA。
2. release job 导入私钥后，要求实际 signing key 指纹等于受保护配置中的 `RELEASE_GPG_FINGERPRINT`，并使用该 fingerprint 显式签名。
3. 在仓库和 Release 资产中发布 ASCII armored 公钥与固定指纹。文档给出获取、导入、fingerprint 比对和 `gpg --verify` 的完整步骤。
4. 签名后在独立 keyring 中用发布公钥验证 `SHA256SUMS.asc`，再执行 `gh release create`。
5. GitHub `release` Environment 必须要求人工审批并限制可访问该 Environment 的分支；此项通过仓库设置截图或管理员记录验证。
6. **Free 套餐限制（2026-08-07 实测）**：required_reviewers 与 wait_timer 保护规则在 GitHub Free 均被 API 拒绝（HTTP 422）。当前以工作流内置门禁替代（tag 必须为 `origin/main` 祖先、与 `package.json` 版本一致、工作树干净、`verify` 与 `audit:production` 通过），并建议对 `v*` 标签启用仓库 Ruleset 权限控制；升级 Pro/Team 后可再启用人工审批。

### 7.3 平台测试

1. 在 Windows matrix job 中显式运行 `npm run windows:test`，不得依赖 Ubuntu 上被 skip 的测试。
2. Windows 和 Linux 各自执行最终压缩包解压、包内 Node 首启、setup、登录、status、stop、升级数据复用的 smoke。
3. 增加 PanelManager 伪健康服务、指纹不匹配、端口被占用、safe stop、restart 和日志路径测试。
4. 发布前实时运行 `npm audit --omit=dev --json`。high/critical 必须为零；moderate/low 必须逐项记录影响、缓解措施、负责人与复审日期。

## 8. 验证矩阵与发布门禁

### 8.1 自动验证

实施完成后，根 `verify` 至少应覆盖以下内容；新增测试脚本必须接入 CI。

| 类别 | 自动验证 | 人工/端到端验证 |
|---|---|---|
| 数据锁与任务恢复 | 双进程、陈旧锁、staging 崩溃点、旧库迁移 | 用副本模拟崩溃和重启，确认最终世界保留 |
| 进程生命周期 | 并发 start/stop/restart、超时、exit 乱序、force | 真 Java 服务端的保存、停止、强杀和重启 |
| 文件与配置 | rename 冲突、properties fixtures、原子写失败、ticket 路由 | 文件读写、下载、取消、大文件和配置重启生效 |
| Java 与权限 | 子进程环境、运行时复验、Unix mode | PATH Java、失效运行时、Windows ACL |
| Web | 单元/组件测试、可访问名称、焦点与错误状态 | 键盘、读屏、390px 至 1920px、真实浏览器下载 |
| 发布 | clean checkout、verify、audit、package、smoke | Windows x64 与 Linux x64 最终资产、签名验证、升级 |

推荐执行顺序：

```powershell
npm.cmd run knowledge:check
npm.cmd run knowledge:test
npm.cmd run typecheck
npm.cmd run test:security -w @mmd/server
npm.cmd run build
npm.cmd run verify
npm.cmd run audit:production
```

新增的服务端与 Web 测试脚本完成后，必须在 `npm.cmd run verify` 中执行。Windows 和 Linux CI 还必须分别运行其平台专属用例。

### 8.2 发布前人工清单

- [ ] 从空数据目录完成 setup、登录、未认证 401、退出和 token 过期跳转。
- [ ] 创建空实例并上传自定义 Jar；分别部署 Vanilla、Paper、Fabric、Forge、NeoForge。
- [ ] 导入 ZIP 和已有目录，观察任务从 pending/running 到 completed/failed。
- [ ] 用真实 Minecraft 服务器验证普通停止等待保存、停止超时提示、显式强制停止和 restart。
- [ ] 验证文件列表、文本读写、重命名冲突、流式大文件下载、容量耗尽和错误反馈。
- [ ] 验证 `server.properties` 注释/高级键保存、Java 探测/绑定/失效和版本告警。
- [ ] 验证桌面、390px、768px、1024px 下的键盘焦点、抽屉、对话框和任务中心失联状态。
- [ ] 分别从 Windows x64 与 Linux x64 最终 Release 压缩包完成首启、setup、stop、升级数据复用和签名校验。

### 8.3 Beta 发布准入条件

只有同时满足以下条件才允许创建公开 Beta 标签：

1. R0 与 R1 全部关闭，R2 仅允许有明确记录且不涉及数据丢失、权限扩大或无反馈的关键路径。
2. 干净 tag checkout 的 `npm run verify` 和 `npm run audit:production` 通过。
3. Windows x64、Linux x64 的 CI 原生打包和最终包 smoke 均通过。
4. 签名公钥、指纹、SBOM、SHA256SUMS 和签名验证记录均可供外部用户取得。
5. `main` 受保护分支上的 tag 与根 `package.json` 版本一致，工作树无未跟踪实现文件。
6. 发布说明列出已知限制、审计残余风险、数据目录权限边界和不支持的平台。

## 9. 数据迁移、回滚与事故处理

### 9.1 数据库与目录迁移

- 在改变 `tasks` 表前，复制 `panel.db`、`panel.db-wal`、`panel.db-shm`，并在副本上演练升级。
- 每个 `ALTER TABLE` 或新表创建必须可重复执行；SQL 迁移失败时不得半写实例状态。
- 新版本不得自动删除旧任务关联的实例目录。检测到旧 pending/running 记录时标记失败并提供诊断，而不是猜测其是否完整。
- staging 和最终目录 marker 必须有版本、实例 ID、任务 ID 和随机 token，升级代码必须能区分旧 marker 与新 marker。

### 9.2 文件与配置回滚

- properties 保存的临时文件和备份只允许位于同一实例根目录内，遵守现有路径检查与大小限制。
- 任何原子替换失败都保留原文件；恢复路径本身也要测试磁盘满、文件锁和进程中断。
- 发布升级前继续要求用户备份 `config/`、`data/`、`logs/`，并在发布说明中明确数据库兼容范围。

### 9.3 发布回滚

- Release 资产一旦发现 P0/P1 问题，立即标记为不可用或撤回，并发布固定版本说明；不得悄悄替换同名资产。
- 回滚只回退应用代码，不自动回退或删除用户数据库/实例目录。若 schema 已前进，提供经演练的兼容启动或明确恢复步骤。
- 保留失败 CI、签名和 smoke 日志，作为下一次发布前复盘证据。

## 10. 推荐提交顺序

| 批次 | 内容 | 前置条件 | 完成证据 |
|---|---|---|---|
| A | 纳入未跟踪下载服务、测试骨架、干净 checkout 门禁 | 无 | clean checkout build/test |
| B | 数据目录锁、任务 staging/恢复、数据库兼容迁移 | A | 崩溃与双启动测试 |
| C | 实例生命周期互斥、停止语义、无覆盖重命名 | B | fake child 并发测试和真实停服验证 |
| D | Java 脱敏、目录权限、下载协议、PanelManager 指纹 | B | 安全/路由/Windows 测试 |
| E | properties、导入扫描、缓存、Web 功能与可访问性 | C、D | Web 与人工交互验证 |
| F | Actions 固定、签名链、Windows CI、文档同步 | A 至 E | 双平台 CI 与独立签名验证 |
| G | Release candidate 演练 | F | 第 8 节全部准入条件 |

每个批次合并前都要检查共享契约、服务端实现、前端调用、可见入口、文档和验证证据。任何发现与本计划假设冲突的源码事实时，先更新本计划和相关架构决策，再扩大改动范围。
