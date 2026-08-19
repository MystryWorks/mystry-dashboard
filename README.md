# Minecraft Mystery Dashboard

单机一体的 Minecraft **服务端** Web 管理面板。

用浏览器管理本机上的多个 Java 版服务端：启停、实时控制台、文件与配置、一键部署核心、接管面板外已有服务端。

> **不是** Minecraft 客户端模组，也无需 Fabric / Forge 作为模组加载。本仓库是独立的 Node.js 面板程序。

[便携预览版](docs/portable-release.md) · [快速开始](docs/getting-started.md) · [产品介绍](docs/product-intro/README.md) · [分步教程](docs/tutorials.md) · [使用指南](docs/user-guide.md) · [API](docs/api.md) · [贡献指南](CONTRIBUTING.md)

---

## 功能

- 多实例启停 / 重启 / 强制停止（确认后 `POST .../stop?force=1`）
- 实时控制台（WebSocket + xterm.js）
- 实例根目录内的文件列表、上传、文本编辑、删除、同目录重命名与流式下载（一次性 download ticket）
- `server.properties` 可视化编辑与 EULA 确认
- 一键部署 **Vanilla / Paper / Fabric / Forge / NeoForge**
- 从固定 `DATA_DIR/imports` 交接区复制接管同机已有服务端，或上传现有服务端 **zip**
- 统一 JVM 配置器：推荐内存、兼容/G1/Paper Aikar 预设、高级参数校验和最终参数预览
- ZIP 二阶段导入：上传预检 `user_jvm_args.txt`，确认配置后再进入后台任务
- 首启创建管理员 + JWT 登录
- 检测 PATH 中 `java` 的状态，并扫描、验证可选择的 Java 运行时

实例只托管在最终数据根目录的 `instances/<id>`，不支持自定义安装目录，也不提供全盘目录浏览。同机交接时先停止原服务器，再把完整目录复制到 `DATA_DIR/imports/<目录名>`；面板只读该候选目录并再次复制到新实例，原目录不会移动或删除。源码模式默认由 `DATA_DIR` 指定数据根；便携控制器使用优先级更高的 `MMD_DATA_DIR`。实例默认使用 PATH 中的 `java`，也可在部署、导入或实例设置中选择面板探测并验证的运行时。

## 便携预览版

GitHub Release 提供 Windows x64 与 Linux x64 两个便携包。包内已包含固定版本的 Node.js 22、生产依赖和前后端构建物；用户无需安装 Node.js 或运行 `npm install`。Linux ARM64 与 macOS 包列为后续计划，本 Preview 不发布。

Windows 解压后双击 `mmdctl.cmd`；Linux 解压后执行：

```bash
chmod +x mmdctl
./mmdctl start
```

便携版不包含 Java。可将适合目标 Minecraft 版本的 `java` 配入系统 PATH 作为默认运行时，或在面板中选择已探测的本机运行时。完整下载、校验、升级、数据保留和已知限制见 [便携预览版说明](docs/portable-release.md)。

## 源码运行环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | **≥ 22**（使用内置 `node:sqlite`，无需原生 SQLite 模块） |
| Java | 默认使用 PATH 中的 `java`；也可选择面板扫描并验证的本机运行时，面板不接受手填完整路径 |
| 操作系统 | 源码管理器支持 Windows（`PanelManager.cmd`）与 Linux / WSL（`PanelManager.sh`）；便携包按 Windows x64 / Linux x64 构建和验证 |

## 快速开始

### Windows 源码管理器

安装 Node.js 22 或更高版本后，直接双击仓库根目录的：

```text
PanelManager.cmd
```

管理器会自动检查环境、安装依赖、创建 `.env`、生成随机密钥、构建并启动面板。中文 Windows 默认显示中文，其他系统语言默认显示英文；菜单中按 `L` 可以切换并记住语言。

也可以从命令行直接操作：

```powershell
PanelManager.cmd start
PanelManager.cmd foreground
PanelManager.cmd stop
PanelManager.cmd restart
PanelManager.cmd logs
PanelManager.cmd rebuild
PanelManager.cmd status
```

### Linux / WSL 源码管理器

安装 Node.js 22 或更高版本后，在仓库根目录执行：

```bash
chmod +x PanelManager.sh
./PanelManager.sh start
```

启动器会按 `package-lock.json` 补装依赖、构建 shared / server / web，然后复用带 PID 指纹、健康检查和安全停止的跨平台控制器。首次启动会在 `config/panel.env` 自动生成互不相同的 `JWT_SECRET`、`SETUP_TOKEN` 和 `LAUNCHER_TOKEN`；不要分享或提交该文件。创建管理员后，控制器会自动移除 `SETUP_TOKEN`。

要让测试配置和数据完全位于 WSL 的独立目录，请在同一个终端先设置：

```bash
export MMD_CONFIG_PATH=/home/mocha/data/mystrydashboard-test/config/panel.env
export MMD_DATA_DIR=/home/mocha/data/mystrydashboard-test
./PanelManager.sh start
```

之后在同一终端可使用：

```bash
./PanelManager.sh foreground
./PanelManager.sh stop
./PanelManager.sh restart
./PanelManager.sh logs
./PanelManager.sh rebuild
./PanelManager.sh status
```

`rebuild` 会重新构建并安全重启；`restart` 只安全重启当前构建。默认访问地址为 `http://127.0.0.1:3000`。

### 手动安装

```bash
# 安装依赖
npm install

# 构建共享类型包
npm run build -w @mmd/shared

# 复制环境变量
cp .env.example .env          # Linux / macOS
# copy .env.example .env      # Windows
```

首次启动前，编辑 `.env`，分别为 `JWT_SECRET` 和 `SETUP_TOKEN` 填入两个不同的 64 位十六进制随机值。若需要使用 PanelManager 的后台安全停止功能，还要为 `LAUNCHER_TOKEN` 生成第三个不同的随机值。请分别执行以下命令，不要使用固定密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

启动后，初始化请求必须在 `X-Setup-Token` header 中携带 `SETUP_TOKEN`。setup 仅在用户表为空时可用；创建管理员后即可从 `.env` 移除 `SETUP_TOKEN`，再重启面板。

```bash
# 终端 1：后端（默认 http://127.0.0.1:3000）
npm run dev:server

# 终端 2：前端（http://127.0.0.1:5173，已代理 API）
npm run dev:web
```

浏览器打开前端地址，按 [快速开始](docs/getting-started.md) 完成初始化。

## 生产部署

```bash
npm run build
npm start
```

后端会托管 `apps/web/dist`，默认监听 `http://127.0.0.1:3000`。完整环境变量、首次启动和迁移说明见 [配置说明](docs/configuration.md)。

部署与导入可能先进入排队状态，前端会持续显示并刷新任务状态，直到完成或超时失败。上传文件超过上限返回 **413**，上传处理容量已满返回 **429**；文件下载默认由 `MAX_CONCURRENT_FILE_DOWNLOADS=4` 限制，并发容量已满时返回 **429**，`FILE_DOWNLOAD_IDLE_TIMEOUT_MS=60000` 空闲超时会关闭下载并释放并发资源。核心下载完整写入临时文件并校验后，才原子发布到缓存，未完成文件不会被复用。控制台同时限制连接数、单条命令大小、命令速率、入站消息和 stdin 输入缓冲，详见 [配置说明](docs/configuration.md)。

## 目录结构

```
minecraft-mystery-dashboard/
├── apps/
│   ├── server/          # Fastify 后端：进程 / 文件 / 部署
│   └── web/             # React 前端面板
├── packages/
│   └── shared/          # 共享 TypeScript 类型
├── docs/                # 用户与开发文档
├── data/                # 运行时数据（gitignore，启动后生成）
├── .env.example
└── package.json         # npm workspaces 根配置
```

| 路径 | 说明 |
|------|------|
| `DATA_DIR/instances/<id>/` | 实例唯一工作目录 |
| `DATA_DIR/imports/<目录名>/` | 同机已有服务端交接区；导入后原目录仍保留 |
| `DATA_DIR/cache/cores/` | 核心 jar 下载缓存 |
| `DATA_DIR/panel.db` | SQLite 元数据库 |

### 旧版外部实例

旧版记录指向的外部实例目录不会被面板访问，也不会被面板删除。需要迁移时，先停止实例和面板服务，再使用操作系统工具将完整目录复制到 `DATA_DIR/instances/<id>`，启动面板后在实例页面点击 **接管**。面板不会自动搬迁、复制或删除旧目录；详见 [使用指南](docs/user-guide.md#旧版外部实例接管)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js ≥ 22、Fastify 5、WebSocket、`node:sqlite` |
| 前端 | React 19、Vite 6、React Router、xterm.js |
| 包管理 | npm workspaces（`apps/*` + `packages/*`） |

## 安全提示

- 默认只监听本机回环地址；若对外暴露，请使用 HTTPS、限制来源并使用强随机密钥。
- 面板具备实例文件读写与进程执行能力，等同于本机高权限工具，请勿暴露给不可信网络。
- `JWT_SECRET`、`SETUP_TOKEN` 不得提交到仓库；setup 完成后应移除 `SETUP_TOKEN`。
- `JWT_SECRET`、`SETUP_TOKEN` 与已配置的 `LAUNCHER_TOKEN` 必须使用互不相同的 64 位十六进制随机值。
- 文件与 zip 解压均做了路径逃逸防护，仍请遵守最小暴露原则。
- 发现安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，勿直接公开 Issue。

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/getting-started.md](docs/getting-started.md) | 安装、初始化、开发模式、生产部署 |
| [docs/portable-release.md](docs/portable-release.md) | Windows/Linux x64 便携包、校验、升级、数据保留与发布流程 |
| [docs/tutorials.md](docs/tutorials.md) | **新手教程**：分步开服、导入与接管 |
| [docs/user-guide.md](docs/user-guide.md) | 界面说明、字段含义、FAQ |
| [docs/configuration.md](docs/configuration.md) | 环境变量与数据目录 |
| [docs/architecture.md](docs/architecture.md) | 模块结构与数据流 |
| [docs/api.md](docs/api.md) | REST / WebSocket API |
| [docs/development.md](docs/development.md) | 扩展开发与构建流程 |
| [docs/ai/README.md](docs/ai/README.md) | AI 开发事实、决策、防错流程与验证门禁 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献流程与约定 |
| [SECURITY.md](SECURITY.md) | 安全漏洞披露 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

## 贡献

欢迎 Issue 与 Pull Request。请先阅读 [贡献指南](CONTRIBUTING.md) 与 [行为准则](CODE_OF_CONDUCT.md)。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。

Minecraft 是 Microsoft / Mojang 的商标。本项目与 Mojang Studios、Microsoft 无官方关联。
