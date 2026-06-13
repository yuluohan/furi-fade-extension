//
//  Localization.swift
//  Shared (App)
//
//  App UI language follows the shared AppState `settings.display.interfaceLanguage`
//  (same switch as the extension popup). English strings double as table keys;
//  missing translations fall back to English.
//

#if os(macOS)
import Foundation

enum L {
    static var language = "en"

    static func update(fromSettings settings: [String: Any]) {
        let display = settings["display"] as? [String: Any] ?? [:]
        language = display["interfaceLanguage"] as? String ?? "en"
    }

    static func t(_ english: String) -> String {
        guard language == "zhHans" else { return english }
        return zhHans[english] ?? english
    }

    static func f(_ english: String, _ args: CVarArg...) -> String {
        String(format: t(english), arguments: args)
    }

    private static let zhHans: [String: String] = [
        // Sidebar / list modes
        "Today": "今天",
        "7 Days": "近 7 天",
        "Suggested": "推荐",
        "Learning": "学习中",
        "Saved": "已保存",
        "Known": "已认识",
        "Ignored": "已忽略",
        "Seen Today": "今日所见",
        "Last 7 Days": "近 7 天",
        "Suggested for You": "推荐学习",
        "Saved Words": "已保存的词",
        "Known Words": "已认识的词",
        "Ignored Words": "已忽略的词",

        // Dashboard
        "Vocabulary": "词汇量",
        "Due Reviews": "待复习",
        "Start Review": "开始复习",
        "Start Review (%d)": "开始复习（%d）",
        "Refresh data from the local store": "从本地存储刷新数据",
        "App settings": "应用设置",
        "Checking Safari extension status…": "正在检查 Safari 扩展状态…",
        "Safari extension enabled": "Safari 扩展已启用",
        "Extension disabled — enable it in Safari Settings › Extensions": "扩展未启用——请在 Safari 设置 › 扩展中开启",
        "Unable to read Safari extension status: %@": "无法读取 Safari 扩展状态：%@",
        "Could not save word action: %@": "无法保存单词操作：%@",
        "No words in this list yet.": "这个列表还没有单词。",
        "No shared data yet. Browse Japanese pages with the Safari extension enabled, then click Refresh.": "还没有共享数据。请在启用 Safari 扩展的情况下浏览日语页面，然后点击刷新。",

        // Sections (T052 layout)
        "Library": "词库",
        "Discover": "发现",
        "All": "全部",
        "All Time": "全部",
        "Search words": "搜索单词",
        "Most seen": "最常看到",
        "Recently seen": "最近看到",
        "No matches.": "没有匹配的单词。",
        "words due for review": "个词待复习",
        "%d lapsed words come first": "其中 %d 个已遗忘，会优先复习",
        "All reviews done": "今日复习已完成",
        "Browse Japanese pages to collect new words.": "去浏览日语网页收集新词吧。",
        "Reviewed today": "今日已复习",
        "Suggested to learn": "建议学习",
        "View all": "查看全部",
        "No suggestions yet — keep browsing.": "暂无建议——继续浏览吧。",
        "Keep browsing Japanese pages — frequently seen new words will appear here.": "继续浏览日语网页，常见的新词会出现在这里。",
        "Save": "保存",
        "Collapse navigation": "折叠导航",
        "Expand navigation": "展开导航",
        "Word details": "单词详情",
        "Details": "详情",
        "Status": "状态",
        "Reading": "读音",
        "Meaning": "释义",
        "Seen": "见过",
        "Next review": "下次复习",
        "Example": "例句",
        "Source": "来源",
        "Actions": "操作",
        "Close": "关闭",
        "%d times": "%d 次",
        "Action saved.": "操作已保存。",
        "Saved to learning.": "已保存到学习中。",
        "Marked as known.": "已标记为已认识。",
        "Marked as forgotten.": "已标记为忘记。",
        "Ignored.": "已忽略。",
        "Restored.": "已恢复。",
        "Always showing annotations.": "已设为始终显示标注。",
        "Undo": "撤销",
        "Undone.": "已撤销。",
        "Could not undo: %@": "无法撤销：%@",

        // Onboarding
        "Let's get started": "开始使用",
        "Fading Furigana annotates Japanese as you browse in Safari, then helps you review here.": "Fading Furigana 会在你用 Safari 浏览时为日语标注假名，再在这里帮你复习。",
        "Enable the Safari extension": "启用 Safari 扩展",
        "Turn on Fading Furigana in Safari Settings › Extensions, and allow it on the sites you read.": "在 Safari 设置 › 扩展中开启 Fading Furigana，并允许它在你阅读的网站上运行。",
        "Enabled": "已启用",
        "Not enabled yet": "尚未启用",
        "Browse Japanese web pages": "浏览日语网页",
        "Readings appear above kanji and katakana. Tap a word to save, mark known, or ignore it.": "假名读音会显示在汉字和片假名上方。点按单词可保存、标记已认识或忽略。",
        "Come back to review": "回来复习",
        "Your words, stats, and review queue show up here. Click Refresh after browsing.": "你的单词、统计和复习队列会显示在这里。浏览后点击刷新。",
        "Refresh": "刷新",

        // Diagnostics footer
        "Storage: %@": "存储：%@",
        "Shared container": "共享容器",
        "Local fallback": "本机回退",
        "Updated %@": "更新于 %@",
        "never": "从未",
        "just now": "刚刚",
        "%d min ago": "%d 分钟前",
        "%d h ago": "%d 小时前",
        "%d d ago": "%d 天前",
        "not installed": "未安装",

        // Status badges
        "New": "新",
        "Reviewing": "复习中",
        "Lapsed": "已遗忘",

        // Word actions
        "Save to Learning": "保存到学习",
        "Mark as Known": "标记为已认识",
        "Forgot This Word": "忘记了这个词",
        "Ignore": "忽略",
        "Restore": "恢复",
        "Always Show Annotation": "始终显示标注",
        "Word actions": "单词操作",

        // Review session
        "Show Answer": "显示答案",
        "Forgot": "忘记了",
        "Got It": "记得",
        "Easy": "很简单",
        "End Session": "结束复习",
        "Done": "完成",
        "(no reading)": "（无读音）",
        "No meaning saved yet": "暂无释义",
        "Remaining %d of %d · Answered %d": "剩余 %d / 共 %d · 已回答 %d",
        "Session complete": "复习完成",
        "All done": "全部完成",
        "Reviewed %d answers · %d words marked forgot": "共回答 %d 次 · %d 个词标记为忘记",
        "Could not save review: %@": "无法保存复习记录：%@",
        "From: %@": "出自：%@",

        // Settings sheet
        "Settings": "设置",
        "Annotation": "标注",
        "Exposure Tracking": "曝光统计",
        "Extension": "扩展",
        "Purchase": "购买",
        "Annotate Japanese words on web pages": "在网页上标注日语单词",
        "Hide words I already know": "隐藏我已认识的词",
        "Use tap hints in titles and navigation": "标题和导航使用点按提示",
        "Track word exposure while browsing": "浏览时统计单词曝光",
        "Mode:": "标注模式：",
        "Hide words at or below:": "隐藏不高于此等级的词：",
        "Display style:": "显示样式：",
        "Save page URLs:": "保存页面网址：",
        "Keep statistics for:": "统计保留时长：",
        "Interface language:": "界面语言：",
        "Current access:": "当前权限：",
        "Trial:": "试用：",
        "Basic:": "Basic：",
        "Development state:": "开发状态：",
        "Adaptive": "自适应",
        "All words": "所有词",
        "Unknown words only": "仅不认识的词",
        "Saved words only": "仅已保存的词",
        "Off": "关闭",
        "None — annotate everything": "不过滤——全部标注",
        "Auto — tap hints in tight layouts": "自动——紧凑布局用点按提示",
        "Always show ruby": "始终显示注音",
        "Tap hints everywhere": "全部用点按提示",
        "Domain only": "仅域名",
        "Full URL": "完整网址",
        "No URLs": "不保存网址",
        "None": "无",
        "Force Trial": "强制试用中",
        "Force Expired": "强制已过期",
        "Force Basic": "强制 Basic",
        "Force Pro": "强制 Pro",
        "Trial": "试用",
        "Basic": "Basic",
        "Pro": "Pro",
        "Trial Expired": "试用已过期",
        "Unknown": "未知",
        "%d days remaining": "剩余 %d 天",
        "Trial ended": "试用已结束",
        "Purchased": "已购买",
        "Refunded": "已退款",
        "Not purchased": "未购买",
        "Local vocabulary stays on this device even if purchase status changes.": "即使购买状态变化，本地词库也会保留在这台设备上。",
        "Sync and cloud backup require Pro.": "同步和云备份需要 Pro。",
        "30 days": "30 天",
        "90 days": "90 天",
        "180 days": "180 天",
        "1 year": "1 年",
        "%d days": "%d 天",
        "Open Safari Extension Settings…": "打开 Safari 扩展设置…",
        "Settings saved": "设置已保存",
        "Could not save settings: %@": "无法保存设置：%@"
    ]
}
#endif
