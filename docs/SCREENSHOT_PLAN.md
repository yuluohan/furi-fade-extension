# 截图清单 / Screenshot Plan

对应上线流程第 7 步。macOS app 在 App Store Connect 的截图要求与拍摄清单。

## 尺寸与格式要求（Mac App Store）

- 接受以下任一像素尺寸（横向）：
  - `1280 × 800`
  - `1440 × 900`
  - `2560 × 1600`
  - `2880 × 1800`（推荐，Retina 截图最清晰）
- 格式：PNG 或 JPG，RGB，不透明，无圆角/无阴影（系统会自动加窗框）。
- 每个本地化语言最多 10 张，**至少 1 张**。
- 截图需展示 app 真实界面，不得是纯营销拼图（Apple 审核会看）。

## 本地化

界面支持中英双语。建议至少出 **英文** 一套；若上架中文区，再出 **简体中文** 一套（切到中文界面重拍同样几屏）。

## 必拍清单（建议 5 张，按顺序）

| # | 画面 | 内容要点 | 标注文案（caption，可选） |
| --- | --- | --- | --- |
| 1 | Mac app 首页 / Today | 今日学习概览、复习入口，界面整洁 | EN: "Read Japanese, learn as you go" ／中: "边读日语，边学单词" |
| 2 | Safari 注音效果 | 真实日语网页上词语带 furigana、淡出效果可见，最好带一个已点开的词卡 | EN: "Furigana on any Japanese page" ／中: "任意日语网页自动注音" |
| 3 | 词语详情 / 保存卡片 | 读音、释义、例句、状态按钮（Known/Forgot/Ignore/Pin） | EN: "Save and grade words in one tap" ／中: "一键保存、标记掌握度" |
| 4 | Library / 复习页 | 本地词库列表或复习队列，体现 SRS | EN: "Review your words locally" ／中: "本地复习你的词库" |
| 5 | 设置页 | 语言、注音行为、URL 留存、存储健康、试用/购买状态 | EN: "Local-first, you're in control" ／中: "本地优先，隐私可控" |

## 拍摄注意

- 用一台干净的演示 Mac/账号，提前保存几个示例词，让 Library/Today 不空。
- Safari 注音页建议用稳定的日语页面（如 Wikipedia 日语条目），避免动态内容跳动；可复用 `packages/extension/demo/safari-qa-page.html`。
- 关闭无关菜单栏图标与通知，避免泄露隐私。
- Retina 下用 `Cmd+Shift+4` 然后空格截窗口，或 `Cmd+Shift+5` 截区域；导出后确认像素尺寸命中上表之一（必要时缩放到 2880×1800）。
- 中英两套保持同样的取景与示例词，方便审核与一致性。
- 文件命名建议：`mac-01-today-en.png`、`mac-02-safari-furigana-en.png`…；中文套用 `-zh` 后缀。

## 产出位置

建议放 `docs/assets/screenshots/`（新建），并在本文件回填实际文件名与拍摄日期。
