import Foundation

enum HarnessError: Error, CustomStringConvertible {
    case usage
    case invalidJson(String)
    case assertion(String)

    var description: String {
        switch self {
        case .usage:
            return "Usage: runSwiftIngestGoldenVectors <ingest-protocol-v1.json>"
        case .invalidJson(let message), .assertion(let message):
            return message
        }
    }
}

@main
struct SwiftIngestGoldenVectorRunner {
    static func main() {
        do {
            try run()
        } catch {
            fputs("[fail] \(error)\n", stderr)
            exit(1)
        }
    }

    private static func run() throws {
        guard CommandLine.arguments.count == 2 else {
            throw HarnessError.usage
        }

        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        let data = try Data(contentsOf: url)
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let cases = root["cases"] as? [[String: Any]]
        else {
            throw HarnessError.invalidJson("Golden vector file must contain a cases array.")
        }

        for testCase in cases {
            let name = testCase["name"] as? String ?? "(unnamed vector)"
            guard
                let initialState = testCase["initialState"] as? [String: Any],
                let batch = testCase["batch"] as? [String: Any],
                let expectedAck = testCase["expectedAck"] as? [String: Any],
                let expectedState = testCase["expectedState"] as? [String: Any]
            else {
                throw HarnessError.invalidJson("\(name) is missing initialState, batch, expectedAck, or expectedState.")
            }

            let result = IngestProtocol.apply(batch: batch, to: initialState)
            try assertSubset(actual: result.ack.dictionary, expected: expectedAck, path: "\(name).ack")
            try assertSubset(actual: result.raw, expected: expectedState, path: "\(name).state")
            print("[pass] \(name)")
        }
    }

    private static func assertSubset(actual: Any?, expected: Any?, path: String) throws {
        if let expectedDictionary = expected as? [String: Any] {
            guard let actualDictionary = actual as? [String: Any] else {
                throw HarnessError.assertion("\(path) expected object, got \(typeDescription(actual))")
            }
            for (key, expectedValue) in expectedDictionary {
                if actualDictionary[key] == nil {
                    let keys = actualDictionary.keys.sorted().joined(separator: ", ")
                    throw HarnessError.assertion("\(path).\(key) is missing; actual keys: [\(keys)]")
                }
                try assertSubset(actual: actualDictionary[key], expected: expectedValue, path: "\(path).\(key)")
            }
            return
        }

        if let expectedArray = expected as? [Any] {
            guard let actualArray = actual as? [Any] else {
                throw HarnessError.assertion("\(path) expected array, got \(typeDescription(actual))")
            }
            guard canonicalJson(actualArray) == canonicalJson(expectedArray) else {
                throw HarnessError.assertion("\(path) expected \(canonicalJson(expectedArray)), got \(canonicalJson(actualArray))")
            }
            return
        }

        guard canonicalJson(actual as Any) == canonicalJson(expected as Any) else {
            throw HarnessError.assertion("\(path) expected \(canonicalJson(expected as Any)), got \(canonicalJson(actual as Any))")
        }
    }

    private static func canonicalJson(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: [value], options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8)
        else {
            return String(describing: value)
        }
        if text.hasPrefix("["), text.hasSuffix("]") {
            let start = text.index(after: text.startIndex)
            let end = text.index(before: text.endIndex)
            return String(text[start..<end])
        }
        return text
    }

    private static func typeDescription(_ value: Any?) -> String {
        guard let value else { return "nil" }
        return String(describing: type(of: value))
    }
}
