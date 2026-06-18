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
                let savedState = try store.saveState(state)
                return success(requestId: requestId, payload: ["state": savedState])
            case "ingestRecordBatch":
                let payload = message["payload"] as? [String: Any] ?? [:]
                guard let batch = payload["batch"] as? [String: Any] else {
                    return failure(requestId: requestId, error: "Missing record batch payload.")
                }
                let ack = try store.ingestRecordBatch(batch)
                return success(requestId: requestId, payload: ["ack": ack.dictionary])
            case "pullRecordBatch":
                let payload = message["payload"] as? [String: Any] ?? [:]
                let targetKind = payload["targetKind"] as? String ?? "safari-extension"
                let cursor = payload["cursor"] as? String
                let batch = try store.pullRecordBatch(targetKind: targetKind, cursor: cursor)
                return success(requestId: requestId, payload: ["batch": batch])
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
    private static let appGroupIdentifier = "group.com.japanstudylab.fadingfurigana"
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

    func saveState(_ state: [String: Any]) throws -> [String: Any] {
        var nextState = state
        Self.touchMetadata(in: &nextState)
        Self.enforceEntitlementPlatform(in: &nextState)
        return try writeState(nextState)
    }

    func ingestRecordBatch(_ batch: [String: Any]) throws -> IngestAck {
        let result = IngestProtocol.apply(batch: batch, to: try loadState())
        guard result.ack.ok else {
            return result.ack
        }

        var nextState = result.raw
        Self.touchMetadata(in: &nextState, writeId: "ingest:\(result.ack.batchId ?? "unknown")")
        Self.enforceEntitlementPlatform(in: &nextState)
        let savedState = try writeState(nextState)
        return result.ack.withRevision(
            storageRevision: Self.intValue((savedState["metadata"] as? [String: Any])?["storageRevision"]),
            updatedAt: (savedState["metadata"] as? [String: Any])?["updatedAt"] as? String
        )
    }

    func pullRecordBatch(targetKind: String, cursor: String?) throws -> [String: Any] {
        let state = try loadState()
        #if os(iOS)
        let sourceKind = "ios-app"
        #else
        let sourceKind = "mac-app"
        #endif
        return IngestProtocol.createRecordBatch(
            from: state,
            sourceKind: sourceKind,
            targetKind: targetKind,
            direction: "pull_response",
            baseCursor: cursor
        )
    }

    private func writeState(_ nextState: [String: Any]) throws -> [String: Any] {
        let url = stateFileURL
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let backupURL = url.appendingPathExtension("bak")
        if fileManager.fileExists(atPath: url.path) {
            try? fileManager.removeItem(at: backupURL)
            try? fileManager.copyItem(at: url, to: backupURL)
        }
        let data = try JSONSerialization.data(withJSONObject: nextState, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: .atomic)
        return nextState
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
            "exposureIndex": [:],
            "sourceOccurrences": [:],
            "dailyExposureSummaries": [:],
            "reviewLogs": [:],
            "metadata": [
                "deviceId": makeDeviceId(),
                "createdAt": now,
                "updatedAt": now,
                "lastOpenedAt": now,
                "storageRevision": 0,
                "writeId": makeWriteId()
            ]
        ]
    }

    private static func touchMetadata(in state: inout [String: Any], writeId: String? = nil) {
        let now = timestamp()
        var metadata = state["metadata"] as? [String: Any] ?? [:]
        metadata["deviceId"] = metadata["deviceId"] as? String ?? makeDeviceId()
        metadata["createdAt"] = metadata["createdAt"] as? String ?? now
        metadata["updatedAt"] = now
        metadata["storageRevision"] = intValue(metadata["storageRevision"]) + 1
        metadata["writeId"] = writeId ?? makeWriteId()
        state["metadata"] = metadata
    }

    // The native store lives in the platform's App Group, so it is authoritative
    // for the entitlement platform. Force it on every write so a JS client that
    // defaults to "browser-extension" cannot stamp the wrong platform / product id
    // onto an Apple-platform store. Only corrects an existing entitlements block;
    // creation/trial-start stays owned by the container app.
    private static func enforceEntitlementPlatform(in state: inout [String: Any]) {
        guard var entitlements = state["entitlements"] as? [String: Any] else { return }
        #if os(iOS)
        let platform = "apple-ios"
        let productId = "com.japanstudylab.fadingfurigana.basic.ios"
        #else
        let platform = "apple-macos"
        let productId = "com.japanstudylab.fadingfurigana.basic.macos"
        #endif
        entitlements["platform"] = platform
        if var basic = entitlements["basic"] as? [String: Any] {
            basic["productId"] = productId
            entitlements["basic"] = basic
        }
        state["entitlements"] = entitlements
    }

    private static func intValue(_ value: Any?) -> Int {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String, let int = Int(text) { return int }
        return 0
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

    static func makeWriteId() -> String {
        "wr_\(UUID().uuidString.lowercased())"
    }
}
