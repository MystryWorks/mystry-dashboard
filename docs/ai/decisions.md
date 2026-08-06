# 架构决策登记

状态含义：

- `Adopted`：当前必须遵守。
- `Proposed`：候选方案，尚未实现。
- `Rejected`：明确不采用。
- `Superseded`：已被新决策替代。

| ID | 状态 | 决策 | 原因与事实源 |
|---|---|---|---|
| D-001 | Adopted | 实例目录固定为最终数据根的 `instances/<id>` | 数据根优先取 `MMD_DATA_DIR`，否则取 `DATA_DIR`；收敛文件与删除边界；`utils/path.ts`、`instance-service.ts` |
| D-002 | Superseded | 所有实例使用面板进程 `PATH` 中的 `java` | 已由 D-014 替代；`process-manager.ts`、`java-detect.ts` |
| D-003 | Adopted | 当前只开放本机节点 `local` | 远程协议尚未完成；`REMOTE_NODE_CREATION_ENABLED = false` |
| D-004 | Adopted | 前后端契约由 `@mmd/shared` 优先定义 | 减少类型和 JSON Schema 漂移；`packages/shared/src/` |
| D-005 | Adopted | PanelManager 使用独立 `LAUNCHER_TOKEN` 调用回环关闭接口 | 与登录/setup 密钥分离并限制本机；`routes/launcher.ts` |
| D-006 | Proposed | 在新增复杂 schema 前引入版本化迁移机制 | 当前只有启动期兼容 SQL，尚无通用迁移框架 |
| D-007 | Rejected | 提供整机目录浏览和任意安装路径 | 会扩大目录穿越与误删除风险 |
| D-008 | Superseded | 请求指定 `installPath` 或 `javaPath` | 已由 D-001、D-002 替代；旧字段只保留数据库兼容用途 |
| D-009 | Adopted | Preview 先发布 Windows x64 与 Linux x64 便携压缩包；Linux ARM64 / macOS 与系统安装器、服务注册延期 | `scripts/portable/`、`.github/workflows/portable-release.yml` |
| D-010 | Adopted | 便携包内置固定 Node.js 22，不捆绑 Minecraft Java | 降低首发安装复杂度；实例默认使用 PATH，已绑定实例遵循 D-014 的受扫描注册运行时边界 |
| D-011 | Adopted | 配置和数据通过 `MMD_HOME`、`MMD_CONFIG_PATH`、`MMD_DATA_DIR` 与源码位置解耦 | `apps/server/src/config.ts`、`scripts/portable/mmdctl.mjs` |
| D-012 | Adopted | 便携包只能在目标平台原生组装，并从最终压缩包重新解压冒烟验证 | 避免源码目录成功替代真实交付验证；`package-portable.mjs`、`smoke-portable.mjs` |
| D-013 | Rejected | Preview 使用 Node SEA 代替运行时目录 | 当前 SEA 仍属 Active development，且直接支持单个 CommonJS 主脚本，不适合当前 ESM、多包与静态资源布局 |
| D-014 | Adopted | 实例可绑定面板探测注册的 Java 运行时；默认仍是 PATH 中的 `java` | 候选路径只来自面板扫描（JAVA_HOME、常见安装目录），扫描与执行前复验均使用脱敏环境；请求只能提交运行时 ID，不能提交路径；`java-runtime-service.ts`、`process-manager.ts` |
| D-015 | Adopted | 面板外已有服务端通过固定 `DATA_DIR/imports` 交接区复制接管，不直接绑定原目录 | 保持 D-001/D-007 的托管与目录浏览边界；客户端只提交单层目录 ID，源目录只读并保留，复制任务拒绝链接、特殊文件、ownership marker、超配额与空间不足；`existing-server-import-service.ts` |
| D-016 | Adopted | 部署/导入任务先写入 `DATA_DIR/.mmd-staging/<taskId>/<instanceId>`，成功后再原子移动到 `instances/<id>`；崩溃恢复只清理 marker 匹配的 staging，保留已注册实例与最终目录 | R0-04；`task-staging-service.ts`、`task-service.ts` 与部署/导入 worker |
| D-017 | Adopted | 同一 `DATA_DIR` 只允许一个面板进程在 `initDb` / 任务恢复前取得 `.mmd-panel-lock/`；存活 PID 拒绝启动，仅原 PID 明确不存在时可 quarantine 旧锁 | R0-01；`data-lock-service.ts`、`index.ts` |

## 更新规则

- 只有当前源码已经执行的决定才能标为 `Adopted`。
- 计划、路线图和讨论默认标为 `Proposed`。
- 改变既有边界时新增记录或将旧记录标为 `Superseded`，不得静默改写原因。
- 决策状态变化时同步 [当前状态](current-state.md)、相关产品文档和机器事实。
