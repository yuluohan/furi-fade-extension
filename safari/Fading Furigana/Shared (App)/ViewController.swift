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

class ViewController: NSViewController {

    private let statusLabel = NSTextField(labelWithString: "Checking Safari extension status...")

    override func viewDidLoad() {
        super.viewDidLoad()
        renderNativeStatusView()
        refreshExtensionState()
    }

    private func renderNativeStatusView() {
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let titleLabel = NSTextField(labelWithString: "Fading Furigana")
        titleLabel.font = NSFont.boldSystemFont(ofSize: 20)
        titleLabel.alignment = .center

        statusLabel.font = NSFont.systemFont(ofSize: 13)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .center
        statusLabel.maximumNumberOfLines = 3

        let preferencesButton = NSButton(title: "Open Safari Extensions Preferences", target: self, action: #selector(openSafariExtensionPreferences))
        preferencesButton.bezelStyle = .rounded

        let stack = NSStackView(views: [titleLabel, statusLabel, preferencesButton])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -28)
        ])
    }

    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            DispatchQueue.main.async {
                if let error = error {
                    self.statusLabel.stringValue = "Unable to read Safari extension status: \(error.localizedDescription)"
                    return
                }

                if state?.isEnabled == true {
                    self.statusLabel.stringValue = "The Safari extension is enabled. Refresh your test page to load the latest build."
                } else {
                    self.statusLabel.stringValue = "The Safari extension is installed but disabled. Enable it in Safari Extensions preferences."
                }
            }
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
#endif
