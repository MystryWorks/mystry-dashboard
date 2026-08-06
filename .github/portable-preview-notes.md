## 便携 Preview 使用说明

- Windows 解压后运行 `mmdctl.cmd start`；Linux 解压后先执行 `chmod +x mmdctl`，再运行 `./mmdctl start`。
- 包内已包含 Node.js 和生产依赖，但不包含 Minecraft Java；默认使用系统 `PATH` 中的 Java，也可在面板中扫描并选择其他已安装运行时。
- 本 Preview 仅发布 Windows x64 与 Linux x64；不提供 Linux ARM64、macOS、系统安装器、服务注册、开机启动、原生自动更新或 Windows 代码签名。

## 升级与数据保留

先在旧目录运行 `mmdctl stop`，将新版本解压到新的同级目录，再把原有 `config/`、`data/`、`logs/` 移入新目录。不要覆盖正在运行的目录，升级前请另外备份这三个目录。

## 安全与已知限制

- 默认只监听 `127.0.0.1`；不要把面板端口直接暴露到不可信公网。
- 2026-08-06 生产依赖审计为 0 critical、0 high、2 moderate。两项 moderate 来自 React Router 6 系依赖公告；当前前端没有 SSR hydration，并且导航目标来自固定站内路径或服务端生成的实例 ID，但仍作为 Preview 残余风险保留并在每次发布重新审计。
- 下载后请先使用 `SHA256SUMS` 校验文件，导入 `mmd-release-signing-key.asc` 核对指纹后，再用该公钥验证 `SHA256SUMS.asc`。

完整说明见仓库中的 `docs/portable-release.md`。
