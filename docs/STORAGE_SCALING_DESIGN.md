# 本地存储扩展性设计 / Storage Scaling Design

最后更新：2026-06-15

本文记录本地存储随词汇量增长的隐患与分期方案。讨论于 2026-06-15 QA 中触发：
真实页面浏览后约 2492 词、`app-state-v1.json` 达 6.94 MB（约 2922 B/词）。
相关：`docs/SAFARI_STORAGE_BRIDGE_DESIGN.md`、`docs/SYNC_AND_CLIENTS_DESIGN.md`、
`packages/core-schema/merge-rules.md`、DEVELOPMENT_PLAN T066/T069/T070/T071。

## 1. 现状

- 整个词库是**单体 JSON blob**（macOS：App Group 容器内 `app-state-v1.json`；
  浏览器/降级：`storage.local`）。
- 每次持久化（每个 Safari 词操作）：`compactState` → `loadState`（读+解析整份）
  → 逐记录合并所有域（O(总记录数)）→ `saveState`（序列化+写回整份）。
- 每个词约 3 条记录：`lexicalItems` + `userLexicalStates` + `dailyExposureSummaries`。

## 2. 三个隐患（同一根因的三面：单体 blob 全量重写）

1. **增长无上界**：只看过、从不交互的曝光词记录永久保留（T066 之前只有 90 天
   "汇总"过期，词条本身不删）。重度阅读者持续累积。
2. **每次保存全量读写 O(总词数)**：成本随总词汇量增长，而非改动量。文件越大越慢。
3. **fallback 配额风险**：若原生桥不可用、退回浏览器 `storage.local`，6.9 MB 已是
   ~10 MB 上限约 69%。`unlimitedStorage` 已声明，但 Safari 对其支持有限。
   （macOS 主路径是原生文件，不受此 ~10 MB 硬配额限制。）

## 3. 分期方案总览

| 阶段 | 内容 | 状态 | 驱动 |
| --- | --- | --- | --- |
| Phase 0 | 按年龄淘汰曝光词（>retentionDays 未交互即清） | **已做（T066）** | 止血 |
| Phase 1 | 曝光轻量层 + 交互提升；可无大迁移 | pending（T069） | 单设备 MVP 的性价比之选 |
| Phase 2 | 单写者快路径，省掉常见情况的 O(n) 合并 | pending（T070） | 词库变大前 |
| Phase 3 | 按记录存储（浏览器多 key / macOS SQLite） | pending（T071） | 随同步落地 |

## 4. Phase 1：曝光轻量层 + 交互提升（推荐先做）

### 模型

分两层存储：

- **曝光层（轻）**：用户仅看到过的词，只存进 `dailyExposureSummaries`（已紧凑、
  按 retentionDays 过期）+ 一条极小 per-word 索引（id、seenCount、firstSeenAt、
  lastSeenAt）。**不**为其物化完整 `userLexicalState`。
- **学习层（重）**：用户首次交互（Save/Known/Ignore/Forgot/Pin/复习）时**才**创建
  完整记录（含 `userIntent`/`interaction`/`learning`/`intelligence`）。这一步称为
  **提升（promotion）**。

### 浏览时"少记"什么（对从不交互的词）

| 字段 | 今天 | Phase 1 | 性质 |
| --- | --- | --- | --- |
| 词 id、seenCount、first/lastSeenAt | 存 | 存（轻量索引） | 保留 |
| 每日曝光汇总（按天/按页） | 存 | 存（本就有，过期） | 保留 |
| `interaction{…}`（全 0） | 存 | 不写 | 纯默认，无信息损失 |
| `learning{…}`（全 0/new） | 存 | 不写 | 纯默认 |
| `userIntent{…}`（全 false） | 存 | 不写 | 纯默认 |
| `intelligence{…}`（派生默认） | 存 | 用时算 | 纯默认 |
| `lifecycleStatus`/`annotationLevel`/`knowledgeConfidence`（默认） | 存 | 不写 | 纯默认 |
| 词典缓存 `lexicalItems[id]`（surface/POS/scriptProfile） | 存 | 按需从打包词典取 | 取舍（见约束 2） |

真正"少记"的取舍项（非默认值）：

1. **>retentionDays 的终身首见/累计次数**：若只靠汇总会丢 → **保留 per-word 轻量
   索引**即可保住。关键约束，勿图省事只留汇总。
2. **每词 uniquePageCount / uniqueSentenceCount**：由直接存改为从汇总**推算**。
   注意此项在 `saveUrls=none` 下今天已退化（所有页 pageKey 都是 `private-page`）。

### 两条设计约束

1. 轻量索引须够"发现页"用：seenCount、reading（在 id 里）、可选等级/词性，足以
   排序+展示+点开详情；其余按需从词典取。
2. "为什么推荐"的 `intelligence` 改为按需计算，不为每个曝光词常驻存储。

### 发现页"想学"链路不受影响

1. 发现页本就从曝光聚合排序（截图里的 "8×" 即 seenCount）——轻量层都在。
2. 用户点 Save / 想学 → 走与 Safari 相同的保存路径 → **此刻**物化完整记录（提升）。
3. 缺字段即时重建：reading 在 id 里、meanings 由打包词典按需补、example 在保存时
   写 `sourceOccurrences`。
4. 未保存词在保存前本就没有已存例句（现状如此，Phase 1 不退化）。
5. 与 T066 的关系：唯一"看不到"的是 >retentionDays 没再出现且从不交互的词——而
   发现页本就该推最近在读的词，这是预期行为。

### 可做成"无大迁移"

继续**能读**老的完整曝光记录；只是**不再写**新的完整曝光记录 + 由 compaction 逐步
把老的瘦掉。老数据自然向新形态收敛，没有"更新瞬间转换整库"的风险窗口。

## 5. 稳态余量估算

数据库稳态 = 最近 retentionDays 滚动窗口内的曝光词 + 用户主动学的词（永久但量小）。
活跃读者稳定后约每天 ~50 个新曝光词（速率随时间下降）：

| | 每词成本 | 90 天滚动曝光（~4500 词） | + 学的词（~2000） | 稳态总量 |
| --- | --- | --- | --- | --- |
| 今天（不瘦身） | ~2900 B | ~13 MB | ~3 MB | **~16 MB** ⚠️ 超 fallback 上限、写入变慢 |
| Phase 1 后 | 曝光词 ~几百 B | ~2 MB | ~3 MB | **~5 MB** ✅ 封顶、长期无压力 |

（量级估算，随阅读量与 `retentionDays` 浮动。）结论：Phase 1 把"有界但偏大、会逼近
上限"变成"有界且很小、体积与保存速度多年无忧"，单设备 MVP 阶段无需 Phase 3。

## 6. Phase 2：单写者快路径

持久化前比对盘上 `metadata.updatedAt`/版本号；若与加载时一致（无并发写）→ 跳过
O(n) 逐记录合并，直接写；不一致才合并。砍掉常见单写场景的合并整趟。配合已有的
`persistScheduler` 防抖合并写，降频率。

## 7. Phase 3：按记录存储（终局，随同步落地）

不再单体 blob：

- **浏览器侧**：每词一个 key（`storage.local` 单 key 写），读可懒加载/分片。
- **macOS 侧**：App Group 内改 **SQLite**（行级写）或分片文件，Swift 侧拥有写入。

每次保存成本变 O(改动量)，并成为 Pro 同步 per-record op-log 的地基
（见 `docs/MONETIZATION_TODO.md` Pro Subscription Todo、`merge-rules.md`）。

### 为什么不现在做

- 单设备 MVP 规模压不到它：Phase 1 后稳态 ~几 MB，macOS 原生 + unlimitedStorage
  毫无压力，保存毫秒级。Phase 3 解决的是单设备不会发生的问题。
- 它是最大、最危险的单项改动（动三个存储适配器 + 原生桥 + 访问模式 + 合并逻辑），
  正撞上线窗口会给上线本身叠风险。
- 其物理布局需求由**同步**驱动；同步未建时拍布局可能选错，反而迁两次。

## 8. 迁移安全约束（任何存储/格式变更都必须遵守）

无论何时改存储，老用户更新后不出事的前提：

1. **单向迁移**：读旧格式 → 写新格式，一次性、幂等。
2. **迁移前自动备份**：写新格式前把旧文件挪成时间戳备份（重置流程已有此机制，
   迁移必须复用）。
3. **降级守门**：旧版本遇到比自己新的 `schemaVersion` 时**拒绝就地改写**
   （备份 + 只读/重建），防回滚用户写坏新数据。
4. **golden vectors 覆盖**：空状态、超大状态、含未知字段、半迁移态都要有用例
   （`packages/core-schema/golden-vectors/`）。
5. **未知字段 round-trip**（CLAUDE.md 规则 5），迁移中不丢不认识的字段。
6. **扩展 ↔ App 格式必须同时支持，且 Safari 缓存旧 content script**：更新后已打开的
   Safari 标签页仍跑旧 content script；新 App 写的新格式必须能被旧 content script
   读懂一个过渡期，或由 `schemaVersion` 守门。这是本产品特有的坑。
7. **存储迁移与同步开关解耦**：把"本地存储重排"作为单独测过的一步先落，同步再建在
   已迁移好的存储之上；别把两件高风险事塞进同一个发布。

风险与时机：基数越大迁移越凶险——破坏性的存储重排应趁 beta（用户少）做，别拖到大
付费基数之后。底子已具备：`schemaVersion`、`migrateAppState`、重置前备份、core-schema
golden vectors。

## 9. 决策（2026-06-15）

- **Phase 1 现在做**：便宜、可无大迁移、给单设备买足年限余量。
- **Phase 2 词库变大前做**。
- **Phase 3 随同步线落地**，作为独立测过的本地迁移先行、同步建于其上；不现在盲做。
- 担心"以后迁移坑老用户"，靠"每次变更都做带版本号 + 备份 + 降级守门 + golden vector
  的单向迁移"兜底，而非靠"提前把最重的改动塞进上线前"。
