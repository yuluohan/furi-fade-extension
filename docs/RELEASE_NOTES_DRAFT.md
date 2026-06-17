# 首发发布说明草稿 / Release Notes Draft

首发版本：`0.1.0`（build 从 `1` 起递增）。
对应上线流程第 3 步「整理发布清单」：首发功能、已知限制、测试路径、审核备注。

相关文档：
- 门禁清单：`docs/MVP_RELEASE_CHECKLIST.md`
- 审核备注：`docs/APP_REVIEW_NOTES_DRAFT.md`、`docs/APP_STORE_METADATA_DRAFT.md`
- 隐私政策：`docs/PRIVACY_POLICY_DRAFT.md`、`docs/TERMS_DRAFT.md`
- 手动 QA：`docs/SAFARI_MANUAL_QA.md`（最近一次记录 `docs/SAFARI_QA_RUN_2026-06-15.md`）

## 标识符基线（提交前再核对一次）

| 项 | 值 |
| --- | --- |
| 首发版本 | `0.1.0` |
| Build number | 从 `1` 起递增 |
| macOS App bundle id | `com.japanstudylab.fadingfurigana` |
| Safari 扩展 bundle id | `com.japanstudylab.fadingfurigana.Extension` |
| App Group | `group.com.japanstudylab.fadingfurigana` |
| Basic IAP（非消耗型） | `com.japanstudylab.fadingfurigana.basic.macos` |
| 扩展权限 | `storage`, `unlimitedStorage`, `activeTab`, `nativeMessaging` |
| 主机权限 | `<all_urls>` |

## 首发功能（MVP scope）

- macOS app 内置 Safari Web Extension，一次安装即可。
- Safari 在用户浏览的日语网页上为词语添加假名注音（furigana），并随熟悉度「淡出」。
- 在网页上保存词语，并标记为已掌握 / 遗忘 / 忽略 / 置顶。
- Safari 与 Mac app 通过 App Group 本地共享同一份 AppState（同设备，无需账号）。
- Mac app 提供 Today、Library、Discover、词语详情与复习操作。
- 本地复习记录与下次复习时间（SRS 雏形）。
- 界面语言中英切换。
- 页面 URL 留存可设置：关闭 / 仅域名 / 完整 URL。
- 存储健康诊断与本地数据重置。
- 一个月试用，到期后一次性购买 Basic（按平台），解锁本地单平台学习闭环。

## 已知限制（首发明确告知，含审核备注）

- **分词偏差**：kuromoji + IPADIC 偶有误读（如计数器读音、专有名词），已有安全网仍非 100%。
- **词典覆盖**：打包 JMdict（约 4.3 万条），生僻词或新词可能查不到义项。
- **受限页面降级**：无 background 场景（演示页 / iOS）退回 `Intl.Segmenter` + 词典最长匹配，准确度略低。
- **仅同设备本地**：无跨设备同步、无云备份、无导入/导出。Pro 同步不在本 MVP。
- **平台范围**：仅 macOS（Safari + Mac app）。Chrome 为次要、iOS / Android / Windows 不在本 MVP。
- **配额敏感**：Safari 本地存储约 10 MB 阈值，曝光词不存义项以控制体积。
- **签名**：本机仅有 Apple Development 证书；公开分发前需 Apple Distribution 证书 + 发布描述文件。

## 测试路径（首发核心回归）

详细步骤见 `docs/SAFARI_MANUAL_QA.md`；最小回归：

1. 全新安装：无既有 AppState，引导出现，可打开 Safari 设置启用扩展。
2. 升级：既有 `app-state-v1.json` 经过构建/安装/更新后保留。
3. Safari 保存：日语页保存一个词 → Mac app 刷新后出现。
4. Mac 回写：Mac app 标记 Known/Forgot → 刷新 Safari 页，注音行为随状态变化。
5. 复习：保存词进入复习队列，复习结果写入 `reviewLogs`，更新下次复习时间。
6. 语言切换：中/英切换，app 与 popup 同步。
7. 存储诊断：popup 与 Mac app 均报告 native/shared 存储，而非 fallback。
8. 真实页面：Wikipedia、新闻文章、Google 结果、长页、动态页。
9. 购买（sandbox）：试用开始、Basic 解锁、恢复购买、失败状态。

## 审核备注要点（提交时附上）

- 扩展使用 `<all_urls>` 是因为核心功能要在用户自选的任意日语网页上注音。
- Basic 不需要账号；学习数据仅在本机、仅在 Safari 扩展与容器 app 间通过 App Group 共享。
- 试用到期或购买校验暂时不可用时，本地学习数据不会被删除。
- 审核员启用流程与购买测试见 `docs/APP_REVIEW_NOTES_DRAFT.md` 的 Suggested Reviewer Flow。
