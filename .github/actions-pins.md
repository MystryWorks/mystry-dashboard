# GitHub Actions 固定 SHA

第三方 Actions 使用完整 commit SHA 引用（非浮动标签），降低供应链篡改风险。更新 SHA 时须对照上游 release/tag 说明，并在本表记录审查日期。

| Action | 参考标签 | Commit SHA | 审查日期 |
|--------|----------|------------|----------|
| [actions/checkout](https://github.com/actions/checkout/releases/tag/v7.0.1) | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-10-21 |
| [actions/setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0) | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | 2026-10-21 |
| [actions/upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | 2026-10-21 |
| [actions/download-artifact](https://github.com/actions/download-artifact/releases/tag/v8.0.2) | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | 2026-10-21 |

Dependabot 在 [`.github/dependabot.yml`](dependabot.yml) 中每周扫描 `github-actions` 更新；合并前必须人工核对上游变更并将新 SHA 写入本表与工作流。
