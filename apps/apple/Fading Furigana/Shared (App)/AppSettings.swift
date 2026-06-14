//
//  AppSettings.swift
//  Shared (App)
//
//  Native macOS settings window over the shared AppState `settings` object.
//  Edits the same fields the extension popup manages, so changes apply to
//  Safari annotation behavior; unknown settings keys are preserved.
//  The whole sheet rebuilds when the interface language changes.
//

#if os(macOS)
import Cocoa
import SafariServices
import StoreKit

enum AppSettingsPane: String, CaseIterable {
    case learning
    case appearance
    case privacy
    case extensions
    case purchase

    var title: String {
        switch self {
        case .learning: return L.t("Learning Experience")
        case .appearance: return L.t("Appearance")
        case .privacy: return L.t("Data and Privacy")
        case .extensions: return L.t("Extensions")
        case .purchase: return L.t("Purchase and Sync")
        }
    }

    var symbolName: String {
        switch self {
        case .learning: return "graduationcap"
        case .appearance: return "paintbrush"
        case .privacy: return "lock.shield"
        case .extensions: return "safari"
        case .purchase: return "creditcard"
        }
    }

    var toolbarIdentifier: NSToolbarItem.Identifier {
        NSToolbarItem.Identifier("settings.\(rawValue)")
    }

    init?(toolbarIdentifier: NSToolbarItem.Identifier) {
        let rawValue = toolbarIdentifier.rawValue.replacingOccurrences(of: "settings.", with: "")
        self.init(rawValue: rawValue)
    }
}

final class AppSettingsWindowController: NSWindowController, NSWindowDelegate, NSToolbarDelegate {
    private let settingsViewController: AppSettingsViewController
    private let onClose: () -> Void

    init(store: AppStateStore, onClose: @escaping () -> Void) {
        self.onClose = onClose
        self.settingsViewController = AppSettingsViewController(store: store)

        let window = NSWindow(contentViewController: settingsViewController)
        window.title = L.t("Settings")
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.collectionBehavior = [.fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 520, height: 360)
        if !window.setFrameUsingName("FadingFuriganaSettingsWindow") {
            window.setContentSize(settingsViewController.preferredContentSize)
            window.center()
        }
        window.setFrameAutosaveName("FadingFuriganaSettingsWindow")

        let toolbar = NSToolbar(identifier: "AppSettingsToolbar")
        toolbar.displayMode = .iconAndLabel
        toolbar.allowsUserCustomization = false
        toolbar.selectedItemIdentifier = AppSettingsPane.learning.toolbarIdentifier

        super.init(window: window)
        toolbar.delegate = self
        window.toolbar = toolbar
        window.delegate = self
        settingsViewController.onInterfaceLanguageChanged = { [weak self] in
            self?.relocalize()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func showSettingsWindow(relativeTo parentWindow: NSWindow? = nil) {
        NSApp.activate(ignoringOtherApps: true)
        if let window {
            if let currentParent = window.parent, currentParent !== parentWindow {
                currentParent.removeChildWindow(window)
            }
            if let parentWindow, parentWindow.styleMask.contains(.fullScreen), window.parent == nil {
                parentWindow.addChildWindow(window, ordered: .above)
            } else if parentWindow?.styleMask.contains(.fullScreen) != true, let currentParent = window.parent {
                currentParent.removeChildWindow(window)
            }
        }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        onClose()
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        AppSettingsPane.allCases.map(\.toolbarIdentifier)
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbarSelectableItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        toolbarDefaultItemIdentifiers(toolbar)
    }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier itemIdentifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        guard let pane = AppSettingsPane(toolbarIdentifier: itemIdentifier) else { return nil }
        let item = NSToolbarItem(itemIdentifier: itemIdentifier)
        item.label = pane.title
        item.paletteLabel = pane.title
        item.toolTip = pane.title
        item.image = NSImage(systemSymbolName: pane.symbolName, accessibilityDescription: pane.title)
        item.target = self
        item.action = #selector(selectPane(_:))
        return item
    }

    @objc private func selectPane(_ sender: NSToolbarItem) {
        guard let pane = AppSettingsPane(toolbarIdentifier: sender.itemIdentifier) else { return }
        settingsViewController.selectPane(pane)
        window?.toolbar?.selectedItemIdentifier = pane.toolbarIdentifier
    }

    private func relocalize() {
        window?.title = L.t("Settings")
        window?.toolbar?.items.forEach { item in
            guard let pane = AppSettingsPane(toolbarIdentifier: item.itemIdentifier) else { return }
            item.label = pane.title
            item.paletteLabel = pane.title
            item.toolTip = pane.title
            item.image = NSImage(systemSymbolName: pane.symbolName, accessibilityDescription: pane.title)
        }
        window?.toolbar?.selectedItemIdentifier = settingsViewController.selectedPane.toolbarIdentifier
    }
}

final class AppSettingsViewController: NSViewController {

    private let store: AppStateStore
    private let purchaseService = BasicPurchaseService()
    private var settings: [String: Any]
    private var entitlementSummary: AppEntitlementSummary
    private(set) var selectedPane: AppSettingsPane = .learning
    var onInterfaceLanguageChanged: (() -> Void)?

    private let annotationEnabled = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let hideKnownCheckbox = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let smartContextCheckbox = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let exposureEnabled = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let modePopup = NSPopUpButton()
    private let levelPopup = NSPopUpButton()
    private let displayStylePopup = NSPopUpButton()
    private let urlPrivacyPopup = NSPopUpButton()
    private let retentionPopup = NSPopUpButton()
    private let languagePopup = NSPopUpButton()
    private let newColorWell = NSColorWell()
    private let learningColorWell = NSColorWell()
    private let lapsedColorWell = NSColorWell()
    private let savedColorWell = NSColorWell()
    private let knownColorWell = NSColorWell()
    private let ignoredColorWell = NSColorWell()
    private let entitlementOverridePopup = NSPopUpButton()
    private let basicPriceLabel = NSTextField(labelWithString: "")
    private let purchaseBasicButton = NSButton(title: "", target: nil, action: nil)
    private let restorePurchaseButton = NSButton(title: "", target: nil, action: nil)
    private let statusLabel = NSTextField(labelWithString: "")
    private let safariExtensionStatusLabel = NSTextField(labelWithString: "")
    private let sharedSafariDataLabel = NSTextField(labelWithString: "")
    private let chromeExtensionStatusLabel = NSTextField(labelWithString: "")
    private let iosSafariStatusLabel = NSTextField(labelWithString: "")
    private let storageHealthLabel = NSTextField(labelWithString: "")
    private let storageDetailLabel = NSTextField(labelWithString: "")
    private let revealStorageButton = NSButton(title: "", target: nil, action: nil)
    private let reloadStorageButton = NSButton(title: "", target: nil, action: nil)
    private let resetStorageButton = NSButton(title: "", target: nil, action: nil)
    private var transactionListener: Task<Void, Never>?

    private static let storageDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    // English titles double as localization keys (see Localization.swift).
    private let modeOptions: [(String, String)] = [
        ("Adaptive", "adaptive"),
        ("All words", "all_items"),
        ("Unknown words only", "unknown_items_only"),
        ("Saved words only", "saved_items_only"),
        ("Off", "off")
    ]
    private let levelOptions: [(String, String)] = [
        ("None — annotate everything", "none"),
        ("N5", "n5"),
        ("N4", "n4"),
        ("N3", "n3"),
        ("N2", "n2"),
        ("N1", "n1")
    ]
    private let displayStyleOptions: [(String, String)] = [
        ("Auto — tap hints in tight layouts", "tap_only"),
        ("Always show ruby", "ruby"),
        ("Tap hints everywhere", "compact")
    ]
    private let urlPrivacyOptions: [(String, String)] = [
        ("Domain only", "domain_only"),
        ("Full URL", "full"),
        ("No URLs", "none")
    ]
    private let retentionOptions: [(String, Int)] = [
        ("30 days", 30),
        ("90 days", 90),
        ("180 days", 180),
        ("1 year", 365)
    ]
    // Language names stay in their own language on purpose.
    private let languageOptions: [(String, String)] = [
        ("中文", "zhHans"),
        ("English", "en")
    ]
    private let entitlementOverrideOptions: [(String, String)] = [
        ("None", "none"),
        ("Force Trial", "trial"),
        ("Force Expired", "expired"),
        ("Force Basic", "basic"),
        ("Force Pro", "pro")
    ]
    private lazy var statusColorWells: [(String, String, NSColorWell)] = [
        ("New words:", "new", newColorWell),
        ("Learning:", "learning", learningColorWell),
        ("Lapsed:", "lapsed", lapsedColorWell),
        ("Saved:", "saved", savedColorWell),
        ("Known:", "known", knownColorWell),
        ("Ignored:", "ignored", ignoredColorWell)
    ]
    private static let defaultStatusColors: [String: String] = [
        "new": "#D98C00",
        "learning": "#2F7DFF",
        "lapsed": "#D64545",
        "saved": "#7A5AF8",
        "known": "#2FA36B",
        "ignored": "#8A8A8A"
    ]

    init(store: AppStateStore) {
        self.store = store
        self.settings = store.settingsDictionary()
        self.entitlementSummary = store.entitlementSummary()
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 430))
        preferredContentSize = NSSize(width: 560, height: 430)
        buildUI()
        refreshStoreProduct()
        startTransactionListener()
    }

    deinit {
        transactionListener?.cancel()
    }

    func selectPane(_ pane: AppSettingsPane) {
        selectedPane = pane
        buildUI()
    }

    // Recover the panel if a purchase completes out-of-band (e.g. the purchase sheet was
    // interrupted and the transaction arrives via Transaction.updates). The foreground
    // purchase() call may still be suspended, so refresh from the verified transaction here.
    private func startTransactionListener() {
        transactionListener = Task { [weak self] in
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                if transaction.productID == BasicPurchaseService.productId {
                    await transaction.finish()
                    self?.applyExternalBasicUnlock()
                }
            }
        }
    }

    private func applyExternalBasicUnlock() {
        guard entitlementSummary.basicStatus != "purchased" else { return }
        try? store.markBasicPurchased(verificationStatus: "verified")
        entitlementSummary = store.entitlementSummary()
        buildUI()
        showStatus(L.t("Basic unlocked"))
    }

    private func buildUI() {
        view.subviews.forEach { $0.removeFromSuperview() }

        let annotation = dict("annotation")
        let exposure = dict("exposureTracking")
        let display = dict("display")

        configureCheckbox(annotationEnabled, titleKey: "Annotate Japanese words on web pages", isOn: annotation["enabled"] as? Bool ?? true)
        configureCheckbox(hideKnownCheckbox, titleKey: "Hide words I already know", isOn: annotation["hideKnownItems"] as? Bool ?? true)
        configureCheckbox(smartContextCheckbox, titleKey: "Use tap hints in titles and navigation", isOn: annotation["useSmartContextDisplay"] as? Bool ?? true)
        configureCheckbox(exposureEnabled, titleKey: "Track word exposure while browsing", isOn: exposure["enabled"] as? Bool ?? true)
        configurePopup(modePopup, options: modeOptions, selected: annotation["mode"] as? String ?? "adaptive")
        configurePopup(levelPopup, options: levelOptions, selected: annotation["userLevel"] as? String ?? "none")
        configurePopup(displayStylePopup, options: displayStyleOptions, selected: annotation["constrainedLayoutMode"] as? String ?? "tap_only")
        configurePopup(urlPrivacyPopup, options: urlPrivacyOptions, selected: exposure["saveUrls"] as? String ?? "domain_only")
        configureRetentionPopup(selected: exposure["retentionDays"] as? Int ?? 90)
        configurePopup(languagePopup, options: languageOptions, selected: display["interfaceLanguage"] as? String ?? "en", localizeTitles: false)
        configureStatusColorWells(colors: annotation["statusColors"] as? [String: Any] ?? [:])
        configurePopup(entitlementOverridePopup, options: entitlementOverrideOptions, selected: entitlementSummary.developmentOverride)
        configurePurchaseControls()
        configureExtensionStatusLabels()
        configureStorageHealth()

        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 16
        root.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 16, right: 24)
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        root.addArrangedSubview(makePaneTitle(selectedPane.title))
        root.addArrangedSubview(makeSelectedPane())
        root.addArrangedSubview(makeStatusFooter())
        refreshSafariExtensionStatus()
    }

    private func makeSelectedPane() -> NSView {
        switch selectedPane {
        case .learning:
            return makeGrid([
                ("", annotationEnabled),
                (L.t("Mode:"), modePopup),
                (L.t("Hide words at or below:"), levelPopup),
                ("", hideKnownCheckbox)
            ])
        case .appearance:
            return makeGrid([
                (L.t("Display style:"), displayStylePopup),
                ("", smartContextCheckbox),
                (L.t("Interface language:"), languagePopup),
                (L.t("Word status colors:"), makeStatusColorGrid())
            ])
        case .privacy:
            return makeGrid([
                ("", exposureEnabled),
                (L.t("Save page URLs:"), urlPrivacyPopup),
                (L.t("Keep statistics for:"), retentionPopup),
                (L.t("Storage:"), storageHealthLabel),
                ("", storageDetailLabel),
                ("", makeButtonRow([revealStorageButton, reloadStorageButton, resetStorageButton]))
            ])
        case .extensions:
            return makeGrid([
                (L.t("Safari:"), safariExtensionStatusLabel),
                (L.t("Data:"), sharedSafariDataLabel),
                (L.t("Chrome:"), chromeExtensionStatusLabel),
                (L.t("iOS Safari:"), iosSafariStatusLabel),
                ("", makeLinkButton(L.t("Open Safari Extension Settings…"), action: #selector(openSafariPreferences)))
            ])
        case .purchase:
            return makePurchasePane()
        }
    }

    private func makePurchasePane() -> NSView {
        var purchaseRows: [(String, NSView)] = [
            (L.t("Current access:"), makeValueLabel(entitlementSummary.tierTitle))
        ]
        // The trial countdown only matters while the trial is the active tier; once Basic/Pro
        // is unlocked (or the trial has lapsed) the access line above already says so.
        if entitlementSummary.tier == "trial" {
            purchaseRows.append((L.t("Trial:"), makeValueLabel(entitlementSummary.trialDetail)))
        }
        purchaseRows.append(contentsOf: [
            (L.t("Basic:"), makeValueLabel(entitlementSummary.basicStatusTitle)),
            (L.t("Basic price:"), basicPriceLabel),
            ("", makeButtonRow([purchaseBasicButton, restorePurchaseButton])),
            (L.t("Development state:"), entitlementOverridePopup),
            ("", makeCaption(L.t("Local vocabulary stays on this device even if purchase status changes."))),
            ("", makeCaption(L.t("Sync and cloud backup require Pro.")))
        ])
        return makeGrid(purchaseRows)
    }

    // MARK: - UI helpers

    private func makePaneTitle(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = NSFont.systemFont(ofSize: 18, weight: .semibold)
        label.textColor = .labelColor
        return label
    }

    private func configureCheckbox(_ checkbox: NSButton, titleKey: String, isOn: Bool) {
        checkbox.title = L.t(titleKey)
        checkbox.state = isOn ? .on : .off
        checkbox.target = self
        checkbox.action = #selector(controlChanged(_:))
    }

    private func configurePopup(_ popup: NSPopUpButton, options: [(String, String)], selected: String, localizeTitles: Bool = true) {
        popup.removeAllItems()
        for (title, value) in options {
            popup.addItem(withTitle: localizeTitles ? L.t(title) : title)
            popup.lastItem?.representedObject = value
        }
        let index = options.firstIndex { $0.1 == selected } ?? 0
        popup.selectItem(at: index)
        popup.target = self
        popup.action = #selector(controlChanged(_:))
    }

    private func configureRetentionPopup(selected: Int) {
        var options = retentionOptions
        if !options.contains(where: { $0.1 == selected }) {
            options.append((L.f("%d days", selected), selected))
        }
        retentionPopup.removeAllItems()
        for (title, value) in options {
            retentionPopup.addItem(withTitle: L.t(title))
            retentionPopup.lastItem?.representedObject = value
        }
        let index = options.firstIndex { $0.1 == selected } ?? 1
        retentionPopup.selectItem(at: index)
        retentionPopup.target = self
        retentionPopup.action = #selector(controlChanged(_:))
    }

    private func configureStatusColorWells(colors: [String: Any]) {
        for (_, key, well) in statusColorWells {
            let hex = (colors[key] as? String) ?? Self.defaultStatusColors[key] ?? "#D98C00"
            well.color = Self.color(fromHex: hex)
            well.target = self
            well.action = #selector(controlChanged(_:))
            well.isBordered = true
            well.translatesAutoresizingMaskIntoConstraints = false
            if well.constraints.isEmpty {
                NSLayoutConstraint.activate([
                    well.widthAnchor.constraint(equalToConstant: 44),
                    well.heightAnchor.constraint(equalToConstant: 24)
                ])
            }
        }
    }

    private func makeSection(_ name: String, grid: NSGridView) -> NSView {
        let header = NSTextField(labelWithString: name)
        header.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        header.textColor = .secondaryLabelColor

        let section = NSStackView(views: [header, grid])
        section.orientation = .vertical
        section.alignment = .leading
        section.spacing = 8
        return section
    }

    private func makeGrid(_ rows: [(String, NSView)]) -> NSGridView {
        let grid = NSGridView(views: rows.map { label, control in
            let text = NSTextField(labelWithString: label)
            text.font = NSFont.systemFont(ofSize: 13)
            text.alignment = .right
            return [text, control]
        })
        grid.rowSpacing = 8
        grid.columnSpacing = 10
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 0).width = 170
        grid.rowAlignment = .firstBaseline
        return grid
    }

    private func makeLinkButton(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        button.controlSize = .small
        return button
    }

    private func makeStatusColorGrid() -> NSView {
        let grid = NSGridView(views: statusColorWells.map { titleKey, _, well in
            let label = NSTextField(labelWithString: L.t(titleKey))
            label.font = NSFont.systemFont(ofSize: 12)
            label.textColor = .secondaryLabelColor
            label.alignment = .right
            return [label, well]
        })
        grid.rowSpacing = 6
        grid.columnSpacing = 8
        grid.column(at: 0).xPlacement = .trailing
        grid.rowAlignment = .firstBaseline
        return grid
    }

    private func configurePurchaseControls() {
        let priceText: String
        switch purchaseService.loadState {
        case .available:
            priceText = purchaseService.displayPrice ?? L.t("Unavailable")
        case .unavailable:
            priceText = L.t("Unavailable")
        case .loading:
            priceText = L.t("Loading…")
        }
        basicPriceLabel.stringValue = priceText
        basicPriceLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        basicPriceLabel.textColor = purchaseService.displayPrice == nil ? .secondaryLabelColor : .labelColor

        let canPurchase = entitlementSummary.basicStatus != "purchased" && purchaseService.displayPrice != nil
        purchaseBasicButton.title = entitlementSummary.basicStatus == "purchased" ? L.t("Basic Unlocked") : L.t("Unlock Basic")
        purchaseBasicButton.bezelStyle = .rounded
        purchaseBasicButton.controlSize = .small
        purchaseBasicButton.target = self
        purchaseBasicButton.action = #selector(purchaseBasicClicked)
        purchaseBasicButton.isEnabled = canPurchase

        restorePurchaseButton.title = L.t("Restore Purchase")
        restorePurchaseButton.bezelStyle = .rounded
        restorePurchaseButton.controlSize = .small
        restorePurchaseButton.target = self
        restorePurchaseButton.action = #selector(restorePurchaseClicked)
    }

    private func configureExtensionStatusLabels() {
        safariExtensionStatusLabel.stringValue = L.t("Checking Safari extension status…")
        safariExtensionStatusLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        safariExtensionStatusLabel.textColor = .secondaryLabelColor

        sharedSafariDataLabel.stringValue = L.t("Safari extension and Mac app share this Mac's local data.")
        sharedSafariDataLabel.font = NSFont.systemFont(ofSize: 12)
        sharedSafariDataLabel.textColor = .secondaryLabelColor
        sharedSafariDataLabel.maximumNumberOfLines = 2
        sharedSafariDataLabel.preferredMaxLayoutWidth = 330

        chromeExtensionStatusLabel.stringValue = L.t("Chrome keeps separate local data until Pro sync is enabled.")
        chromeExtensionStatusLabel.font = NSFont.systemFont(ofSize: 12)
        chromeExtensionStatusLabel.textColor = .secondaryLabelColor
        chromeExtensionStatusLabel.maximumNumberOfLines = 2
        chromeExtensionStatusLabel.preferredMaxLayoutWidth = 330

        iosSafariStatusLabel.stringValue = L.t("Planned for the iOS app.")
        iosSafariStatusLabel.font = NSFont.systemFont(ofSize: 12)
        iosSafariStatusLabel.textColor = .secondaryLabelColor
    }

    private func configureStorageHealth() {
        let health = store.storageHealth()

        let statusText: String
        let statusColor: NSColor
        if health.fileExists && !health.isReadable {
            statusText = L.t("Data file unreadable")
            statusColor = .systemRed
        } else if !health.isShared {
            statusText = L.t("Local only (not shared with Safari)")
            statusColor = .systemOrange
        } else {
            statusText = L.t("Healthy — shared with Safari")
            statusColor = .systemGreen
        }
        storageHealthLabel.stringValue = statusText
        storageHealthLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        storageHealthLabel.textColor = statusColor

        var detail: [String] = []
        if health.fileExists {
            detail.append(L.f("%d words stored", health.wordCount))
            if let modified = health.lastModified {
                detail.append(L.f("updated %@", Self.storageDateFormatter.string(from: modified)))
            }
        } else {
            detail.append(L.t("No data file yet"))
        }
        storageDetailLabel.stringValue = detail.joined(separator: " · ")
        storageDetailLabel.font = NSFont.systemFont(ofSize: 12)
        storageDetailLabel.textColor = .secondaryLabelColor

        configureSmallButton(revealStorageButton, title: L.t("Reveal in Finder"), action: #selector(revealStorageClicked))
        configureSmallButton(reloadStorageButton, title: L.t("Reload"), action: #selector(reloadStorageClicked))
        configureSmallButton(resetStorageButton, title: L.t("Reset Local Data…"), action: #selector(resetStorageClicked))
        resetStorageButton.hasDestructiveAction = true
    }

    private func configureSmallButton(_ button: NSButton, title: String, action: Selector) {
        button.title = title
        button.bezelStyle = .rounded
        button.controlSize = .small
        button.target = self
        button.action = action
    }

    private func makeButtonRow(_ buttons: [NSButton]) -> NSView {
        let row = NSStackView(views: buttons)
        row.orientation = .horizontal
        row.alignment = .centerY
        row.spacing = 8
        return row
    }

    private func makeValueLabel(_ title: String) -> NSTextField {
        let label = NSTextField(labelWithString: title)
        label.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        label.textColor = .labelColor
        return label
    }

    private func makeCaption(_ title: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: title)
        label.font = NSFont.systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        label.maximumNumberOfLines = 2
        label.preferredMaxLayoutWidth = 300
        return label
    }

    private func makeStatusFooter() -> NSView {
        statusLabel.font = NSFont.systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor

        let footer = NSStackView()
        footer.orientation = .horizontal
        footer.alignment = .centerY
        footer.spacing = 12
        footer.addArrangedSubview(statusLabel)
        footer.addArrangedSubview(NSView())

        footer.translatesAutoresizingMaskIntoConstraints = false
        footer.setContentHuggingPriority(NSLayoutConstraint.Priority(1), for: .vertical)
        return footer
    }

    // MARK: - Actions

    @objc private func controlChanged(_ sender: Any?) {
        let previousLanguage = L.language
        do {
            try store.updateSettings { settings in
                Self.setValue(self.annotationEnabled.state == .on, in: &settings, section: "annotation", key: "enabled")
                Self.setValue(self.selectedString(self.modePopup, fallback: "adaptive"), in: &settings, section: "annotation", key: "mode")
                Self.setValue(self.selectedString(self.levelPopup, fallback: "none"), in: &settings, section: "annotation", key: "userLevel")
                Self.setValue(self.selectedString(self.displayStylePopup, fallback: "tap_only"), in: &settings, section: "annotation", key: "constrainedLayoutMode")
                Self.setValue(self.smartContextCheckbox.state == .on, in: &settings, section: "annotation", key: "useSmartContextDisplay")
                Self.setValue(self.hideKnownCheckbox.state == .on, in: &settings, section: "annotation", key: "hideKnownItems")
                Self.setValue(self.readStatusColors(), in: &settings, section: "annotation", key: "statusColors")
                Self.setValue(self.exposureEnabled.state == .on, in: &settings, section: "exposureTracking", key: "enabled")
                Self.setValue(self.selectedString(self.urlPrivacyPopup, fallback: "domain_only"), in: &settings, section: "exposureTracking", key: "saveUrls")
                Self.setValue(self.retentionPopup.selectedItem?.representedObject as? Int ?? 90, in: &settings, section: "exposureTracking", key: "retentionDays")
                Self.setValue(self.selectedString(self.languagePopup, fallback: "en"), in: &settings, section: "display", key: "interfaceLanguage")
            }
            try store.updateEntitlementDevelopmentOverride(selectedString(entitlementOverridePopup, fallback: "none"))

            let newLanguage = selectedString(languagePopup, fallback: "en")
            if newLanguage != previousLanguage {
                L.language = newLanguage
                onInterfaceLanguageChanged?()
            }
            settings = store.settingsDictionary()
            entitlementSummary = store.entitlementSummary()
            if !(sender is NSColorWell) {
                buildUI()
            }
            showStatus(L.t("Settings saved"))
        } catch {
            showStatus(L.f("Could not save settings: %@", error.localizedDescription))
        }
    }

    @objc private func openSafariPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    private func refreshSafariExtensionStatus() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.safariExtensionStatusLabel.stringValue = L.f("Unable to read Safari extension status: %@", error.localizedDescription)
                    self.safariExtensionStatusLabel.textColor = .systemOrange
                    return
                }
                if state?.isEnabled == true {
                    self.safariExtensionStatusLabel.stringValue = L.t("Connected and enabled")
                    self.safariExtensionStatusLabel.textColor = .systemGreen
                } else {
                    self.safariExtensionStatusLabel.stringValue = L.t("Installed but disabled")
                    self.safariExtensionStatusLabel.textColor = .systemOrange
                }
            }
        }
    }

    @objc private func revealStorageClicked() {
        NSWorkspace.shared.activateFileViewerSelecting([store.stateFileLocation])
    }

    @objc private func reloadStorageClicked() {
        settings = store.settingsDictionary()
        entitlementSummary = store.entitlementSummary()
        buildUI()
        showStatus(L.t("Reloaded from disk"))
    }

    @objc private func resetStorageClicked() {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = L.t("Reset local data?")
        alert.informativeText = L.t("Your saved words and settings on this Mac will be cleared. A timestamped backup is kept next to the data file so you can recover it.")
        alert.addButton(withTitle: L.t("Reset"))
        alert.addButton(withTitle: L.t("Cancel"))
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            let backup = try store.resetLocalState()
            settings = store.settingsDictionary()
            entitlementSummary = store.entitlementSummary()
            buildUI()
            if let backup {
                showStatus(L.f("Reset done. Backup: %@", backup.lastPathComponent))
            } else {
                showStatus(L.t("Reset done."))
            }
        } catch {
            showStatus(L.f("Reset failed: %@", error.localizedDescription))
        }
    }

    @objc private func purchaseBasicClicked() {
        setPurchaseControlsEnabled(false)
        showStatus(L.t("Starting purchase…"))
        Task {
            do {
                let result = try await purchaseService.purchaseBasic()
                switch result {
                case .purchased:
                    try store.markBasicPurchased(verificationStatus: "verified")
                    entitlementSummary = store.entitlementSummary()
                    buildUI()
                    showStatus(L.t("Basic unlocked"))
                case .cancelled:
                    showStatus(L.t("Purchase cancelled"))
                case .pending:
                    showStatus(L.t("Purchase pending"))
                }
            } catch {
                showStatus(L.f("Purchase failed: %@", error.localizedDescription))
            }
            setPurchaseControlsEnabled(true)
        }
    }

    @objc private func restorePurchaseClicked() {
        setPurchaseControlsEnabled(false)
        showStatus(L.t("Restoring purchase…"))
        Task {
            do {
                try store.updateBasicVerificationStatus("pending_restore")
                let restored = try await purchaseService.restoreBasic()
                if restored {
                    try store.markBasicPurchased(verificationStatus: "verified")
                    entitlementSummary = store.entitlementSummary()
                    buildUI()
                    showStatus(L.t("Purchase restored"))
                } else {
                    try store.updateBasicVerificationStatus("not_checked")
                    entitlementSummary = store.entitlementSummary()
                    buildUI()
                    showStatus(L.t("No Basic purchase found"))
                }
            } catch {
                try? store.updateBasicVerificationStatus("failed_offline")
                showStatus(L.f("Restore failed: %@", error.localizedDescription))
            }
            setPurchaseControlsEnabled(true)
        }
    }

    private func showStatus(_ text: String) {
        statusLabel.stringValue = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            if self?.statusLabel.stringValue == text {
                self?.statusLabel.stringValue = ""
            }
        }
    }

    private func selectedString(_ popup: NSPopUpButton, fallback: String) -> String {
        popup.selectedItem?.representedObject as? String ?? fallback
    }

    private func readStatusColors() -> [String: String] {
        var colors: [String: String] = [:]
        for (_, key, well) in statusColorWells {
            colors[key] = Self.hexString(from: well.color)
        }
        return colors
    }

    private func refreshStoreProduct() {
        Task {
            do {
                _ = try await purchaseService.loadBasicProduct()
            } catch {
                basicPriceLabel.stringValue = L.t("Unavailable")
                showStatus(L.f("Could not load product: %@", error.localizedDescription))
            }
            configurePurchaseControls()
        }
    }

    private func setPurchaseControlsEnabled(_ isEnabled: Bool) {
        purchaseBasicButton.isEnabled = isEnabled && entitlementSummary.basicStatus != "purchased" && purchaseService.displayPrice != nil
        restorePurchaseButton.isEnabled = isEnabled
        entitlementOverridePopup.isEnabled = isEnabled
    }

    private func dict(_ section: String) -> [String: Any] {
        settings[section] as? [String: Any] ?? [:]
    }

    private static func setValue(_ value: Any, in settings: inout [String: Any], section: String, key: String) {
        var sectionDict = settings[section] as? [String: Any] ?? [:]
        sectionDict[key] = value
        settings[section] = sectionDict
    }

    private static func color(fromHex hex: String) -> NSColor {
        let normalized = normalizeHex(hex) ?? "#D98C00"
        let start = normalized.index(after: normalized.startIndex)
        let value = String(normalized[start...])
        var rgb: UInt64 = 0
        Scanner(string: value).scanHexInt64(&rgb)
        return NSColor(
            calibratedRed: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }

    private static func hexString(from color: NSColor) -> String {
        let rgb = color.usingColorSpace(.sRGB) ?? color
        let red = Int(round(max(0, min(1, rgb.redComponent)) * 255))
        let green = Int(round(max(0, min(1, rgb.greenComponent)) * 255))
        let blue = Int(round(max(0, min(1, rgb.blueComponent)) * 255))
        return String(format: "#%02X%02X%02X", red, green, blue)
    }

    private static func normalizeHex(_ hex: String) -> String? {
        let raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = raw.hasPrefix("#") ? String(raw.dropFirst()) : raw
        if value.count == 3, value.allSatisfy(\.isHexDigit) {
            return "#" + value.map { "\($0)\($0)" }.joined().uppercased()
        }
        if value.count == 6, value.allSatisfy(\.isHexDigit) {
            return "#\(value.uppercased())"
        }
        return nil
    }
}

enum BasicPurchaseResult {
    case purchased
    case cancelled
    case pending
}

enum BasicPurchaseError: LocalizedError {
    case productUnavailable
    case unverifiedTransaction

    var errorDescription: String? {
        switch self {
        case .productUnavailable:
            return L.t("Basic product is not available")
        case .unverifiedTransaction:
            return L.t("Purchase could not be verified")
        }
    }
}

final class BasicPurchaseService {
    static let productId = "com.banyuguru.fadingfurigana.basic.macos"

    enum LoadState {
        case loading
        case available
        case unavailable
    }

    private var product: Product?
    private(set) var loadState: LoadState = .loading

    var displayPrice: String? {
        product?.displayPrice
    }

    func loadBasicProduct() async throws -> Product? {
        do {
            let products = try await Product.products(for: [Self.productId])
            product = products.first
            loadState = product == nil ? .unavailable : .available
            return product
        } catch {
            loadState = .unavailable
            throw error
        }
    }

    func purchaseBasic() async throws -> BasicPurchaseResult {
        let product = try await productOrLoad()
        let result = try await product.purchase()

        switch result {
        case .success(let verification):
            let transaction = try verifiedTransaction(from: verification)
            await transaction.finish()
            return .purchased
        case .userCancelled:
            return .cancelled
        case .pending:
            return .pending
        @unknown default:
            return .pending
        }
    }

    func restoreBasic() async throws -> Bool {
        try await AppStore.sync()
        return await hasBasicEntitlement()
    }

    private func productOrLoad() async throws -> Product {
        if let product {
            return product
        }
        guard let product = try await loadBasicProduct() else {
            throw BasicPurchaseError.productUnavailable
        }
        return product
    }

    private func hasBasicEntitlement() async -> Bool {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.productID == Self.productId {
                return true
            }
        }
        return false
    }

    private func verifiedTransaction(from result: VerificationResult<Transaction>) throws -> Transaction {
        switch result {
        case .verified(let transaction):
            return transaction
        case .unverified:
            throw BasicPurchaseError.unverifiedTransaction
        }
    }
}

final class BasicPaywallViewController: NSViewController {
    private let store: AppStateStore
    private let onClose: () -> Void
    private let purchaseService = BasicPurchaseService()

    private let priceLabel = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "")
    private let unlockButton = NSButton(title: "", target: nil, action: nil)
    private let restoreButton = NSButton(title: "", target: nil, action: nil)
    private let notNowButton = NSButton(title: "", target: nil, action: nil)

    init(store: AppStateStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 460, height: 360))
        preferredContentSize = NSSize(width: 460, height: 360)
        buildUI()
        refreshStoreProduct()
    }

    private func buildUI() {
        view.subviews.forEach { $0.removeFromSuperview() }

        let title = NSTextField(labelWithString: L.t("Continue learning locally"))
        title.font = NSFont.boldSystemFont(ofSize: 22)
        title.alignment = .center

        let mainCopy = makeBodyLabel(L.t("Your words stay on this Mac. Basic unlocks the local Safari extension and Mac learning app after the trial."))
        let safetyCopy = makeBodyLabel(L.t("Your saved words are not deleted when the trial ends."))
        let boundaryCopy = makeBodyLabel(L.t("Basic is for this platform. Cross-device sync and advanced intelligence are part of Pro."))

        priceLabel.stringValue = purchaseService.displayPrice.map { L.f("Basic: %@", $0) } ?? L.t("Loading…")
        priceLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        priceLabel.textColor = .secondaryLabelColor
        priceLabel.alignment = .center

        unlockButton.title = L.t("Unlock Basic")
        unlockButton.bezelStyle = .rounded
        unlockButton.target = self
        unlockButton.action = #selector(unlockBasicClicked)
        unlockButton.isEnabled = purchaseService.displayPrice != nil

        restoreButton.title = L.t("Restore Purchase")
        restoreButton.bezelStyle = .rounded
        restoreButton.target = self
        restoreButton.action = #selector(restorePurchaseClicked)

        notNowButton.title = L.t("Not now")
        notNowButton.bezelStyle = .rounded
        notNowButton.target = self
        notNowButton.action = #selector(notNowClicked)

        statusLabel.font = NSFont.systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .center

        let actionRow = NSStackView(views: [unlockButton, restoreButton, notNowButton])
        actionRow.orientation = .horizontal
        actionRow.alignment = .centerY
        actionRow.distribution = .fillEqually
        actionRow.spacing = 8

        let stack = NSStackView(views: [title, mainCopy, safetyCopy, boundaryCopy, priceLabel, actionRow, statusLabel])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.edgeInsets = NSEdgeInsets(top: 26, left: 30, bottom: 22, right: 30)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: view.topAnchor),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            actionRow.widthAnchor.constraint(equalToConstant: 360)
        ])
    }

    private func makeBodyLabel(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = NSFont.systemFont(ofSize: 13)
        label.textColor = .labelColor
        label.alignment = .center
        label.maximumNumberOfLines = 3
        label.preferredMaxLayoutWidth = 380
        return label
    }

    private func refreshStoreProduct() {
        Task {
            do {
                _ = try await purchaseService.loadBasicProduct()
                priceLabel.stringValue = purchaseService.displayPrice.map { L.f("Basic: %@", $0) } ?? L.t("Unavailable")
            } catch {
                priceLabel.stringValue = L.t("Unavailable")
                showStatus(L.f("Could not load product: %@", error.localizedDescription))
            }
            unlockButton.isEnabled = purchaseService.displayPrice != nil
        }
    }

    @objc private func unlockBasicClicked() {
        setControlsEnabled(false)
        showStatus(L.t("Starting purchase…"))
        Task {
            do {
                let result = try await purchaseService.purchaseBasic()
                switch result {
                case .purchased:
                    try store.markBasicPurchased(verificationStatus: "verified")
                    closeAndRefresh()
                case .cancelled:
                    showStatus(L.t("Purchase cancelled"))
                case .pending:
                    showStatus(L.t("Purchase pending"))
                }
            } catch {
                showStatus(L.f("Purchase failed: %@", error.localizedDescription))
            }
            setControlsEnabled(true)
        }
    }

    @objc private func restorePurchaseClicked() {
        setControlsEnabled(false)
        showStatus(L.t("Restoring purchase…"))
        Task {
            do {
                try store.updateBasicVerificationStatus("pending_restore")
                let restored = try await purchaseService.restoreBasic()
                if restored {
                    try store.markBasicPurchased(verificationStatus: "verified")
                    closeAndRefresh()
                } else {
                    try store.updateBasicVerificationStatus("not_checked")
                    showStatus(L.t("No Basic purchase found"))
                }
            } catch {
                try? store.updateBasicVerificationStatus("failed_offline")
                showStatus(L.f("Restore failed: %@", error.localizedDescription))
            }
            setControlsEnabled(true)
        }
    }

    @objc private func notNowClicked() {
        dismiss(self)
        onClose()
    }

    private func closeAndRefresh() {
        dismiss(self)
        onClose()
    }

    private func setControlsEnabled(_ isEnabled: Bool) {
        unlockButton.isEnabled = isEnabled && purchaseService.displayPrice != nil
        restoreButton.isEnabled = isEnabled
        notNowButton.isEnabled = isEnabled
    }

    private func showStatus(_ text: String) {
        statusLabel.stringValue = text
    }
}
#endif
