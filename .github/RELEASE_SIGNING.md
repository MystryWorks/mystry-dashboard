# 发布 GPG 签名配置

公开 Preview 资产的 `SHA256SUMS` 由维护者持有的 GPG 密钥签名。仓库内文件与 GitHub Environment 必须一致，流水线在创建 Release 前会在独立 keyring 中验证签名。

## 维护者首次配置

1. 生成或选定仅用于发布的 GPG 密钥（建议 RSA 4096 或 Ed25519，带 passphrase）。
2. 导出 ASCII armored **公钥**到 [`.github/release-signing-key.asc`](release-signing-key.asc)（提交到 `main`）。
3. 将公钥指纹（40 位十六进制，无空格，建议大写）写入 [`.github/release-signing-key.fingerprint`](release-signing-key.fingerprint) 单独一行。
4. 在 GitHub 仓库 **Settings → Environments → `release`** 中配置：
   - `RELEASE_GPG_PRIVATE_KEY`：ASCII armored 私钥（Secret，必需）
   - `RELEASE_GPG_PASSPHRASE`：私钥密码（Secret，有密码时必需）
   - `RELEASE_GPG_FINGERPRINT`：与仓库 `.fingerprint` 文件相同的指纹（Secret 或 Variables，必需）
5. 为 `release` Environment 启用 **Required reviewers**（人工审批），并限制仅 `main` 上标签触发的 workflow 可访问（见 [docs/portable-release.md](../docs/portable-release.md)）。

本地核对指纹：

```bash
gpg --import --import-options show-only .github/release-signing-key.asc
gpg --fingerprint --with-colons "$(head -n1 .github/release-signing-key.fingerprint)"
```

## 用户验证 Release 资产

从 GitHub Release 下载 `mystry-release-signing-key.asc`（或仓库内同名公钥）、`SHA256SUMS` 与 `SHA256SUMS.asc`。

```bash
gpg --import mystry-release-signing-key.asc
gpg --fingerprint
# 与 release-signing-key.fingerprint 或发布说明中的指纹比对（须完全一致）

sha256sum -c SHA256SUMS --ignore-missing
gpg --verify SHA256SUMS.asc SHA256SUMS
```

Windows 上可使用 [Gpg4win](https://gpg4win.org/) 或 WSL 中的 `gpg`，步骤相同。

## 流水线校验顺序（摘要）

1. 导入 CI 私钥后，断言 secret key 指纹等于 `RELEASE_GPG_FINGERPRINT`。
2. 断言仓库 `.github/release-signing-key.fingerprint` 与 Environment 指纹一致。
3. 使用 `--local-user <指纹>` 对 `SHA256SUMS`  detached 签名。
4. 在临时 keyring 中仅导入仓库公钥，验证 `SHA256SUMS.asc` 后再执行 `gh release create`。

第三方 Actions 的固定 SHA 见 [actions-pins.md](actions-pins.md)。
