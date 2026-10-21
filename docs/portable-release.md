# 便携预览版

仓库当前版本为 `v0.2.0-preview.2`，发布流程为其配置了两个自带 Node.js 22、生产依赖和已构建前后端的便携目标：

| 系统 | 文件 |
|------|------|
| Windows x64 | `mystry-v0.2.0-preview.2-windows-x64.zip` |
| Linux x64 | `mystry-v0.2.0-preview.2-linux-x64.tar.gz` |

Linux ARM64 与 macOS（Intel / Apple Silicon）打包脚本仍可本地使用，但不纳入本 Preview 公开发布矩阵，留待后续版本。

此表说明构建目标与文件命名，不代表对应资产已经公开发布。下载前以项目实际 Release 页面为准；若没有所需资产，可按 [快速开始](getting-started.md) 使用源码管理器。

这是 Preview，不是系统安装器。用户无需安装 Node.js 或运行 `npm install`，但仍需自行安装 Minecraft 所需 Java。实例默认使用系统 `PATH` 中的 `java`，也可在面板中选择扫描并验证的本机运行时。本阶段没有采用 [Node SEA](https://nodejs.org/download/release/latest-jod/docs/api/single-executable-applications.html)：该能力仍标为 Active development，且直接面向单个 CommonJS 主脚本，不适合当前 ESM、多包和静态前端资源布局。

## 下载与校验

从同一 GitHub Release 下载对应平台压缩包、`SHA256SUMS`、`SHA256SUMS.asc` 以及 `mystry-release-signing-key.asc`（与仓库 [`.github/release-signing-key.asc`](../.github/release-signing-key.asc) 相同）。发布页还会提供生产依赖的 `sbom.cdx.json`。

### 1. 取得并信任发布公钥

维护者首次启用签名前须按 [`.github/RELEASE_SIGNING.md`](../.github/RELEASE_SIGNING.md) 提交公钥与 [`.github/release-signing-key.fingerprint`](../.github/release-signing-key.fingerprint) 单行指纹。

用户侧：

```bash
gpg --import mystry-release-signing-key.asc
gpg --fingerprint
```

将输出中的指纹与仓库 `release-signing-key.fingerprint` 或 Release 说明中的记录比对（40 位十六进制，忽略空格与大小写差异后须完全一致）。只有从项目发布渠道取得并信任该公钥后，GPG 签名校验才有意义。

### 2. 校验文件哈希与签名

Linux：

```bash
sha256sum -c SHA256SUMS --ignore-missing
gpg --verify SHA256SUMS.asc SHA256SUMS
```

Windows PowerShell 可先计算压缩包哈希，再与 `SHA256SUMS` 中对应行比较：

```powershell
Get-FileHash .\mystry-v0.2.0-preview.2-windows-x64.zip -Algorithm SHA256
```

也可在 WSL 或 Gpg4win 中执行与 Linux 相同的 `gpg --verify`。

流水线缺少 `RELEASE_GPG_PRIVATE_KEY` 或 `RELEASE_GPG_FINGERPRINT` 与仓库指纹不一致时会拒绝创建公开 Release，不会降级成未签名发布。签名前 CI 会在独立 keyring 中用仓库公钥验证 `SHA256SUMS.asc`，再执行 `gh release create`。

## 启动

Windows：

```text
解压 → 双击 mystryctl.cmd → 选择“启动面板”
```

也可以在终端运行：

```powershell
.\mystryctl.cmd start
```

Linux：

```bash
tar -xzf mystry-v0.2.0-preview.2-linux-x64.tar.gz
cd mystry-dashboard
chmod +x mystryctl
./mystryctl start
```

统一命令：

| 命令 | 作用 |
|------|------|
| `start` | 后台启动，写入 PID 指纹、执行健康检查并记录日志 |
| `foreground` | 前台启动，适合排错 |
| `stop` | 通过本机令牌请求安全关闭 |
| `restart` | 停止后重新后台启动 |
| `status` | 检查健康状态和受管进程状态 |
| `logs` | 显示最近日志 |
| `open` | 打开面板地址 |

首次启动会创建 `config/panel.env`，生成彼此不同的随机密钥，并在空用户库时显示一次 setup token。创建管理员后，控制器会从配置中移除 setup token。配置文件包含密钥，不要上传或分享。

## 目录与数据

```text
mystry-dashboard/
├── runtime/              # 固定版本的官方 Node.js 运行时
├── app/                  # 已构建应用和生产依赖
├── config/               # 首启配置和配置备份
├── data/                 # 数据库、实例、缓存和上传临时文件
├── logs/                 # 面板标准输出和错误日志
├── mystryctl.cmd
├── mystryctl
├── manifest.json
├── VERSION
├── README.txt
└── LICENSE
```

实例仍严格位于 `data/instances/<id>`。`manifest.json` 记录产品版本、Git SHA、Node 版本、目标平台、架构、构建时间，以及包内每个发布文件的大小和 SHA-256。发布包中的 `config/`、`data/` 和 `logs/` 初始为空，不包含 `.env`、数据库、缓存、实例或开发依赖。

## 升级与回滚

不要覆盖正在运行的便携目录：

1. 在旧目录运行 `mystryctl stop`，再用 `mystryctl status` 确认已停止。
2. 将新版本解压到一个新的同级目录。
3. 确认新目录的 `config/`、`data/`、`logs/` 为空。
4. 将旧目录中的这三个目录移动到新目录，保留旧应用目录作为回滚副本。
5. 从新目录运行 `mystryctl start`，检查登录、实例列表和存档。
6. 确认无误后再自行归档旧应用目录；不要删除唯一的数据副本。

需要回滚时，先停止新版本，将 `config/`、`data/`、`logs/` 移回旧应用目录后再启动。当前没有数据库版本迁移框架，因此升级前应另外备份这三个目录，不能只依赖旧应用目录。

若已在环境中设置 `MYSTRY_HOME`，Windows `.cmd` 与 Unix `.sh` 包装脚本会保留该值，并仅对未设置的 `MYSTRY_CONFIG_PATH`、`MYSTRY_DATA_DIR` 使用便携包默认值；相对路径均相对于 `MYSTRY_HOME`。日常便携使用不需要手动设置这些变量。

## Preview 已知限制

- 公开发布仅覆盖 Windows x64 与 Linux x64；Linux ARM64 与 macOS 便携包暂不提供。
- 不提供 NSIS、DEB、PKG、系统级安装或卸载。
- 不注册 WinSW、systemd、LaunchDaemon，也不会开机自动启动。
- Windows 产物尚未代码签名；操作系统可能显示来源警告。
- 不提供原生自动更新、自动回滚和运行中覆盖升级。
- Java 8/17/21 不随包提供，也不会自动下载；用户可正确配置系统 `PATH` 作为默认运行时，或启动面板后扫描并选择其他已安装版本。
- 登录仍使用浏览器本地 JWT；Cookie 会话、CSRF、TOTP 和公网部署向导尚未实现。
- 默认只监听 `127.0.0.1`。不要把面板端口直接暴露到不可信公网。
- 2026-10-21 的官方 registry 生产依赖审计结果为 0 critical、0 high、2 moderate。两项 moderate 来自 React Router 6 系公告；当前 SPA 不使用 SSR hydration，导航目标来自固定站内路径或服务端生成的实例 ID，但这些公告仍作为 Preview 残余风险记录，并须在每次发布时重新审计。此前 `fastify`、`fast-jwt`、`@fastify/busboy`、`fast-uri`、`brace-expansion` 的 high 公告已通过升级传递依赖（`fastify` 5.12.7、`fast-jwt` 6.3.5、`@fastify/busboy` 3.2.3、`fast-uri` 3.1.9 / 4.2.3、`brace-expansion` 5.0.12）消除。开发依赖 `vitest` 3 系的 `tinypool` critical 公告不进入便携包，升级需跨大版本，暂未处理。

## 发布维护

本地原生平台构建与验证：

```bash
npm ci
npm run verify
npm run audit:production
npm run build
node scripts/portable/package-portable.mjs --platform win32 --arch x64 --output-dir release
node scripts/portable/smoke-portable.mjs release/mystry-v0.2.0-preview.2-windows-x64.zip
```

以上流程可一键完成（在目标平台原生运行，自动使用当前平台与架构，并生成压缩包、SHA256SUMS 与 SBOM）：

```bash
npm run package:release
```

Windows 用户也可直接双击 `scripts/portable/package-release.cmd`。参数：

- `--skip-install`：跳过 `npm ci`（需已有依赖）
- `--skip-verify`：跳过 `verify` 与生产依赖审计，仅构建后打包（开发自测）
- `--skip-smoke`：跳过最终压缩包冒烟验证
- `--no-force`：已有同名压缩包时拒绝覆盖
- `--allow-dirty`：允许脏工作树打包（非发布用途）
- `--output-dir <目录>`：指定输出目录，默认 `release`
- `--runtime-dir <目录>`：复用本机已下载的 Node 运行时，不重新下载

`package-portable.mjs` 写入 `manifest.json` 的 Git SHA 优先取自当前 checkout 的 `git rev-parse HEAD`（而非 workflow 的 `GITHUB_SHA`）。正式资产要求工作树干净；本地非发布调试可设置 `MYSTRY_PORTABLE_ALLOW_DIRTY=1` 或传入 `--allow-dirty`。

目标平台必须与构建机平台、架构一致。发布流程位于 `.github/workflows/portable-release.yml`：只有位于 `main` 历史、版本与根 `package.json` 一致、且 checkout 工作树干净的现有 `v*` 标签才能触发发布；prepare 阶段执行 `npm run verify` 与生产依赖审计；Windows x64 矩阵 job 显式执行 `npm run windows:test`；Win/Linux x64 两个最终压缩包都必须重新解压并通过健康检查，Release job 才会生成校验和、经指纹绑定的 GPG 签名、SBOM 和自动 Release Notes。第三方 Actions 使用固定 commit SHA，见 [`.github/actions-pins.md`](../.github/actions-pins.md)。

仓库需要在 GitHub `release` Environment 配置：

- `RELEASE_GPG_PRIVATE_KEY`：ASCII armored 私钥，必需。
- `RELEASE_GPG_PASSPHRASE`：私钥有密码时配置。
- `RELEASE_GPG_FINGERPRINT`：与 [`.github/release-signing-key.fingerprint`](../.github/release-signing-key.fingerprint) 一致的公钥指纹，必需。

`release` Environment 应启用 **Required reviewers**（人工审批），并限制仅受保护分支上的发布 workflow 可访问；此项须由仓库管理员在 GitHub Settings 中配置并留存记录。

正式打标签前先将版本提交合入 `main`，再在该提交创建并推送标签。流水线不会自动创建标签，也不会发布不在 `main` 中的提交。
