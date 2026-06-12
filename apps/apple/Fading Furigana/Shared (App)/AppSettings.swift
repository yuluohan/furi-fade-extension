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

final class AppSettingsViewController: NSViewController {

    private let store: AppStateStore
    private let onClose: () -> Void
    private var settings: [String: Any]

    private let annotationEnabled = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let hideKnownCheckbox = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let exposureEnabled = NSButton(checkboxWithTitle: "", target: nil, action: nil)
    private let modePopup = NSPopUpButton()
    private let levelPopup = NSPopUpButton()
    private let displayStylePopup = NSPopUpButton()
    private let urlPrivacyPopup = NSPopUpButton()
    private let retentionPopup = NSPopUpButton()
    private let languagePopup = NSPopUpButton()
    private let statusLabel = NSTextField(labelWithString: "")

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

    init(store: AppStateStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        self.settings = store.settingsDictionary()
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 520, height: 560))
        preferredContentSize = NSSize(width: 520, height: 560)
        buildUI()
    }

    private func buildUI() {
        view.subviews.forEach { $0.removeFromSuperview() }

        let annotation = dict("annotation")
        let exposure = dict("exposureTracking")
        let display = dict("display")

        configureCheckbox(annotationEnabled, titleKey: "Annotate Japanese words on web pages", isOn: annotation["enabled"] as? Bool ?? true)
        configureCheckbox(hideKnownCheckbox, titleKey: "Hide words I already know", isOn: annotation["hideKnownItems"] as? Bool ?? true)
        configureCheckbox(exposureEnabled, titleKey: "Track word exposure while browsing", isOn: exposure["enabled"] as? Bool ?? true)
        configurePopup(modePopup, options: modeOptions, selected: annotation["mode"] as? String ?? "adaptive")
        configurePopup(levelPopup, options: levelOptions, selected: annotation["userLevel"] as? String ?? "none")
        configurePopup(displayStylePopup, options: displayStyleOptions, selected: annotation["constrainedLayoutMode"] as? String ?? "tap_only")
        configurePopup(urlPrivacyPopup, options: urlPrivacyOptions, selected: exposure["saveUrls"] as? String ?? "domain_only")
        configureRetentionPopup(selected: exposure["retentionDays"] as? Int ?? 90)
        configurePopup(languagePopup, options: languageOptions, selected: display["interfaceLanguage"] as? String ?? "en", localizeTitles: false)

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
        root.addArrangedSubview(makeSection(L.t("Data"), grid: makeGrid([
            ("", makeLinkButton(L.t("Show Data File in Finder"), action: #selector(revealDataFile)))
        ])))
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
                Self.setValue(self.hideKnownCheckbox.state == .on, in: &settings, section: "annotation", key: "hideKnownItems")
                Self.setValue(self.exposureEnabled.state == .on, in: &settings, section: "exposureTracking", key: "enabled")
                Self.setValue(self.selectedString(self.urlPrivacyPopup, fallback: "domain_only"), in: &settings, section: "exposureTracking", key: "saveUrls")
                Self.setValue(self.retentionPopup.selectedItem?.representedObject as? Int ?? 90, in: &settings, section: "exposureTracking", key: "retentionDays")
                Self.setValue(self.selectedString(self.languagePopup, fallback: "en"), in: &settings, section: "display", key: "interfaceLanguage")
            }

            let newLanguage = selectedString(languagePopup, fallback: "en")
            if newLanguage != previousLanguage {
                L.language = newLanguage
                settings = store.settingsDictionary()
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

    @objc private func revealDataFile() {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: store.displayPath)])
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

    private func dict(_ section: String) -> [String: Any] {
        settings[section] as? [String: Any] ?? [:]
    }

    private static func setValue(_ value: Any, in settings: inout [String: Any], section: String, key: String) {
        var sectionDict = settings[section] as? [String: Any] ?? [:]
        sectionDict[key] = value
        settings[section] = sectionDict
    }
}
#endif
