# 贡献指南

感谢你对 **Minecraft Mystery Dashboard** 的关注。本指南说明如何参与开发与文档改进。

## 行为准则

参与本项目即表示你同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 我能贡献什么？

- Bug 报告与复现步骤
- 功能建议（先开 Issue 讨论，避免重复劳动）
- 文档与教程修正 / 翻译
- 代码修复与小范围功能增强

大改架构、引入新依赖或破坏性变更前，请先开 Issue 与维护者对齐。

## 开发环境

| 依赖 | 要求 |
|------|------|
| Node.js | ≥ 22 |
| Java | 用于本地验证实例启停（可选，但强烈建议） |

```bash
npm install
npm run build -w @mmd/shared
cp .env.example .env   # Windows: copy .env.example .env

# 两个终端
npm run dev:server
npm run dev:web
```

更多细节见 [docs/development.md](docs/development.md) 与 [docs/getting-started.md](docs/getting-started.md)。

## 分支与提交

1. 从默认分支创建功能分支，例如 `fix/console-reconnect`、`docs/readme-typo`。
2. 保持改动聚焦：一次 PR 只解决一个问题。
3. 提交信息简洁说明 **为什么**，例如：
   - `fix: 防止 zip 导入时路径逃逸`
   - `docs: 补充生产部署 JWT 说明`
4. 用户可见文案与代码注释优先使用**中文**（与现有项目一致）。

## 代码约定

- TypeScript + ESM；与周围文件风格保持一致。
- 新增前后端共用类型时，先改 `packages/shared`，再构建 shared。
- 涉及实例路径的读写必须走现有路径校验（见 `apps/server/src/utils/path.ts` / `file-service`），禁止自行拼接未校验路径。
- 不要提交 `.env`、`data/`、密钥或本机绝对路径。
- 避免无关重构与格式化整个仓库。

## Pull Request 检查清单

提交 PR 前请自行确认：

- [ ] `npm run build` 通过
- [ ] 若改动 API，已更新 [docs/api.md](docs/api.md)
- [ ] 若改动配置项，已更新 `.env.example` 与 [docs/configuration.md](docs/configuration.md)
- [ ] 手动验证过相关流程（登录 / 部署 / 控制台 / 文件等）
- [ ] PR 描述写清动机、改动摘要与测试方式

## Issue 报告建议

**Bug**：环境（OS / Node / Java 版本）、复现步骤、期望与实际行为、相关日志（可打码）。

**功能**：使用场景、期望行为、是否已有替代方案。

安全相关问题请勿公开开 Issue，见 [SECURITY.md](SECURITY.md)。

## 许可证

贡献的代码将在 [MIT License](LICENSE) 下发布。提交 PR 即表示你有权以该许可证贡献这些内容。
