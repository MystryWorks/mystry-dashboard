# Minecraft Mystery Dashboard

用浏览器管理本机上的多个 **Minecraft Java 服务端**：启停、实时控制台、文件与配置、一键部署和已有服务端导入。

面板是独立的 Node.js 程序，不是客户端模组，无需安装 Fabric / Forge 来运行面板自身。

[快速开始](docs/getting-started.md) · [文档中心](docs/README.md) · [分步教程](docs/tutorials.md) · [产品介绍](docs/product-intro/README.md) · [贡献指南](CONTRIBUTING.md)

## 功能

| 能力 | 可以做什么 |
|---|---|
| 实例管理 | 创建、启动、停止、重启与删除本机实例，危险操作需确认 |
| 控制台 | 查看实时日志、发送命令，断线后自动重连 |
| 文件与配置 | 上传、流式下载、文本编辑、重命名，编辑 `server.properties` 与确认 EULA |
| 部署与导入 | 部署 Vanilla / Paper / Fabric / Forge / NeoForge；ZIP 预检后导入，或复制接管同机已有服务端 |
| Java 与 JVM | 探测本机 Java 运行时，统一配置内存、预设与高级参数 |
| 任务与监测 | 全局任务队列；总览查看主机与实例进程资源，监测失败时提示数据过期 |
| 界面与认证 | 首启创建管理员、JWT 登录，六种主题与响应式布局 |

### 使用边界

- 当前只管理内置本机节点 `local`，远程 Agent 与远程节点创建尚未开放。
- 实例工作目录固定为最终数据根下的 `instances/<id>`；面板不提供全盘浏览或外部目录绑定。
- 同机导入前先停止原服务器，再把完整目录复制到 `DATA_DIR/imports/<目录名>`。面板只读该交接目录并复制到新实例，原目录保留。
- 任务可能排队；面板重启后，遗留任务会标记失败，不会自动续跑。
- 当前没有完整的自动备份与恢复功能；操作方法见 [备份与迁移](docs/tutorials.md#教程-8备份与迁移)。

## 快速开始

先选择运行方式，再按 [初始化管理员](docs/getting-started.md#初始化管理员) 进入面板。

| 运行方式 | 环境要求 | 入口 |
|---|---|---|
| 便携预览版 | 发布目标为 Windows x64 / Linux x64；包内自带 Node.js | [下载、校验与启动](docs/portable-release.md) |
| Windows 源码管理器 | Node.js ≥ 22 | 双击仓库根目录 `PanelManager.cmd` |
| Linux / WSL 源码管理器 | Node.js ≥ 22 | 运行下方命令 |
| 手动开发 | Node.js ≥ 22，两个开发终端 | [安装与配置](docs/getting-started.md#手动安装与首次配置)、[开发指南](docs/development.md) |

Windows PowerShell：

```powershell
.\PanelManager.cmd start
```

Linux / WSL：

```bash
chmod +x PanelManager.sh
./PanelManager.sh start
```

源码管理器会检查环境、安装依赖、生成配置并构建启动。整合面板默认访问 `http://127.0.0.1:3000`；手动开发时访问 Vite 的 `http://127.0.0.1:5173`。

Minecraft 服务端所需的 **Java 需要另行安装**。实例默认使用面板环境 PATH 中的 `java`，也可选择面板探测并验证的本机运行时。

### 便携预览版

发布流程配置了 Windows x64 与 Linux x64 两个便携目标，包内包含 Node.js、生产依赖和前后端构建物。具体版本与资产以项目实际 Release 页面为准；平台限制、签名校验和升级步骤统一见 [便携预览版说明](docs/portable-release.md)。

### 生产部署

已按 [快速开始](docs/getting-started.md#手动安装与首次配置) 完成依赖安装和密钥配置后，可手动构建并启动：

```powershell
npm.cmd run build
npm.cmd start
```

Linux/macOS 将 `npm.cmd` 换成 `npm`。后端托管构建后的 Web 页面；配置文件位置、监听地址与资源限制见 [配置说明](docs/configuration.md)。

## 数据与安全

最终数据根优先使用 `MMD_DATA_DIR`，其次 `DATA_DIR`，默认是仓库或便携包下的 `data/`。文档中的 `DATA_DIR/...` 均表示最终解析后的数据根。

| 路径 | 用途 |
|---|---|
| `DATA_DIR/panel.db` | 账号、实例、任务等元数据 |
| `DATA_DIR/instances/<id>/` | 实例工作目录与存档 |
| `DATA_DIR/imports/<目录名>/` | 同机服务端导入的只读复制源 |
| `DATA_DIR/cache/cores/` | 核心下载缓存 |

默认仅监听本机回环地址。面板具有实例文件读写与进程执行权限，对外访问前请阅读 [安全政策](SECURITY.md) 与 [配置说明](docs/configuration.md)。密钥及运行数据不得提交到仓库；已配置的 `JWT_SECRET`、`SETUP_TOKEN`、`LAUNCHER_TOKEN` 必须是互不相同的 64 位十六进制随机值。

旧版外部目录的迁移步骤见 [旧版外部实例接管](docs/user-guide.md#旧版外部实例接管)；备份前先安全停止实例和面板。

## 项目结构与开发

| 路径 | 职责 |
|---|---|
| `apps/server/` | Fastify 5 API、`node:sqlite`、进程、文件与任务 |
| `apps/web/` | React 19、Vite 6、React Router 6 与 xterm.js |
| `packages/shared/` | 前后端共享类型与 JSON Schema |
| `scripts/` | 启动器、验证和便携打包工具 |
| `docs/` | 用户文档、开发参考与 AI 知识库 |

从 [开发指南](docs/development.md) 了解构建和验证，从 [API 参考](docs/api.md) 与 [架构设计](docs/architecture.md) 查实现边界。AI 协作先读 [AGENTS.md](AGENTS.md)。

## 贡献与许可证

欢迎提交 Issue、Pull Request 和文档修正，请先阅读 [贡献指南](CONTRIBUTING.md) 与 [行为准则](CODE_OF_CONDUCT.md)。安全问题按 [SECURITY.md](SECURITY.md) 私下报告。

项目采用 [MIT License](LICENSE)。版本历史见 [变更日志](CHANGELOG.md)。Minecraft 是 Microsoft / Mojang 的商标；本项目与 Mojang Studios、Microsoft 无官方关联。
