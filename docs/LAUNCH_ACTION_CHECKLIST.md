# 上架行动清单 / Launch Action Checklist (Mac App Store)

目标:把 macOS app + 内置 Safari Web Extension 提交到 **Mac App Store**。
这是一份**有序、可勾选的执行手册**——按阶段从上往下做,前一阶段是后一阶段的前提。
详细背景与风险说明见 `docs/MAC_APP_STORE_SUBMISSION.md`;本文件是「现在动手做什么」。

最后核对:2026-06-18(下面「当前真实状态」是直接读项目与本机签名得到的,不是照搬旧文档)。

## 关键常量(照抄,别手打错)

| 项 | 值 |
| --- | --- |
| 付费开发者团队 | `W3JAJZ2RRU`(ZHUOQUN XU),付费会员 2026-06-16 通过 |
| App 包标识 | `com.japanstudylab.fadingfurigana` |
| 扩展包标识 | `com.japanstudylab.fadingfurigana.Extension` |
| App Group | `group.com.japanstudylab.fadingfurigana` |
| IAP 产品(非消耗型) | `com.japanstudylab.fadingfurigana.basic.macos` |
| 当前版本 / 构建号 | `MARKETING_VERSION = 0.1.0` / build `1` |
| 域名 | `japanstudylab.com` |
| 构建命令(唯一正确路径) | `npm run build:safari:mac`(**绝不用 bare Xcode 构建**,否则装进去的是过期 JS) |

## 当前真实状态(2026-06-18 核对)

- ✅ 项目 `DEVELOPMENT_TEAM` 已是 `W3JAJZ2RRU`。
- ✅ 两个 target 均开启 App Sandbox + App Group;app/扩展都带 `PrivacyInfo.xcprivacy`;1024 图标齐全;StoreKit2 + 试用/Basic 权限模型已实现。
- ⚠️ 本机签名身份**只有 Apple Development**:`H4589RR2Z3`(旧 dev 团队)与 `ZHUOQUN XU (4SUTLH7978)`。**没有 Apple Distribution、也没有 Mac Installer Distribution 证书** → 阶段 B 必做。
- ⚠️ 团队不一致提示:本机出现 `4SUTLH7978` 的开发证书,而付费会员/项目目标是 `W3JAJZ2RRU`。**证书、App 记录、IAP 必须全部落在 `W3JAJZ2RRU` 下**;开始前先确认你在 App Store Connect 登录的就是这个团队。
- ⚠️ 版本号 `0.1.0`:首版公开建议确认是否抬到 `1.0.0`(决策见阶段 0)。

---

## 阶段 0 — 提审前的前置(部分是我可代劳的代码/文档项)

这些不阻塞你先去开账号协议(阶段 A),但**提交审核前必须全部完成**。

- [ ] **应用内 Acknowledgements 视图** + 仓库归档许可证原文(JMdict/EDRDG CC BY-SA 4.0、kuromoji Apache-2.0、IPADIC NAIST)。目前完全缺失,是 App Review 合规硬项。→ **Claude 可独立完成**,见 `docs/THIRD_PARTY_NOTICES.md`。
- [ ] **JMdict CC BY-SA 4.0 ShareAlike 义务确认**:生成的 `jmdictCommonData.js` 是否构成 JMdict 的衍生数据库、是否需以兼容许可公开。**这是法务判断,需你拍板**,不是写一段文字就完事。
- [ ] **三处草稿的 URL/邮箱占位符填实**:`docs/APP_STORE_METADATA_DRAFT.md`、`docs/SUPPORT_PAGE_DRAFT.md`、`docs/PRIVACY_POLICY_DRAFT.md`、`docs/TERMS_DRAFT.md` 里的 Support / Marketing / Privacy URL 和支持邮箱。**需你给真实链接+邮箱后 Claude 改**。
- [ ] **确认首版版本号**:维持 `0.1.0` 还是抬到 `1.0.0`(改 `MARKETING_VERSION`,build 号每次上传必须比上次大)。
- [ ] **跑通候选构建**:`npm run check && npm test`,再 `npm run build:safari:mac`,确认装进 `~/Applications/Fading Furigana.app` 的是最新 JS。

---

## 阶段 A — 账号与协议(App Store Connect 网页,只有你能做)

> 顺序原因:没接受 Paid Apps 协议、没填税务银行,IAP 无法售卖;没有 app 记录,后面传不上去。

- [ ] 用 `W3JAJZ2RRU` 团队登录 [App Store Connect](https://appstoreconnect.apple.com/)。
- [ ] **Agreements, Tax, and Banking**:接受 **Paid Apps Agreement**;填 **Tax**(税务表)与 **Banking**(收款账户)。状态变 Active 才算完成。
- [ ] **My Apps → +** 新建 App:
  - 平台 macOS;名称 `Fading Furigana`;主语言;
  - Bundle ID 选 `com.japanstudylab.fadingfurigana`(若下拉里没有,先去 [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) 注册同名 App ID,开 App Groups 能力);
  - SKU 自取(如 `fadingfurigana-macos`)。
- [ ] 设置 **主分类 / 副分类**(建议 Education;副选 Reference 或 Productivity)与 **内容版权**。

---

## 阶段 B — 分发签名证书(Xcode,你本机,当前最大缺口)

> 本机现在只有 Apple Development 证书,上传 MAS 需要 Distribution 系列证书。

- [ ] Xcode → Settings → Accounts,加入 `W3JAJZ2RRU` 的 Apple ID(若尚未登录)。
- [ ] 创建 **Apple Distribution** 证书(Xcode 账号面板 *Manage Certificates → +*,或 Distribute 时自动生成)。
- [ ] 创建 **Mac Installer Distribution** 证书(签上传的 `.pkg`)。
- [ ] 让 Xcode 为 app + 扩展自动生成 **Mac App Store** provisioning profiles(*Distribute App* 流程在证书就绪后会自动管理)。
- [ ] 验证:`security find-identity -v -p codesigning` 应出现 `Apple Distribution: ... (W3JAJZ2RRU)` 和 `Mac Installer Distribution` 两项。

---

## 阶段 C — IAP 产品(App Store Connect,只有你能做)

> 首个 IAP 必须**随首版 app 一起提交**,不能单独先发。

- [ ] App Store Connect → 该 app → **In-App Purchases →** 新建 **Non-Consumable**:
  - Product ID 精确填 `com.japanstudylab.fadingfurigana.basic.macos`(本地 `.storekit` 文件**不会**创建真实产品);
  - 设价格档、各语言名称/描述;
  - 上传 IAP 审核截图(展示解锁 Basic 的界面)。
- [ ] 确认各区价格(对照 `docs/MONETIZATION_TODO.md` 的价格目标)。
- [ ] 不要把试用描述成 StoreKit 试用——见阶段 F。

---

## 阶段 D — 构建与上传

- [ ] 用完整流水线出包:`npm run build:safari:mac`(保证扩展 Resources 镜像最新)。
- [ ] Xcode 选 `Fading Furigana (macOS)` scheme,**Product → Archive**(团队 = `W3JAJZ2RRU`,Release 配置)。
- [ ] Organizer → **Distribute App → App Store Connect → Upload**(用阶段 B 的分发证书 + profile)。
- [ ] 等 App Store Connect 处理完构建(Processing → 可在版本页选择)。

---

## 阶段 E — 列表物料与元数据(网页 + 我可协助文案)

- [ ] **macOS 截图**(必填,仓库里还没有):支持尺寸如 1280×800 / 1440×900 / 2560×1600 / 2880×1800。拍摄计划见 `docs/SCREENSHOT_PLAN.md`。
- [ ] 填 **Privacy Policy URL(必填)/ Support URL / Marketing URL**(来自阶段 0 敲定的链接)。
- [ ] 填 **描述 / 关键词 / 推广文案**(草稿见 `docs/APP_STORE_METADATA_DRAFT.md`)。
- [ ] 填 **隐私营养标签**(草稿见 `docs/APP_STORE_PRIVACY_ANSWERS_DRAFT.md`:无追踪、无收集数据类型)。
- [ ] 完成 **年龄分级** 问卷。
- [ ] **出口合规**:仅用标准 HTTPS → 通常声明豁免。
- [ ] 在列表里指明第三方署名所在位置(应用内 Acknowledgements + 网站)。

---

## 阶段 F — 提审前风险点(MAS 特有,务必处理)

- [ ] **试用模型措辞**:这是「一个月本地试用 → 一次性非消耗购买」,属**本地自管试用**,不是 StoreKit 试用(那只有订阅才有)。审核备注必须说清,并给审核员到达付费态的路径(sandbox 测试账号/步骤)。文案里不得暗示 StoreKit 试用。草稿见 `docs/APP_REVIEW_NOTES_DRAFT.md`。
- [ ] **Safari 扩展 `<all_urls>` 权限说明**:核心功能是给用户选择阅读的任意页面加注音(备注已起草)。
- [ ] **第三方数据署名**已在应用内可见(阶段 0 的 Acknowledgements 视图)。
- [ ] **审核员可复现核心闭环**:安装 → 启用扩展 → 注音日语页 → 保存 → Mac app 出现该词(步骤见 `docs/APP_REVIEW_NOTES_DRAFT.md`)。

---

## 阶段 G — 提交

- [ ] 版本页绑定阶段 D 的构建 + 阶段 C 的 IAP(首个 IAP 勾选随此版本提交)。
- [ ] 填审核备注(阶段 F 内容)+ 联系邮箱。
- [ ] **Submit for Review**。
- [ ] 提交后:留意「需补充信息/被拒」邮件;被拒按 Resolution Center 回复或修正后重传(build 号要 +1)。

---

## 谁做什么(一眼看清)

- **只有你能做**:阶段 A(账号协议/app 记录)、阶段 B(分发证书)、阶段 C(IAP)、阶段 D 的 Archive/Upload、阶段 E 的截图与网页表单、阶段 F 的法务/措辞拍板、阶段 G 提交。
- **Claude 能代劳**:阶段 0 的 Acknowledgements 视图 + 许可证归档、URL/邮箱填实(给信息后)、版本号修改、构建自检、各类文案润色。
