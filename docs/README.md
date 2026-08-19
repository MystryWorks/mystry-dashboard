# 项目文档

Minecraft Mystery Dashboard 是一套单机一体的 Minecraft **服务端**管理面板，通过 Web 界面管理本机上的多个服务端实例。

> 本项目**不是**客户端模组；它是独立的 Node.js 面板程序。

## 文档目录

| 文档 | 说明 |
|------|------|
| [便携预览版](portable-release.md) | Windows/Linux x64 下载、校验、启停、升级、数据保留与已知限制 |
| [快速开始](getting-started.md) | 环境要求、安装、开发与生产部署 |
| [分步教程](tutorials.md) | **推荐新手**：从零开服、导入、联机、模组服、备份 |
| [产品介绍（带截图）](product-intro/README.md) | 产品定位、各页面实拍、每个按钮的说明；另有 PDF |
| [使用指南](user-guide.md) | 界面导览、字段说明、常见问题 |
| [配置说明](configuration.md) | 环境变量、数据目录与安全建议 |
| [架构设计](architecture.md) | Monorepo 结构、模块职责与数据流 |
| [API 参考](api.md) | REST / WebSocket 接口说明 |
| [开发指南](development.md) | 本地开发、构建与扩展建议 |
| [Beta 发布修复计划](beta-release-remediation-plan.md) | 当前发布阻断问题的分阶段修复、迁移和验收计划 |
| [AI 项目知识库](ai/README.md) | AI 开发事实、决策、防错流程与验证门禁 |

## 社区与开源

| 文档 | 说明 |
|------|------|
| [贡献指南](../CONTRIBUTING.md) | 如何提 Issue / PR |
| [安全政策](../SECURITY.md) | 漏洞私下披露 |
| [行为准则](../CODE_OF_CONDUCT.md) | 社区参与规范 |
| [变更日志](../CHANGELOG.md) | 版本历史 |
| [许可证](../LICENSE) | MIT |

## 项目概览

```
minecraft-mystery-dashboard/
├── apps/
│   ├── server/          # Fastify 后端
│   └── web/             # React 前端
├── packages/
│   └── shared/          # 前后端共享 TypeScript 类型
├── data/                # 运行时数据（实例、缓存、数据库）
├── docs/                # 本目录
└── package.json         # npm workspaces 根配置
```

## 核心能力

- 多实例启停、重启、强制停止（确认后 `SIGKILL`）
- Web 控制台（WebSocket + xterm.js）
- 实例目录文件浏览、上传、文本编辑、删除、同目录重命名与流式下载
- `server.properties` 可视化编辑
- 从官方源一键部署 Vanilla / Paper / Fabric / Forge / NeoForge
- 导入现有服务端 zip 安装包
- 首启创建管理员 + JWT 登录

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js ≥ 22、Fastify、WebSocket、`node:sqlite` |
| 前端 | React、Vite、React Router、xterm.js |
| 包管理 | npm workspaces |

## 版本

当前包版本：`0.2.0-preview.1`（见根目录 `package.json`）。完整变更见 [CHANGELOG.md](../CHANGELOG.md)。
