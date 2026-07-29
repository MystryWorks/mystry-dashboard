# 配置说明

配置通过仓库根目录的 `.env` 文件加载（后端启动时从 `apps/server` 相对路径解析到仓库根目录）。可先复制 `.env.example`，再填写密钥和需要调整的值。

## 首次启动必需配置

首次启动前必须配置：

- `JWT_SECRET`：64 位十六进制字符串，用于 JWT 签名。
- `SETUP_TOKEN`：64 位十六进制字符串，用于首次 setup 请求的 `X-Setup-Token` header。
- `LAUNCHER_TOKEN`：PanelManager 自动生成的独立本机关闭令牌；手动运行且不使用管理器时可以不配置。

已配置的密钥必须分别使用不同的随机值。Node.js 生成命令如下；文档和模板不提供可用固定密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`POST /api/auth/setup` 只有在用户表为空时可用，并且必须携带 `X-Setup-Token: <SETUP_TOKEN>`。管理员创建成功后，可以从 `.env` 移除 `SETUP_TOKEN`，再重启面板；已有用户不需要它登录。若用户表为空而没有 `SETUP_TOKEN`，面板不会启动。

## 环境变量

数值限制的单位为字节或毫秒时，表中已标明；`MiB` 使用 `1024 × 1024` 计算。

### 基础与认证

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `127.0.0.1` | Fastify 监听地址 |
| `PORT` | `3000` | 监听端口 |
| `JWT_SECRET` | 无；初次启动前必填 | 64 位十六进制 JWT 签名密钥，不要使用固定示例值 |
| `SETUP_TOKEN` | 无；初次 setup 前必填 | 64 位十六进制初始化令牌；setup 完成后可移除 |
| `LAUNCHER_TOKEN` | 无；使用 PanelManager 时自动生成 | 64 位十六进制本机关闭令牌；仅回环地址可使用 |
| `JWT_EXPIRES_IN` | `2h` | JWT 有效期 |
| `CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | 精确 CORS 来源白名单，逗号分隔，不要填写 `*` |
| `RATE_LIMIT_MAX` | `120` | 普通请求限流窗口内的最大次数 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 普通请求限流窗口，毫秒 |
| `AUTH_RATE_LIMIT_MAX` | `5` | 登录和 setup 限流窗口内的最大次数 |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | 登录和 setup 限流窗口，毫秒 |
| `CONSOLE_TICKET_TTL_SECONDS` | `60` | 控制台 ticket 有效期；每个 ticket 只能建立一次 WebSocket 连接 |

### HTTP、文件与上传生命周期

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HTTP_REQUEST_TIMEOUT_MS` | `900000` | HTTP 请求生命周期超时，15 分钟 |
| `HTTP_CONNECTION_TIMEOUT_MS` | `300000` | HTTP 连接超时，5 分钟 |
| `HTTP_KEEP_ALIVE_TIMEOUT_MS` | `72000` | HTTP keep-alive 空闲超时，72 秒 |
| `UPLOAD_IDLE_TIMEOUT_MS` | `30000` | 上传空闲超时，30 秒；持续无数据的上传会被取消 |
| `FILE_DOWNLOAD_IDLE_TIMEOUT_MS` | `60000` | 文件下载空闲超时，60 秒；超时会关闭下载并释放并发资源 |

### JSON、并发与任务

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_JSON_BODY_BYTES` | `1048576` | JSON 请求体上限，1 MiB |
| `MAX_CONCURRENT_UPLOADS` | `1` | 同时处理的上传数上限 |
| `MAX_CONCURRENT_FILE_DOWNLOADS` | `4` | 同时处理的文件下载数上限 |
| `MAX_CONCURRENT_TASKS` | `1` | 同时执行的部署 / 导入任务数上限 |
| `MAX_QUEUED_TASKS` | `2` | 等待执行的任务数上限 |
| `TASK_TIMEOUT_MS` | `1800000` | 单个任务超时，30 分钟 |

部署和导入任务受并发数与队列数共同限制。达到 `MAX_CONCURRENT_TASKS` 后，新任务会进入 `pending` 排队；队列已满时请求返回 **429**。任务开始执行后，超过 `TASK_TIMEOUT_MS` 会失败并清理；前端应持续显示并轮询 `pending` / `running` 状态，不能把排队误判为失败。

文件下载受 `MAX_CONCURRENT_FILE_DOWNLOADS` 限制；并发槽位已满时文件下载请求返回 **429**。下载在 `FILE_DOWNLOAD_IDLE_TIMEOUT_MS` 时间内无数据活动会被关闭，并释放占用的下载并发资源。

### 核心、Installer 与文本/控制台

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CORE_DOWNLOAD_BYTES` | `536870912` | 单个核心下载上限，512 MiB |
| `CORE_DOWNLOAD_TIMEOUT_MS` | `300000` | 核心下载超时，5 分钟 |
| `MAX_CORE_METADATA_BYTES` | `2097152` | 核心版本、构建等元数据响应上限，2 MiB |
| `CORE_METADATA_TIMEOUT_MS` | `15000` | 核心元数据请求超时，15 秒 |
| `MAX_INSTALLER_OUTPUT_BYTES` | `65536` | Installer 输出保留上限，64 KiB |
| `INSTALLER_KILL_GRACE_MS` | `5000` | Installer 取消或超时后等待强制结束的宽限期，5 秒 |
| `MAX_TEXT_FILE_BYTES` | `1048576` | 在线读取或编辑的文本文件上限，1 MiB |
| `MAX_COMMAND_BYTES` | `4096` | 单条控制台命令上限，4 KiB |
| `MAX_CONSOLE_BUFFER_BYTES` | `1048576` | 控制台历史缓冲上限，1 MiB |
| `MAX_CONSOLE_CHUNK_BYTES` | `65536` | 单个控制台输出块上限，64 KiB |
| `MAX_CONSOLE_INCOMING_BYTES` | `4352` | 单个 WebSocket 入站消息上限，包含消息协议开销 |
| `MAX_CONSOLE_CONNECTIONS` | `20` | 控制台 WebSocket 最大并发连接数 |
| `MAX_CONSOLE_COMMANDS_PER_WINDOW` | `60` | 单个命令限流窗口内最多发送的控制台命令数 |
| `CONSOLE_COMMAND_WINDOW_MS` | `60000` | 控制台命令限流窗口，60 秒 |
| `MAX_CONSOLE_STDIN_BYTES` | `65536` | 写入实例 stdin 的待处理输入缓冲上限，64 KiB |

控制台连接数、单条命令大小、命令速率、WebSocket 入站帧和 stdin 待处理输入均受上表限制；历史输出与单次输出块分别受 `MAX_CONSOLE_BUFFER_BYTES`、`MAX_CONSOLE_CHUNK_BYTES` 限制。超过连接或缓冲容量会被拒绝或施加背压，命令超限或超过速率窗口不会写入实例 stdin。

核心下载先写入临时文件，只有校验并完整完成后才以原子方式发布到 `DATA_DIR/cache/cores/` 的最终缓存路径。中断、超时或进程崩溃留下的未完成文件不会作为可用缓存复用。

### 上传与 ZIP 解压

以下现有上传 / ZIP 参数继续有效：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_UPLOAD_BYTES` | `536870912` | 单个上传文件上限，512 MiB |
| `MAX_ZIP_ENTRIES` | `10000` | ZIP 条目数上限 |
| `MAX_ZIP_ENTRY_BYTES` | `1073741824` | 单个解压条目上限，1 GiB |
| `MAX_ZIP_UNCOMPRESSED_BYTES` | `2147483648` | ZIP 解压后总大小上限，2 GiB |
| `MAX_ZIP_CENTRAL_DIRECTORY_BYTES` | `33554432` | ZIP central directory 上限，32 MiB |

普通文件或 zip 上传超过 `MAX_UPLOAD_BYTES` 时返回 **413**；上传并发槽位已满时返回 **429**。ZIP 还会继续执行条目数、单条目、总解压大小和 central directory 配额校验。

### 数据目录

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `data` | 数据根目录；相对值相对于仓库根目录解析，也可填写绝对路径 |

`DATA_DIR` 下的运行时结构为：

| 路径 | 说明 |
|------|------|
| `panel.db` | SQLite 数据库（用户、实例、任务） |
| `instances/` | 实例唯一托管根目录 |
| `instances/<id>/` | 对应实例的全部文件、jar 和工作目录 |
| `cache/cores/` | 核心 jar 下载缓存 |
| `uploads/` | 上传临时目录 |

无论 `DATA_DIR` 使用相对路径还是绝对路径，实例始终只能位于 `DATA_DIR/instances/<id>`。部署、导入、创建和启动都使用这一目录；不支持自定义安装目录，也不提供从整台机器选择目录的功能。实例文件 API 的路径只是相对于该实例根目录的逻辑路径。

## 旧版外部实例

旧版数据库中记录的外部实例目录不会被面板访问或删除。迁移必须由用户完成：

1. 停止实例，并停止面板服务。
2. 使用操作系统的复制工具，将旧外部目录完整复制到 `DATA_DIR/instances/<id>`。
3. 重新启动面板，在对应实例页面点击 **接管**。

面板不会自动搬迁、复制、扫描或清理旧外部目录。接管前也不会通过旧目录启动实例；目标目录必须是对应 `<id>` 的完整副本。

## 安全建议

1. **不要**将面板直接暴露到公网；默认仅绑定回环地址。
2. 若需远程访问，使用反向代理（Nginx / Caddy）+ HTTPS，并限制 IP 或 VPN。
3. `JWT_SECRET` 和 `SETUP_TOKEN` 必须使用不同的随机值，setup 成功后移除 `SETUP_TOKEN`。
4. 管理员密码使用至少 12 位的强密码；面板具备实例文件读写与进程执行能力。
5. 所有实例进程固定使用 PATH 中的 `java`；先用 `java -version` 检查运行环境。
6. Paper 下载请求会附带合规 User-Agent；请遵守各核心分发方的使用条款。

## 前端开发代理

开发模式下 `apps/web/vite.config.ts` 将：

- `/api` → `http://127.0.0.1:3000`
- `/ws` → `ws://127.0.0.1:3000`

生产构建后由后端 `@fastify/static` 提供静态文件，无需 Vite。
