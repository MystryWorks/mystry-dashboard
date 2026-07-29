# 快速开始

## 环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | **≥ 22**（使用内置 `node:sqlite`，无需编译原生 SQLite 模块） |
| Java | PATH 中必须可用 `java`；所有实例固定使用该命令 |
| 操作系统 | 已在 Windows 上验证；Linux / macOS 理论上可用（进程管理基于 `child_process.spawn`） |

面板不接受 Java 完整路径，也不提供选择 Java 安装目录的功能。先在运行面板的同一用户环境中执行 `java -version` 检查 PATH。

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
| `npm start` | 运行生产后端 |

## 五分钟上手路径

| 步骤 | 做什么 | 在哪里 |
|------|--------|--------|
| 1 | 配置密钥、创建管理员并登录 | `.env`、登录页 |
| 2 | 部署 Paper（或导入 zip） | 侧栏「一键部署」/「导入安装包」 |
| 3 | 点「启动」 | 实例详情或总览 |
| 4 | 等控制台出现 `Done` | 实例 →「控制台」 |
| 5 | 游戏添加服务器 `127.0.0.1` | Minecraft 客户端 |

详细截图级说明见 [分步教程](tutorials.md) 与 [使用指南](user-guide.md)。

## 首次使用检查清单

1. 在运行面板的环境中确认 `java -version` 可执行，并确认版本符合服务端要求。
2. 配置 64 位十六进制 `JWT_SECRET` 与 `SETUP_TOKEN`。
3. 通过带 `X-Setup-Token` header 的 setup 请求创建管理员并登录；完成后移除 `SETUP_TOKEN`。
4. 通过「一键部署」或「导入安装包」创建第一个实例。实例会自动使用 `DATA_DIR/instances/<id>`。
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
| 启动实例失败 | jar 不存在，或 PATH 中的 `java` 不可用 / 版本不匹配 | 检查实例根目录、`java -version` 和控制台日志 |
| 部署超时 | 网络无法访问 Mojang / Paper / Fabric API，或任务超过执行超时 | 检查防火墙、代理、任务队列和相关超时配置 |
| 端口占用 | `PORT` 与已有服务冲突，或服务端端口冲突 | 修改 `.env` 中的 `PORT` 或实例 `server.properties` |

更多配置见 [配置说明](configuration.md)。
