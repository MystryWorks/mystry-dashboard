# API 参考

除下列公开接口外，其余 `/api/*` 路由均需 JWT：

```http
Authorization: Bearer <token>
```

错误响应通常为 JSON：`{ "error": "说明" }`。

## 总览性能监测

`GET /api/system/metrics` 需要 JWT，返回共享类型 `DashboardMetrics`：

- `sampledAt`：采样时间；`cpuPercent`：整机 CPU 使用率，首次采样为 `null`。
- `memory`：主机 `usedBytes` / `totalBytes`；`disk`：数据根所在磁盘的 `availableBytes` / `totalBytes`，读取失败为 `null`。
- `instances`：以实例 ID 为键，包含 `cpuPercent`、`memoryBytes` 与 `state`（`ready` / `collecting` / `unavailable`）。仅采集面板持有的活进程，调用方不能指定 PID 或路径。
- `warnings`：CPU 或内存连续采样至少 30 秒达到 90% 时提示；磁盘可用空间低于 5 GiB 或 10% 时提示。

CPU 按整机逻辑核总容量归一至 0–100%；进程内存是驻留内存，与 JVM 堆内存上限 Xmx 不同。Windows 使用累计 CPU 时间和 WorkingSet，Linux 使用 `/proc` 与系统时钟频率；其他平台的进程指标暂不可用。空值不表示零占用。快照缓存 4 秒，并发请求合并；无历史存储，页面每 5 秒刷新、隐藏时暂停。采样间隔超过 15 秒会重新累计持续告警时间。

## 健康检查

| 方法 | 路径 | 认证 | 响应 |
|------|------|------|------|
| GET | `/api/health` | 否 | `{ ok: true, service: "minecraft-mystery-dashboard", processFingerprint?: string }` |

`processFingerprint` 仅在便携控制器启动服务时出现。它用于让 `mmdctl` 将状态文件、PID 与实际监听服务对应起来，不是认证密钥，也不能替代 `X-Launcher-Token`。

## 认证 `/api/auth`

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/api/auth/status` | 否 | `{ needsSetup: boolean }` |
| POST | `/api/auth/setup` | `X-Setup-Token` | 仅用户表为空时可用；Body：`{ username, password }` → `{ token, user }` |
| POST | `/api/auth/login` | 否 | Body：`{ username, password }` → `{ token, user }` 或 401 |
| GET | `/api/auth/me` | 是 | `{ user }` |

### setup 请求

`setup` 不使用 JWT，而是要求环境变量 `SETUP_TOKEN` 的值放在 header 中：

```http
POST /api/auth/setup
Content-Type: application/json
X-Setup-Token: <SETUP_TOKEN>

{"username":"admin","password":"至少 12 位的强密码"}
```

`SETUP_TOKEN` 和 `JWT_SECRET` 都必须是 64 位十六进制字符串，且必须使用不同的值。用户创建成功后，setup 接口不再可用；此时可以从 `.env` 移除 `SETUP_TOKEN`。用户表为空且未配置 setup token 时，服务不会启动。

## 系统 `/api/system`

| 方法 | 路径 | 认证 | 响应 |
|------|------|------|------|
| GET | `/api/system/java` | 是 | Java 状态对象 |
| GET | `/api/system/java-runtimes` | 是 | `{ runtimes: JavaRuntimeInfo[] }` |

Java 状态响应准确结构为：

```json
{
  "available": true,
  "version": "21.0.3",
  "majorVersion": 21
}
```

找不到 Java 时返回 `{ "available": false, "version": null, "majorVersion": null }`。面板不提供全盘目录浏览接口。

`/api/system/java-runtimes` 返回面板探测并验证过的 Java 运行时注册表；带 `?refresh=1` 请求重新扫描。并发扫描会合并为一个任务，连续强制刷新受 30 秒冷却限制；普通读取默认使用 60 秒缓存。候选路径只来自 `JAVA_HOME` 和常见安装目录扫描，且必须文件名为 `java`/`java.exe`、`-version` 输出可解析出版本号才会入表。实例可通过 `javaRuntimeId` 绑定表内条目（创建、更新、部署请求均接受该可选字段；`null` 表示使用 PATH 中的 `java`），请求不能提交任意可执行路径。绑定运行时在启动或 Forge/NeoForge Installer 执行前会再次验证；最近一次扫描未发现的条目会以 `available: false` 返回。

`JavaRuntimeInfo` 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 运行时注册表 ID；请求仅可提交该值 |
| `path` | string | 面板扫描到的绝对 Java 可执行路径，仅对已认证用户返回 |
| `version` / `majorVersion` | string / number | 最近一次验证的完整版本与主版本号 |
| `source` | `env \| scan` | `JAVA_HOME` 或常见安装目录扫描 |
| `verifiedAt` | string | 最近一次成功验证时间 |
| `available` | boolean | 最近一次完整扫描是否仍发现并验证此条目 |

## 实例 `/api/instances`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/instances` | 实例列表 `InstanceInfo[]` |
| GET | `/api/instances/:id` | 单个实例 |
| POST | `/api/instances` | 创建空实例，Body 见 `CreateInstanceInput` |
| PATCH | `/api/instances/:id` | 更新 `UpdateInstanceInput` |
| POST | `/api/instances/:id/adopt-managed-directory` | 接管已复制到面板托管根目录的旧实例 |
| DELETE | `/api/instances/:id` | 删除实例记录及面板托管的实例目录；旧版外部目录不会被访问或删除 |
| POST | `/api/instances/:id/start` | 启动 |
| POST | `/api/instances/:id/stop` | 停止；`?force=1` 强杀 |
| POST | `/api/instances/:id/restart` | 重启 |
| POST | `/api/instances/:id/command` | Body：`{ command: string }`，发送控制台指令 |

实例目录固定为最终数据根目录的 `instances/<id>`。最终数据根优先取 `MMD_DATA_DIR`，否则取 `DATA_DIR`；创建、部署、导入和启动都不会接受另一个实例目录，`jarFile` 也只能表示实例根目录内的相对文件。

### 接管旧版实例

面板不会访问或删除旧版记录指向的外部目录，也不会自动搬迁。调用接管接口前，必须：

1. 停止实例和面板服务。
2. 使用操作系统工具将旧外部目录完整复制到 `DATA_DIR/instances/<id>`。
3. 启动面板，并以 JWT 调用：

```http
POST /api/instances/<id>/adopt-managed-directory
Authorization: Bearer <token>
```

接管成功后返回更新后的 `InstanceInfo`。实例正在运行、目标目录为空或目录不属于该实例时，接口会返回错误。接管或删除面板实例都不会触碰旧外部目录。

### `InstanceInfo` 字段摘要

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 实例 ID |
| `name` | string | 显示名称 |
| `coreType` | `vanilla \| paper \| fabric \| forge \| neoforge \| custom` | 核心类型 |
| `mcVersion` | string \| null | MC 版本 |
| `jarFile` | string | 相对实例根目录的 jar 名或启动参数文件 |
| `jvmArgs` | string | JVM 参数字符串 |
| `requiresMigration` | boolean | 是否需要按旧版外部实例流程完成接管 |
| `nodeId` | string | 执行节点 ID；本机为 `local` |
| `javaRuntimeId` | string \| null | 绑定的 Java 运行时 ID；`null` 使用 PATH 中的 `java` |
| `status` | `InstanceStatus` | 运行状态 |
| `acceptEula` | boolean | 是否写入 `eula=true` |
| `createdAt` / `updatedAt` | string | ISO 时间 |

`jvmArgs` 保存与启动前都会经过 `@mmd/shared` 的同一套校验：必须各有一个 `Xms` / `Xmx`，拒绝未闭合引号、重复或冲突 GC、`Xms > Xmx`，也拒绝 `-jar`、classpath、模块启动、`@argfile` 和 `nogui` 等由面板负责的启动参数。请求省略 `jvmArgs` 时，创建、部署和导入仍使用兼容默认值 `-Xms1G -Xmx2G`。旧实例文本不会仅因读取而被改写，但非法旧值必须先修正才能保存或启动。

## 文件与配置 `/api/instances/:id`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/files?path=` | 列出实例根目录内的目录 `FileEntry[]` |
| GET | `/files/content?path=` | 读文本 `{ path, content }` |
| PUT | `/files/content` | Body：`{ path, content }` |
| DELETE | `/files?path=` | 删除实例根目录内的文件或目录 |
| POST | `/files/mkdir` | Body：`{ path }` |
| POST | `/files/rename` | Body：`{ from, to }` |
| GET | `/files/download?path=` | 二进制流；可选 `ticket=` 一次性下载票据；响应含 `Content-Disposition: attachment` |
| POST | `/files/download-ticket` | Body：`{ path }`；签发并预占下载槽位 |
| GET | `/files/download-ticket/:ticket/status` | 查询所属下载票据的生命周期状态 |
| DELETE | `/files/download-ticket/:ticket` | 取消尚未开流的所属下载票据 |
| POST | `/files/upload?path=` | multipart 单文件 |
| GET | `/config/server.properties` | 键值对象 |
| PUT | `/config/server.properties` | Body：`Record<string, string>` |

所有 `path` 均为**相对于 `DATA_DIR/instances/<id>` 的逻辑路径**，服务端会校验并拒绝 `..` 逃逸；这些接口不能访问实例根目录以外的文件。下载仅允许普通文件；`Content-Disposition` 仅使用 basename（含 RFC 5987 `filename*`）。无 ticket 的下载使用 Bearer JWT；浏览器原生下载可先使用 Bearer JWT 调用 `POST .../download-ticket`，再以 `GET .../download?path=&ticket=` 触发流式下载（该 GET 不带 Authorization header）。

下载 ticket 的签发有效期由 `FILE_DOWNLOAD_TICKET_TTL_SECONDS` 控制，默认 60 秒。签发时状态为 `reserved` 并预占下载并发槽；原生 GET 校验 `instance` 与 `path` 后原子转为 `streaming`，签发有效期不会回收已开流的槽位。状态查询返回 `reserved`、`streaming`、`consumed`、`failed` 或 `expired`：成功传输为 `consumed`，读流错误、连接中止、下载空闲超时及取消为 `failed`，未开流而签发期到期为 `expired`。`expired`、`consumed` 和 `failed` 都按所属用户保留 60 秒短时 tombstone，供状态查询返回终态；超过该期限或无权查询时返回 404。

已认证的 `DELETE .../download-ticket/:ticket` 仅在 ticket、当前用户和 URL 中的实例 ID 三者都匹配，且 ticket 仍为 `reserved` 时取消并立即释放预占槽位，返回 **204**。已进入 `streaming` 时不改变流或槽位，返回 **409**；票据不存在、所属用户或实例不匹配时统一返回 **404**。

上传文件超过 `MAX_UPLOAD_BYTES` 时返回 **413**；上传并发容量已满时返回 **429**。HTTP 请求、连接和上传空闲超时分别由 `HTTP_REQUEST_TIMEOUT_MS`、`HTTP_CONNECTION_TIMEOUT_MS` 和 `UPLOAD_IDLE_TIMEOUT_MS` 控制。文件下载受 `MAX_CONCURRENT_FILE_DOWNLOADS` 限制，并发容量已满时返回 **429**；下载在 `FILE_DOWNLOAD_IDLE_TIMEOUT_MS` 内无数据活动会被关闭并释放下载并发资源。

## 核心部署与导入

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cores/:type/versions` | `type`: `vanilla \| paper \| fabric \| forge \| neoforge` |
| GET | `/api/cores/paper/:version/builds` | Paper build 列表 |
| GET | `/api/cores/fabric/:version/loaders` | Fabric loaders + installers |
| GET | `/api/cores/forge/:version/loaders` | Forge loader 列表 |
| GET | `/api/cores/neoforge/:version/loaders` | NeoForge loader 列表 |
| POST | `/api/cores/deploy` | Body：`DeployCoreInput`，返回 `TaskInfo` |
| GET | `/api/import/sources` | 列出 `DATA_DIR/imports` 的直接子目录及启动文件探测结果 |
| POST | `/api/import/existing` | Body：`ImportExistingServerInput`，复制交接目录并返回 `TaskInfo` |
| POST | `/api/import/previews` | multipart 上传单个 ZIP，验证中央目录并返回 `ImportPreviewInfo` |
| GET | `/api/import/previews/:id` | 恢复当前登录用户的待确认预览 |
| POST | `/api/import/previews/:id/confirm` | Body：`ConfirmZipImportInput`，确认配置并返回 `TaskInfo` |
| DELETE | `/api/import/previews/:id` | 取消预览并删除临时 ZIP |
| POST | `/api/import` | 兼容的一阶段 multipart 导入；字段同旧版，Web 不再使用 |
| GET | `/api/tasks/:id` | 查询任务进度 `TaskInfo` |
| GET | `/api/tasks` | 任务中心列表，按创建时间倒序返回最近 50 条 `{ tasks: TaskInfo[] }` |

部署和导入始终把内容写入新实例的 `DATA_DIR/instances/<id>`，不接收自定义目录或 Java 可执行文件路径。实例默认使用 PATH 中的 `java` 启动，可通过 `javaRuntimeId` 绑定注册表中当前可用的运行时；部署请求中的绑定同样用于 Forge/NeoForge Installer。

部署内部由 `core-metadata` 解析版本与地址，`core-download` 管理下载和缓存，`core-installer` 管理 Installer，`core-depot` 编排任务。相同缓存路径的并发任务共享一次下载；单个等待者取消不影响其他等待者，全部退出才中止未完成的下载并清理 part 文件。所有核心统一执行 staging 原子落地 → 注册实例 → 更新实例元数据的收尾顺序；目录落地后不再检查取消信号，必须继续注册，正常返回的 worker 仍记为成功。落地前失败只清理 staging，最终实例目录不参与该清理。

### 同机已有服务端交接

`GET /api/import/sources` 返回：

```json
{
  "sources": [
    {
      "id": "paper-survival",
      "launchTarget": "paper.jar",
      "coreType": "paper",
      "modifiedAt": "2026-08-02T10:00:00.000Z",
      "ready": true,
      "detectedJvmConfig": {
        "source": "user_jvm_args.txt",
        "raw": "-Xms1G\n-Xmx4G\n",
        "canonicalArgs": "-Xms1G -Xmx4G",
        "issues": []
      }
    }
  ]
}
```

`id` 只是 `DATA_DIR/imports` 下的单层目录名，不是系统路径。创建任务示例：

```json
{
  "name": "生存服",
  "sourceId": "paper-survival",
  "coreType": "paper",
  "mcVersion": "1.20.1",
  "jvmArgs": "-Xms2G -Xmx4G",
  "acceptEula": true,
  "javaRuntimeId": null
}
```

提交前应停止原服务器。任务会只读扫描交接源，拒绝路径逃逸、symlink/junction、特殊文件和 ownership marker，并按 `MAX_EXISTING_IMPORT_ENTRIES`、`MAX_EXISTING_IMPORT_BYTES`、`TASK_TIMEOUT_MS` 与目标磁盘空间执行复制。成功或失败都不会删除源目录；失败时会清理新建的半成品托管实例。

目录根部存在普通 `user_jvm_args.txt` 时，来源信息可包含 `detectedJvmConfig`。文件最大 64 KiB；不读取子目录文件，不跟随链接，也不解析或执行 `.bat` / `.sh`。检测到参数后，Web 要求用户明确选择沿用、面板推荐或自定义；解析失败时 `canonicalArgs` 为 `null`，不能沿用。

### ZIP 二阶段导入

第一步仅上传文件：

```http
POST /api/import/previews
Content-Type: multipart/form-data

file=<server.zip>
```

服务端流式写入受控临时目录，验证 ZIP 中央目录、条目配额、ZIP64、链接/特殊文件和重复 entry；只额外解压根目录或单一顶层目录中的 `user_jvm_args.txt`，且最多 64 KiB。成功响应：

```json
{
  "id": "不可猜测的随机预览 ID",
  "fileName": "server.zip",
  "sizeBytes": 10485760,
  "expiresAt": "2026-08-11T12:30:00.000Z",
  "detectedJvmConfig": {
    "source": "user_jvm_args.txt",
    "raw": "-Xms1G\n-Xmx4G\n",
    "canonicalArgs": "-Xms1G -Xmx4G",
    "issues": []
  }
}
```

第二步确认配置：

```json
{
  "name": "生存服",
  "coreType": "paper",
  "mcVersion": "1.21.1",
  "jvmArgs": "-Xms4G -Xmx4G -XX:+UseG1GC",
  "acceptEula": true,
  "javaRuntimeId": null
}
```

预览 ID 绑定登录用户：非所有者和不存在的 ID 返回 **404**，过期返回 **410**，正在确认或重复确认返回 **409**。每个用户最多一个预览，全局容量由 `MAX_IMPORT_PREVIEWS` 控制；新 ZIP 预检成功后才替换旧预览。只有后台任务成功入队才消费预览，任务队列满返回 **429** 且保留预览供重试。预览默认由 `IMPORT_PREVIEW_TTL_SECONDS=1800` 控制，取消、过期、面板关闭或重启都会删除临时 ZIP，不写入数据库也不跨重启恢复。

兼容接口 `POST /api/import` 仍接受旧 multipart 字段并直接创建任务，但会执行相同的服务端 JVM 校验；新 Web 流程只使用预览接口。

ZIP 预览与解压由 `zip-service` 统一处理条目文件头和数据范围校验，任务入队与实例落地由 `import-service` 负责。普通文件支持存储和 Deflate 压缩；不支持的压缩方式在打开文件流前拒绝，JVM 参数预览返回结构化诊断，实际导入失败并清理半成品。此内部拆分不改变请求、响应或预览生命周期。

核心版本、构建和 loader 元数据受 `MAX_CORE_METADATA_BYTES` 与 `CORE_METADATA_TIMEOUT_MS` 限制；核心文件下载先写入临时文件，完整完成后才原子发布到 `DATA_DIR/cache/cores/`，不复用未完成缓存。队列已满时创建任务返回 **429**。

### `TaskInfo` 状态

| status | 含义 |
|--------|------|
| `pending` | 排队 |
| `running` | 执行中 |
| `completed` | 成功，`result` 可能含 `instanceId` |
| `failed` | 失败，`error` 为原因 |

部署或导入提交成功后，即使暂时没有执行槽位，也会先返回 `pending` 任务。调用方和前端应继续查询 `/api/tasks/:id`，直到 `completed` 或 `failed`；任务开始执行后超过 `TASK_TIMEOUT_MS` 会失败。排队状态不是失败，也不应通过重复提交来“催促”任务。

## 控制台 WebSocket

先用 JWT 调用 `POST /api/instances/:id/console-ticket` 获取一次性 ticket：

```http
POST /api/instances/<id>/console-ticket
Authorization: Bearer <token>
```

然后连接：`ws://<host>:<port>/ws/console/:instanceId?ticket=<ticket>`。ticket 默认 60 秒有效且只能建立一次连接。

控制台 WebSocket 受以下限制保护：最多 `MAX_CONSOLE_CONNECTIONS=20` 个并发连接；单个入站消息最多 `MAX_CONSOLE_INCOMING_BYTES=4352` 字节；单条命令最多 `MAX_COMMAND_BYTES=4096` 字节；每个 `CONSOLE_COMMAND_WINDOW_MS=60000` 毫秒窗口最多 `MAX_CONSOLE_COMMANDS_PER_WINDOW=60` 条命令；写入实例 stdin 的待处理缓冲最多 `MAX_CONSOLE_STDIN_BYTES=65536` 字节。历史输出和单次输出块还分别受 `MAX_CONSOLE_BUFFER_BYTES`、`MAX_CONSOLE_CHUNK_BYTES` 限制。超过命令大小、速率、连接数或输入缓冲限制时，服务端不会继续向实例 stdin 写入。

### 服务端 → 客户端消息（JSON）

| type | 字段 | 说明 |
|------|------|------|
| `history` | `data`, `status?` | 连接时历史输出 |
| `output` | `data` | 新日志片段 |
| `status` | `status` | 状态变更 |
| `error` | `data` | 错误说明 |

### 客户端 → 服务端

```json
{ "type": "command", "data": "say hello" }
```

## PanelManager 本机关闭

`POST /api/launcher/shutdown` 只供仓库根目录的 PanelManager 调用，不使用登录 JWT。请求必须来自回环地址并携带：

```http
X-Launcher-Token: <LAUNCHER_TOKEN>
```

有效请求返回 **202**，响应包含 `accepted`、运行实例数、运行/排队任务数和是否已经处于关闭过程。令牌无效返回 401，非本机来源返回 403，当前启动方式未提供安全关闭回调时返回 503。该接口使用独立限流，并在响应发送完成后开始停止任务、Minecraft 实例、HTTP 服务和数据库。

## 节点 `/api/nodes`

阶段一仅保证本机节点 `local` 可用。远程节点创建由共享常量 `REMOTE_NODE_CREATION_ENABLED` 控制，当前为关闭。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/nodes` | 节点列表 `NodeInfo[]` |
| GET | `/api/nodes/:id` | 单个节点 |
| POST | `/api/nodes` | 创建远程节点（当前返回 **403**） |
| PATCH | `/api/nodes/:id` | 重命名 |
| DELETE | `/api/nodes/:id` | 删除远程节点（本机不可删；有实例时拒绝） |
| POST | `/api/nodes/:id/secret/reset` | 重置密钥（当前返回 **403**） |

创建实例时若传入非本机 `nodeId`，服务端会拒绝（远程执行尚未开放）。

## 类型定义

完整 TypeScript 定义与请求体 JSON Schema 见 `packages/shared/src/index.ts` / `packages/shared/src/schemas.ts`。
