# 验证矩阵

新版前端修复的自动、隔离 API 与待补浏览器验收见 [本批验收记录](../frontend-review-verification.md)。

总览监测首版（2026-09-08）：`npm.cmd run verify` exit 0；交互测试 11 项通过，服务端回归 65 项通过 / 4 项平台跳过。新增测试覆盖监测失败/旧值/重试、异常筛选、隐藏暂停/卸载清理、CPU 归一、并发缓存、磁盘读取失败、Windows 真实进程采样，以及真实路由 JWT 认证。当前浏览器工具没有可用浏览器，六种主题、窄屏和真实 Minecraft 负载下的采集开销尚未验证；Linux 进程采集尚未在 Linux 实机执行。正在运行的旧面板需要通过 PanelManager 重启才能加载新后端。

## 标准命令

Windows PowerShell：

```powershell
npm.cmd run knowledge:check
npm.cmd run knowledge:test
npm.cmd run portable:test
npm.cmd run windows:test
npm.cmd run linux:test
npm.cmd run typecheck
npm.cmd run test:interaction
npm.cmd run test:security -w @mmd/server
npm.cmd run test:regression -w @mmd/server
npm.cmd run test:static
npm.cmd run build
npm.cmd run audit:production
```

完整门禁：

```powershell
npm.cmd run verify
```

Beta 修复批次回归（已并入根 `verify`；需要单独聚焦执行时）：

```powershell
npm.cmd run test:regression -w @mmd/server
```

历史证据（不代表当前检查或依赖状态）：2026-08-07 本机 Windows：`verify` exit 0（已含 `test:regression` 18 pass / 2 skip，R1-02 Unix 权限）；`audit:production` critical=0 high=0 moderate=2。

Linux/macOS 和 CI 使用相同脚本名，但命令入口为 `npm run ...`。

## 按变更类型

| 变更 | 最低自动验证 | 额外人工验证 |
|---|---|---|
| 纯知识库或文档 | `knowledge:check`、`knowledge:test`；提交前 `verify` | 标题锚点、阅读路径和事实源可读 |
| shared 类型/schema | shared build、typecheck、build | 请求与响应兼容 |
| 服务端路由/认证 | typecheck、安全自检、build | health、setup/login、授权失败 |
| 文件/路径/ZIP | 安全自检、build | 列表、读写、上传、下载及逃逸拒绝 |
| 进程/任务/控制台 | typecheck、安全自检、build | 启停、命令、WS 重连、排队到终态 |
| UI/样式 | typecheck、build | 桌面/窄屏、加载/错误态、键盘焦点 |
| 数据库 schema | typecheck、安全自检、build | 旧数据库副本升级和失败恢复 |
| Java 运行时扫描/绑定 | shared build、typecheck、安全自检、build | 合法/非法候选、未知或失效 ID、`null` 回退、启动前复验、Forge/NeoForge Installer |
| PanelManager | typecheck、安全自检、build | start/status/stop/restart/logs |
| 便携控制器/打包 | portable:test、build、audit:production、目标平台 package + smoke | 最终压缩包解压、首启、setup、stop、升级数据复用 |
| 依赖升级 | verify、当前 `npm audit --omit=dev` | 登录、部署、控制台和文件回归 |

## 关键人工流程

`knowledge:check` 检查机器事实与本地 Markdown 链接目标是否存在，不检查标题锚点、远程链接或正文语义。文档整理需额外检查所改链接的锚点与命令是否符合对应终端。

`verify` 不包含 `audit:production`，也不自动完成下列人工流程。

`test:interaction` 使用 Vitest、jsdom 与 Testing Library 执行真实 React 组件的键盘、任务抽屉开关/焦点恢复、ZIP 选择/拖放、节点重试及剪贴板反馈回归，已纳入 `verify`。请求与终端使用替身，jsdom 的 dialog 替身仅检查应用逻辑；不证明原生模态焦点约束、文件对话框、布局、主题、真实上传或 Minecraft 进程行为。

1. `GET /api/health` 返回 `ok`。
2. 空用户库 setup、正常 login、已认证请求和未认证 401。
3. 创建、部署或导入实例；任务从 `pending/running` 到 `completed/failed`。
4. 启动实例，控制台收到输出并可发送命令。
5. 文件列表、文本读写、上传、流式下载和 `server.properties` 保存。
6. `npm start` 后浏览器打开后端托管的整合页面。
7. 每个平台从最终 Release 压缩包重新解压，使用包内 Node 完成 start、health、status、stop。
8. 重新探测 Java 运行时后，验证选择器、版本告警、失效条目提示和绑定实例的启动失败反馈。

## 结果解释

- typecheck 通过：只证明 TypeScript 契约可检查。
- 安全自检通过：只证明当前自检覆盖的负向边界。
- build 通过：只证明生产产物可生成；大 chunk 警告应单独报告。
- 人工流程通过：只证明本次环境和路径下的可见行为。
- `npm audit` 结果会随时间变化；只有当前执行结果才能支持当前结论。
- 本机单平台便携 smoke 通过不能代表另一发布目标；Windows x64 与 Linux x64 结论必须来自 Actions 矩阵。

受限沙箱中若 Vite/esbuild 报父目录 `Access is denied`，先确认错误与权限相关，再在获准环境重跑完整构建；不要把环境限制误报为代码构建失败。
