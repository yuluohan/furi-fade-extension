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

enum WordListMode: String, CaseIterable {
    case today = "Today"
    case week = "7 Days"
    case suggested = "Suggested"
    case learning = "Learning"
    case saved = "Saved"
    case known = "Known"
    case ignored = "Ignored"
}

enum WordAction: String {
    case save
    case known
    case forgot
    case ignore
    case alwaysShow
    case restore
}

extension WordListMode {
    var symbolName: String {
        switch self {
        case .today: return "sun.max"
        case .week: return "calendar"
        case .suggested: return "sparkles"
        case .learning: return "book"
        case .saved: return "bookmark"
        case .known: return "checkmark.circle"
        case .ignored: return "nosign"
        }
    }

    var displayName: String {
        L.t(rawValue)
    }

    var displayTitle: String {
        switch self {
        case .today: return L.t("Seen Today")
        case .week: return L.t("Last 7 Days")
        case .suggested: return L.t("Suggested for You")
        case .learning: return L.t("Learning")
        case .saved: return L.t("Saved Words")
        case .known: return L.t("Known Words")
        case .ignored: return L.t("Ignored Words")
        }
    }
}

class ViewController: NSViewController, NSTableViewDataSource, NSTableViewDelegate {

    private let store = AppStateStore()
    private var snapshot = AppStateSnapshot.empty
    private var selectedMode = WordListMode.today
    private var dueRows: [WordRow] = []
    private var currentRows: [WordRow] = []

    private let sidebarTable = NSTableView()
    private let wordTable = NSTableView()

    private let sectionTitleLabel = NSTextField(labelWithString: "")
    private let statusDot = NSView()
    private let statusLabel = NSTextField(labelWithString: "Checking Safari extension status…")
    private let emptyStateLabel = NSTextField(wrappingLabelWithString: "")
    private let versionLabel = NSTextField(labelWithString: "")
    private let storePathLabel = NSTextField(labelWithString: "")
    private let reviewButton = NSButton(title: "Start Review", target: nil, action: nil)

    private let totalWordsValue = NSTextField(labelWithString: "0")
    private let todayValue = NSTextField(labelWithString: "0")
    private let learningValue = NSTextField(labelWithString: "0")
    private let dueValue = NSTextField(labelWithString: "0")
    private let savedValue = NSTextField(labelWithString: "0")

    // Static UI texts re-localized when the interface language changes.
    private var localizedLabels: [(NSTextField, String)] = []
    private var localizedTooltips: [(NSButton, String)] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        L.update(fromSettings: store.settingsDictionary())
        buildLayout()
        sidebarTable.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        loadDashboard()
        refreshExtensionState()
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard let window = view.window else { return }
        window.minSize = NSSize(width: 880, height: 540)
        if window.frame.width < 900 {
            window.setContentSize(NSSize(width: 1000, height: 640))
            window.center()
        }
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        sidebarTable.sizeLastColumnToFit()
        wordTable.sizeLastColumnToFit()
    }

    // MARK: - Layout

    private func buildLayout() {
        let splitView = NSSplitView()
        splitView.isVertical = true
        splitView.dividerStyle = .thin
        splitView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(splitView)

        NSLayoutConstraint.activate([
            splitView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            splitView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            splitView.topAnchor.constraint(equalTo: view.topAnchor),
            splitView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        let sidebar = makeSidebar()
        let content = makeContent()
        splitView.addArrangedSubview(sidebar)
        splitView.addArrangedSubview(content)
        splitView.setHoldingPriority(NSLayoutConstraint.Priority(260), forSubviewAt: 0)

        NSLayoutConstraint.activate([
            sidebar.widthAnchor.constraint(greaterThanOrEqualToConstant: 180),
            sidebar.widthAnchor.constraint(lessThanOrEqualToConstant: 260),
            content.widthAnchor.constraint(greaterThanOrEqualToConstant: 560)
        ])
    }

    private func makeSidebar() -> NSView {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("section"))
        column.minWidth = 120
        sidebarTable.addTableColumn(column)
        sidebarTable.headerView = nil
        sidebarTable.style = .sourceList
        sidebarTable.rowHeight = 32
        sidebarTable.focusRingType = .none
        sidebarTable.allowsEmptySelection = false
        sidebarTable.dataSource = self
        sidebarTable.delegate = self

        let scroll = NSScrollView()
        scroll.documentView = sidebarTable
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false

        let effect = NSVisualEffectView()
        effect.material = .sidebar
        effect.blendingMode = .behindWindow
        effect.addSubview(scroll)

        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: effect.topAnchor, constant: 10),
            scroll.bottomAnchor.constraint(equalTo: effect.bottomAnchor)
        ])
        return effect
    }

    private func makeContent() -> NSView {
        let container = NSView()

        let column = NSStackView()
        column.orientation = .vertical
        column.alignment = .leading
        column.distribution = .fill
        column.spacing = 16
        column.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(column)

        let preferredWidth = column.widthAnchor.constraint(equalToConstant: 860)
        preferredWidth.priority = NSLayoutConstraint.Priority(500)

        NSLayoutConstraint.activate([
            column.topAnchor.constraint(equalTo: container.topAnchor, constant: 20),
            column.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
            column.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            column.widthAnchor.constraint(lessThanOrEqualToConstant: 860),
            column.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 24),
            preferredWidth
        ])

        let header = makeHeaderRow()
        let metrics = makeMetricsRow()
        let table = makeWordTableContainer()
        let footer = makeFooterRow()

        column.addArrangedSubview(header)
        column.addArrangedSubview(metrics)
        column.addArrangedSubview(table)
        column.addArrangedSubview(footer)

        for child in [header, metrics, table, footer] {
            NSLayoutConstraint.activate([
                child.leadingAnchor.constraint(equalTo: column.leadingAnchor),
                child.trailingAnchor.constraint(equalTo: column.trailingAnchor)
            ])
        }
        table.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .vertical)
        return container
    }

    private func makeHeaderRow() -> NSView {
        sectionTitleLabel.font = NSFont.boldSystemFont(ofSize: 22)
        sectionTitleLabel.lineBreakMode = .byTruncatingTail

        statusDot.wantsLayer = true
        statusDot.layer?.cornerRadius = 4
        statusDot.layer?.backgroundColor = NSColor.systemOrange.cgColor
        NSLayoutConstraint.activate([
            statusDot.widthAnchor.constraint(equalToConstant: 8),
            statusDot.heightAnchor.constraint(equalToConstant: 8)
        ])

        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.maximumNumberOfLines = 1
        statusLabel.stringValue = L.t("Checking Safari extension status…")

        let statusRow = NSStackView(views: [statusDot, statusLabel])
        statusRow.orientation = .horizontal
        statusRow.alignment = .centerY
        statusRow.spacing = 6

        let titleStack = NSStackView(views: [sectionTitleLabel, statusRow])
        titleStack.orientation = .vertical
        titleStack.alignment = .leading
        titleStack.spacing = 4

        reviewButton.target = self
        reviewButton.action = #selector(startReviewClicked(_:))
        reviewButton.bezelStyle = .rounded
        reviewButton.controlSize = .large
        reviewButton.keyEquivalent = "\r"
        reviewButton.isEnabled = false

        let refreshButton = makeIconButton(
            symbol: "arrow.clockwise",
            tooltip: "Refresh data from the local store",
            action: #selector(refreshButtonClicked(_:))
        )
        let settingsButton = makeIconButton(
            symbol: "gearshape",
            tooltip: "App settings",
            action: #selector(openAppSettings)
        )

        let buttons = NSStackView(views: [reviewButton, refreshButton, settingsButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8

        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.addArrangedSubview(titleStack)
        row.addArrangedSubview(NSView())
        row.addArrangedSubview(buttons)
        return row
    }

    private func makeMetricsRow() -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.distribution = .fillEqually

        row.addArrangedSubview(makeMetricCard(titleKey: "Vocabulary", value: totalWordsValue))
        row.addArrangedSubview(makeMetricCard(titleKey: "Seen Today", value: todayValue))
        row.addArrangedSubview(makeMetricCard(titleKey: "Learning", value: learningValue))
        row.addArrangedSubview(makeMetricCard(titleKey: "Due Reviews", value: dueValue))
        row.addArrangedSubview(makeMetricCard(titleKey: "Saved", value: savedValue))
        return row
    }

    private func makeMetricCard(titleKey: String, value: NSTextField) -> NSView {
        let label = NSTextField(labelWithString: L.t(titleKey))
        label.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        label.textColor = .secondaryLabelColor
        localizedLabels.append((label, titleKey))

        value.font = NSFont.monospacedDigitSystemFont(ofSize: 20, weight: .semibold)
        value.textColor = .labelColor

        let stack = NSStackView(views: [label, value])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        stack.wantsLayer = true
        stack.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        stack.layer?.cornerRadius = 8
        return stack
    }

    private func makeWordTableContainer() -> NSView {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("word"))
        column.minWidth = 200
        wordTable.addTableColumn(column)
        wordTable.headerView = nil
        wordTable.rowHeight = 56
        wordTable.intercellSpacing = NSSize(width: 0, height: 6)
        wordTable.selectionHighlightStyle = .none
        wordTable.backgroundColor = .clear
        wordTable.focusRingType = .none
        wordTable.dataSource = self
        wordTable.delegate = self

        let scroll = NSScrollView()
        scroll.documentView = wordTable
        scroll.hasVerticalScroller = true
        scroll.drawsBackground = false
        scroll.translatesAutoresizingMaskIntoConstraints = false

        emptyStateLabel.font = NSFont.systemFont(ofSize: 13)
        emptyStateLabel.textColor = .secondaryLabelColor
        emptyStateLabel.alignment = .center
        emptyStateLabel.maximumNumberOfLines = 3
        emptyStateLabel.translatesAutoresizingMaskIntoConstraints = false
        emptyStateLabel.isHidden = true

        let container = NSView()
        container.addSubview(scroll)
        container.addSubview(emptyStateLabel)

        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: container.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            emptyStateLabel.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            emptyStateLabel.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            emptyStateLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            container.heightAnchor.constraint(greaterThanOrEqualToConstant: 200)
        ])
        return container
    }

    private func makeFooterRow() -> NSView {
        versionLabel.font = NSFont.systemFont(ofSize: 10)
        versionLabel.textColor = .tertiaryLabelColor

        storePathLabel.font = NSFont.systemFont(ofSize: 10)
        storePathLabel.textColor = .tertiaryLabelColor
        storePathLabel.lineBreakMode = .byTruncatingMiddle
        storePathLabel.maximumNumberOfLines = 1

        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.addArrangedSubview(versionLabel)
        row.addArrangedSubview(NSView())
        row.addArrangedSubview(storePathLabel)
        return row
    }

    private func makeIconButton(symbol: String, tooltip: String, action: Selector) -> NSButton {
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: tooltip) ?? NSImage()
        let button = NSButton(image: image, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.toolTip = L.t(tooltip)
        localizedTooltips.append((button, tooltip))
        return button
    }

    private func applyStaticTexts() {
        for (label, key) in localizedLabels {
            label.stringValue = L.t(key)
        }
        for (button, key) in localizedTooltips {
            button.toolTip = L.t(key)
        }
    }

    // MARK: - Data

    private func loadDashboard() {
        snapshot = store.loadSnapshot()
        L.update(fromSettings: snapshot.raw["settings"] as? [String: Any] ?? [:])
        versionLabel.stringValue = VersionInfo.displayText()
        storePathLabel.stringValue = store.displayPath
        storePathLabel.toolTip = store.displayPath
        renderSnapshot()
    }

    private func renderSnapshot() {
        applyStaticTexts()
        dueRows = ReviewScheduler.dueWords(in: snapshot.words)
        totalWordsValue.stringValue = "\(snapshot.totalWordCount)"
        todayValue.stringValue = "\(snapshot.todaySeenCount)"
        learningValue.stringValue = "\(snapshot.learningCount)"
        savedValue.stringValue = "\(snapshot.savedCount)"
        dueValue.stringValue = "\(dueRows.count)"
        reviewButton.title = dueRows.isEmpty ? L.t("Start Review") : L.f("Start Review (%d)", dueRows.count)
        reviewButton.isEnabled = !dueRows.isEmpty

        let selected = max(sidebarTable.selectedRow, 0)
        sidebarTable.reloadData()
        sidebarTable.selectRowIndexes(IndexSet(integer: selected), byExtendingSelection: false)
        renderWordList()
    }

    private func renderWordList() {
        currentRows = Array(snapshot.rows(for: selectedMode).prefix(200))
        sectionTitleLabel.stringValue = selectedMode.displayTitle
        wordTable.reloadData()
        wordTable.sizeLastColumnToFit()

        emptyStateLabel.stringValue = snapshot.hasLoadedState
            ? L.t("No words in this list yet.")
            : L.t("No shared data yet. Browse Japanese pages with the Safari extension enabled, then click Refresh.")
        emptyStateLabel.isHidden = !currentRows.isEmpty
    }

    // MARK: - Table view data source / delegate

    func numberOfRows(in tableView: NSTableView) -> Int {
        if tableView === sidebarTable { return WordListMode.allCases.count }
        return currentRows.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        if tableView === sidebarTable {
            guard row < WordListMode.allCases.count else { return nil }
            return makeSidebarCell(for: WordListMode.allCases[row])
        }
        guard row < currentRows.count else { return nil }
        return makeWordCell(currentRows[row])
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard (notification.object as? NSTableView) === sidebarTable else { return }
        let index = sidebarTable.selectedRow
        guard index >= 0, index < WordListMode.allCases.count else { return }
        selectedMode = WordListMode.allCases[index]
        renderWordList()
    }

    private func makeSidebarCell(for mode: WordListMode) -> NSView {
        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: mode.symbolName, accessibilityDescription: nil)
        icon.contentTintColor = .secondaryLabelColor
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 18)
        ])

        let name = NSTextField(labelWithString: mode.displayName)
        name.font = NSFont.systemFont(ofSize: 13)
        name.lineBreakMode = .byTruncatingTail

        let count = NSTextField(labelWithString: "\(snapshot.rows(for: mode).count)")
        count.font = NSFont.systemFont(ofSize: 11)
        count.textColor = .secondaryLabelColor

        let cell = NSStackView()
        cell.orientation = .horizontal
        cell.alignment = .centerY
        cell.spacing = 7
        cell.edgeInsets = NSEdgeInsets(top: 0, left: 4, bottom: 0, right: 6)
        cell.addArrangedSubview(icon)
        cell.addArrangedSubview(name)
        cell.addArrangedSubview(NSView())
        cell.addArrangedSubview(count)
        return cell
    }

    private func makeWordCell(_ row: WordRow) -> NSView {
        let surface = NSTextField(labelWithString: row.surface)
        surface.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        surface.lineBreakMode = .byTruncatingTail
        surface.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(740), for: .horizontal)

        let reading = NSTextField(labelWithString: row.reading)
        reading.font = NSFont.systemFont(ofSize: 12)
        reading.textColor = .secondaryLabelColor
        reading.lineBreakMode = .byTruncatingTail
        reading.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(730), for: .horizontal)

        let topLine = NSStackView(views: [surface, reading])
        topLine.orientation = .horizontal
        topLine.alignment = .firstBaseline
        topLine.spacing = 8

        if row.saved {
            topLine.addArrangedSubview(makeInlineFlagIcon("bookmark.fill", tooltip: L.t("Saved")))
        }
        if row.pinned {
            topLine.addArrangedSubview(makeInlineFlagIcon("pin.fill", tooltip: L.t("Always Show Annotation")))
        }

        let meaning = NSTextField(labelWithString: row.meaning.isEmpty ? "—" : row.meaning)
        meaning.font = NSFont.systemFont(ofSize: 12)
        meaning.textColor = .secondaryLabelColor
        meaning.lineBreakMode = .byTruncatingTail
        meaning.maximumNumberOfLines = 1
        meaning.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(240), for: .horizontal)

        let text = NSStackView(views: [topLine, meaning])
        text.orientation = .vertical
        text.alignment = .leading
        text.spacing = 3

        let displayCount = row.summarySeenCount > 0 ? row.summarySeenCount : row.seenCount
        let count = NSTextField(labelWithString: "\(displayCount)×")
        count.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        count.textColor = .secondaryLabelColor

        let badge = makeStatusBadge(for: row)
        let actions = makeActionsButton(for: row)

        let cell = NSStackView()
        cell.orientation = .horizontal
        cell.alignment = .centerY
        cell.spacing = 10
        cell.edgeInsets = NSEdgeInsets(top: 6, left: 12, bottom: 6, right: 8)
        cell.wantsLayer = true
        cell.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        cell.layer?.cornerRadius = 8
        cell.addArrangedSubview(text)
        cell.addArrangedSubview(NSView())
        cell.addArrangedSubview(count)
        cell.addArrangedSubview(badge)
        cell.addArrangedSubview(actions)
        return cell
    }

    private func makeInlineFlagIcon(_ symbol: String, tooltip: String) -> NSImageView {
        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tooltip)
        icon.contentTintColor = .tertiaryLabelColor
        icon.toolTip = tooltip
        icon.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 10, weight: .regular)
        return icon
    }

    private func makeStatusBadge(for row: WordRow) -> NSView {
        let info = badgeInfo(for: row)

        let label = NSTextField(labelWithString: info.text)
        label.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        label.textColor = info.color

        let badge = NSStackView(views: [label])
        badge.orientation = .horizontal
        badge.edgeInsets = NSEdgeInsets(top: 2, left: 8, bottom: 2, right: 8)
        badge.wantsLayer = true
        badge.layer?.backgroundColor = info.color.withAlphaComponent(0.14).cgColor
        badge.layer?.cornerRadius = 9
        return badge
    }

    private func badgeInfo(for row: WordRow) -> (text: String, color: NSColor) {
        if row.ignored || row.lifecycleStatus == "ignored" { return (L.t("Ignored"), .systemGray) }
        if row.reviewStage == "lapsed" { return (L.t("Lapsed"), .systemOrange) }
        switch row.lifecycleStatus {
        case "learning": return (L.t("Learning"), .systemBlue)
        case "reviewing": return (L.t("Reviewing"), .systemIndigo)
        case "known", "mastered": return (L.t("Known"), .systemGreen)
        default: return (L.t("New"), .systemGray)
        }
    }

    private func makeActionsButton(for row: WordRow) -> NSPopUpButton {
        let button = NSPopUpButton(frame: .zero, pullsDown: true)
        button.bezelStyle = .rounded
        button.controlSize = .small

        let menu = NSMenu()
        let face = NSMenuItem(title: "", action: nil, keyEquivalent: "")
        face.image = NSImage(systemSymbolName: "ellipsis.circle", accessibilityDescription: "Word actions")
        menu.addItem(face)

        func add(_ titleKey: String, _ action: WordAction) {
            let item = NSMenuItem(title: L.t(titleKey), action: #selector(wordMenuItemClicked(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = "\(action.rawValue)|\(row.id)"
            menu.addItem(item)
        }

        let isIgnored = row.ignored || row.lifecycleStatus == "ignored"
        if !(row.saved && row.lifecycleStatus == "learning") { add("Save to Learning", .save) }
        if row.lifecycleStatus != "known" && row.lifecycleStatus != "mastered" { add("Mark as Known", .known) }
        if ["learning", "reviewing", "known", "mastered"].contains(row.lifecycleStatus) { add("Forgot This Word", .forgot) }
        if isIgnored { add("Restore", .restore) } else { add("Ignore", .ignore) }
        if !row.pinned { add("Always Show Annotation", .alwaysShow) }

        button.menu = menu
        button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        return button
    }

    // MARK: - Extension status

    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            DispatchQueue.main.async {
                if let error = error {
                    self.setStatus(L.f("Unable to read Safari extension status: %@", error.localizedDescription), color: .systemRed)
                    return
                }

                if state?.isEnabled == true {
                    self.setStatus(L.t("Safari extension enabled"), color: .systemGreen)
                } else {
                    self.setStatus(L.t("Extension disabled — enable it in Safari Settings › Extensions"), color: .systemOrange)
                }
            }
        }
    }

    private func setStatus(_ text: String, color: NSColor) {
        statusLabel.stringValue = text
        statusDot.layer?.backgroundColor = color.cgColor
    }

    // MARK: - Actions

    @objc private func refreshButtonClicked(_ sender: NSButton) {
        loadDashboard()
        refreshExtensionState()
    }

    @objc private func startReviewClicked(_ sender: NSButton) {
        guard !dueRows.isEmpty else { return }
        let queue = Array(dueRows.prefix(ReviewScheduler.sessionLimit))
        let session = ReviewSessionViewController(queue: queue, store: store) { [weak self] in
            self?.loadDashboard()
        }
        presentAsSheet(session)
    }

    @objc private func wordMenuItemClicked(_ sender: NSMenuItem) {
        guard
            let raw = sender.representedObject as? String,
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
            setStatus(L.f("Could not save word action: %@", error.localizedDescription), color: .systemRed)
        }
    }

    @objc private func openAppSettings() {
        let settings = AppSettingsViewController(store: store) { [weak self] in
            self?.loadDashboard()
        }
        presentAsSheet(settings)
    }
}

private enum VersionInfo {
    static func displayText() -> String {
        let appVersion = bundleVersionText(Bundle.main)
        let extensionVersion = safariExtensionVersionText()
        return "App \(appVersion) · Extension \(extensionVersion)"
    }

    private static func bundleVersionText(_ bundle: Bundle) -> String {
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "v\(version) (\(build))"
    }

    private static func safariExtensionVersionText() -> String {
        let extensionURL = Bundle.main.builtInPlugInsURL?
            .appendingPathComponent("Fading Furigana Extension.appex")
        guard
            let extensionURL,
            let extensionBundle = Bundle(url: extensionURL)
        else {
            return L.t("not installed")
        }
        return bundleVersionText(extensionBundle)
    }
}

final class AppStateStore {
    private static let appGroupIdentifier = "group.com.banyuguru.fading-furigana"
    private let fileManager = FileManager.default

    var displayPath: String {
        stateFileURL.path
    }

    private var stateFileURL: URL {
        Self.stateFileURL(fileManager: fileManager)
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

    func settingsDictionary() -> [String: Any] {
        loadRawState()["settings"] as? [String: Any] ?? [:]
    }

    // Mutates only the keys the caller touches so unknown settings fields
    // written by other clients round-trip intact.
    func updateSettings(_ mutate: (inout [String: Any]) -> Void) throws {
        var raw = loadRawState()
        var settings = raw["settings"] as? [String: Any] ?? [:]
        mutate(&settings)
        raw["settings"] = settings

        let now = ISO8601DateFormatter().string(from: Date())
        var metadata = raw["metadata"] as? [String: Any] ?? [:]
        metadata["updatedAt"] = now
        metadata["lastOpenedAt"] = now
        raw["metadata"] = metadata

        try save(raw)
    }

    func applyReview(_ result: ReviewResult, lexicalItemId: String) throws {
        var raw = loadRawState()
        var states = raw["userLexicalStates"] as? [String: Any] ?? [:]
        var userState = states[lexicalItemId] as? [String: Any] ?? createDefaultUserState(lexicalItemId: lexicalItemId)
        var learning = userState["learning"] as? [String: Any] ?? [:]
        var intelligence = userState["intelligence"] as? [String: Any] ?? [:]
        var reasonCodes = intelligence["reasonCodes"] as? [String] ?? []

        let now = Date()
        let nowText = ISO8601DateFormatter().string(from: now)
        let previousStreak = learning["correctStreak"] as? Int ?? 0
        let stageBefore = learning["reviewStage"] as? String ?? "new"
        let outcome = ReviewScheduler.outcome(for: result, previousStreak: previousStreak, now: now)
        let nextReviewText = ISO8601DateFormatter().string(from: outcome.nextReviewAt)

        learning["reviewStage"] = outcome.reviewStage
        learning["reviewCount"] = (learning["reviewCount"] as? Int ?? 0) + 1
        learning["correctStreak"] = outcome.correctStreak
        learning["lastReviewedAt"] = nowText
        learning["nextReviewAt"] = nextReviewText
        if result == .forgot {
            learning["wrongCount"] = (learning["wrongCount"] as? Int ?? 0) + 1
        } else {
            learning["correctCount"] = (learning["correctCount"] as? Int ?? 0) + 1
        }

        userState["lifecycleStatus"] = outcome.lifecycleStatus
        userState["knowledgeConfidence"] = outcome.knowledgeConfidence
        if let annotationLevel = outcome.annotationLevel {
            userState["annotationLevel"] = annotationLevel
        }
        if let reasonCode = outcome.reasonCode {
            appendUnique(reasonCode, to: &reasonCodes)
        }

        intelligence["reasonCodes"] = reasonCodes
        userState["learning"] = learning
        userState["intelligence"] = intelligence
        states[lexicalItemId] = userState
        raw["userLexicalStates"] = states

        // Append-only review log with a client-generated ID (sync contract).
        var reviewLogs = raw["reviewLogs"] as? [String: Any] ?? [:]
        let logId = "rl_\(UUID().uuidString.lowercased())"
        reviewLogs[logId] = [
            "id": logId,
            "lexicalItemId": lexicalItemId,
            "reviewedAt": nowText,
            "result": result.rawValue,
            "stageBefore": stageBefore,
            "stageAfter": outcome.reviewStage,
            "intervalDays": outcome.intervalDays,
            "nextReviewAt": nextReviewText,
            "source": "macos_app"
        ]
        raw["reviewLogs"] = reviewLogs

        var metadata = raw["metadata"] as? [String: Any] ?? [:]
        metadata["updatedAt"] = nowText
        metadata["lastOpenedAt"] = nowText
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

    private static func stateFileURL(fileManager: FileManager = .default) -> URL {
        if let appGroupURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) {
            return appGroupURL
                .appendingPathComponent("Library", isDirectory: true)
                .appendingPathComponent("Application Support", isDirectory: true)
                .appendingPathComponent("FadingFurigana", isDirectory: true)
                .appendingPathComponent("app-state-v1.json")
        }

        return URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("FadingFurigana", isDirectory: true)
            .appendingPathComponent("app-state-v1.json")
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

struct AppStateSnapshot {
    static let empty = AppStateSnapshot(raw: [:], hasLoadedState: false)

    let raw: [String: Any]
    let hasLoadedState: Bool
    let words: [WordRow]
    let todayTopRows: [WordRow]
    let weekTopRows: [WordRow]
    let suggestedRows: [WordRow]
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
        self.suggestedRows = Self.suggestedRows(weekTopRows: weekTopRows, allWords: words)
    }

    // Frequency-based learning suggestions: words the user keeps running into
    // but has not started learning, marked known, or dismissed.
    private static func suggestedRows(weekTopRows: [WordRow], allWords: [WordRow]) -> [WordRow] {
        func isCandidate(_ row: WordRow) -> Bool {
            row.lifecycleStatus == "new" && !row.saved && !row.ignored && !row.pinned
        }

        var suggested = weekTopRows.filter(isCandidate)
        let includedIds = Set(suggested.map(\.id))
        let allTimeExtras = allWords.filter { isCandidate($0) && $0.seenCount >= 2 && !includedIds.contains($0.id) }
        suggested.append(contentsOf: allTimeExtras)
        return Array(suggested.prefix(50))
    }

    var totalWordCount: Int {
        words.count
    }

    var learningCount: Int {
        words.filter { $0.lifecycleStatus == "learning" || $0.lifecycleStatus == "reviewing" }.count
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
        case .suggested:
            return suggestedRows
        case .learning:
            return words
                .filter { $0.lifecycleStatus == "learning" || $0.lifecycleStatus == "reviewing" }
                .sorted(by: WordRow.defaultSort)
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

struct WordRow {
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
    let reviewStage: String
    let nextReviewAt: String?
    var summarySeenCount: Int

    init(id: String, item: [String: Any], userState: [String: Any], summarySeenCount: Int) {
        let exposure = userState["exposure"] as? [String: Any] ?? [:]
        let userIntent = userState["userIntent"] as? [String: Any] ?? [:]
        let learning = userState["learning"] as? [String: Any] ?? [:]
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
        self.reviewStage = learning["reviewStage"] as? String ?? "new"
        self.nextReviewAt = learning["nextReviewAt"] as? String
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
