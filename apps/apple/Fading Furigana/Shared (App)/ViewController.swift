//
//  ViewController.swift
//  Shared (App)
//

#if os(iOS)
import UIKit
import WebKit

let extensionBundleIdentifier = "com.japanstudylab.fadingfurigana.Extension"

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
import StoreKit

let extensionBundleIdentifier = "com.japanstudylab.fadingfurigana.Extension"

enum WordAction: String {
    case save
    case known
    case forgot
    case ignore
    case alwaysShow
    case restore
}

struct AppEntitlementSummary {
    let tier: String
    let basicUnlocked: Bool
    let proUnlocked: Bool
    let trialDaysRemaining: Int?
    let basicStatus: String
    let verificationStatus: String
    let proStatus: String
    let developmentOverride: String

    var tierTitle: String {
        switch tier {
        case "trial": return L.t("Trial")
        case "basic": return L.t("Basic")
        case "pro": return L.t("Pro")
        case "expired": return L.t("Trial Expired")
        default: return L.t("Unknown")
        }
    }

    var trialDetail: String {
        if let trialDaysRemaining {
            return L.f("%d days remaining", trialDaysRemaining)
        }
        return L.t("Trial ended")
    }

    var basicStatusTitle: String {
        switch basicStatus {
        case "purchased": return L.t("Purchased")
        case "refunded": return L.t("Refunded")
        case "unknown": return L.t("Unknown")
        default: return L.t("Not purchased")
        }
    }
}

// Sidebar destinations: one per user intent (review now / manage words / pick new words).
enum AppSection: Int, CaseIterable {
    case today
    case library
    case discover

    var displayName: String {
        switch self {
        case .today: return L.t("Today")
        case .library: return L.t("Library")
        case .discover: return L.t("Discover")
        }
    }

    var symbolName: String {
        switch self {
        case .today: return "sun.max"
        case .library: return "books.vertical"
        case .discover: return "sparkles"
        }
    }
}

enum LibraryFilter: Int, CaseIterable {
    case all
    case learning
    case saved
    case known
    case ignored

    var displayName: String {
        switch self {
        case .all: return L.t("All")
        case .learning: return L.t("Learning")
        case .saved: return L.t("Saved")
        case .known: return L.t("Known")
        case .ignored: return L.t("Ignored")
        }
    }
}

enum DiscoverScope: Int, CaseIterable {
    case today
    case week
    case allTime

    var displayName: String {
        switch self {
        case .today: return L.t("Today")
        case .week: return L.t("7 Days")
        case .allTime: return L.t("All Time")
        }
    }
}

// Scroll-view document container that lays content out top-down.
final class FlippedStackContainer: NSView {
    override var isFlipped: Bool { true }
}

class ViewController: NSViewController, NSTableViewDataSource, NSTableViewDelegate {

    private let store = AppStateStore()
    private var snapshot = AppStateSnapshot.empty
    private var dueRows: [WordRow] = []
    private var currentRows: [WordRow] = []
    private var currentRowsShowSave = false

    private var selectedSection = AppSection.today
    private var libraryFilter = LibraryFilter.all
    private var libraryQuery = ""
    private var librarySortByRecent = false
    private var discoverScope = DiscoverScope.week
    private var extensionEnabled: Bool?
    private var isNavigationCollapsed = false
    private var appStateAutoRefreshTimer: Timer?
    private var lastObservedStateSignature: String?
    private var pendingUndoState: [String: Any]?
    private var transactionListener: Task<Void, Never>?
    private var hasPresentedBasicPaywallThisLaunch = false
    private var isPresentingBasicPaywall = false
    private var didConfigureWindow = false
    private var settingsWindowController: AppSettingsWindowController?
    #if os(macOS)
    private var loopbackIngestServer: LoopbackIngestServer?
    #endif
    private weak var splitView: NSSplitView?
    private weak var sidebarView: NSView?

    private let sidebarTable = NSTableView()
    private let wordTable = NSTableView()
    private let wordScrollView = NSScrollView()
    private let sidebarToggleButton = NSButton()
    private let sidebarRevealButton = NSButton()

    private let sectionTitleLabel = NSTextField(labelWithString: "")
    private let statusDot = NSView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let emptyStateLabel = NSTextField(wrappingLabelWithString: "")
    private let versionLabel = NSTextField(labelWithString: "")
    private let storePathLabel = NSTextField(labelWithString: "")
    private let updatedLabel = NSTextField(labelWithString: "")
    private let actionFeedbackLabel = NSTextField(labelWithString: "")
    private let undoButton = NSButton(title: "", target: nil, action: nil)

    private let todayScroll = NSScrollView()
    private let todayStack = NSStackView()
    private let onboardingContainer = NSStackView()
    private let libraryControlsRow = NSStackView()
    private let discoverControlsRow = NSStackView()
    private let tableContainer = NSView()

    private let searchField = NSSearchField()
    private let filterControl = NSSegmentedControl()
    private let sortPopup = NSPopUpButton()
    private let scopeControl = NSSegmentedControl()

    // Icon-button tooltips re-localized when the interface language changes.
    private var localizedTooltips: [(NSButton, String)] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        try? store.initializeEntitlementsIfNeeded()
        L.update(fromSettings: store.settingsDictionary())
        buildLayout()
        sidebarTable.selectRowIndexes(IndexSet(integer: 0), byExtendingSelection: false)
        loadDashboard()
        startAppStateAutoRefresh()
        startEntitlementSync()
        #if os(macOS)
        startLoopbackIngestServer()
        #endif
    }

    deinit {
        appStateAutoRefreshTimer?.invalidate()
        transactionListener?.cancel()
        #if os(macOS)
        loopbackIngestServer?.stop()
        #endif
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        guard let window = view.window else { return }
        configureWindowIfNeeded(window)
        maybePresentExpiredTrialPaywall()
    }

    #if os(macOS)
    private func startLoopbackIngestServer() {
        let server = LoopbackIngestServer(store: store)
        server.start()
        loopbackIngestServer = server
    }
    #endif

    private func configureWindowIfNeeded(_ window: NSWindow) {
        guard !didConfigureWindow else { return }
        didConfigureWindow = true

        window.styleMask.insert([.resizable, .miniaturizable])
        window.collectionBehavior.remove(.fullScreenNone)
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.minSize = NSSize(width: 760, height: 480)

        let autosaveName = "FadingFuriganaMainWindow"
        if !window.setFrameUsingName(autosaveName) {
            window.setContentSize(NSSize(width: 1000, height: 640))
            window.center()
        }
        window.setFrameAutosaveName(autosaveName)
    }

    override func viewDidLayout() {
        super.viewDidLayout()
        sidebarTable.sizeLastColumnToFit()
        wordTable.sizeLastColumnToFit()
    }

    // MARK: - StoreKit entitlement sync

    private static let basicProductId = "com.japanstudylab.fadingfurigana.basic.macos"

    /// Records StoreKit purchases into the local entitlement store and keeps listening for
    /// transactions that complete outside a direct `purchase()` call — an interrupted purchase
    /// sheet, Ask to Buy, or a purchase made on another device. Without this the transaction
    /// arrives on `Transaction.updates`, is never recorded locally, and stays unfinished.
    /// (StoreKit requires apps to iterate `Transaction.updates` at launch.)
    private func startEntitlementSync() {
        transactionListener = Task { [weak self] in
            await self?.applyCurrentEntitlements()
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                if transaction.productID == Self.basicProductId {
                    self?.unlockBasicIfNeeded()
                    await transaction.finish()
                }
            }
        }
    }

    private func applyCurrentEntitlements() async {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.productID == Self.basicProductId {
                unlockBasicIfNeeded()
                await transaction.finish()
            }
        }
    }

    private func unlockBasicIfNeeded() {
        guard store.entitlementSummary().basicStatus != "purchased" else { return }
        try? store.markBasicPurchased(verificationStatus: "verified")
        loadDashboard()
    }

    // MARK: - Layout

    private func buildLayout() {
        let splitView = NSSplitView()
        self.splitView = splitView
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
        sidebarView = sidebar
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

        configureIconButton(
            sidebarToggleButton,
            symbol: "sidebar.left",
            tooltip: "Collapse navigation",
            action: #selector(toggleNavigationClicked)
        )

        let title = NSTextField(labelWithString: "Fading Furigana")
        title.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        title.textColor = .secondaryLabelColor
        title.lineBreakMode = .byTruncatingTail

        let header = NSStackView(views: [title, NSView(), sidebarToggleButton])
        header.orientation = .horizontal
        header.alignment = .centerY
        header.spacing = 8
        header.edgeInsets = NSEdgeInsets(top: 12, left: 14, bottom: 6, right: 10)
        header.translatesAutoresizingMaskIntoConstraints = false

        let effect = NSVisualEffectView()
        effect.material = .sidebar
        effect.blendingMode = .behindWindow
        effect.addSubview(header)
        effect.addSubview(scroll)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            header.topAnchor.constraint(equalTo: effect.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: header.bottomAnchor),
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
        let today = makeTodaySection()
        let libraryControls = makeLibraryControlsRow()
        let discoverControls = makeDiscoverControlsRow()
        let table = makeWordTableContainer()
        let footer = makeFooterRow()

        column.addArrangedSubview(header)
        column.addArrangedSubview(today)
        column.addArrangedSubview(libraryControls)
        column.addArrangedSubview(discoverControls)
        column.addArrangedSubview(table)
        column.addArrangedSubview(footer)

        for child in [header, today, libraryControls, discoverControls, table, footer] {
            NSLayoutConstraint.activate([
                child.leadingAnchor.constraint(equalTo: column.leadingAnchor),
                child.trailingAnchor.constraint(equalTo: column.trailingAnchor)
            ])
        }
        today.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .vertical)
        table.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .vertical)
        return container
    }

    private func makeHeaderRow() -> NSView {
        sectionTitleLabel.font = NSFont.boldSystemFont(ofSize: 22)
        sectionTitleLabel.lineBreakMode = .byTruncatingTail

        configureIconButton(
            sidebarRevealButton,
            symbol: "sidebar.leading",
            tooltip: "Expand navigation",
            action: #selector(toggleNavigationClicked)
        )
        sidebarRevealButton.isHidden = true

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

        let refreshButton = makeIconButton(
            symbol: "arrow.clockwise",
            tooltip: "Refresh data from the local store",
            action: #selector(refreshButtonClicked(_:))
        )
        let settingsButton = makeIconButton(
            symbol: "gearshape",
            tooltip: "App settings",
            action: #selector(openSettings(_:))
        )

        let buttons = NSStackView(views: [refreshButton, settingsButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8

        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.addArrangedSubview(sidebarRevealButton)
        row.addArrangedSubview(titleStack)
        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        spacer.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        row.addArrangedSubview(spacer)
        row.addArrangedSubview(buttons)
        return row
    }

    // MARK: - Today section

    private func makeTodaySection() -> NSView {
        todayStack.orientation = .vertical
        todayStack.alignment = .leading
        todayStack.spacing = 16
        todayStack.translatesAutoresizingMaskIntoConstraints = false

        onboardingContainer.orientation = .vertical
        onboardingContainer.alignment = .leading
        onboardingContainer.spacing = 16

        let document = FlippedStackContainer()
        document.translatesAutoresizingMaskIntoConstraints = false
        document.addSubview(todayStack)

        todayScroll.documentView = document
        todayScroll.hasVerticalScroller = true
        todayScroll.drawsBackground = false
        todayScroll.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            todayStack.leadingAnchor.constraint(equalTo: document.leadingAnchor),
            todayStack.trailingAnchor.constraint(equalTo: document.trailingAnchor),
            todayStack.topAnchor.constraint(equalTo: document.topAnchor),
            todayStack.bottomAnchor.constraint(equalTo: document.bottomAnchor),
            document.leadingAnchor.constraint(equalTo: todayScroll.contentView.leadingAnchor),
            document.topAnchor.constraint(equalTo: todayScroll.contentView.topAnchor),
            document.widthAnchor.constraint(equalTo: todayScroll.contentView.widthAnchor)
        ])
        return todayScroll
    }

    private func rebuildToday() {
        todayStack.arrangedSubviews.forEach {
            todayStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }

        if shouldShowOnboarding {
            rebuildOnboarding()
            todayStack.addArrangedSubview(onboardingContainer)
            return
        }

        let hero = makeHeroCard()
        let metrics = makeTodayMetricsRow()
        let activity = makeLearningActivitySection()
        let suggested = makeSuggestedSection()

        todayStack.addArrangedSubview(hero)
        todayStack.addArrangedSubview(metrics)
        todayStack.addArrangedSubview(activity)
        todayStack.addArrangedSubview(suggested)

        for child in [hero, metrics, activity, suggested] {
            NSLayoutConstraint.activate([
                child.leadingAnchor.constraint(equalTo: todayStack.leadingAnchor),
                child.trailingAnchor.constraint(equalTo: todayStack.trailingAnchor)
            ])
        }
    }

    private func makeHeroCard() -> NSView {
        let due = dueRows.count
        let lapsed = snapshot.words.filter { $0.reviewStage == "lapsed" }.count

        let card = NSStackView()
        card.orientation = .horizontal
        card.alignment = .centerY
        card.spacing = 16
        card.edgeInsets = NSEdgeInsets(top: 18, left: 20, bottom: 18, right: 20)
        card.wantsLayer = true
        card.layer?.cornerRadius = 12

        let textStack = NSStackView()
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 4

        if due > 0 {
            card.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.12).cgColor

            let number = NSTextField(labelWithString: "\(due)")
            number.font = NSFont.monospacedDigitSystemFont(ofSize: 40, weight: .semibold)
            number.textColor = .controlAccentColor

            let caption = NSTextField(labelWithString: L.t("words due for review"))
            caption.font = NSFont.systemFont(ofSize: 15, weight: .medium)

            let countRow = NSStackView(views: [number, caption])
            countRow.orientation = .horizontal
            countRow.alignment = .lastBaseline
            countRow.spacing = 6
            textStack.addArrangedSubview(countRow)

            if lapsed > 0 {
                let sub = NSTextField(labelWithString: L.f("%d lapsed words come first", lapsed))
                sub.font = NSFont.systemFont(ofSize: 12)
                sub.textColor = .secondaryLabelColor
                textStack.addArrangedSubview(sub)
            }

            let button = NSButton(title: L.t("Start Review"), target: self, action: #selector(startReviewClicked(_:)))
            button.bezelStyle = .rounded
            button.controlSize = .large
            button.keyEquivalent = "\r"

            card.addArrangedSubview(textStack)
            card.addArrangedSubview(NSView())
            card.addArrangedSubview(button)
        } else {
            card.layer?.backgroundColor = NSColor.systemGreen.withAlphaComponent(0.10).cgColor

            let check = NSImageView()
            check.image = NSImage(systemSymbolName: "checkmark.circle.fill", accessibilityDescription: nil)
            check.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 26, weight: .semibold)
            check.contentTintColor = .systemGreen

            let title = NSTextField(labelWithString: L.t("All reviews done"))
            title.font = NSFont.systemFont(ofSize: 16, weight: .semibold)

            let caption = NSTextField(labelWithString: L.t("Browse Japanese pages to collect new words."))
            caption.font = NSFont.systemFont(ofSize: 12)
            caption.textColor = .secondaryLabelColor

            textStack.addArrangedSubview(title)
            textStack.addArrangedSubview(caption)

            card.addArrangedSubview(check)
            card.addArrangedSubview(textStack)
            card.addArrangedSubview(NSView())
        }
        return card
    }

    private func makeTodayMetricsRow() -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal
        row.spacing = 10
        row.distribution = .fillEqually

        row.addArrangedSubview(makeMetricCard(title: L.t("Seen Today"), value: "\(snapshot.todaySeenCount)"))
        row.addArrangedSubview(makeMetricCard(title: L.t("Reviewed today"), value: "\(snapshot.reviewedTodayCount)"))
        row.addArrangedSubview(makeMetricCard(title: L.t("Learning"), value: "\(snapshot.learningCount)"))
        row.addArrangedSubview(makeMetricCard(title: L.t("Vocabulary"), value: "\(snapshot.totalWordCount)"))
        return row
    }

    private func makeMetricCard(title: String, value: String) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        label.textColor = .secondaryLabelColor

        let valueLabel = NSTextField(labelWithString: value)
        valueLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 20, weight: .semibold)
        valueLabel.textColor = .labelColor

        let stack = NSStackView(views: [label, valueLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        stack.edgeInsets = NSEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        stack.wantsLayer = true
        stack.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        stack.layer?.cornerRadius = 8
        return stack
    }

    private func makeLearningActivitySection() -> NSView {
        let section = NSStackView()
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 8

        let total = snapshot.activityDays.reduce(0) { $0 + $1.activityCount }
        let title = NSTextField(labelWithString: L.f("%d learning activities in the last year", total))
        title.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        title.textColor = .secondaryLabelColor

        let grid = makeActivityHeatmap(days: snapshot.activityDays)

        let legend = makeActivityLegend()
        let legendRow = NSStackView(views: [NSView(), legend])
        legendRow.orientation = .horizontal
        legendRow.alignment = .centerY

        section.addArrangedSubview(title)
        section.addArrangedSubview(grid)
        section.addArrangedSubview(legendRow)

        for child in [grid, legendRow] {
            NSLayoutConstraint.activate([
                child.leadingAnchor.constraint(equalTo: section.leadingAnchor),
                child.trailingAnchor.constraint(equalTo: section.trailingAnchor)
            ])
        }
        return section
    }

    private func makeActivityHeatmap(days: [LearningActivityDay]) -> NSView {
        let container = NSView()
        let cellSize: CGFloat = 10
        let cellGap: CGFloat = 3
        let labelWidth: CGFloat = 34
        let monthLabelHeight: CGFloat = 18
        let columns = max(1, Int(ceil(Double(days.count) / 7.0)))

        let gridLayer = FlippedStackContainer()
        gridLayer.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(gridLayer)

        NSLayoutConstraint.activate([
            gridLayer.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: labelWidth),
            gridLayer.topAnchor.constraint(equalTo: container.topAnchor, constant: monthLabelHeight),
            gridLayer.widthAnchor.constraint(equalToConstant: CGFloat(columns) * cellSize + CGFloat(columns - 1) * cellGap),
            gridLayer.heightAnchor.constraint(equalToConstant: 7 * cellSize + 6 * cellGap),
            container.widthAnchor.constraint(greaterThanOrEqualTo: gridLayer.widthAnchor, constant: labelWidth),
            container.heightAnchor.constraint(equalToConstant: monthLabelHeight + 7 * cellSize + 6 * cellGap)
        ])

        for (index, day) in days.enumerated() {
            let column = index / 7
            let row = index % 7
            let cell = NSView(frame: NSRect(
                x: CGFloat(column) * (cellSize + cellGap),
                y: CGFloat(row) * (cellSize + cellGap),
                width: cellSize,
                height: cellSize
            ))
            cell.wantsLayer = true
            cell.layer?.cornerRadius = 2
            cell.layer?.backgroundColor = activityColor(level: activityLevel(for: day.activityCount)).cgColor
            cell.toolTip = activityTooltip(for: day)
            gridLayer.addSubview(cell)
        }

        let calendar = Calendar.current
        var lastMonth = -1
        for (index, day) in days.enumerated() where index % 7 == 0 {
            let month = calendar.component(.month, from: day.date)
            guard month != lastMonth else { continue }
            lastMonth = month

            let label = NSTextField(labelWithString: Self.activityMonthFormatter.string(from: day.date))
            label.font = NSFont.systemFont(ofSize: 10)
            label.textColor = .secondaryLabelColor
            label.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(label)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(equalTo: gridLayer.leadingAnchor, constant: CGFloat(index / 7) * (cellSize + cellGap)),
                label.topAnchor.constraint(equalTo: container.topAnchor)
            ])
        }

        for (title, row) in [(L.t("Mon"), 1), (L.t("Wed"), 3), (L.t("Fri"), 5)] {
            let label = NSTextField(labelWithString: title)
            label.font = NSFont.systemFont(ofSize: 10)
            label.textColor = .secondaryLabelColor
            label.alignment = .right
            label.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(label)
            NSLayoutConstraint.activate([
                label.trailingAnchor.constraint(equalTo: gridLayer.leadingAnchor, constant: -8),
                label.centerYAnchor.constraint(equalTo: gridLayer.topAnchor, constant: CGFloat(row) * (cellSize + cellGap) + cellSize / 2)
            ])
        }
        return container
    }

    private func makeActivityLegend() -> NSView {
        let views: [NSView] = [
            NSTextField(labelWithString: L.t("Less")),
            makeLegendCell(level: 0),
            makeLegendCell(level: 1),
            makeLegendCell(level: 2),
            makeLegendCell(level: 3),
            makeLegendCell(level: 4),
            NSTextField(labelWithString: L.t("More"))
        ]
        let row = NSStackView(views: views)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 5
        for case let label as NSTextField in views {
            label.font = NSFont.systemFont(ofSize: 11)
            label.textColor = .secondaryLabelColor
        }
        return row
    }

    private func makeLegendCell(level: Int) -> NSView {
        let cell = NSView()
        cell.wantsLayer = true
        cell.layer?.cornerRadius = 2
        cell.layer?.backgroundColor = activityColor(level: level).cgColor
        cell.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            cell.widthAnchor.constraint(equalToConstant: 10),
            cell.heightAnchor.constraint(equalToConstant: 10)
        ])
        return cell
    }

    private func activityLevel(for count: Int) -> Int {
        switch count {
        case 0: return 0
        case 1: return 1
        case 2...4: return 2
        case 5...8: return 3
        default: return 4
        }
    }

    private func activityColor(level: Int) -> NSColor {
        switch level {
        case 1: return NSColor.systemGreen.withAlphaComponent(0.35)
        case 2: return NSColor.systemGreen.withAlphaComponent(0.55)
        case 3: return NSColor.systemGreen.withAlphaComponent(0.78)
        case 4: return NSColor.systemGreen
        default: return NSColor.separatorColor.withAlphaComponent(0.35)
        }
    }

    private func activityTooltip(for day: LearningActivityDay) -> String {
        let date = Self.activityTooltipDateFormatter.string(from: day.date)
        if day.activityCount == 0 {
            return L.f("No learning activity on %@", date)
        }
        return L.f(
            "%d activities on %@ (%d words seen, %d reviews)",
            day.activityCount,
            date,
            day.seenWordCount,
            day.reviewCount
        )
    }

    private func makeSuggestedSection() -> NSView {
        let section = NSStackView()
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 8

        let headerLabel = NSTextField(labelWithString: L.t("Suggested to learn"))
        headerLabel.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        headerLabel.textColor = .secondaryLabelColor

        let viewAll = makeTextButton(L.t("View all"), action: #selector(viewAllSuggestionsClicked))
        viewAll.controlSize = .small

        let headerRow = NSStackView(views: [headerLabel, NSView(), viewAll])
        headerRow.orientation = .horizontal
        headerRow.alignment = .centerY
        headerRow.spacing = 8

        section.addArrangedSubview(headerRow)

        let rows = Array(snapshot.suggestedRows.prefix(3))
        if rows.isEmpty {
            let empty = NSTextField(labelWithString: L.t("No suggestions yet — keep browsing."))
            empty.font = NSFont.systemFont(ofSize: 12)
            empty.textColor = .tertiaryLabelColor
            section.addArrangedSubview(empty)
        } else {
            for row in rows {
                let cell = makeWordCell(row, withSaveButton: true)
                section.addArrangedSubview(cell)
                NSLayoutConstraint.activate([
                    cell.leadingAnchor.constraint(equalTo: section.leadingAnchor),
                    cell.trailingAnchor.constraint(equalTo: section.trailingAnchor)
                ])
            }
        }

        NSLayoutConstraint.activate([
            headerRow.leadingAnchor.constraint(equalTo: section.leadingAnchor),
            headerRow.trailingAnchor.constraint(equalTo: section.trailingAnchor)
        ])
        return section
    }

    // MARK: - Library / Discover controls

    private func makeLibraryControlsRow() -> NSView {
        searchField.sendsSearchStringImmediately = true
        searchField.target = self
        searchField.action = #selector(searchChanged(_:))
        searchField.widthAnchor.constraint(equalToConstant: 220).isActive = true

        filterControl.segmentCount = LibraryFilter.allCases.count
        filterControl.trackingMode = .selectOne
        filterControl.target = self
        filterControl.action = #selector(libraryFilterChanged(_:))
        filterControl.selectedSegment = 0

        sortPopup.target = self
        sortPopup.action = #selector(sortChanged(_:))

        libraryControlsRow.orientation = .horizontal
        libraryControlsRow.alignment = .centerY
        libraryControlsRow.spacing = 10
        libraryControlsRow.addArrangedSubview(searchField)
        libraryControlsRow.addArrangedSubview(filterControl)
        libraryControlsRow.addArrangedSubview(NSView())
        libraryControlsRow.addArrangedSubview(sortPopup)
        return libraryControlsRow
    }

    private func makeDiscoverControlsRow() -> NSView {
        scopeControl.segmentCount = DiscoverScope.allCases.count
        scopeControl.trackingMode = .selectOne
        scopeControl.target = self
        scopeControl.action = #selector(scopeChanged(_:))
        scopeControl.selectedSegment = discoverScope.rawValue

        discoverControlsRow.orientation = .horizontal
        discoverControlsRow.alignment = .centerY
        discoverControlsRow.spacing = 10
        discoverControlsRow.addArrangedSubview(scopeControl)
        discoverControlsRow.addArrangedSubview(NSView())
        return discoverControlsRow
    }

    private func refreshLibraryControls() {
        searchField.placeholderString = L.t("Search words")
        for (index, filter) in LibraryFilter.allCases.enumerated() {
            filterControl.setLabel("\(filter.displayName) \(snapshot.libraryCount(for: filter))", forSegment: index)
        }
        filterControl.selectedSegment = libraryFilter.rawValue

        let selectedSort = librarySortByRecent ? 1 : 0
        sortPopup.removeAllItems()
        sortPopup.addItems(withTitles: [L.t("Most seen"), L.t("Recently seen")])
        sortPopup.selectItem(at: selectedSort)
    }

    private func refreshDiscoverControls() {
        for (index, scope) in DiscoverScope.allCases.enumerated() {
            scopeControl.setLabel(scope.displayName, forSegment: index)
        }
        scopeControl.selectedSegment = discoverScope.rawValue
    }

    // MARK: - Word table container

    private func makeWordTableContainer() -> NSView {
        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("word"))
        column.minWidth = 200
        wordTable.addTableColumn(column)
        wordTable.headerView = nil
        wordTable.rowHeight = 64
        wordTable.intercellSpacing = NSSize(width: 0, height: 6)
        wordTable.selectionHighlightStyle = .none
        wordTable.backgroundColor = .clear
        wordTable.focusRingType = .none
        wordTable.dataSource = self
        wordTable.delegate = self
        wordTable.target = self
        wordTable.doubleAction = #selector(openSelectedWordDetail)

        wordScrollView.documentView = wordTable
        wordScrollView.hasVerticalScroller = true
        wordScrollView.drawsBackground = false
        wordScrollView.translatesAutoresizingMaskIntoConstraints = false

        emptyStateLabel.font = NSFont.systemFont(ofSize: 13)
        emptyStateLabel.textColor = .secondaryLabelColor
        emptyStateLabel.alignment = .center
        emptyStateLabel.maximumNumberOfLines = 3
        emptyStateLabel.translatesAutoresizingMaskIntoConstraints = false
        emptyStateLabel.isHidden = true

        tableContainer.addSubview(wordScrollView)
        tableContainer.addSubview(emptyStateLabel)

        NSLayoutConstraint.activate([
            wordScrollView.leadingAnchor.constraint(equalTo: tableContainer.leadingAnchor),
            wordScrollView.trailingAnchor.constraint(equalTo: tableContainer.trailingAnchor),
            wordScrollView.topAnchor.constraint(equalTo: tableContainer.topAnchor),
            wordScrollView.bottomAnchor.constraint(equalTo: tableContainer.bottomAnchor),
            emptyStateLabel.centerXAnchor.constraint(equalTo: tableContainer.centerXAnchor),
            emptyStateLabel.centerYAnchor.constraint(equalTo: tableContainer.centerYAnchor),
            emptyStateLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            tableContainer.heightAnchor.constraint(greaterThanOrEqualToConstant: 200)
        ])
        return tableContainer
    }

    private func makeFooterRow() -> NSView {
        versionLabel.font = NSFont.systemFont(ofSize: 10)
        versionLabel.textColor = .tertiaryLabelColor

        storePathLabel.font = NSFont.systemFont(ofSize: 10)
        storePathLabel.textColor = .tertiaryLabelColor
        storePathLabel.lineBreakMode = .byTruncatingMiddle
        storePathLabel.maximumNumberOfLines = 1

        updatedLabel.font = NSFont.systemFont(ofSize: 10)
        updatedLabel.textColor = .tertiaryLabelColor
        updatedLabel.maximumNumberOfLines = 1

        actionFeedbackLabel.font = NSFont.systemFont(ofSize: 11, weight: .medium)
        actionFeedbackLabel.textColor = .secondaryLabelColor
        actionFeedbackLabel.lineBreakMode = .byTruncatingTail
        actionFeedbackLabel.isHidden = true

        undoButton.title = L.t("Undo")
        undoButton.target = self
        undoButton.action = #selector(undoLastWordActionClicked(_:))
        undoButton.bezelStyle = .rounded
        undoButton.controlSize = .small
        undoButton.isHidden = true

        let row = NSStackView()
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 12
        row.addArrangedSubview(versionLabel)
        row.addArrangedSubview(storePathLabel)
        row.addArrangedSubview(NSView())
        row.addArrangedSubview(actionFeedbackLabel)
        row.addArrangedSubview(undoButton)
        row.addArrangedSubview(updatedLabel)
        return row
    }

    private func makeTextButton(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        return button
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

    private func configureIconButton(_ button: NSButton, symbol: String, tooltip: String, action: Selector) {
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: tooltip)
        button.target = self
        button.action = action
        button.bezelStyle = .rounded
        button.controlSize = .large
        button.toolTip = L.t(tooltip)
    }

    private func applyStaticTexts() {
        for (button, key) in localizedTooltips {
            button.toolTip = L.t(key)
        }
        undoButton.title = L.t("Undo")
        updateNavigationToggleButtons()
    }

    private func updateNavigationToggleButtons() {
        sidebarRevealButton.isHidden = !isNavigationCollapsed
        sidebarRevealButton.image = NSImage(systemSymbolName: "sidebar.leading", accessibilityDescription: "Expand navigation")
        sidebarRevealButton.toolTip = L.t("Expand navigation")
        sidebarToggleButton.image = NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: "Collapse navigation")
        sidebarToggleButton.toolTip = L.t("Collapse navigation")
    }

    // MARK: - Data

    private func relativeTimeText(_ iso: String?) -> String {
        guard let date = ReviewScheduler.parseISODate(iso) else { return L.t("never") }
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 { return L.t("just now") }
        if seconds < 3600 { return L.f("%d min ago", seconds / 60) }
        if seconds < 86_400 { return L.f("%d h ago", seconds / 3600) }
        return L.f("%d d ago", seconds / 86_400)
    }

    private static let activityMonthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.setLocalizedDateFormatFromTemplate("MMM")
        return formatter
    }()

    private static let activityTooltipDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    private func loadDashboard() {
        snapshot = store.loadSnapshot()
        lastObservedStateSignature = store.stateSignature()
        L.update(fromSettings: snapshot.raw["settings"] as? [String: Any] ?? [:])
        AppDelegate.rebuildMainMenu()
        versionLabel.stringValue = VersionInfo.displayText()
        let storageMode = store.isUsingAppGroup ? L.t("Shared container") : L.t("Local fallback")
        storePathLabel.stringValue = L.f("Storage: %@", storageMode)
        storePathLabel.toolTip = store.displayPath
        let updatedAt = (snapshot.raw["metadata"] as? [String: Any])?["updatedAt"] as? String
        updatedLabel.stringValue = L.f("Updated %@", relativeTimeText(updatedAt))
        renderSnapshot()
        // Re-localized here too: the status text is set asynchronously, so a
        // language change (settings sheet close -> loadDashboard) must re-issue it.
        refreshExtensionState()
    }

    private func startAppStateAutoRefresh() {
        appStateAutoRefreshTimer?.invalidate()
        appStateAutoRefreshTimer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshIfAppStateChanged()
        }
        if let appStateAutoRefreshTimer {
            RunLoop.main.add(appStateAutoRefreshTimer, forMode: .common)
        }
    }

    private func refreshIfAppStateChanged() {
        let signature = store.stateSignature()
        guard signature != lastObservedStateSignature else { return }
        loadDashboard()
    }

    private func renderSnapshot() {
        applyStaticTexts()
        dueRows = ReviewScheduler.dueWords(in: snapshot.words)

        let selected = max(sidebarTable.selectedRow, 0)
        sidebarTable.reloadData()
        sidebarTable.selectRowIndexes(IndexSet(integer: selected), byExtendingSelection: false)
        renderSection()
    }

    private func renderSection() {
        sectionTitleLabel.stringValue = selectedSection.displayName
        todayScroll.isHidden = selectedSection != .today
        libraryControlsRow.isHidden = selectedSection != .library
        discoverControlsRow.isHidden = selectedSection != .discover
        tableContainer.isHidden = selectedSection == .today

        switch selectedSection {
        case .today:
            rebuildToday()
        case .library:
            refreshLibraryControls()
            currentRows = Array(snapshot.libraryRows(filter: libraryFilter, search: libraryQuery, sortByRecent: librarySortByRecent).prefix(300))
            currentRowsShowSave = false
            emptyStateLabel.stringValue = libraryQuery.isEmpty
                ? L.t("No words in this list yet.")
                : L.t("No matches.")
            reloadWordTable()
        case .discover:
            refreshDiscoverControls()
            currentRows = Array(snapshot.discoverRows(scope: discoverScope).prefix(200))
            currentRowsShowSave = true
            emptyStateLabel.stringValue = L.t("Keep browsing Japanese pages — frequently seen new words will appear here.")
            reloadWordTable()
        }
    }

    private func reloadWordTable() {
        wordTable.reloadData()
        wordTable.sizeLastColumnToFit()
        emptyStateLabel.isHidden = !currentRows.isEmpty
    }

    // Onboarding replaces the Today content until the first word arrives;
    // an extension problem alone is surfaced by the header status instead.
    private var shouldShowOnboarding: Bool {
        snapshot.totalWordCount == 0
    }

    private func rebuildOnboarding() {
        onboardingContainer.arrangedSubviews.forEach {
            onboardingContainer.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }

        let title = NSTextField(labelWithString: L.t("Let's get started"))
        title.font = NSFont.boldSystemFont(ofSize: 20)

        let intro = NSTextField(wrappingLabelWithString: L.t("Fading Furigana annotates Japanese as you browse in Safari, then helps you review here."))
        intro.font = NSFont.systemFont(ofSize: 13)
        intro.textColor = .secondaryLabelColor
        intro.maximumNumberOfLines = 2
        intro.preferredMaxLayoutWidth = 500

        let enabled = extensionEnabled == true
        let statusText = extensionEnabled == nil
            ? nil
            : (enabled ? L.t("Enabled") : L.t("Not enabled yet"))
        let step1Button = makeTextButton(L.t("Open Safari Extension Settings…"), action: #selector(openSafariExtensionPreferences))
        let step1 = makeOnboardingStep(
            number: 1,
            done: enabled,
            title: L.t("Enable the Safari extension"),
            subtitle: L.t("Turn on Fading Furigana in Safari Settings › Extensions, and allow it on the sites you read."),
            statusText: statusText,
            statusOk: enabled,
            control: step1Button
        )
        let step2 = makeOnboardingStep(
            number: 2,
            done: false,
            title: L.t("Browse Japanese web pages"),
            subtitle: L.t("Readings appear above kanji and katakana. Tap a word to save, mark known, or ignore it."),
            statusText: nil,
            statusOk: false,
            control: nil
        )
        let step3Button = makeTextButton(L.t("Refresh"), action: #selector(refreshButtonClicked(_:)))
        let step3 = makeOnboardingStep(
            number: 3,
            done: false,
            title: L.t("Come back to review"),
            subtitle: L.t("Your words, stats, and review queue show up here. Click Refresh after browsing."),
            statusText: nil,
            statusOk: false,
            control: step3Button
        )

        onboardingContainer.addArrangedSubview(title)
        onboardingContainer.addArrangedSubview(intro)
        onboardingContainer.addArrangedSubview(step1)
        onboardingContainer.addArrangedSubview(step2)
        onboardingContainer.addArrangedSubview(step3)
    }

    private func makeOnboardingStep(
        number: Int,
        done: Bool,
        title: String,
        subtitle: String,
        statusText: String?,
        statusOk: Bool,
        control: NSView?
    ) -> NSView {
        let badge = NSTextField(labelWithString: done ? "✓" : "\(number)")
        badge.alignment = .center
        badge.font = NSFont.boldSystemFont(ofSize: 13)
        badge.textColor = .white
        badge.wantsLayer = true
        badge.layer?.backgroundColor = (done ? NSColor.systemGreen : NSColor.systemBlue).cgColor
        badge.layer?.cornerRadius = 12
        NSLayoutConstraint.activate([
            badge.widthAnchor.constraint(equalToConstant: 24),
            badge.heightAnchor.constraint(equalToConstant: 24)
        ])

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.systemFont(ofSize: 14, weight: .semibold)

        let subtitleLabel = NSTextField(wrappingLabelWithString: subtitle)
        subtitleLabel.font = NSFont.systemFont(ofSize: 12)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.maximumNumberOfLines = 3
        subtitleLabel.preferredMaxLayoutWidth = 460

        let textStack = NSStackView(views: [titleLabel, subtitleLabel])
        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 2

        if let statusText {
            let status = NSTextField(labelWithString: statusText)
            status.font = NSFont.systemFont(ofSize: 11, weight: .medium)
            status.textColor = statusOk ? .systemGreen : .systemOrange
            textStack.addArrangedSubview(status)
        }
        if let control {
            textStack.addArrangedSubview(control)
        }

        let row = NSStackView(views: [badge, textStack])
        row.orientation = .horizontal
        row.alignment = .top
        row.spacing = 12
        return row
    }

    // MARK: - Table view data source / delegate

    func numberOfRows(in tableView: NSTableView) -> Int {
        if tableView === sidebarTable { return AppSection.allCases.count }
        return currentRows.count
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        if tableView === sidebarTable {
            guard row < AppSection.allCases.count else { return nil }
            return makeSidebarCell(for: AppSection.allCases[row])
        }
        guard row < currentRows.count else { return nil }
        return makeWordCell(currentRows[row], withSaveButton: currentRowsShowSave)
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        guard (notification.object as? NSTableView) === sidebarTable else { return }
        let index = sidebarTable.selectedRow
        guard index >= 0, index < AppSection.allCases.count else { return }
        selectedSection = AppSection.allCases[index]
        renderSection()
    }

    private func makeSidebarCell(for section: AppSection) -> NSView {
        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: section.symbolName, accessibilityDescription: nil)
        icon.contentTintColor = .secondaryLabelColor
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 18)
        ])

        let name = NSTextField(labelWithString: section.displayName)
        name.font = NSFont.systemFont(ofSize: 13)
        name.lineBreakMode = .byTruncatingTail

        let countValue: Int
        switch section {
        case .today: countValue = dueRows.count
        case .library: countValue = snapshot.totalWordCount
        case .discover: countValue = snapshot.discoverRows(scope: discoverScope).count
        }
        let count = NSTextField(labelWithString: "\(countValue)")
        count.font = NSFont.systemFont(ofSize: 11)
        count.textColor = section == .today && countValue > 0 ? .controlAccentColor : .secondaryLabelColor

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

    private func makeWordCell(_ row: WordRow, withSaveButton: Bool = false) -> NSView {
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

        // Context preview for words the user is actually working on.
        let learningStatuses = ["learning", "reviewing"]
        if row.saved || learningStatuses.contains(row.lifecycleStatus), let sentence = row.exampleSentence {
            let example = NSTextField(labelWithString: sentence)
            example.font = NSFont.systemFont(ofSize: 11)
            example.textColor = .tertiaryLabelColor
            example.lineBreakMode = .byTruncatingTail
            example.maximumNumberOfLines = 1
            example.setContentCompressionResistancePriority(NSLayoutConstraint.Priority(230), for: .horizontal)
            text.addArrangedSubview(example)
        }

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
        if withSaveButton && !row.saved {
            let save = NSButton(title: L.t("Save"), target: self, action: #selector(saveWordClicked(_:)))
            save.bezelStyle = .rounded
            save.controlSize = .small
            save.identifier = NSUserInterfaceItemIdentifier(row.id)
            cell.addArrangedSubview(save)
        }
        let details = NSButton(
            image: NSImage(systemSymbolName: "info.circle", accessibilityDescription: L.t("Word details")) ?? NSImage(),
            target: self,
            action: #selector(openWordDetailButtonClicked(_:))
        )
        details.bezelStyle = .rounded
        details.controlSize = .small
        details.toolTip = L.t("Word details")
        details.identifier = NSUserInterfaceItemIdentifier(row.id)
        details.widthAnchor.constraint(equalToConstant: 34).isActive = true
        cell.addArrangedSubview(details)
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

                let enabled = state?.isEnabled == true
                self.extensionEnabled = enabled
                if enabled {
                    self.setStatus(L.t("Safari extension enabled"), color: .systemGreen)
                } else {
                    self.setStatus(L.t("Extension disabled — enable it in Safari Settings › Extensions"), color: .systemOrange)
                }
                if self.selectedSection == .today {
                    self.renderSection()
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
    }

    @objc private func toggleNavigationClicked(_ sender: NSButton) {
        isNavigationCollapsed.toggle()
        sidebarView?.isHidden = isNavigationCollapsed
        splitView?.adjustSubviews()
        updateNavigationToggleButtons()
    }

    @objc private func startReviewClicked(_ sender: NSButton) {
        guard !dueRows.isEmpty else { return }
        let queue = Array(dueRows.prefix(ReviewScheduler.sessionLimit))
        let session = ReviewSessionViewController(queue: queue, store: store) { [weak self] in
            self?.loadDashboard()
        }
        presentAsSheet(session)
    }

    @objc private func openSelectedWordDetail() {
        let rowIndex = wordTable.clickedRow >= 0 ? wordTable.clickedRow : wordTable.selectedRow
        guard rowIndex >= 0, rowIndex < currentRows.count else { return }
        presentWordDetail(currentRows[rowIndex])
    }

    @objc private func openWordDetailButtonClicked(_ sender: NSButton) {
        guard let wordId = sender.identifier?.rawValue else { return }
        guard let row = currentRows.first(where: { $0.id == wordId })
            ?? snapshot.suggestedRows.first(where: { $0.id == wordId })
            ?? snapshot.words.first(where: { $0.id == wordId })
        else {
            return
        }
        presentWordDetail(row)
    }

    private func presentWordDetail(_ row: WordRow) {
        let detail = WordDetailViewController(row: row) { [weak self] action, wordId in
            guard let self else { return }
            self.performWordActionWithStatus(action, lexicalItemId: wordId)
        }
        presentAsSheet(detail)
    }

    @objc private func saveWordClicked(_ sender: NSButton) {
        guard let wordId = sender.identifier?.rawValue, !wordId.isEmpty else { return }
        performWordActionWithStatus(.save, lexicalItemId: wordId)
    }

    @objc private func searchChanged(_ sender: NSSearchField) {
        libraryQuery = sender.stringValue
        renderSection()
    }

    @objc private func libraryFilterChanged(_ sender: NSSegmentedControl) {
        libraryFilter = LibraryFilter(rawValue: sender.selectedSegment) ?? .all
        renderSection()
    }

    @objc private func sortChanged(_ sender: NSPopUpButton) {
        librarySortByRecent = sender.indexOfSelectedItem == 1
        renderSection()
    }

    @objc private func scopeChanged(_ sender: NSSegmentedControl) {
        discoverScope = DiscoverScope(rawValue: sender.selectedSegment) ?? .week
        renderSection()
        // The Discover sidebar count follows the selected scope.
        let selected = max(sidebarTable.selectedRow, 0)
        sidebarTable.reloadData()
        sidebarTable.selectRowIndexes(IndexSet(integer: selected), byExtendingSelection: false)
    }

    @objc private func viewAllSuggestionsClicked(_ sender: NSButton) {
        sidebarTable.selectRowIndexes(IndexSet(integer: AppSection.discover.rawValue), byExtendingSelection: false)
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

        performWordActionWithStatus(action, lexicalItemId: wordId)
    }

    private func performWordActionWithStatus(_ action: WordAction, lexicalItemId: String) {
        if action == .save && !store.entitlementSummary().basicUnlocked {
            presentBasicPaywall(closingAttachedSheet: true)
            return
        }

        do {
            try performWordAction(action, lexicalItemId: lexicalItemId)
        } catch {
            setStatus(L.f("Could not save word action: %@", error.localizedDescription), color: .systemRed)
        }
    }

    private func performWordAction(_ action: WordAction, lexicalItemId: String) throws {
        let undoState = store.rawStateForUndo()
        try store.apply(action: action, lexicalItemId: lexicalItemId)
        pendingUndoState = undoState
        loadDashboard()
        showActionFeedback(actionFeedbackText(for: action), canUndo: true)
    }

    private func actionFeedbackText(for action: WordAction) -> String {
        switch action {
        case .save: return L.t("Saved to learning.")
        case .known: return L.t("Marked as known.")
        case .forgot: return L.t("Marked as forgotten.")
        case .ignore: return L.t("Ignored.")
        case .alwaysShow: return L.t("Always showing annotations.")
        case .restore: return L.t("Restored.")
        }
    }

    private func showActionFeedback(_ text: String, canUndo: Bool) {
        actionFeedbackLabel.stringValue = text
        actionFeedbackLabel.isHidden = false
        undoButton.isHidden = !canUndo
    }

    @objc private func undoLastWordActionClicked(_ sender: NSButton) {
        guard let pendingUndoState else { return }
        do {
            try store.restoreRawState(pendingUndoState)
            self.pendingUndoState = nil
            loadDashboard()
            showActionFeedback(L.t("Undone."), canUndo: false)
        } catch {
            setStatus(L.f("Could not undo: %@", error.localizedDescription), color: .systemRed)
        }
    }

    @objc private func openSafariExtensionPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    @objc func openSettings(_ sender: Any?) {
        if let settingsWindowController {
            settingsWindowController.showSettingsWindow(relativeTo: view.window)
            return
        }

        let controller = AppSettingsWindowController(store: store) { [weak self] in
            self?.loadDashboard()
            self?.settingsWindowController = nil
        }
        settingsWindowController = controller
        controller.showSettingsWindow(relativeTo: view.window)
    }

    private func maybePresentExpiredTrialPaywall() {
        guard !hasPresentedBasicPaywallThisLaunch else { return }
        guard !store.entitlementSummary().basicUnlocked else { return }
        guard view.window?.attachedSheet == nil else { return }

        hasPresentedBasicPaywallThisLaunch = true
        presentBasicPaywall()
    }

    private func presentBasicPaywall(closingAttachedSheet: Bool = false) {
        guard !store.entitlementSummary().basicUnlocked else { return }
        guard !isPresentingBasicPaywall else { return }

        if let attachedSheet = view.window?.attachedSheet {
            guard closingAttachedSheet else { return }
            view.window?.endSheet(attachedSheet)
            DispatchQueue.main.async { [weak self] in
                self?.presentBasicPaywall()
            }
            return
        }

        isPresentingBasicPaywall = true
        let paywall = BasicPaywallViewController(store: store) { [weak self] in
            self?.isPresentingBasicPaywall = false
            self?.loadDashboard()
        }
        presentAsSheet(paywall)
    }
}

final class WordDetailViewController: NSViewController {
    private let row: WordRow
    private let onAction: (WordAction, String) throws -> Void
    private let errorLabel = NSTextField(labelWithString: "")

    init(row: WordRow, onAction: @escaping (WordAction, String) throws -> Void) {
        self.row = row
        self.onAction = onAction
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 600, height: 520))
        preferredContentSize = NSSize(width: 600, height: 520)

        let column = NSStackView()
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 18
        column.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(column)

        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            column.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            column.topAnchor.constraint(equalTo: view.topAnchor, constant: 22),
            column.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -18)
        ])

        column.addArrangedSubview(makeHeader())
        column.addArrangedSubview(makeFactsSection())
        column.addArrangedSubview(makeExampleSection())
        column.addArrangedSubview(makeActionsSection())

        errorLabel.font = NSFont.systemFont(ofSize: 12)
        errorLabel.textColor = .systemRed
        errorLabel.maximumNumberOfLines = 2
        errorLabel.isHidden = true
        column.addArrangedSubview(errorLabel)
        column.addArrangedSubview(makeFooter())
    }

    private func makeHeader() -> NSView {
        let surface = NSTextField(labelWithString: row.surface)
        surface.font = NSFont.systemFont(ofSize: 34, weight: .semibold)
        surface.lineBreakMode = .byTruncatingTail

        let reading = NSTextField(labelWithString: row.reading.isEmpty ? L.t("(no reading)") : row.reading)
        reading.font = NSFont.systemFont(ofSize: 15)
        reading.textColor = .secondaryLabelColor

        let badge = makeStatusBadge()

        let top = NSStackView(views: [surface, NSView(), badge])
        top.orientation = .horizontal
        top.alignment = .centerY
        top.spacing = 12

        let stack = NSStackView(views: [top, reading])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 4
        return stack
    }

    private func makeStatusBadge() -> NSView {
        let label = NSTextField(labelWithString: statusText)
        label.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        label.textColor = statusColor

        let badge = NSStackView(views: [label])
        badge.orientation = .horizontal
        badge.edgeInsets = NSEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)
        badge.wantsLayer = true
        badge.layer?.backgroundColor = statusColor.withAlphaComponent(0.14).cgColor
        badge.layer?.cornerRadius = 10
        return badge
    }

    private var statusText: String {
        if row.ignored || row.lifecycleStatus == "ignored" { return L.t("Ignored") }
        if row.reviewStage == "lapsed" { return L.t("Lapsed") }
        switch row.lifecycleStatus {
        case "learning": return L.t("Learning")
        case "reviewing": return L.t("Reviewing")
        case "known", "mastered": return L.t("Known")
        default: return L.t("New")
        }
    }

    private var statusColor: NSColor {
        if row.ignored || row.lifecycleStatus == "ignored" { return .systemGray }
        if row.reviewStage == "lapsed" { return .systemOrange }
        switch row.lifecycleStatus {
        case "learning": return .systemBlue
        case "reviewing": return .systemIndigo
        case "known", "mastered": return .systemGreen
        default: return .systemGray
        }
    }

    private func makeFactsSection() -> NSView {
        let grid = NSGridView(views: [
            makeFactRow(L.t("Meaning"), row.meaning.isEmpty ? L.t("No meaning saved yet") : row.meaning),
            makeFactRow(L.t("Difficulty"), row.difficultyText.map { L.f("%@ (estimated)", $0) } ?? L.t("Unknown")),
            makeFactRow(L.t("Status"), statusText),
            makeFactRow(L.t("Seen"), L.f("%d times", row.seenCount)),
            makeFactRow(L.t("Next review"), row.nextReviewAt ?? L.t("never"))
        ])
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).xPlacement = .leading
        grid.rowSpacing = 8
        grid.columnSpacing = 14
        return grid
    }

    private func makeFactRow(_ title: String, _ value: String) -> [NSView] {
        let key = NSTextField(labelWithString: title)
        key.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        key.textColor = .secondaryLabelColor

        let val = NSTextField(wrappingLabelWithString: value)
        val.font = NSFont.systemFont(ofSize: 13)
        val.maximumNumberOfLines = 2
        val.preferredMaxLayoutWidth = 410
        return [key, val]
    }

    private func makeExampleSection() -> NSView {
        let title = NSTextField(labelWithString: L.t("Example"))
        title.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        title.textColor = .secondaryLabelColor

        let sentence = NSTextField(wrappingLabelWithString: row.exampleSentence ?? "—")
        sentence.font = NSFont.systemFont(ofSize: 14)
        sentence.maximumNumberOfLines = 4
        sentence.preferredMaxLayoutWidth = 520

        let source = NSTextField(labelWithString: row.exampleSource.map { "\(L.t("Source")): \($0)" } ?? "")
        source.font = NSFont.systemFont(ofSize: 11)
        source.textColor = .tertiaryLabelColor
        source.lineBreakMode = .byTruncatingTail
        source.isHidden = row.exampleSource == nil

        let stack = NSStackView(views: [title, sentence, source])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 6
        return stack
    }

    private func makeActionsSection() -> NSView {
        let title = NSTextField(labelWithString: L.t("Actions"))
        title.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        title.textColor = .secondaryLabelColor

        let save = makeActionButton("Save to Learning", action: .save)
        let known = makeActionButton("Mark as Known", action: .known)
        let forgot = makeActionButton("Forgot This Word", action: .forgot)
        let ignoreTitle = (row.ignored || row.lifecycleStatus == "ignored") ? "Restore" : "Ignore"
        let ignore = makeActionButton(ignoreTitle, action: (row.ignored || row.lifecycleStatus == "ignored") ? .restore : .ignore)
        let pin = makeActionButton("Always Show Annotation", action: .alwaysShow)
        pin.isEnabled = !row.pinned

        let buttons = NSStackView(views: [save, known, forgot, ignore, pin])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8

        let stack = NSStackView(views: [title, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        return stack
    }

    private func makeActionButton(_ titleKey: String, action: WordAction) -> NSButton {
        let button = NSButton(title: L.t(titleKey), target: self, action: #selector(actionClicked(_:)))
        button.bezelStyle = .rounded
        button.identifier = NSUserInterfaceItemIdentifier(action.rawValue)
        return button
    }

    private func makeFooter() -> NSView {
        let close = NSButton(title: L.t("Close"), target: self, action: #selector(closeClicked))
        close.bezelStyle = .rounded

        let row = NSStackView(views: [NSView(), close])
        row.orientation = .horizontal
        row.alignment = .centerY
        return row
    }

    @objc private func actionClicked(_ sender: NSButton) {
        guard let raw = sender.identifier?.rawValue, let action = WordAction(rawValue: raw) else { return }
        do {
            try onAction(action, row.id)
            dismiss(nil)
        } catch {
            errorLabel.stringValue = L.f("Could not save word action: %@", error.localizedDescription)
            errorLabel.isHidden = false
        }
    }

    @objc private func closeClicked() {
        dismiss(nil)
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
    private static let appGroupIdentifier = "group.com.japanstudylab.fadingfurigana"
    private let fileManager = FileManager.default

    // True when the shared App Group container is reachable; false means the
    // app fell back to its own Application Support copy (not shared with Safari).
    var isUsingAppGroup: Bool {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupIdentifier) != nil
    }

    var displayPath: String {
        stateFileURL.path
    }

    var stateFileLocation: URL {
        stateFileURL
    }

    // Human-facing storage health for the Settings recovery surface. Distinguishes
    // "no file yet" from "file exists but won't parse" (corruption), which loadRawState
    // collapses into the same empty-state fallback.
    struct StorageHealth {
        let isShared: Bool
        let fileExists: Bool
        let isReadable: Bool
        let lastModified: Date?
        let byteSize: Int
        let wordCount: Int
    }

    func storageHealth() -> StorageHealth {
        let path = stateFileURL.path
        let exists = fileManager.fileExists(atPath: path)
        let attributes = try? fileManager.attributesOfItem(atPath: path)

        var isReadable = false
        var wordCount = 0
        if exists,
           let data = try? Data(contentsOf: stateFileURL),
           let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            isReadable = true
            let lexicalItems = raw["lexicalItems"] as? [String: Any] ?? [:]
            let userStates = raw["userLexicalStates"] as? [String: Any] ?? [:]
            let exposureIndex = raw["exposureIndex"] as? [String: Any] ?? [:]
            wordCount = Set(lexicalItems.keys).union(userStates.keys).union(exposureIndex.keys).count
        }

        return StorageHealth(
            isShared: isUsingAppGroup,
            fileExists: exists,
            isReadable: isReadable,
            lastModified: attributes?[.modificationDate] as? Date,
            byteSize: (attributes?[.size] as? NSNumber)?.intValue ?? 0,
            wordCount: wordCount
        )
    }

    // Move the current (possibly corrupt) file aside to a timestamped backup, then write
    // a fresh default state. The user never silently loses data — the old file is kept.
    @discardableResult
    func resetLocalState() throws -> URL? {
        let url = stateFileURL
        var backupURL: URL?
        if fileManager.fileExists(atPath: url.path) {
            let stamp = Self.backupTimestampFormatter.string(from: Date())
            let candidate = url.deletingLastPathComponent()
                .appendingPathComponent("app-state-v1.backup-\(stamp).json")
            try? fileManager.removeItem(at: candidate)
            try fileManager.copyItem(at: url, to: candidate)
            backupURL = candidate
        }
        try save(createEmptyState())
        return backupURL
    }

    private static let backupTimestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()

    func stateSignature() -> String? {
        guard
            let attributes = try? fileManager.attributesOfItem(atPath: stateFileURL.path),
            let modifiedAt = attributes[.modificationDate] as? Date
        else {
            return nil
        }
        let size = attributes[.size] as? NSNumber
        return "\(modifiedAt.timeIntervalSince1970):\(size?.intValue ?? 0)"
    }

    func rawStateForUndo() -> [String: Any] {
        loadRawState()
    }

    func restoreRawState(_ raw: [String: Any]) throws {
        var next = raw
        touchMetadata(in: &next)
        try save(next)
    }

    func initializeEntitlementsIfNeeded() throws {
        let fileExists = fileManager.fileExists(atPath: stateFileURL.path)
        var raw = loadRawState()
        let existing = raw["entitlements"] as? [String: Any]
        let needsInitialization = !fileExists || existing == nil || existing?["access"] == nil
        guard needsInitialization else { return }

        let now = Date()
        raw["entitlements"] = Self.normalizedEntitlements(existing, now: now)
        touchMetadata(in: &raw, now: now)
        try save(raw)
    }

    func entitlementSummary() -> AppEntitlementSummary {
        let raw = loadRawState()
        let entitlements = Self.normalizedEntitlements(raw["entitlements"] as? [String: Any], now: Date())
        let access = entitlements["access"] as? [String: Any] ?? [:]
        let trial = entitlements["trial"] as? [String: Any] ?? [:]
        let basic = entitlements["basic"] as? [String: Any] ?? [:]
        let pro = entitlements["pro"] as? [String: Any] ?? [:]

        return AppEntitlementSummary(
            tier: access["tier"] as? String ?? "trial",
            basicUnlocked: access["basicUnlocked"] as? Bool ?? true,
            proUnlocked: access["proUnlocked"] as? Bool ?? false,
            trialDaysRemaining: Self.daysRemaining(until: trial["expiresAt"] as? String, now: Date()),
            basicStatus: basic["status"] as? String ?? "not_purchased",
            verificationStatus: basic["verificationStatus"] as? String ?? "not_checked",
            proStatus: pro["status"] as? String ?? "not_subscribed",
            developmentOverride: entitlements["developmentOverride"] as? String ?? "none"
        )
    }

    func updateEntitlementDevelopmentOverride(_ override: String) throws {
        var raw = loadRawState()
        var entitlements = Self.normalizedEntitlements(raw["entitlements"] as? [String: Any], now: Date())
        if override == "none" {
            entitlements.removeValue(forKey: "developmentOverride")
        } else {
            entitlements["developmentOverride"] = override
        }
        entitlements = Self.normalizedEntitlements(entitlements, now: Date())
        raw["entitlements"] = entitlements
        touchMetadata(in: &raw)
        try save(raw)
    }

    func markBasicPurchased(verificationStatus: String) throws {
        var raw = loadRawState()
        let now = Date()
        let nowText = ISO8601DateFormatter().string(from: now)
        var entitlements = Self.normalizedEntitlements(raw["entitlements"] as? [String: Any], now: now)
        var basic = entitlements["basic"] as? [String: Any] ?? [:]

        basic["status"] = "purchased"
        basic["productId"] = "com.japanstudylab.fadingfurigana.basic.macos"
        if basic["purchasedAt"] == nil || basic["purchasedAt"] is NSNull {
            basic["purchasedAt"] = nowText
        }
        basic["lastVerifiedAt"] = nowText
        basic["verificationStatus"] = verificationStatus
        entitlements["basic"] = basic
        entitlements.removeValue(forKey: "developmentOverride")
        entitlements = Self.normalizedEntitlements(entitlements, now: now)
        raw["entitlements"] = entitlements
        touchMetadata(in: &raw, now: now)
        try save(raw)
    }

    func updateBasicVerificationStatus(_ status: String) throws {
        var raw = loadRawState()
        let now = Date()
        var entitlements = Self.normalizedEntitlements(raw["entitlements"] as? [String: Any], now: now)
        var basic = entitlements["basic"] as? [String: Any] ?? [:]
        basic["verificationStatus"] = status
        if status == "verified" || status == "failed_invalid" {
            basic["lastVerifiedAt"] = ISO8601DateFormatter().string(from: now)
        }
        entitlements["basic"] = basic
        entitlements = Self.normalizedEntitlements(entitlements, now: now)
        raw["entitlements"] = entitlements
        touchMetadata(in: &raw, now: now)
        try save(raw)
    }

    @discardableResult
    func ingestRecordBatch(_ batch: [String: Any], appliedAt: Date = Date()) throws -> IngestAck {
        let result = IngestProtocol.apply(batch: batch, to: loadRawState())
        if !result.ack.ok {
            return result.ack
        }

        var raw = result.raw
        touchMetadata(in: &raw, now: appliedAt, writeId: "ingest:\(result.ack.batchId ?? "unknown")")
        try save(raw)
        return result.ack.withRevision(
            storageRevision: Self.intValue((raw["metadata"] as? [String: Any])?["storageRevision"]),
            updatedAt: (raw["metadata"] as? [String: Any])?["updatedAt"] as? String
        )
    }

    func pullRecordBatch(targetKind: String, cursor: String?) -> [String: Any] {
        IngestProtocol.createRecordBatch(
            from: loadRawState(),
            sourceKind: "mac-app",
            targetKind: targetKind,
            direction: "pull_response",
            baseCursor: cursor
        )
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
        let deviceId = ensureDeviceId(in: &raw)
        var states = raw["userLexicalStates"] as? [String: Any] ?? [:]
        var userState = states[lexicalItemId] as? [String: Any] ?? createDefaultUserState(lexicalItemId: lexicalItemId)
        mergeExposureIndex(into: &userState, lexicalItemId: lexicalItemId, raw: raw)
        var userIntent = userState["userIntent"] as? [String: Any] ?? [:]
        var learning = userState["learning"] as? [String: Any] ?? [:]
        var interaction = userState["interaction"] as? [String: Any] ?? [:]
        var intelligence = userState["intelligence"] as? [String: Any] ?? [:]
        var reasonCodes = intelligence["reasonCodes"] as? [String] ?? []
        let nowDate = Date()
        let now = ISO8601DateFormatter().string(from: nowDate)

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
        userState["id"] = userState["id"] as? String ?? lexicalItemId
        userState["updatedAt"] = now
        let existingDeviceId = userState["deviceId"] as? String
        userState["deviceId"] = (existingDeviceId == nil || existingDeviceId == "dev_unknown") ? deviceId : existingDeviceId
        states[lexicalItemId] = userState
        raw["userLexicalStates"] = states

        touchMetadata(in: &raw, now: nowDate)

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

        touchMetadata(in: &raw)

        try save(raw)
    }

    func applyReview(_ result: ReviewResult, lexicalItemId: String) throws {
        var raw = loadRawState()
        let deviceId = ensureDeviceId(in: &raw)
        var states = raw["userLexicalStates"] as? [String: Any] ?? [:]
        var userState = states[lexicalItemId] as? [String: Any] ?? createDefaultUserState(lexicalItemId: lexicalItemId)
        mergeExposureIndex(into: &userState, lexicalItemId: lexicalItemId, raw: raw)
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
        userState["id"] = userState["id"] as? String ?? lexicalItemId
        userState["updatedAt"] = nowText
        let existingDeviceId = userState["deviceId"] as? String
        userState["deviceId"] = (existingDeviceId == nil || existingDeviceId == "dev_unknown") ? deviceId : existingDeviceId
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
            "source": "macos_app",
            "updatedAt": nowText,
            "deviceId": deviceId
        ]
        raw["reviewLogs"] = reviewLogs

        touchMetadata(in: &raw, now: now)

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

    private func touchMetadata(in raw: inout [String: Any], now: Date = Date(), writeId: String? = nil) {
        let nowText = ISO8601DateFormatter().string(from: now)
        var metadata = raw["metadata"] as? [String: Any] ?? [:]
        metadata["deviceId"] = metadata["deviceId"] as? String ?? Self.makeDeviceId()
        metadata["createdAt"] = metadata["createdAt"] as? String ?? nowText
        metadata["updatedAt"] = nowText
        metadata["lastOpenedAt"] = nowText
        metadata["storageRevision"] = Self.intValue(metadata["storageRevision"]) + 1
        metadata["writeId"] = writeId ?? Self.makeWriteId()
        raw["metadata"] = metadata
    }

    @discardableResult
    private func ensureDeviceId(in raw: inout [String: Any]) -> String {
        var metadata = raw["metadata"] as? [String: Any] ?? [:]
        let deviceId = metadata["deviceId"] as? String ?? Self.makeDeviceId()
        metadata["deviceId"] = deviceId
        raw["metadata"] = metadata
        return deviceId
    }

    private func mergeExposureIndex(into userState: inout [String: Any], lexicalItemId: String, raw: [String: Any]) {
        let exposureIndex = raw["exposureIndex"] as? [String: Any] ?? [:]
        guard let indexed = exposureIndex[lexicalItemId] as? [String: Any] else { return }

        var exposure = userState["exposure"] as? [String: Any] ?? [:]
        exposure["seenCount"] = max(Self.intValue(exposure["seenCount"]), Self.intValue(indexed["seenCount"]))
        if let firstSeenAt = Self.earlierTimestamp(exposure["firstSeenAt"] as? String, indexed["firstSeenAt"] as? String) {
            exposure["firstSeenAt"] = firstSeenAt
        }
        if let lastSeenAt = Self.laterTimestamp(exposure["lastSeenAt"] as? String, indexed["lastSeenAt"] as? String) {
            exposure["lastSeenAt"] = lastSeenAt
        }
        userState["exposure"] = exposure
    }

    private static func intValue(_ value: Any?) -> Int {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String, let int = Int(text) { return int }
        return 0
    }

    private static func earlierTimestamp(_ lhs: String?, _ rhs: String?) -> String? {
        guard let lhs, !lhs.isEmpty else { return rhs }
        guard let rhs, !rhs.isEmpty else { return lhs }
        if let lhsDate = ReviewScheduler.parseISODate(lhs), let rhsDate = ReviewScheduler.parseISODate(rhs) {
            return lhsDate <= rhsDate ? lhs : rhs
        }
        return lhs <= rhs ? lhs : rhs
    }

    private static func laterTimestamp(_ lhs: String?, _ rhs: String?) -> String? {
        guard let lhs, !lhs.isEmpty else { return rhs }
        guard let rhs, !rhs.isEmpty else { return lhs }
        if let lhsDate = ReviewScheduler.parseISODate(lhs), let rhsDate = ReviewScheduler.parseISODate(rhs) {
            return lhsDate >= rhsDate ? lhs : rhs
        }
        return lhs >= rhs ? lhs : rhs
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
            "entitlements": Self.defaultEntitlements(now: Date()),
            "lexicalItems": [:],
            "userLexicalStates": [:],
            "exposureIndex": [:],
            "sourceOccurrences": [:],
            "dailyExposureSummaries": [:],
            "reviewLogs": [:],
            "metadata": [
                "deviceId": Self.makeDeviceId(),
                "createdAt": now,
                "updatedAt": now,
                "lastOpenedAt": now,
                "storageRevision": 0,
                "writeId": Self.makeWriteId()
            ]
        ]
    }

    private func createDefaultUserState(lexicalItemId: String) -> [String: Any] {
        let now = ISO8601DateFormatter().string(from: Date())
        return [
            "id": lexicalItemId,
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
            ],
            "updatedAt": now,
            "deviceId": "dev_unknown"
        ]
    }

    private static func makeDeviceId() -> String {
        "dev_\(UUID().uuidString.lowercased())"
    }

    private static func makeWriteId() -> String {
        "wr_\(UUID().uuidString.lowercased())"
    }

    private func appendUnique(_ value: String, to values: inout [String]) {
        if !values.contains(value) {
            values.append(value)
        }
    }

    private static func defaultEntitlements(now: Date) -> [String: Any] {
        let nowText = ISO8601DateFormatter().string(from: now)
        let expiresAt = Calendar(identifier: .gregorian).date(byAdding: .day, value: 31, to: now) ?? now
        let expiresText = ISO8601DateFormatter().string(from: expiresAt)
        return [
            "schemaVersion": 1,
            "platform": "apple-macos",
            "trial": [
                "startedAt": nowText,
                "expiresAt": expiresText,
                "source": "first_app_launch"
            ],
            "basic": [
                "status": "not_purchased",
                "productId": "com.japanstudylab.fadingfurigana.basic.macos",
                "verificationStatus": "not_checked"
            ],
            "pro": [
                "status": "not_subscribed"
            ],
            "access": accessForTier("trial", now: now)
        ]
    }

    private static func normalizedEntitlements(_ raw: [String: Any]?, now: Date) -> [String: Any] {
        let defaults = defaultEntitlements(now: now)
        var entitlements = defaults.merging(raw ?? [:]) { _, new in new }
        entitlements["schemaVersion"] = 1
        // This app only runs on macOS, so it is authoritative for the platform of
        // the shared entitlement. Force it (do not merely default) so a value
        // written by another client (e.g. the Safari extension defaulting to
        // "browser-extension") cannot stick.
        entitlements["platform"] = "apple-macos"

        let defaultTrial = defaults["trial"] as? [String: Any] ?? [:]
        let defaultBasic = defaults["basic"] as? [String: Any] ?? [:]
        let defaultPro = defaults["pro"] as? [String: Any] ?? [:]
        var trial = defaultTrial.merging(entitlements["trial"] as? [String: Any] ?? [:]) { _, new in new }
        var basic = defaultBasic.merging(entitlements["basic"] as? [String: Any] ?? [:]) { _, new in new }
        var pro = defaultPro.merging(entitlements["pro"] as? [String: Any] ?? [:]) { _, new in new }

        trial["startedAt"] = trial["startedAt"] as? String ?? defaultTrial["startedAt"]
        trial["expiresAt"] = trial["expiresAt"] as? String ?? defaultTrial["expiresAt"]
        basic["status"] = normalize(basic["status"] as? String, allowed: ["not_purchased", "purchased", "refunded", "unknown"], fallback: "not_purchased")
        basic["verificationStatus"] = normalize(basic["verificationStatus"] as? String, allowed: ["not_checked", "verified", "failed_offline", "failed_invalid", "pending_restore"], fallback: "not_checked")
        // productId follows the (now forced) macOS platform; never keep a stale id.
        basic["productId"] = "com.japanstudylab.fadingfurigana.basic.macos"
        pro["status"] = normalize(pro["status"] as? String, allowed: ["not_subscribed", "active", "grace_period", "expired", "unknown"], fallback: "not_subscribed")

        entitlements["trial"] = trial
        entitlements["basic"] = basic
        entitlements["pro"] = pro

        if let override = entitlements["developmentOverride"] as? String {
            let normalizedOverride = normalize(override, allowed: ["none", "trial", "expired", "basic", "pro"], fallback: "none")
            if normalizedOverride == "none" {
                entitlements.removeValue(forKey: "developmentOverride")
            } else {
                entitlements["developmentOverride"] = normalizedOverride
            }
        }

        entitlements["access"] = computeAccess(entitlements, now: now)
        return entitlements
    }

    private static func computeAccess(_ entitlements: [String: Any], now: Date) -> [String: Any] {
        if let override = entitlements["developmentOverride"] as? String, override != "none" {
            return accessForTier(override, now: now)
        }

        let basic = entitlements["basic"] as? [String: Any] ?? [:]
        let pro = entitlements["pro"] as? [String: Any] ?? [:]
        let trial = entitlements["trial"] as? [String: Any] ?? [:]

        let proStatus = pro["status"] as? String ?? "not_subscribed"
        if proStatus == "active" || proStatus == "grace_period" {
            return accessForTier("pro", now: now)
        }

        if (basic["status"] as? String) == "purchased" {
            return accessForTier("basic", now: now)
        }

        if let expiresAt = parseDate(trial["expiresAt"] as? String), expiresAt > now {
            return accessForTier("trial", now: now)
        }

        return accessForTier("expired", now: now)
    }

    private static func accessForTier(_ tier: String, now: Date) -> [String: Any] {
        [
            "tier": tier,
            "basicUnlocked": tier == "trial" || tier == "basic" || tier == "pro",
            "proUnlocked": tier == "pro",
            "computedAt": ISO8601DateFormatter().string(from: now)
        ]
    }

    private static func daysRemaining(until expiresAt: String?, now: Date) -> Int? {
        guard let expiresAt = parseDate(expiresAt), expiresAt > now else { return nil }
        let seconds = expiresAt.timeIntervalSince(now)
        return max(0, Int(ceil(seconds / 86_400)))
    }

    private static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        return ISO8601DateFormatter().date(from: value)
    }

    private static func normalize(_ value: String?, allowed: [String], fallback: String) -> String {
        guard let value, allowed.contains(value) else { return fallback }
        return value
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
    let activityDays: [LearningActivityDay]
    let todaySeenCount: Int
    let reviewedTodayCount: Int

    init(raw: [String: Any], hasLoadedState: Bool) {
        self.raw = raw
        self.hasLoadedState = hasLoadedState

        let lexicalItems = raw["lexicalItems"] as? [String: Any] ?? [:]
        let userStates = raw["userLexicalStates"] as? [String: Any] ?? [:]
        let exposureIndex = raw["exposureIndex"] as? [String: Any] ?? [:]
        let summaries = raw["dailyExposureSummaries"] as? [String: Any] ?? [:]
        let reviewLogs = raw["reviewLogs"] as? [String: Any] ?? [:]
        let examples = Self.latestExamples(from: raw["sourceOccurrences"] as? [String: Any] ?? [:])
        let todayKey = Self.localDateKey(Date())
        let weekStart = Calendar.current.date(byAdding: .day, value: -6, to: Date()).map(Self.localDateKey) ?? todayKey

        var rowsById: [String: WordRow] = [:]
        for (id, itemValue) in lexicalItems {
            let item = itemValue as? [String: Any] ?? [:]
            let indexed = exposureIndex[id] as? [String: Any] ?? [:]
            let state = Self.userStateWithIndexedExposure(userStates[id] as? [String: Any] ?? [:], indexed: indexed)
            rowsById[id] = WordRow(id: id, item: item, userState: state, summarySeenCount: 0, example: examples[id])
        }

        for (id, stateValue) in userStates where rowsById[id] == nil {
            let indexed = exposureIndex[id] as? [String: Any] ?? [:]
            let item = Self.itemFromIndexedExposure(id: id, indexed: indexed)
            let state = Self.userStateWithIndexedExposure(stateValue as? [String: Any] ?? [:], indexed: indexed)
            rowsById[id] = WordRow(id: id, item: item, userState: state, summarySeenCount: 0, example: examples[id])
        }

        for (id, indexedValue) in exposureIndex where rowsById[id] == nil {
            let indexed = indexedValue as? [String: Any] ?? [:]
            let item = Self.itemFromIndexedExposure(id: id, indexed: indexed)
            let state = Self.userStateWithIndexedExposure(["lifecycleStatus": "new"], indexed: indexed)
            rowsById[id] = WordRow(id: id, item: item, userState: state, summarySeenCount: 0, example: examples[id])
        }

        let todayCounts = Self.counts(from: summaries, startDate: todayKey, endDate: todayKey)
        let weekCounts = Self.counts(from: summaries, startDate: weekStart, endDate: todayKey)

        self.todaySeenCount = todayCounts.values.reduce(0, +)
        self.reviewedTodayCount = Self.reviewedToday(from: reviewLogs)
        self.words = rowsById.values.sorted(by: WordRow.defaultSort)
        self.todayTopRows = Self.rows(from: todayCounts, rowsById: rowsById)
        self.weekTopRows = Self.rows(from: weekCounts, rowsById: rowsById)
        self.suggestedRows = Self.suggestedRows(weekTopRows: weekTopRows, allWords: words)
        self.activityDays = Self.activityDays(from: summaries, reviewLogs: reviewLogs)
    }

    private static func itemFromIndexedExposure(id: String, indexed: [String: Any]) -> [String: Any] {
        let parts = splitLexicalItemId(id)
        return [
            "surface": indexed["surface"] as? String ?? parts.surface,
            "readingKana": indexed["readingKana"] as? String ?? indexed["baseReadingKana"] as? String ?? parts.readingKana,
            "baseReadingKana": indexed["baseReadingKana"] as? String ?? indexed["readingKana"] as? String ?? parts.readingKana
        ]
    }

    private static func userStateWithIndexedExposure(_ userState: [String: Any], indexed: [String: Any]) -> [String: Any] {
        guard !indexed.isEmpty else { return userState }

        var next = userState
        var exposure = next["exposure"] as? [String: Any] ?? [:]
        exposure["seenCount"] = max(intValue(exposure["seenCount"]), intValue(indexed["seenCount"]))
        if let firstSeenAt = earlierTimestamp(exposure["firstSeenAt"] as? String, indexed["firstSeenAt"] as? String) {
            exposure["firstSeenAt"] = firstSeenAt
        }
        if let lastSeenAt = laterTimestamp(exposure["lastSeenAt"] as? String, indexed["lastSeenAt"] as? String) {
            exposure["lastSeenAt"] = lastSeenAt
        }
        next["exposure"] = exposure
        if next["lifecycleStatus"] == nil {
            next["lifecycleStatus"] = "new"
        }
        return next
    }

    private static func splitLexicalItemId(_ id: String) -> (surface: String, readingKana: String) {
        guard let separator = id.firstIndex(of: ":") else {
            return (id, "")
        }
        let surface = String(id[..<separator])
        let readingStart = id.index(after: separator)
        return (surface.isEmpty ? id : surface, String(id[readingStart...]))
    }

    private static func intValue(_ value: Any?) -> Int {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String, let int = Int(text) { return int }
        return 0
    }

    private static func earlierTimestamp(_ lhs: String?, _ rhs: String?) -> String? {
        guard let lhs, !lhs.isEmpty else { return rhs }
        guard let rhs, !rhs.isEmpty else { return lhs }
        if let lhsDate = ReviewScheduler.parseISODate(lhs), let rhsDate = ReviewScheduler.parseISODate(rhs) {
            return lhsDate <= rhsDate ? lhs : rhs
        }
        return lhs <= rhs ? lhs : rhs
    }

    private static func laterTimestamp(_ lhs: String?, _ rhs: String?) -> String? {
        guard let lhs, !lhs.isEmpty else { return rhs }
        guard let rhs, !rhs.isEmpty else { return lhs }
        if let lhsDate = ReviewScheduler.parseISODate(lhs), let rhsDate = ReviewScheduler.parseISODate(rhs) {
            return lhsDate >= rhsDate ? lhs : rhs
        }
        return lhs >= rhs ? lhs : rhs
    }

    // A word the user keeps running into but has not started learning,
    // marked known, or dismissed.
    static func isSuggestionCandidate(_ row: WordRow) -> Bool {
        row.lifecycleStatus == "new" && !row.saved && !row.ignored && !row.pinned
    }

    private static func suggestedRows(weekTopRows: [WordRow], allWords: [WordRow]) -> [WordRow] {
        var suggested = weekTopRows.filter { isSuggestionCandidate($0) }
        let includedIds = Set(suggested.map(\.id))
        let allTimeExtras = allWords.filter { isSuggestionCandidate($0) && $0.seenCount >= 2 && !includedIds.contains($0.id) }
        suggested.append(contentsOf: allTimeExtras)
        return Array(suggested.prefix(50))
    }

    private static func reviewedToday(from logs: [String: Any]) -> Int {
        var count = 0
        for value in logs.values {
            let log = value as? [String: Any] ?? [:]
            guard let date = ReviewScheduler.parseISODate(log["reviewedAt"] as? String) else { continue }
            if Calendar.current.isDateInToday(date) { count += 1 }
        }
        return count
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

    static func matches(_ row: WordRow, filter: LibraryFilter) -> Bool {
        switch filter {
        case .all:
            return true
        case .learning:
            return row.lifecycleStatus == "learning" || row.lifecycleStatus == "reviewing"
        case .saved:
            return row.saved
        case .known:
            return row.lifecycleStatus == "known" || row.lifecycleStatus == "mastered"
        case .ignored:
            return row.ignored || row.lifecycleStatus == "ignored"
        }
    }

    func libraryCount(for filter: LibraryFilter) -> Int {
        words.filter { Self.matches($0, filter: filter) }.count
    }

    func libraryRows(filter: LibraryFilter, search: String, sortByRecent: Bool) -> [WordRow] {
        var rows = words.filter { Self.matches($0, filter: filter) }

        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !query.isEmpty {
            rows = rows.filter {
                $0.surface.lowercased().contains(query) ||
                $0.reading.lowercased().contains(query) ||
                $0.meaning.lowercased().contains(query)
            }
        }

        if sortByRecent {
            rows.sort { lhs, rhs in
                lhs.lastSeenAt == rhs.lastSeenAt ? WordRow.defaultSort(lhs, rhs) : lhs.lastSeenAt > rhs.lastSeenAt
            }
        }
        return rows
    }

    func discoverRows(scope: DiscoverScope) -> [WordRow] {
        switch scope {
        case .today:
            return todayTopRows.filter { Self.isSuggestionCandidate($0) }
        case .week:
            return weekTopRows.filter { Self.isSuggestionCandidate($0) }
        case .allTime:
            return words.filter { Self.isSuggestionCandidate($0) }
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

    // Most recent source sentence per lexical item (occurrences are written
    // when a word is saved; never pruned by compactState).
    private static func latestExamples(from occurrences: [String: Any]) -> [String: WordExample] {
        var latestAt: [String: String] = [:]
        var result: [String: WordExample] = [:]
        for value in occurrences.values {
            let occ = value as? [String: Any] ?? [:]
            guard
                let itemId = occ["lexicalItemId"] as? String,
                let sentence = occ["sentence"] as? String,
                !sentence.isEmpty
            else {
                continue
            }
            let createdAt = occ["createdAt"] as? String ?? ""
            if let prev = latestAt[itemId], prev >= createdAt { continue }
            latestAt[itemId] = createdAt
            let title = occ["pageTitle"] as? String
            let domain = occ["domain"] as? String
            let source = [title, domain]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " · ")
            result[itemId] = WordExample(sentence: sentence, source: source)
        }
        return result
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

    private static func activityDays(from summaries: [String: Any], reviewLogs: [String: Any]) -> [LearningActivityDay] {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let endWeekday = calendar.component(.weekday, from: today)
        let trailingDays = 7 - endWeekday
        let gridEnd = calendar.date(byAdding: .day, value: trailingDays, to: today) ?? today
        let gridStart = calendar.date(byAdding: .day, value: -370, to: gridEnd) ?? today

        var seenWordsByDate: [String: Set<String>] = [:]
        for summaryValue in summaries.values {
            let summary = summaryValue as? [String: Any] ?? [:]
            guard
                let date = summary["date"] as? String,
                let lexicalItemId = summary["lexicalItemId"] as? String
            else {
                continue
            }
            seenWordsByDate[date, default: []].insert(lexicalItemId)
        }

        var reviewCountsByDate: [String: Int] = [:]
        for value in reviewLogs.values {
            let log = value as? [String: Any] ?? [:]
            guard let reviewedAt = ReviewScheduler.parseISODate(log["reviewedAt"] as? String) else { continue }
            reviewCountsByDate[localDateKey(reviewedAt), default: 0] += 1
        }

        var days: [LearningActivityDay] = []
        var cursor = gridStart
        while cursor <= gridEnd {
            let key = localDateKey(cursor)
            days.append(LearningActivityDay(
                date: cursor,
                dateKey: key,
                seenWordCount: seenWordsByDate[key]?.count ?? 0,
                reviewCount: reviewCountsByDate[key] ?? 0
            ))
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return days
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

struct LearningActivityDay {
    let date: Date
    let dateKey: String
    let seenWordCount: Int
    let reviewCount: Int

    var activityCount: Int {
        seenWordCount + reviewCount
    }
}

// A sentence the word was seen in, plus where it came from.
struct WordExample {
    let sentence: String
    let source: String
}

struct WordRow {
    let id: String
    let surface: String
    let reading: String
    let meaning: String
    let difficultyText: String?
    let lifecycleStatus: String
    let saved: Bool
    let ignored: Bool
    let pinned: Bool
    let seenCount: Int
    let lastSeenAt: String
    let reviewStage: String
    let nextReviewAt: String?
    let exampleSentence: String?
    let exampleSource: String?
    var summarySeenCount: Int

    init(id: String, item: [String: Any], userState: [String: Any], summarySeenCount: Int, example: WordExample? = nil) {
        let exposure = userState["exposure"] as? [String: Any] ?? [:]
        let userIntent = userState["userIntent"] as? [String: Any] ?? [:]
        let learning = userState["learning"] as? [String: Any] ?? [:]
        self.id = id
        self.surface = item["surface"] as? String ?? id.components(separatedBy: ":").first ?? id
        self.reading = item["readingKana"] as? String ?? item["baseReadingKana"] as? String ?? ""
        self.meaning = Self.meaningText(from: item["meanings"] as? [String: Any] ?? [:])
        self.difficultyText = Self.difficultyText(from: item["difficulty"] as? [String: Any] ?? [:])
        self.lifecycleStatus = userState["lifecycleStatus"] as? String ?? "new"
        self.saved = userIntent["saved"] as? Bool ?? false
        self.ignored = userIntent["ignored"] as? Bool ?? false
        self.pinned = userIntent["pinnedAnnotation"] as? Bool ?? false
        self.seenCount = exposure["seenCount"] as? Int ?? 0
        self.lastSeenAt = exposure["lastSeenAt"] as? String ?? ""
        self.reviewStage = learning["reviewStage"] as? String ?? "new"
        self.nextReviewAt = learning["nextReviewAt"] as? String
        // Only keep a sentence that adds context beyond the word itself
        // (some occurrences record just the surface, e.g. "トップ").
        if let example, example.sentence.count > self.surface.count {
            self.exampleSentence = example.sentence
            self.exampleSource = example.source.isEmpty ? nil : example.source
        } else {
            self.exampleSentence = nil
            self.exampleSource = nil
        }
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

    nonisolated private static func difficultyText(from difficulty: [String: Any]) -> String? {
        guard let jlpt = difficulty["jlptLevel"] as? String, !jlpt.isEmpty else { return nil }
        return "JLPT \(jlpt.uppercased())"
    }
}
#endif
