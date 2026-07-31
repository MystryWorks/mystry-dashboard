# API 参考

除下列公开接口外，其余 `/api/*` 路由均需 JWT：

```http
Authorization: Bearer <token>
```

错误响应通常为 JSON：`{ "error": "说明" }`。

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

Java 状态响应准确结构为：

```json
{
  "available": true,
  "version": "21.0.3"
}
```

找不到 Java 时返回 `{ "available": false, "version": null }`。探测和所有实例进程都固定执行 PATH 中的 `java`，响应不包含可执行文件路径、候选列表或选择器信息。面板不提供全盘目录浏览接口。

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
| `status` | `InstanceStatus` | 运行状态 |
| `acceptEula` | boolean | 是否写入 `eula=true` |
| `createdAt` / `updatedAt` | string | ISO 时间 |

## 文件与配置 `/api/instances/:id`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/files?path=` | 列出实例根目录内的目录 `FileEntry[]` |
| GET | `/files/content?path=` | 读文本 `{ path, content }` |
| PUT | `/files/content` | Body：`{ path, content }` |
| DELETE | `/files?path=` | 删除实例根目录内的文件或目录 |
| POST | `/files/mkdir` | Body：`{ path }` |
| POST | `/files/rename` | Body：`{ from, to }` |
| GET | `/files/download?path=` | 二进制流 |
| POST | `/files/upload?path=` | multipart 单文件 |
| GET | `/config/server.properties` | 键值对象 |
| PUT | `/config/server.properties` | Body：`Record<string, string>` |

所有 `path` 均为**相对于 `DATA_DIR/instances/<id>` 的逻辑路径**，服务端会校验并拒绝 `..` 逃逸；这些接口不能访问实例根目录以外的文件。

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
| POST | `/api/import` | multipart：`name`、`file`（zip）、可选 `jvmArgs`、`acceptEula` |
| GET | `/api/tasks/:id` | 查询任务进度 `TaskInfo` |

部署和导入始终把内容写入新实例的 `DATA_DIR/instances/<id>`，不接收自定义目录或 Java 可执行文件字段。所有实例启动均使用 PATH 中的 `java`。

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
