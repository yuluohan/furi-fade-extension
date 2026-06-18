//
//  IngestProtocol.swift
//  Shared (App)
//

import Foundation

struct IngestAck {
    let protocolVersion: Int
    let batchId: String?
    let ok: Bool
    let appliedRecordIds: [String]
    let rejectedRecords: [[String: Any]]
    let errorCode: String?
    let errorMessage: String?
    let storageRevision: Int?
    let updatedAt: String?

    func withRevision(storageRevision: Int?, updatedAt: String?) -> IngestAck {
        IngestAck(
            protocolVersion: protocolVersion,
            batchId: batchId,
            ok: ok,
            appliedRecordIds: appliedRecordIds,
            rejectedRecords: rejectedRecords,
            errorCode: errorCode,
            errorMessage: errorMessage,
            storageRevision: storageRevision,
            updatedAt: updatedAt
        )
    }

    var dictionary: [String: Any] {
        var payload: [String: Any] = [
            "protocolVersion": protocolVersion,
            "ok": ok,
            "appliedRecordIds": appliedRecordIds,
            "rejectedRecords": rejectedRecords
        ]
        if let batchId { payload["batchId"] = batchId }
        if let errorCode {
            payload["error"] = [
                "code": errorCode,
                "message": errorMessage ?? errorCode
            ]
        }
        if let storageRevision { payload["storageRevision"] = storageRevision }
        if let updatedAt { payload["updatedAt"] = updatedAt }
        return payload
    }
}

enum IngestProtocol {
    private static let protocolVersion = 1

    private struct RecordDefinition {
        let domain: String
        let appStateKey: String?
        let singletonId: String?
        let syncScope: String
        let mergeStrategy: String
    }

    private static let definitions: [String: RecordDefinition] = [
        "appMetadata": RecordDefinition(domain: "metadata", appStateKey: nil, singletonId: "local", syncScope: "local_only", mergeStrategy: "local_only"),
        "userProfile": RecordDefinition(domain: "userProfile", appStateKey: nil, singletonId: "global", syncScope: "syncable", mergeStrategy: "lww"),
        "settings": RecordDefinition(domain: "settings", appStateKey: nil, singletonId: "global", syncScope: "syncable", mergeStrategy: "lww"),
        "entitlements": RecordDefinition(domain: "entitlements", appStateKey: nil, singletonId: "local", syncScope: "local_or_server_authoritative", mergeStrategy: "server_authoritative"),
        "lexicalItem": RecordDefinition(domain: "lexicalItems", appStateKey: "lexicalItems", singletonId: nil, syncScope: "syncable", mergeStrategy: "lww"),
        "userLexicalState": RecordDefinition(domain: "userLexicalStates", appStateKey: "userLexicalStates", singletonId: nil, syncScope: "syncable", mergeStrategy: "lww"),
        "exposureIndex": RecordDefinition(domain: "exposureIndex", appStateKey: "exposureIndex", singletonId: nil, syncScope: "syncable", mergeStrategy: "lww_pending_additive_exposure"),
        "sourceOccurrence": RecordDefinition(domain: "sourceOccurrences", appStateKey: "sourceOccurrences", singletonId: nil, syncScope: "syncable", mergeStrategy: "append_lww_same_id"),
        "dailyExposureSummary": RecordDefinition(domain: "dailyExposureSummaries", appStateKey: "dailyExposureSummaries", singletonId: nil, syncScope: "per_device_delta", mergeStrategy: "additive_delta_pending"),
        "reviewLog": RecordDefinition(domain: "reviewLogs", appStateKey: "reviewLogs", singletonId: nil, syncScope: "syncable", mergeStrategy: "append_lww_same_id")
    ]

    struct ApplyResult {
        let raw: [String: Any]
        let ack: IngestAck
    }

    static func createRecordBatch(
        from raw: [String: Any],
        sourceKind: String,
        targetKind: String,
        direction: String = "pull_response",
        baseCursor: String? = nil,
        batchId: String? = nil,
        createdAt: String? = nil
    ) -> [String: Any] {
        let now = createdAt ?? timestamp()
        let metadata = raw["metadata"] as? [String: Any] ?? [:]
        let sourceDeviceId = normalizeDeviceId(metadata["deviceId"])
        let sourceUpdatedAt = firstString(metadata["updatedAt"], metadata["createdAt"], now)
        var records: [[String: Any]] = []

        for (type, definition) in definitions.sorted(by: { $0.key < $1.key }) {
            if let singletonId = definition.singletonId {
                let value: [String: Any]
                switch type {
                case "appMetadata": value = metadata
                case "userProfile": value = raw["userProfile"] as? [String: Any] ?? [:]
                case "settings": value = raw["settings"] as? [String: Any] ?? [:]
                case "entitlements": value = raw["entitlements"] as? [String: Any] ?? [:]
                default: value = [:]
                }
                records.append(createRecord(
                    type: type,
                    definition: definition,
                    logicalId: singletonId,
                    value: value,
                    fallbackUpdatedAt: sourceUpdatedAt,
                    fallbackDeviceId: sourceDeviceId
                ))
                continue
            }

            guard let appStateKey = definition.appStateKey,
                  let domain = raw[appStateKey] as? [String: Any] else {
                continue
            }
            for logicalId in domain.keys.sorted() {
                guard let value = domain[logicalId] as? [String: Any] else { continue }
                records.append(createRecord(
                    type: type,
                    definition: definition,
                    logicalId: logicalId,
                    value: value,
                    fallbackUpdatedAt: sourceUpdatedAt,
                    fallbackDeviceId: sourceDeviceId
                ))
            }
        }

        return [
            "protocolVersion": protocolVersion,
            "batchId": batchId ?? "bat_\(sourceDeviceId)_\(UUID().uuidString.lowercased())",
            "sourceClientId": sourceDeviceId,
            "sourceKind": sourceKind,
            "targetKind": targetKind,
            "direction": direction,
            "createdAt": now,
            "baseCursor": baseCursor ?? NSNull(),
            "records": records
        ]
    }

    static func apply(batch: [String: Any], to raw: [String: Any]) -> ApplyResult {
        let batchId = batch["batchId"] as? String
        let errors = validateBatch(batch)
        if !errors.messages.isEmpty {
            return ApplyResult(
                raw: raw,
                ack: failureAck(
                    batchId: batchId,
                    code: "invalid_batch",
                    message: errors.messages.joined(separator: "; "),
                    rejectedRecords: errors.rejectedRecords
                )
            )
        }

        var nextRaw = raw
        var appliedRecordIds: [String] = []
        let records = batch["records"] as? [[String: Any]] ?? []

        for record in records {
            apply(record: record, to: &nextRaw)
            if let recordId = record["recordId"] as? String {
                appliedRecordIds.append(recordId)
            }
        }

        return ApplyResult(
            raw: nextRaw,
            ack: IngestAck(
                protocolVersion: protocolVersion,
                batchId: batchId,
                ok: true,
                appliedRecordIds: appliedRecordIds,
                rejectedRecords: [],
                errorCode: nil,
                errorMessage: nil,
                storageRevision: nil,
                updatedAt: nil
            )
        )
    }

    private static func validateBatch(_ batch: [String: Any]) -> (messages: [String], rejectedRecords: [[String: Any]]) {
        var messages = validateBatchEnvelope(batch)
        var rejectedRecords: [[String: Any]] = []
        let records = batch["records"] as? [[String: Any]] ?? []
        for (index, record) in records.enumerated() {
            let recordErrors = validateRecord(record)
            if !recordErrors.isEmpty {
                messages.append(contentsOf: recordErrors.map { "records[\(index)].\($0)" })
                rejectedRecords.append([
                    "recordId": record["recordId"] as? String ?? "",
                    "code": "invalid_record",
                    "message": recordErrors.joined(separator: "; ")
                ])
            }
        }
        return (messages, rejectedRecords)
    }

    private static func validateBatchEnvelope(_ batch: [String: Any]) -> [String] {
        var errors: [String] = []
        if intValue(batch["protocolVersion"]) != protocolVersion {
            errors.append("protocolVersion must be \(protocolVersion)")
        }
        if (batch["batchId"] as? String)?.isEmpty != false {
            errors.append("batchId must be a non-empty string")
        }
        if (batch["sourceClientId"] as? String)?.isEmpty != false {
            errors.append("sourceClientId must be a non-empty string")
        }
        if !["safari-extension", "chrome-extension", "mac-app", "ios-app", "cloud"].contains(batch["sourceKind"] as? String ?? "") {
            errors.append("sourceKind is invalid")
        }
        if !["safari-extension", "chrome-extension", "mac-app", "ios-app", "cloud"].contains(batch["targetKind"] as? String ?? "") {
            errors.append("targetKind is invalid")
        }
        if !["push", "pull_response"].contains(batch["direction"] as? String ?? "") {
            errors.append("direction is invalid")
        }
        if parseISODate(batch["createdAt"] as? String) == nil {
            errors.append("createdAt must be an ISO timestamp string")
        }
        if batch["records"] as? [[String: Any]] == nil {
            errors.append("records must be an array of objects")
        }
        return errors
    }

    private static func validateRecord(_ record: [String: Any]) -> [String] {
        var errors: [String] = []
        guard let type = record["type"] as? String, let definition = definitions[type] else {
            return ["record type is unknown"]
        }

        if intValue(record["formatVersion"]) != 1 {
            errors.append("formatVersion must be 1")
        }
        if record["domain"] as? String != definition.domain {
            errors.append("domain must be \(definition.domain)")
        }
        if record["syncScope"] as? String != definition.syncScope {
            errors.append("syncScope must be \(definition.syncScope)")
        }
        if record["mergeStrategy"] as? String != definition.mergeStrategy {
            errors.append("mergeStrategy must be \(definition.mergeStrategy)")
        }
        guard let logicalId = record["logicalId"] as? String, !logicalId.isEmpty else {
            errors.append("logicalId must be a non-empty string")
            return errors
        }
        let expectedRecordId = createRecordId(type: type, logicalId: logicalId)
        if record["recordId"] as? String != expectedRecordId {
            errors.append("recordId is not deterministic for type/logicalId")
        }
        if parseISODate(record["updatedAt"] as? String) == nil {
            errors.append("updatedAt must be an ISO timestamp string")
        }
        if !(record["deviceId"] as? String ?? "").hasPrefix("dev_") {
            errors.append("deviceId must start with dev_")
        }
        if let deletedAt = record["deletedAt"] as? String, parseISODate(deletedAt) == nil {
            errors.append("deletedAt must be an ISO timestamp string")
        }
        if record["value"] as? [String: Any] == nil {
            errors.append("value must be an object")
        }
        if let singletonId = definition.singletonId, logicalId != singletonId {
            errors.append("logicalId must be \(singletonId)")
        }
        return errors
    }

    private static func apply(record: [String: Any], to raw: inout [String: Any]) {
        guard
            let type = record["type"] as? String,
            let logicalId = record["logicalId"] as? String,
            let definition = definitions[type],
            let incomingValue = record["value"] as? [String: Any]
        else {
            return
        }

        let strategy = record["mergeStrategy"] as? String ?? definition.mergeStrategy
        if let appStateKey = definition.appStateKey {
            var domain = raw[appStateKey] as? [String: Any] ?? [:]
            let existing = domain[logicalId] as? [String: Any]
            if let merged = mergeValue(existing: existing, incomingRecord: record, incomingValue: incomingValue, strategy: strategy) {
                domain[logicalId] = merged
            }
            raw[appStateKey] = domain
            return
        }

        let key: String
        switch type {
        case "appMetadata": key = "metadata"
        case "userProfile": key = "userProfile"
        case "settings": key = "settings"
        case "entitlements": key = "entitlements"
        default: return
        }
        let existing = raw[key] as? [String: Any]
        if let merged = mergeValue(existing: existing, incomingRecord: record, incomingValue: incomingValue, strategy: strategy) {
            raw[key] = merged
        }
    }

    private static func mergeValue(existing: [String: Any]?, incomingRecord: [String: Any], incomingValue: [String: Any], strategy: String) -> [String: Any]? {
        guard let existing else {
            return incomingRecord["deletedAt"] == nil ? incomingValue : nil
        }

        switch strategy {
        case "local_only":
            return existing
        case "lww", "append_lww_same_id", "server_authoritative", "lww_pending_additive_exposure", "additive_delta_pending":
            return incomingWins(existing: existing, incomingRecord: incomingRecord) ? incomingValue : existing
        default:
            return existing
        }
    }

    private static func incomingWins(existing: [String: Any], incomingRecord: [String: Any]) -> Bool {
        let existingVersion = laterTimestamp(existing["deletedAt"] as? String, existing["updatedAt"] as? String) ?? ""
        let incomingVersion = laterTimestamp(incomingRecord["deletedAt"] as? String, incomingRecord["updatedAt"] as? String) ?? ""
        if existingVersion != incomingVersion {
            return compareTimestamp(incomingVersion, existingVersion) > 0
        }

        let existingDeleted = existing["deletedAt"] != nil
        let incomingDeleted = incomingRecord["deletedAt"] != nil
        if existingDeleted != incomingDeleted {
            return incomingDeleted
        }

        return (incomingRecord["deviceId"] as? String ?? "") > (existing["deviceId"] as? String ?? "")
    }

    private static func failureAck(batchId: String?, code: String, message: String, rejectedRecords: [[String: Any]] = []) -> IngestAck {
        IngestAck(
            protocolVersion: protocolVersion,
            batchId: batchId,
            ok: false,
            appliedRecordIds: [],
            rejectedRecords: rejectedRecords,
            errorCode: code,
            errorMessage: message,
            storageRevision: nil,
            updatedAt: nil
        )
    }

    private static func createRecord(
        type: String,
        definition: RecordDefinition,
        logicalId: String,
        value: [String: Any],
        fallbackUpdatedAt: String,
        fallbackDeviceId: String
    ) -> [String: Any] {
        var record: [String: Any] = [
            "formatVersion": 1,
            "recordId": createRecordId(type: type, logicalId: logicalId),
            "type": type,
            "domain": definition.domain,
            "logicalId": logicalId,
            "syncScope": definition.syncScope,
            "mergeStrategy": definition.mergeStrategy,
            "updatedAt": firstString(
                value["deletedAt"],
                value["updatedAt"],
                value["lastSeenAt"],
                value["reviewedAt"],
                value["createdAt"],
                fallbackUpdatedAt
            ),
            "deviceId": normalizeDeviceId(value["deviceId"] ?? fallbackDeviceId),
            "value": value
        ]
        if let deletedAt = value["deletedAt"] as? String, !deletedAt.isEmpty {
            record["deletedAt"] = deletedAt
        }
        return record
    }

    private static func createRecordId(type: String, logicalId: String) -> String {
        "\(type):\(encodeRecordKey(logicalId))"
    }

    private static func encodeRecordKey(_ value: String) -> String {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func intValue(_ value: Any?) -> Int {
        if let int = value as? Int { return int }
        if let number = value as? NSNumber { return number.intValue }
        if let text = value as? String, let int = Int(text) { return int }
        return 0
    }

    private static func normalizeDeviceId(_ value: Any?) -> String {
        if let text = value as? String, text.hasPrefix("dev_") {
            return text
        }
        return "dev_unknown"
    }

    private static func firstString(_ values: Any?...) -> String {
        for value in values {
            if let text = value as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return ""
    }

    private static func parseISODate(_ value: String?) -> Date? {
        guard let value else { return nil }
        if let date = fractionalISOFormatter.date(from: value) {
            return date
        }
        return plainISOFormatter.date(from: value)
    }

    private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainISOFormatter = ISO8601DateFormatter()

    private static func laterTimestamp(_ lhs: String?, _ rhs: String?) -> String? {
        guard let lhs, !lhs.isEmpty else { return rhs }
        guard let rhs, !rhs.isEmpty else { return lhs }
        if let lhsDate = parseISODate(lhs), let rhsDate = parseISODate(rhs) {
            return lhsDate >= rhsDate ? lhs : rhs
        }
        return lhs >= rhs ? lhs : rhs
    }

    private static func compareTimestamp(_ lhs: String, _ rhs: String) -> Int {
        if let lhsDate = parseISODate(lhs), let rhsDate = parseISODate(rhs) {
            if lhsDate == rhsDate { return 0 }
            return lhsDate > rhsDate ? 1 : -1
        }
        if lhs == rhs { return 0 }
        return lhs > rhs ? 1 : -1
    }

    private static func timestamp() -> String {
        ISO8601DateFormatter().string(from: Date())
    }
}
