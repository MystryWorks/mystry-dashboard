# 安全政策

## 支持的版本

| 版本 | 支持状态 |
|------|----------|
| `0.2.0-preview.x` | 当前 Preview，接收安全报告 |
| `0.1.x` | 仅在未发布更新 Preview 前临时维护 |

发布正式稳定版本后，仅对仍受支持的小版本接收安全修复。Preview 不承诺与正式版同等的长期安全支持窗口。

## 报告漏洞

本项目是本机高权限管理面板（可读写实例文件、启动 Java 进程）。若你发现安全问题，请**不要**公开创建 Issue 或讨论帖。

请通过以下方式私下联系维护者：

1. 使用 GitHub 仓库的 **Private vulnerability reporting**（若已启用：Security → Report a vulnerability）；或
2. 向仓库维护者发送私信 / 邮件（在仓库 About 或 Profile 中查看联系方式）。

报告时尽量包含：

- 影响版本与运行环境（OS、Node 版本）
- 漏洞类型与影响范围（例如未授权访问、路径穿越、命令注入）
- 最小复现步骤或 PoC（请勿在公开渠道粘贴）
- 你认为的修复方向（可选）

我们会尽快确认并回复；在修复发布前请勿公开细节。

## 安全相关设计原则（摘要）

- 默认监听 `127.0.0.1`，避免无意暴露公网。
- 首次初始化使用 `X-Setup-Token` header；setup 仅在用户表为空时接受请求。管理员创建后应移除 `SETUP_TOKEN`。
- `JWT_SECRET` 和 `SETUP_TOKEN` 均须为 64 位十六进制随机值，且必须互不相同、不得提交到仓库。
- 所有实例严格位于 `DATA_DIR/instances/<id>`；面板不接受自定义实例目录，也不提供全盘目录浏览。
- 实例文件和 zip 解压做路径逃逸校验，文件 API 的路径始终相对于实例根目录。
- 实例默认通过 PATH 中的 `java` 启动，也可按注册表 ID 使用面板扫描并验证的运行时；请求不能提交 Java 完整路径。扫描仅执行候选的 `-version`，且使用脱敏子进程环境；`JAVA_HOME` 与扫描目录必须由受信任的本机管理员控制。
- 旧版外部实例目录不会被面板访问或删除；迁移由用户在停止服务后使用系统工具完成。
- `DATA_DIR` 可相对于项目根目录配置，也可使用绝对路径；实例仍只能位于该目录下的 `instances/<id>`。
- 上传超过大小上限返回 413，上传并发容量耗尽返回 429；核心缓存仅原子发布已完整写入的文件。
- 文件下载默认最多 4 个并发；下载并发容量耗尽返回 429，下载空闲超时会关闭下载并释放并发资源（由 `MAX_CONCURRENT_FILE_DOWNLOADS` 和 `FILE_DOWNLOAD_IDLE_TIMEOUT_MS` 控制）。
- 部署 / 导入任务支持排队并受执行超时保护；控制台限制并发连接、命令大小与速率、入站消息和 stdin 缓冲。

详见 [docs/configuration.md](docs/configuration.md)。

## 致谢

负责任披露并协助修复的贡献者，可在修复发布后按意愿致谢（可匿名）。

## 发布资产完整性

公开 Preview 的 GitHub Release 提供压缩包、`SHA256SUMS`、`SHA256SUMS.asc` 与 `mmd-release-signing-key.asc`。维护者配置与指纹说明见 [`.github/RELEASE_SIGNING.md`](.github/RELEASE_SIGNING.md)；用户验证步骤见 [docs/portable-release.md](docs/portable-release.md#下载与校验)。

验证要点：

1. 导入 Release 附带的公钥，核对指纹与仓库 [`.github/release-signing-key.fingerprint`](.github/release-signing-key.fingerprint) 一致。
2. 用 `sha256sum -c` 或等效方式确认压缩包哈希与 `SHA256SUMS` 匹配。
3. 使用 `gpg --verify SHA256SUMS.asc SHA256SUMS` 确认校验和列表由该公钥签名。

CI 在创建 Release 前会在独立 keyring 中完成相同验证；私钥、指纹与 Environment 审批由仓库管理员配置，不由应用运行时读取。
