//
//  AppSettings.swift
//  Shared (App)
//
//  Native settings sheet over the shared AppState `settings` object.
//  Edits the same fields the extension popup manages, so changes apply to
//  Safari annotation behavior; unknown settings keys are preserved.
//  The whole sheet rebuilds when the interface language changes.
//

#if os(macOS)
import Cocoa
import SafariServices
import StoreKit

final class AppSettingsViewController: NSViewController {

    private let store: AppStateStore
    private let onClose: () -> Void
    private let purchaseService = BasicPurchaseService()
    private var settings: [String: Any]
    private var entitlementSummary: AppEntitlementSummary

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
    private let entitlementOverridePopup = NSPopUpButton()
    private let basicPriceLabel = NSTextField(labelWithString: "")
    private let purchaseBasicButton = NSButton(title: "", target: nil, action: nil)
    private let restorePurchaseButton = NSButton(title: "", target: nil, action: nil)
    private let statusLabel = NSTextField(labelWithString: "")
    private var transactionListener: Task<Void, Never>?

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

    init(store: AppStateStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        self.settings = store.settingsDictionary()
        self.entitlementSummary = store.entitlementSummary()
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 690))
        preferredContentSize = NSSize(width: 560, height: 690)
        buildUI()
        refreshStoreProduct()
        startTransactionListener()
    }

    deinit {
        transactionListener?.cancel()
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
        configurePopup(entitlementOverridePopup, options: entitlementOverrideOptions, selected: entitlementSummary.developmentOverride)
        configurePurchaseControls()

        let title = NSTextField(labelWithString: L.t("Settings"))
        title.font = NSFont.boldSystemFont(ofSize: 18)

        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .leading
        root.spacing = 14
        root.edgeInsets = NSEdgeInsets(top: 20, left: 24, bottom: 16, right: 24)
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        root.addArrangedSubview(title)
        root.addArrangedSubview(makeSection(L.t("Annotation"), grid: makeGrid([
            ("", annotationEnabled),
            (L.t("Mode:"), modePopup),
            (L.t("Hide words at or below:"), levelPopup),
            (L.t("Display style:"), displayStylePopup),
            ("", smartContextCheckbox),
            ("", hideKnownCheckbox)
        ])))
        root.addArrangedSubview(makeSection(L.t("Exposure Tracking"), grid: makeGrid([
            ("", exposureEnabled),
            (L.t("Save page URLs:"), urlPrivacyPopup),
            (L.t("Keep statistics for:"), retentionPopup)
        ])))
        root.addArrangedSubview(makeSection(L.t("Extension"), grid: makeGrid([
            (L.t("Interface language:"), languagePopup),
            ("", makeLinkButton(L.t("Open Safari Extension Settings…"), action: #selector(openSafariPreferences)))
        ])))
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
        root.addArrangedSubview(makeSection(L.t("Purchase"), grid: makeGrid(purchaseRows)))
        root.addArrangedSubview(makeFooter())
    }

    // MARK: - UI helpers

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

    private func makeFooter() -> NSView {
        statusLabel.font = NSFont.systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor

        let doneButton = NSButton(title: L.t("Done"), target: self, action: #selector(doneClicked))
        doneButton.bezelStyle = .rounded
        doneButton.keyEquivalent = "\r"

        let footer = NSStackView()
        footer.orientation = .horizontal
        footer.alignment = .centerY
        footer.spacing = 12
        footer.addArrangedSubview(statusLabel)
        footer.addArrangedSubview(NSView())
        footer.addArrangedSubview(doneButton)

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
                Self.setValue(self.exposureEnabled.state == .on, in: &settings, section: "exposureTracking", key: "enabled")
                Self.setValue(self.selectedString(self.urlPrivacyPopup, fallback: "domain_only"), in: &settings, section: "exposureTracking", key: "saveUrls")
                Self.setValue(self.retentionPopup.selectedItem?.representedObject as? Int ?? 90, in: &settings, section: "exposureTracking", key: "retentionDays")
                Self.setValue(self.selectedString(self.languagePopup, fallback: "en"), in: &settings, section: "display", key: "interfaceLanguage")
            }
            try store.updateEntitlementDevelopmentOverride(selectedString(entitlementOverridePopup, fallback: "none"))

            let newLanguage = selectedString(languagePopup, fallback: "en")
            if newLanguage != previousLanguage {
                L.language = newLanguage
            }
            settings = store.settingsDictionary()
            entitlementSummary = store.entitlementSummary()
            buildUI()
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

    @objc private func doneClicked() {
        dismiss(self)
        onClose()
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
