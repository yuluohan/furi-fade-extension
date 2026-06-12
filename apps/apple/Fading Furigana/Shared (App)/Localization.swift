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

        // Settings sheet
        "Settings": "设置",
        "Annotation": "标注",
        "Exposure Tracking": "曝光统计",
        "Extension": "扩展",
        "Data": "数据",
        "Annotate Japanese words on web pages": "在网页上标注日语单词",
        "Hide words I already know": "隐藏我已认识的词",
        "Track word exposure while browsing": "浏览时统计单词曝光",
        "Mode:": "标注模式：",
        "Hide words at or below:": "隐藏不高于此等级的词：",
        "Display style:": "显示样式：",
        "Save page URLs:": "保存页面网址：",
        "Keep statistics for:": "统计保留时长：",
        "Interface language:": "界面语言：",
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
        "30 days": "30 天",
        "90 days": "90 天",
        "180 days": "180 天",
        "1 year": "1 年",
        "%d days": "%d 天",
        "Open Safari Extension Settings…": "打开 Safari 扩展设置…",
        "Show Data File in Finder": "在 Finder 中显示数据文件",
        "Settings saved": "设置已保存",
        "Could not save settings: %@": "无法保存设置：%@"
    ]
}
#endif
