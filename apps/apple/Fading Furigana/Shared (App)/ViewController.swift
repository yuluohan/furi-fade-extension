//
//  ViewController.swift
//  Shared (App)
//

#if os(iOS)
import UIKit
import WebKit

let extensionBundleIdentifier = "com.banyuguru.fading-furigana.Extension"

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.scrollView.isScrollEnabled = false
        self.webView.configuration.userContentController.add(self, name: "controller")
        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("show('ios')")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    }
}
#elseif os(macOS)
import Cocoa
import SafariServices

let extensionBundleIdentifier = "com.banyuguru.fading-furigana.Extension"

private enum WordListMode: String, CaseIterable {
    case today = "Today"
    case week = "7 Days"
    case learning = "Learning"
    case saved = "Saved"
    case known = "Known"
    case ignored = "Ignored"
}

private enum WordAction: String {
    case save
    case known
    case forgot
    case ignore
    case alwaysShow
    case restore
}

class ViewController: NSViewController {

    private let store = AppStateStore()
    private var snapshot = AppStateSnapshot.empty
    private var selectedMode = WordListMode.today

    private let statusLabel = NSTextField(labelWithString: "Checking Safari extension status...")
    private let storeLabel = NSTextField(labelWithString: "Local store: not loaded")
    private let totalWordsValue = NSTextField(labelWithString: "0")
    private let todayValue = NSTextField(labelWithString: "0")
    private let learningValue = NSTextField(labelWithString: "0")
    private let savedValue = NSTextField(labelWithString: "0")
    private let segmentedControl = NSSegmentedControl(labels: WordListMode.allCases.map(\.rawValue), trackingMode: .selectOne, target: nil, action: nil)
    private let listStack = NSStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        renderLearningDashboard()
        loadDashboard()
        refreshExtensionState()
    }

    private func renderLearningDashboard() {
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let root = NSStackView()
        root.orientation = .vertical
        root.spacing = 18
        root.edgeInsets = NSEdgeInsets(top: 24, left: 24, bottom: 24, right: 24)
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        root.addArrangedSubview(makeHeader())
        root.addArrangedSubview(makeSummaryRow())
        root.addArrangedSubview(makeModeSelector())
        root.addArrangedSubview(makeListScrollView())
    }

    private func makeHeader() -> NSView {
        let container = NSStackView()
        container.orientation = .horizontal
        container.alignment = .centerY
        container.spacing = 16

        let textStack = NSStackView()
        textStack.orientation = .vertical
        textStack.spacing = 6

        let title = NSTextField(labelWithString: "Fading Furigana")
        title.font = NSFont.boldSystemFont(ofSize: 24)

        statusLabel.font = NSFont.systemFont(ofSize: 13)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.maximumNumberOfLines = 2

        storeLabel.font = NSFont.userFixedPitchFont(ofSize: 11) ?? NSFont.systemFont(ofSize: 11)
        storeLabel.textColor = .tertiaryLabelColor
        storeLabel.maximumNumberOfLines = 2

        textStack.addArrangedSubview(title)
        textStack.addArrangedSubview(statusLabel)
        textStack.addArrangedSubview(storeLabel)

        let refreshButton = makeButton("Refresh", action: #selector(refreshButtonClicked(_:)))
        let preferencesButton = makeButton("Safari Settings", action: #selector(openSafariExtensionPreferences))

        let buttonStack = NSStackView(views: [refreshButton, preferencesButton])
        buttonStack.orientation = .horizontal
        buttonStack.spacing = 8

        container.addArrangedSubview(textStack)
        container.addArrangedSubview(NSView())
        container.addArrangedSubview(buttonStack)
        return container
    }

    private func makeSummaryRow() -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.distribution = .fillEqually

        row.addArrangedSubview(makeMetricCard(title: "Vocabulary", value: totalWordsValue))
        row.addArrangedSubview(makeMetricCard(title: "Seen Today", value: todayValue))
        row.addArrangedSubview(makeMetricCard(title: "Learning", value: learningValue))
        row.addArrangedSubview(makeMetricCard(title: "Saved", value: savedValue))
        return row
    }

    private func makeMetricCard(title: String, value: NSTextField) -> NSView {
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 6
        stack.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
        stack.wantsLayer = true
        stack.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        stack.layer?.cornerRadius = 8

        let label = NSTextField(labelWithString: title)
        label.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        label.textColor = .secondaryLabelColor

        value.font = NSFont.monospacedDigitSystemFont(ofSize: 24, weight: .semibold)
        value.textColor = .labelColor

        stack.addArrangedSubview(label)
        stack.addArrangedSubview(value)
        return stack
    }

    private func makeModeSelector() -> NSView {
        segmentedControl.target = self
        segmentedControl.action = #selector(modeChanged(_:))
        segmentedControl.selectedSegment = 0
        segmentedControl.segmentStyle = .rounded
        return segmentedControl
    }

    private func makeListScrollView() -> NSView {
        listStack.orientation = .vertical
        listStack.alignment = .leading
        listStack.spacing = 10
        listStack.translatesAutoresizingMaskIntoConstraints = false

        let scrollView = NSScrollView()
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.documentView = listStack

        NSLayoutConstraint.activate([
            listStack.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor)
        ])

        return scrollView
    }

    private func loadDashboard() {
        snapshot = store.loadSnapshot()
        storeLabel.stringValue = "Local store: \(store.displayPath)"
        renderSnapshot()
    }

    private func renderSnapshot() {
        totalWordsValue.stringValue = "\(snapshot.totalWordCount)"
        todayValue.stringValue = "\(snapshot.todaySeenCount)"
        learningValue.stringValue = "\(snapshot.learningCount)"
        savedValue.stringValue = "\(snapshot.savedCount)"
        renderWordList()
    }

    private func renderWordList() {
        listStack.arrangedSubviews.forEach { view in
            listStack.removeArrangedSubview(view)
            view.removeFromSuperview()
        }

        let rows = snapshot.rows(for: selectedMode)
        if rows.isEmpty {
            listStack.addArrangedSubview(makeEmptyState())
            return
        }

        for row in rows.prefix(80) {
            listStack.addArrangedSubview(makeWordRow(row))
        }
    }

    private func makeEmptyState() -> NSView {
        let label = NSTextField(labelWithString: snapshot.hasLoadedState
            ? "No words in this section yet."
            : "No shared AppState file yet. Use the extension first, then refresh this app.")
        label.font = NSFont.systemFont(ofSize: 14)
        label.textColor = .secondaryLabelColor
        label.alignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false

        let container = NSView()
        container.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            container.heightAnchor.constraint(equalToConstant: 180),
            container.widthAnchor.constraint(greaterThanOrEqualToConstant: 400)
        ])
        return container
    }

    private func makeWordRow(_ row: WordRow) -> NSView {
        let card = NSStackView()
        card.orientation = .horizontal
        card.alignment = .centerY
        card.spacing = 12
        card.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 12, right: 14)
        card.wantsLayer = true
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        card.layer?.cornerRadius = 8

        let textStack = NSStackView()
        textStack.orientation = .vertical
        textStack.spacing = 5

        let title = NSTextField(labelWithString: "\(row.surface)  \(row.reading)")
        title.font = NSFont.systemFont(ofSize: 16, weight: .semibold)
        title.lineBreakMode = .byTruncatingTail

        let detail = NSTextField(labelWithString: row.detailText)
        detail.font = NSFont.systemFont(ofSize: 12)
        detail.textColor = .secondaryLabelColor
        detail.maximumNumberOfLines = 2
        detail.lineBreakMode = .byTruncatingTail

        textStack.addArrangedSubview(title)
        textStack.addArrangedSubview(detail)

        let actions = NSStackView()
        actions.orientation = .horizontal
        actions.spacing = 6
        actions.addArrangedSubview(makeWordActionButton("Save", action: .save, wordId: row.id))
        actions.addArrangedSubview(makeWordActionButton("Known", action: .known, wordId: row.id))
        actions.addArrangedSubview(makeWordActionButton("Forgot", action: .forgot, wordId: row.id))
        actions.addArrangedSubview(makeWordActionButton("Ignore", action: .ignore, wordId: row.id))
        actions.addArrangedSubview(makeWordActionButton("Always", action: .alwaysShow, wordId: row.id))

        card.addArrangedSubview(textStack)
        card.addArrangedSubview(NSView())
        card.addArrangedSubview(actions)
        return card
    }

    private func makeButton(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        return button
    }

    private func makeWordActionButton(_ title: String, action: WordAction, wordId: String) -> NSButton {
        let button = NSButton(title: title, target: self, action: #selector(wordActionClicked(_:)))
        button.bezelStyle = .rounded
        button.controlSize = .small
        button.identifier = NSUserInterfaceItemIdentifier("\(action.rawValue)|\(wordId)")
        return button
    }

    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            DispatchQueue.main.async {
                if let error = error {
                    self.statusLabel.stringValue = "Unable to read Safari extension status: \(error.localizedDescription)"
                    return
                }

                if state?.isEnabled == true {
                    self.statusLabel.stringValue = "Safari extension enabled. Dashboard data refreshes from the local AppState store."
                } else {
                    self.statusLabel.stringValue = "Safari extension installed but disabled. Enable it in Safari Settings > Extensions."
                }
            }
        }
    }

    @objc private func refreshButtonClicked(_ sender: NSButton) {
        loadDashboard()
        refreshExtensionState()
    }

    @objc private func modeChanged(_ sender: NSSegmentedControl) {
        let index = max(0, sender.selectedSegment)
        selectedMode = WordListMode.allCases[index]
        renderWordList()
    }

    @objc private func wordActionClicked(_ sender: NSButton) {
        guard
            let raw = sender.identifier?.rawValue,
            let separator = raw.firstIndex(of: "|")
        else {
            return
        }

        let actionName = String(raw[..<separator])
        let wordId = String(raw[raw.index(after: separator)...])
        guard let action = WordAction(rawValue: actionName) else { return }

        do {
            try store.apply(action: action, lexicalItemId: wordId)
            loadDashboard()
        } catch {
            statusLabel.stringValue = "Could not save word action: \(error.localizedDescription)"
        }
    }

    @objc private func openSafariExtensionPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }
}

private final class AppStateStore {
    private let appGroupIdentifier = "group.com.banyuguru.fading-furigana"
    private let fileManager = FileManager.default

    var displayPath: String {
        stateFileURL.path
    }

    private var stateFileURL: URL {
        let baseURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)
            ?? fallbackApplicationSupportURL()
        return baseURL
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("FadingFurigana", isDirectory: true)
            .appendingPathComponent("app-state-v1.json")
    }

    func loadSnapshot() -> AppStateSnapshot {
        guard
            let data = try? Data(contentsOf: stateFileURL),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .empty
        }

        return AppStateSnapshot(raw: raw, hasLoadedState: true)
    }

    func apply(action: WordAction, lexicalItemId: String) throws {
        var raw = loadRawState()
        var states = raw["userLexicalStates"] as? [String: Any] ?? [:]
        var userState = states[lexicalItemId] as? [String: Any] ?? createDefaultUserState(lexicalItemId: lexicalItemId)
        var userIntent = userState["userIntent"] as? [String: Any] ?? [:]
        var learning = userState["learning"] as? [String: Any] ?? [:]
        var interaction = userState["interaction"] as? [String: Any] ?? [:]
        var intelligence = userState["intelligence"] as? [String: Any] ?? [:]
        var reasonCodes = intelligence["reasonCodes"] as? [String] ?? []
        let now = ISO8601DateFormatter().string(from: Date())

        switch action {
        case .save:
            userState["lifecycleStatus"] = "learning"
            userState["annotationLevel"] = "full_ruby"
            userIntent["saved"] = true
            interaction["savedCount"] = (interaction["savedCount"] as? Int ?? 0) + 1
            appendUnique("user_saved", to: &reasonCodes)
        case .known:
            userState["lifecycleStatus"] = "known"
            userState["knowledgeConfidence"] = 1
            userState["annotationLevel"] = "hidden"
            userIntent["manuallyMarkedKnown"] = true
            userIntent["manuallyMarkedUnknown"] = false
            userIntent["ignored"] = false
            interaction["markedKnownCount"] = (interaction["markedKnownCount"] as? Int ?? 0) + 1
            appendUnique("user_marked_known", to: &reasonCodes)
        case .forgot:
            userState["lifecycleStatus"] = "learning"
            userState["knowledgeConfidence"] = 0
            userState["annotationLevel"] = "full_ruby"
            userIntent["saved"] = true
            userIntent["ignored"] = false
            userIntent["manuallyMarkedKnown"] = false
            userIntent["manuallyMarkedUnknown"] = true
            learning["reviewStage"] = "lapsed"
            learning["wrongCount"] = (learning["wrongCount"] as? Int ?? 0) + 1
            learning["correctStreak"] = 0
            appendUnique("user_forgot", to: &reasonCodes)
        case .ignore:
            userState["lifecycleStatus"] = "ignored"
            userState["annotationLevel"] = "hidden"
            userIntent["ignored"] = true
            interaction["ignoredCount"] = (interaction["ignoredCount"] as? Int ?? 0) + 1
            appendUnique("user_ignored", to: &reasonCodes)
        case .alwaysShow:
            userIntent["pinnedAnnotation"] = true
            if (userState["annotationLevel"] as? String) == "hidden" {
                userState["annotationLevel"] = "full_ruby"
            }
            appendUnique("user_pinned_annotation", to: &reasonCodes)
        case .restore:
            userState["lifecycleStatus"] = "new"
            userState["annotationLevel"] = "full_ruby"
            userIntent["ignored"] = false
        }

        interaction["lastActionAt"] = now
        intelligence["reasonCodes"] = reasonCodes
        userState["userIntent"] = userIntent
        userState["learning"] = learning
        userState["interaction"] = interaction
        userState["intelligence"] = intelligence
        states[lexicalItemId] = userState
        raw["userLexicalStates"] = states

        var metadata = raw["metadata"] as? [String: Any] ?? [:]
        metadata["updatedAt"] = now
        metadata["lastOpenedAt"] = now
        raw["metadata"] = metadata

        try save(raw)
    }

    private func loadRawState() -> [String: Any] {
        guard
            let data = try? Data(contentsOf: stateFileURL),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return createEmptyState()
        }
        return raw
    }

    private func save(_ raw: [String: Any]) throws {
        let url = stateFileURL
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: raw, options: [.prettyPrinted, .sortedKeys])
        let backupURL = url.appendingPathExtension("bak")
        if fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: backupURL)
            try? fileManager.copyItem(at: url, to: backupURL)
        }
        try data.write(to: url, options: .atomic)
    }

    private func fallbackApplicationSupportURL() -> URL {
        let urls = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        return (urls.first ?? URL(fileURLWithPath: NSTemporaryDirectory()))
            .appendingPathComponent("FadingFurigana", isDirectory: true)
    }

    private func createEmptyState() -> [String: Any] {
        let now = ISO8601DateFormatter().string(from: Date())
        return [
            "schemaVersion": 1,
            "settings": [:],
            "lexicalItems": [:],
            "userLexicalStates": [:],
            "sourceOccurrences": [:],
            "dailyExposureSummaries": [:],
            "reviewLogs": [:],
            "metadata": [
                "createdAt": now,
                "updatedAt": now,
                "lastOpenedAt": now
            ]
        ]
    }

    private func createDefaultUserState(lexicalItemId: String) -> [String: Any] {
        let now = ISO8601DateFormatter().string(from: Date())
        return [
            "lexicalItemId": lexicalItemId,
            "lifecycleStatus": "new",
            "knowledgeConfidence": 0,
            "annotationLevel": "full_ruby",
            "userIntent": [
                "saved": false,
                "ignored": false,
                "manuallyMarkedKnown": false,
                "manuallyMarkedUnknown": false,
                "pinnedAnnotation": false
            ],
            "exposure": [
                "seenCount": 0,
                "uniquePageCount": 0,
                "uniqueSentenceCount": 0,
                "firstSeenAt": now,
                "lastSeenAt": now
            ],
            "interaction": [
                "tooltipOpenCount": 0,
                "savedCount": 0,
                "markedKnownCount": 0,
                "ignoredCount": 0
            ],
            "learning": [
                "reviewStage": "new",
                "reviewCount": 0,
                "correctCount": 0,
                "wrongCount": 0,
                "correctStreak": 0
            ],
            "intelligence": [
                "confidenceKnown": 0,
                "confidenceNeedsHelp": 1,
                "reasonCodes": []
            ]
        ]
    }

    private func appendUnique(_ value: String, to values: inout [String]) {
        if !values.contains(value) {
            values.append(value)
        }
    }
}

private struct AppStateSnapshot {
    static let empty = AppStateSnapshot(raw: [:], hasLoadedState: false)

    let raw: [String: Any]
    let hasLoadedState: Bool
    let words: [WordRow]
    let todayTopRows: [WordRow]
    let weekTopRows: [WordRow]
    let todaySeenCount: Int

    init(raw: [String: Any], hasLoadedState: Bool) {
        self.raw = raw
        self.hasLoadedState = hasLoadedState

        let lexicalItems = raw["lexicalItems"] as? [String: Any] ?? [:]
        let userStates = raw["userLexicalStates"] as? [String: Any] ?? [:]
        let summaries = raw["dailyExposureSummaries"] as? [String: Any] ?? [:]
        let todayKey = Self.localDateKey(Date())
        let weekStart = Calendar.current.date(byAdding: .day, value: -6, to: Date()).map(Self.localDateKey) ?? todayKey

        var rowsById: [String: WordRow] = [:]
        for (id, itemValue) in lexicalItems {
            let item = itemValue as? [String: Any] ?? [:]
            let state = userStates[id] as? [String: Any] ?? [:]
            rowsById[id] = WordRow(id: id, item: item, userState: state, summarySeenCount: 0)
        }

        for (id, stateValue) in userStates where rowsById[id] == nil {
            let state = stateValue as? [String: Any] ?? [:]
            rowsById[id] = WordRow(id: id, item: [:], userState: state, summarySeenCount: 0)
        }

        let todayCounts = Self.counts(from: summaries, startDate: todayKey, endDate: todayKey)
        let weekCounts = Self.counts(from: summaries, startDate: weekStart, endDate: todayKey)

        self.todaySeenCount = todayCounts.values.reduce(0, +)
        self.words = rowsById.values.sorted(by: WordRow.defaultSort)
        self.todayTopRows = Self.rows(from: todayCounts, rowsById: rowsById)
        self.weekTopRows = Self.rows(from: weekCounts, rowsById: rowsById)
    }

    var totalWordCount: Int {
        words.count
    }

    var learningCount: Int {
        words.filter { $0.lifecycleStatus == "learning" }.count
    }

    var savedCount: Int {
        words.filter(\.saved).count
    }

    func rows(for mode: WordListMode) -> [WordRow] {
        switch mode {
        case .today:
            return todayTopRows
        case .week:
            return weekTopRows
        case .learning:
            return words.filter { $0.lifecycleStatus == "learning" }.sorted(by: WordRow.defaultSort)
        case .saved:
            return words.filter(\.saved).sorted(by: WordRow.defaultSort)
        case .known:
            return words.filter { $0.lifecycleStatus == "known" }.sorted(by: WordRow.defaultSort)
        case .ignored:
            return words.filter { $0.lifecycleStatus == "ignored" }.sorted(by: WordRow.defaultSort)
        }
    }

    private static func rows(from counts: [String: Int], rowsById: [String: WordRow]) -> [WordRow] {
        counts.map { id, count in
            if var row = rowsById[id] {
                row.summarySeenCount = count
                return row
            }
            return WordRow(id: id, item: [:], userState: [:], summarySeenCount: count)
        }
        .sorted { $0.summarySeenCount == $1.summarySeenCount ? WordRow.defaultSort($0, $1) : $0.summarySeenCount > $1.summarySeenCount }
    }

    private static func counts(from summaries: [String: Any], startDate: String, endDate: String) -> [String: Int] {
        var totals: [String: Int] = [:]
        for summaryValue in summaries.values {
            let summary = summaryValue as? [String: Any] ?? [:]
            guard
                let date = summary["date"] as? String,
                date >= startDate,
                date <= endDate,
                let lexicalItemId = summary["lexicalItemId"] as? String
            else {
                continue
            }
            totals[lexicalItemId, default: 0] += summary["totalSeenCount"] as? Int ?? 0
        }
        return totals
    }

    nonisolated private static func localDateKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

private struct WordRow {
    let id: String
    let surface: String
    let reading: String
    let meaning: String
    let lifecycleStatus: String
    let saved: Bool
    let ignored: Bool
    let pinned: Bool
    let seenCount: Int
    let lastSeenAt: String
    var summarySeenCount: Int

    init(id: String, item: [String: Any], userState: [String: Any], summarySeenCount: Int) {
        let exposure = userState["exposure"] as? [String: Any] ?? [:]
        let userIntent = userState["userIntent"] as? [String: Any] ?? [:]
        self.id = id
        self.surface = item["surface"] as? String ?? id.components(separatedBy: ":").first ?? id
        self.reading = item["readingKana"] as? String ?? item["baseReadingKana"] as? String ?? ""
        self.meaning = Self.meaningText(from: item["meanings"] as? [String: Any] ?? [:])
        self.lifecycleStatus = userState["lifecycleStatus"] as? String ?? "new"
        self.saved = userIntent["saved"] as? Bool ?? false
        self.ignored = userIntent["ignored"] as? Bool ?? false
        self.pinned = userIntent["pinnedAnnotation"] as? Bool ?? false
        self.seenCount = exposure["seenCount"] as? Int ?? 0
        self.lastSeenAt = exposure["lastSeenAt"] as? String ?? ""
        self.summarySeenCount = summarySeenCount
    }

    var detailText: String {
        let count = summarySeenCount > 0 ? summarySeenCount : seenCount
        let flags = [
            lifecycleStatus,
            saved ? "saved" : nil,
            ignored ? "ignored" : nil,
            pinned ? "always show" : nil
        ].compactMap { $0 }.joined(separator: " / ")
        let meaningPart = meaning.isEmpty ? "No meaning yet" : meaning
        return "\(meaningPart) - seen \(count)x - \(flags)"
    }

    nonisolated static func defaultSort(_ lhs: WordRow, _ rhs: WordRow) -> Bool {
        if lhs.seenCount != rhs.seenCount {
            return lhs.seenCount > rhs.seenCount
        }
        if lhs.lastSeenAt != rhs.lastSeenAt {
            return lhs.lastSeenAt > rhs.lastSeenAt
        }
        return lhs.surface < rhs.surface
    }

    nonisolated private static func meaningText(from meanings: [String: Any]) -> String {
        for key in ["zhHans", "en", "ja"] {
            if let values = meanings[key] as? [String], !values.isEmpty {
                return values.prefix(2).joined(separator: "; ")
            }
            if let value = meanings[key] as? String, !value.isEmpty {
                return value
            }
        }
        return ""
    }
}
#endif
