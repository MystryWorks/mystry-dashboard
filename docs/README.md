# 项目文档

Minecraft Mystry Dashboard 是独立的 Minecraft Java 服务端 Web 管理面板，在本机管理多个服务端实例。

## 按目标阅读

| 你想做什么 | 从这里开始 | 后续参考 |
|---|---|---|
| 安装并启动面板 | [快速开始](getting-started.md) | [便携版下载、校验与升级](portable-release.md) |
| 创建首个管理员或处理登录问题 | [初始化管理员](getting-started.md#初始化管理员) | [启动与认证排查](getting-started.md#故障排查) |
| 开出第一个服务端 | [分步教程](tutorials.md) | [使用指南](user-guide.md) |
| 导入、配置或管理实例 | [使用指南](user-guide.md) | [备份与迁移](tutorials.md#教程-8备份与迁移) |
| 修改监听、密钥或资源限制 | [配置说明](configuration.md) | [安全政策](../SECURITY.md) |
| 修改代码或提交 PR | [开发指南](development.md) | [贡献指南](../CONTRIBUTING.md)、[验证矩阵](ai/verification.md) |
| 接入接口或理解实现 | [API 参考](api.md) | [架构设计](architecture.md) |
| 使用 AI 协助开发 | [项目开发规则](../AGENTS.md) | [AI 项目知识库](ai/README.md) |
| 快速浏览页面与功能 | [产品介绍（截图与 PDF）](product-intro/README.md) | [中文 Wiki 导航](wiki/README.md) |

首次使用建议按“快速开始 → 分步教程 → 使用指南”阅读。截图与 PDF 反映拍摄时的界面，可能与后续页面调整不同；操作说明以当前正文与实际界面为准。

## 文档分工

- 根 [README](../README.md)：项目定位、能力边界和运行入口。
- 本目录的专题文档：用户操作、配置、接口与开发流程的正文来源。
- [Wiki](wiki/README.md)：保留中文页面入口，链接到正文，不重复维护命令、配置默认值和发布状态。
- [AI 知识库](ai/README.md)：可追溯的实现事实、架构决策、禁区和检查方法。
- 历史记录：保留当时的结论和证据，不作为当前缺陷或发布状态清单。

## 历史与社区资料

| 文档 | 用途 |
|---|---|
| [变更日志](../CHANGELOG.md) | 版本历史 |
| [贡献指南](../CONTRIBUTING.md) | Issue、PR 和文档维护约定 |
| [安全政策](../SECURITY.md) | 漏洞私下披露 |
| [行为准则](../CODE_OF_CONDUCT.md) | 社区参与规范 |
| [许可证](../LICENSE) | MIT |

## 维护与校验

修改功能说明前先核对相关源码、共享契约、前端入口和测试。配置、路由、脚本或 AI 入口变化时，同步 [机器事实](ai/project-facts.json)；文档改动流程见 [变更手册](ai/change-playbooks.md#文档与知识库)。

在仓库根目录执行：

```powershell
npm.cmd run knowledge:check
npm.cmd run knowledge:test
```

Linux/macOS 使用相同脚本名，将 `npm.cmd` 换成 `npm`。检查器验证机器事实和本地 Markdown 链接目标是否存在；不验证标题锚点、外部链接可用性、界面截图或真实用户流程。提交前还须按 [验证矩阵](ai/verification.md) 运行 `npm.cmd run verify`。
