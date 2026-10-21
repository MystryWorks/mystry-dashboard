# AI 项目知识库

这里保存面向 Codex、OpenCode、Cursor 的项目事实、决策和防错流程。根目录
[`AGENTS.md`](../../AGENTS.md) 是唯一强制入口；本目录提供按任务加载的详细知识。

## 读取规则

1. 先检查 `git status --short --branch`，保护用户已有修改。
2. 只读取与当前任务相关的页面，随后回到源码核实。
3. 若文档与源码冲突，以源码和配置为准，并把知识库修正纳入同一变更。
4. 不把 Proposed、Rejected、Superseded 或历史故障记录描述成当前已实现能力。

## 按任务路由

| 任务 | 必读页面 |
|---|---|
| 了解当前能力或回答“是否支持” | [当前状态](current-state.md)、[架构决策](decisions.md) |
| 修改 API、共享字段或 JSON Schema | [变更手册](change-playbooks.md)、[验证矩阵](verification.md) |
| 修改文件、路径、上传、下载或 ZIP | [安全禁区](guardrails.md)、[变更手册](change-playbooks.md) |
| 修改进程、控制台、任务或关闭流程 | [当前状态](current-state.md)、[变更手册](change-playbooks.md) |
| 修改 UI、交互或用户文案 | [变更手册](change-playbooks.md)、[验证矩阵](verification.md) |
| 修改数据库、实例目录或节点模型 | [架构决策](decisions.md)、[安全禁区](guardrails.md) |
| 审查提交、功能声明或历史问题 | [已知误区](known-failures.md)、[验证矩阵](verification.md) |
| 修改配置、路由、脚本或知识库 | [机器事实](project-facts.json)、[验证矩阵](verification.md) |

## 维护原则

- 当前事实写入 [当前状态](current-state.md)，并附源码事实源。
- 重大取舍写入 [架构决策](decisions.md)，必须标注状态。
- 可复现的误判或事故写入 [已知误区](known-failures.md)，说明预防和验证方法。
- package、路由、环境变量或 AI 入口变化时，同步
  [project-facts.json](project-facts.json) 并运行 `npm.cmd run knowledge:check`。
- `.slim/deepwork/**` 只保存本机历史草稿，禁止作为当前事实引用。

## 快速验证

```powershell
npm.cmd run knowledge:check
npm.cmd run knowledge:test
npm.cmd run verify
```
