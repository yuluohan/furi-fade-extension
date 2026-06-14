//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

import Foundation
import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let store = NativeAppStateStore()

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = nativeMessage(from: request)
        let responsePayload = handle(message: message)

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: responsePayload]
        } else {
            response.userInfo = ["message": responsePayload]
        }

        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func nativeMessage(from request: NSExtensionItem?) -> [String: Any] {
        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }
        return message as? [String: Any] ?? [:]
    }

    private func handle(message: [String: Any]) -> [String: Any] {
        let requestId = message["requestId"] as? String ?? ""
        guard message["type"] as? String == "FADING_FURIGANA_STORAGE" else {
            return failure(requestId: requestId, error: "Unsupported native message type.")
        }

        do {
            switch message["action"] as? String {
            case "loadState":
                return success(requestId: requestId, payload: ["state": try store.loadState()])
            case "saveState":
                let payload = message["payload"] as? [String: Any] ?? [:]
                guard let state = payload["state"] as? [String: Any] else {
                    return failure(requestId: requestId, error: "Missing state payload.")
                }
                try store.saveState(state)
                return success(requestId: requestId, payload: ["state": state])
            case "clearState":
                try store.clearState()
                return success(requestId: requestId, payload: ["state": NativeAppStateStore.defaultState()])
            default:
                return failure(requestId: requestId, error: "Unsupported storage action.")
            }
        } catch {
            os_log(.error, "Fading Furigana native storage failed: %@", error.localizedDescription)
            return failure(requestId: requestId, error: error.localizedDescription)
        }
    }

    private func success(requestId: String, payload: [String: Any]) -> [String: Any] {
        [
            "type": "FADING_FURIGANA_STORAGE_RESPONSE",
            "requestId": requestId,
            "ok": true,
            "payload": payload
        ]
    }

    private func failure(requestId: String, error: String) -> [String: Any] {
        [
            "type": "FADING_FURIGANA_STORAGE_RESPONSE",
            "requestId": requestId,
            "ok": false,
            "error": error
        ]
    }
}

private final class NativeAppStateStore {
    private static let appGroupIdentifier = "group.com.banyuguru.fading-furigana"
    private let fileManager = FileManager.default

    private var stateFileURL: URL {
        NativeAppStateStore.stateFileURL(fileManager: fileManager)
    }

    func loadState() throws -> [String: Any] {
        guard fileManager.fileExists(atPath: stateFileURL.path) else {
            return Self.defaultState()
        }
        let data = try Data(contentsOf: stateFileURL)
        let raw = try JSONSerialization.jsonObject(with: data)
        return raw as? [String: Any] ?? Self.defaultState()
    }

    func saveState(_ state: [String: Any]) throws {
        var nextState = state
        var metadata = nextState["metadata"] as? [String: Any] ?? [:]
        metadata["updatedAt"] = Self.timestamp()
        metadata["deviceId"] = metadata["deviceId"] as? String ?? Self.makeDeviceId()
        nextState["metadata"] = metadata

        let url = stateFileURL
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let backupURL = url.appendingPathExtension("bak")
        if fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: backupURL)
            try? fileManager.copyItem(at: url, to: backupURL)
        }
        let data = try JSONSerialization.data(withJSONObject: nextState, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
    }

    func clearState() throws {
        if fileManager.fileExists(atPath: stateFileURL.path) {
            try fileManager.removeItem(at: stateFileURL)
        }
    }

    static func defaultState() -> [String: Any] {
        let now = timestamp()
        return [
            "schemaVersion": 1,
            "userProfile": [
                "targetLanguage": "ja",
                "nativeLanguages": ["zhHans"],
                "preferredMeaningLanguages": ["zhHans", "en", "ja"]
            ],
            "settings": [
                "display": [
                    "interfaceLanguage": "en"
                ],
                "annotation": [
                    "enabled": true,
                    "mode": "adaptive",
                    "hideKnownItems": true,
                    "showRuby": true,
                    "showLoanwordOrigins": true,
                    "showMeaningsInTooltip": true,
                    "userLevel": "none",
                    "constrainedLayoutMode": "tap_only"
                ],
                "exposureTracking": [
                    "enabled": true,
                    "saveUrls": "domain_only",
                    "retentionDays": 90
                ],
                "siteOverrides": [:],
                "dictionary": [
                    "mode": "sample"
                ]
            ],
            "lexicalItems": [:],
            "userLexicalStates": [:],
            "sourceOccurrences": [:],
            "dailyExposureSummaries": [:],
            "reviewLogs": [:],
            "metadata": [
                "deviceId": makeDeviceId(),
                "createdAt": now,
                "updatedAt": now,
                "lastOpenedAt": now
            ]
        ]
    }

    static func stateFileURL(fileManager: FileManager = .default) -> URL {
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

    static func timestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    static func makeDeviceId() -> String {
        "dev_\(UUID().uuidString.lowercased())"
    }
}
