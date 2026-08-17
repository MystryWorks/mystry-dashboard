# Minecraft Mystery Dashboard — 本机 Minecraft 服务端 Web 面板

`minecraft-mystery-dashboard` **0.2.0-preview.1**（Preview）。当前工作分支 `dev` @ `f4c342f`。默认分支 `main` 落后 `dev` **44** 个提交——**不要从 `main` 安装新功能**。

仓库：<https://github.com/MystryMocha/mystrydashboard>（private）。许可证 [MIT](../../LICENSE)。Minecraft 是 Microsoft / Mojang 的商标；本项目与 Mojang Studios、Microsoft **无官方关联**。

## 给谁用

本机服务端管理员：用浏览器管理本机上的 Paper / Fabric / Forge / Vanilla / NeoForge 实例。

**不是**玩家客户端，也**不是** Fabric / Forge 模组。这是独立的 Node.js 面板程序。

## 能做什么

- 多实例启动 / 停止 / 强制停止
- xterm 实时控制台
- 实例文件浏览、上传、文本编辑、下载
- `server.properties` 可视化编辑
- 一键部署五种核心：Vanilla / Paper / Fabric / Forge / NeoForge
- ZIP 导入，以及同机 `DATA_DIR/imports` 交接
- 统一 JVM 配置器
- Java 运行时探测与按 ID 绑定
- 首启创建管理员 + JWT 登录

## 不能做什么

| 限制 | 现状 |
|------|------|
| 远程 Agent | `REMOTE_NODE_CREATION_ENABLED=false`，只有本机节点 `local` |
| 自定义实例路径 | 实例只能在 `DATA_DIR/instances/<id>` |
| 全盘浏览 | 文件 API 只相对实例根目录 |
| 捆绑 Java | 需自备；默认 PATH `java` 或绑定已探测 ID |
| 公网暴露向导 | 无；默认监听 `127.0.0.1:3000` |

## 两条路径

| 路径 | 适合 | 入口 |
|------|------|------|
| 便携包 | 不想安装 Node | `mmdctl.cmd` / `mmdctl` |
| 源码 PanelManager | 开发或本机构建 | `PanelManager.cmd` / `PanelManager.sh` |

详见 [快速开始](快速开始.md) 与 [便携版与发布](便携版与发布.md)。

## Wiki 目录

| 页面 | 内容 |
|------|------|
| [快速开始](快速开始.md) | 环境、便携 / 源码 / 手动启动、首启、五分钟开服 |
| [使用手册](使用手册.md) | 界面、部署、导入、文件、配置、JVM、危险操作 |
| [分步教程](分步教程.md) | 八个场景的入口索引（正文在仓库教程） |
| [架构与数据边界](架构与数据边界.md) | 进程、目录、任务、安全边界 |
| [配置参考](配置参考.md) | 密钥、监听、配额、覆盖变量 |
| [本地开发与测试](本地开发与测试.md) | workspaces、脚本、门禁、手工 QA |
| [便携版与发布](便携版与发布.md) | 产物、校验、升级、CI、未发布项 |

## 仓库文档

Wiki 只做导航与入口。完整说明见：

- [README.md](../../README.md)
- [SECURITY.md](../../SECURITY.md)
- [LICENSE](../../LICENSE)
- [docs/getting-started.md](../getting-started.md)
- [docs/user-guide.md](../user-guide.md)
- [docs/tutorials.md](../tutorials.md)
