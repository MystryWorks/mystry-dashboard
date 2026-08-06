# GitHub Actions 固定 SHA

第三方 Actions 使用完整 commit SHA 引用（非浮动标签），降低供应链篡改风险。更新 SHA 时须对照上游 release/tag 说明，并在本表记录审查日期。

| Action | 参考标签 | Commit SHA | 审查日期 |
|--------|----------|------------|----------|
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v6) | v6 | `d23441a48e516b6c34aea4fa41551a30e30af803` | 2026-08-07 |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v6) | v6 | `249970729cb0ef3589644e2896645e5dc5ba9c38` | 2026-08-07 |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v4) | v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` | 2026-08-07 |
| [actions/download-artifact](https://github.com/actions/download-artifact/releases/tag/v5) | v5 | `634f93cb2916e3fdff6788551b99b062d0335ce0` | 2026-08-07 |

Dependabot 在 [`.github/dependabot.yml`](dependabot.yml) 中每周扫描 `github-actions` 更新；合并前必须人工核对上游变更并将新 SHA 写入本表与工作流。
