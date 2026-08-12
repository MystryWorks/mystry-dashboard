# 快速开始

## 便携版（普通用户推荐）

便携包已经包含 Node.js、生产依赖和构建产物。Windows 解压后双击 `mmdctl.cmd`；Linux / macOS 解压后运行：

```bash
chmod +x mmdctl
./mmdctl start
```

无需执行 `npm install`。请先安装适配目标服务端的 Java；可用 `java -version` 检查默认 PATH 运行时，或在面板中探测并选择其他已安装运行时。完整平台列表、校验、升级和限制见 [便携预览版](portable-release.md)。

## 环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | **≥ 22**（使用内置 `node:sqlite`，无需编译原生 SQLite 模块） |
| Java | 默认使用 PATH 中的 `java`；部署页和实例设置可选择面板扫描并验证的本机运行时 |
| 操作系统 | 源码管理器支持 Windows（`PanelManager.cmd`）与 Linux / WSL（`PanelManager.sh`）；便携产物由 Windows x64 与 Linux x64 分别构建和冒烟验证 |

面板不接受手填 Java 完整路径。先在运行面板的同一用户环境中执行 `java -version` 检查默认 PATH；需要其他已安装 Java 时，在部署页或实例设置中使用「重新探测」后的选择器。

## Windows 一键管理（推荐）

安装 Node.js 22 或更高版本后，双击仓库根目录的 `PanelManager.cmd`。它会自动完成：

1. 检查 Node、npm 和 Java。
2. 按 `package-lock.json` 安装依赖。
3. 创建 `.env` 并生成互不相同的随机密钥。
4. 构建 shared、server 和 web。
5. 后台启动面板并打开浏览器。

中文 Windows 默认显示中文菜单，其他系统语言默认显示英文。菜单中按 `L` 可切换语言并保存到本机运行数据中。也可以直接使用：

```powershell
PanelManager.cmd start
PanelManager.cmd foreground
PanelManager.cmd stop
PanelManager.cmd restart
PanelManager.cmd logs
PanelManager.cmd rebuild
PanelManager.cmd status

# 仅覆盖本次显示语言，不修改保存的偏好
PanelManager.cmd status --lang en-US
PanelManager.cmd status --lang zh-CN
```

后台停止和重启会先取消部署/导入任务，再逐个安全停止正在运行的 Minecraft 实例；不要直接在任务管理器中强杀 Node 进程。

若已有 `.env` 中的密钥不是 64 位十六进制字符串，PanelManager 会先将原文件备份到 `data/launcher/config-backups/`，再生成合规的新密钥。更换 `JWT_SECRET` 会使旧登录令牌失效，但不会删除管理员、实例或 Minecraft 存档。

## Linux / WSL 源码一键管理

在仓库根目录执行：

```bash
chmod +x PanelManager.sh
./PanelManager.sh start
```

`PanelManager.sh` 检查 Node.js 22、按锁文件补装依赖并构建源码，再复用跨平台控制器完成随机配置、PID 指纹、健康检查和安全停止。它默认把配置写到 `config/panel.env`、数据写到仓库 `data/`；两者均被 Git 忽略。

如需隔离 WSL 测试数据，请在启动、停止、查看状态等每次操作前使用相同的环境变量：

```bash
export MMD_CONFIG_PATH=/home/mocha/data/mystrydashboard-test/config/panel.env
export MMD_DATA_DIR=/home/mocha/data/mystrydashboard-test
./PanelManager.sh start
```

首次空用户库会自动生成三个不同的随机密钥，并在终端显示或复制 setup token；不要把 token 或 `panel.env` 分享到聊天、仓库或截图中。可用命令为 `start`、`foreground`、`stop`、`restart`、`logs`、`rebuild`、`status` 和 `open`；其中 `rebuild` 会构建后安全重启。

## 手动安装与首次配置

在仓库根目录执行：

```bash
npm install
npm run build -w @mmd/shared
```

复制环境变量模板：

```bash
# Windows
copy .env.example .env

# Linux / macOS
cp .env.example .env
```

编辑 `.env`。首次启动**必须**配置 `JWT_SECRET` 和 `SETUP_TOKEN`，两者都必须是 64 位十六进制字符串且必须使用不同随机值。若要使用 PanelManager 的安全停止接口，还应配置第三个不同的 `LAUNCHER_TOKEN`。请分别执行以下命令生成值；命令不包含可用固定密钥：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`SETUP_TOKEN` 只用于初始化管理员。初始化请求必须在 `X-Setup-Token` header 中携带它，且接口仅在用户表为空时可用。创建管理员后，从 `.env` 移除 `SETUP_TOKEN` 并重启面板即可。

## 开发模式

需要同时运行后端与前端（前端通过 Vite 代理访问 API）。

**终端 1 — 后端**（默认 `http://127.0.0.1:3000`）：

```bash
npm run dev:server
```

**终端 2 — 前端**（默认 `http://127.0.0.1:5173`）：

```bash
npm run dev:web
```

浏览器访问 **http://127.0.0.1:5173**。首次打开会进入初始化流程；客户端需要让 setup 请求发送 `X-Setup-Token`。

安装完成后，建议直接跟着 **[分步教程：第一次开服](tutorials.md#教程-1第一次开服推荐-paper)** 走完一遍。

## 生产部署

一次性构建所有工作区包：

```bash
npm run build
```

启动后端（会托管 `apps/web/dist` 静态资源）：

```bash
npm start
```

默认监听 **http://127.0.0.1:3000**，前后端同端口访问。

## 常用 npm 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev:server` | 后端热重载开发（`@mmd/server`） |
| `npm run dev:web` | 前端 Vite 开发服务器（`@mmd/web`） |
| `npm run build` | 构建 shared → server → web |
| `npm run portable:test` | 验证便携控制器和发布辅助脚本 |
| `npm run audit:production` | 使用官方 registry 检查生产依赖，阻断 high / critical |
| `npm start` | 运行生产后端 |

## 五分钟上手路径

| 步骤 | 做什么 | 在哪里 |
|------|--------|--------|
| 1 | 配置密钥、创建管理员并登录 | `.env`、登录页 |
| 2 | 部署 Paper（或导入已有服务端） | 侧栏「一键部署」/「导入已有服务端」 |
| 3 | 点「启动」 | 实例详情或总览 |
| 4 | 等控制台出现 `Done` | 实例 →「控制台」 |
| 5 | 游戏添加服务器 `127.0.0.1` | Minecraft 客户端 |

详细截图级说明见 [分步教程](tutorials.md) 与 [使用指南](user-guide.md)。

## 首次使用检查清单

1. 安装符合服务端要求的 Java；默认运行时可在面板环境中用 `java -version` 检查，也可稍后在面板内选择扫描到的运行时。
2. 配置 64 位十六进制 `JWT_SECRET` 与 `SETUP_TOKEN`。
3. 通过带 `X-Setup-Token` header 的 setup 请求创建管理员并登录；完成后移除 `SETUP_TOKEN`。
4. 通过「一键部署」或「导入已有服务端」创建第一个实例。实例会自动使用 `DATA_DIR/instances/<id>`；同机旧服先停止并复制到 `DATA_DIR/imports/<目录名>`。
5. 在实例详情中启动服务，并在「控制台」查看日志。
6. 改端口、难度等：实例 →「配置」→ 保存后 **重启**。

## 旧版外部实例接管

旧版外部实例不会被面板访问或删除，也不会自动搬迁。停止实例和面板服务后，用操作系统工具将完整目录复制到对应的 `DATA_DIR/instances/<id>`，重新启动面板，再在实例页面点击 **接管**。

## 故障排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 面板启动失败并提示密钥 | 未配置或格式不是 64 位十六进制 | 为 `JWT_SECRET` 和首次启动所需的 `SETUP_TOKEN` 分别生成随机值 |
| setup 返回 401 | 缺少或错误的 header | 发送 `X-Setup-Token: <SETUP_TOKEN>`；确认用户表仍为空 |
| 前端 401 | 未登录或 token 过期 | 重新登录 |
| 启动实例失败 | jar 不存在，或默认 PATH / 已绑定 Java 运行时不可用、版本不匹配 | 检查实例根目录、实例设置中的运行时状态和控制台日志 |
| 部署超时 | 网络无法访问 Mojang / Paper / Fabric API，或任务超过执行超时 | 检查防火墙、代理、任务队列和相关超时配置 |
| 端口占用 | `PORT` 与已有服务冲突，或服务端端口冲突 | 修改 `.env` 中的 `PORT` 或实例 `server.properties` |

更多配置见 [配置说明](configuration.md)。
