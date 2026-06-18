//
//  runLoopbackSmoke.swift
//
//  Exercises the real loopback request pipeline — HTTPRequest.parse, LoopbackRouter (pairing-code
//  auth, CORS gate, ingest/pull), the shared IngestProtocol merge, and LoopbackResponse
//  serialization — over a real 127.0.0.1 TCP socket, then drives it with URLSession exactly as the
//  Chrome extension would. This is the automated half of the "Chrome extension -> Mac app"
//  loopback smoke test; the browser GUI half is the manual runbook in DEVELOPMENT_PLAN.md.
//
//  A plain POSIX socket stands in for NWListener only as the accept loop: NWListener needs system
//  networking services that aren't available in a headless CI process, but the routing, auth,
//  parsing, and serialization under test are the production types verbatim.
//

import Foundation

// Minimal stand-in for the app's AppStateStore: enough surface for LoopbackRouter to ingest and
// pull record batches via the shared IngestProtocol. The real store is not compiled here, so this
// is the only `AppStateStore` in the harness binary.
final class AppStateStore {
    private var raw: [String: Any]

    init(initial: [String: Any] = [:]) {
        self.raw = initial
    }

    func ingestRecordBatch(_ batch: [String: Any], appliedAt: Date = Date()) throws -> IngestAck {
        let result = IngestProtocol.apply(batch: batch, to: raw)
        raw = result.raw
        return result.ack
    }

    func pullRecordBatch(targetKind: String, cursor: String?) -> [String: Any] {
        IngestProtocol.createRecordBatch(from: raw, sourceKind: "mac-app", targetKind: targetKind)
    }
}

enum SmokeError: Error, CustomStringConvertible {
    case message(String)
    var description: String { if case .message(let text) = self { return text } else { return "smoke error" } }
}

func assert(_ condition: Bool, _ message: @autoclosure () -> String) throws {
    if !condition { throw SmokeError.message(message()) }
}

// Plain-socket accept loop that runs the production router. Replaces only NWListener's transport.
final class RawLoopbackServer {
    let port: UInt16
    private let listenFd: Int32
    private let store: AppStateStore
    private var running = true

    init(store: AppStateStore) throws {
        self.store = store
        var chosenFd: Int32 = -1
        var chosenPort: UInt16 = 0
        for candidate in LoopbackIngestServer.portRange {
            let sock = socket(AF_INET, SOCK_STREAM, 0)
            if sock < 0 { continue }
            var yes: Int32 = 1
            setsockopt(sock, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
            var addr = sockaddr_in()
            addr.sin_family = sa_family_t(AF_INET)
            addr.sin_port = candidate.bigEndian
            addr.sin_addr.s_addr = inet_addr("127.0.0.1")
            let bound = withUnsafePointer(to: &addr) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(sock, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
            if bound == 0 && listen(sock, 8) == 0 {
                chosenFd = sock
                chosenPort = candidate
                break
            }
            close(sock)
        }
        guard chosenFd >= 0 else {
            throw SmokeError.message("could not bind any port in \(LoopbackIngestServer.portRange)")
        }
        self.listenFd = chosenFd
        self.port = chosenPort
        LoopbackPairing.recordListening(port: chosenPort)
    }

    func start() {
        Thread.detachNewThread { [self] in
            while running {
                let client = accept(listenFd, nil, nil)
                if client < 0 { break }
                handle(client)
            }
        }
    }

    func stop() {
        running = false
        close(listenFd)
        LoopbackPairing.clearListening()
    }

    private func handle(_ client: Int32) {
        defer { close(client) }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        var request: HTTPRequest?
        while data.count < 1_048_576 {
            let received = recv(client, &buffer, buffer.count, 0)
            if received <= 0 { break }
            data.append(contentsOf: buffer[0..<received])
            if let parsed = HTTPRequest.parse(data) {
                request = parsed
                break
            }
        }
        let response = request.map { LoopbackRouter(store: store, boundPort: port).response(for: $0) }
            ?? LoopbackResponse(status: 400, payload: ["ok": false, "error": "Incomplete HTTP request."])
        let bytes = response.httpData()
        bytes.withUnsafeBytes { raw in
            _ = send(client, raw.baseAddress, raw.count, 0)
        }
    }
}

struct HTTPResult {
    let status: Int
    let json: [String: Any]
}

func request(
    _ method: String,
    _ url: URL,
    body: [String: Any]? = nil,
    bearer: String? = nil
) throws -> HTTPResult {
    var req = URLRequest(url: url)
    req.httpMethod = method
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    // Mimic the chrome-extension popup so the server's ACAO echo path is exercised too.
    req.setValue("chrome-extension://smoketestextensionid", forHTTPHeaderField: "Origin")
    if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
    if let body {
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
    }

    let semaphore = DispatchSemaphore(value: 0)
    var capturedStatus = -1
    var capturedData = Data()
    var capturedError: Error?
    let task = URLSession.shared.dataTask(with: req) { data, response, error in
        capturedError = error
        capturedStatus = (response as? HTTPURLResponse)?.statusCode ?? -1
        capturedData = data ?? Data()
        semaphore.signal()
    }
    task.resume()
    if semaphore.wait(timeout: .now() + 5) == .timedOut {
        throw SmokeError.message("\(method) \(url.path) timed out")
    }
    if let capturedError { throw SmokeError.message("\(method) \(url.path) failed: \(capturedError)") }
    let json = (try? JSONSerialization.jsonObject(with: capturedData)) as? [String: Any] ?? [:]
    return HTTPResult(status: capturedStatus, json: json)
}

func recordIds(in batch: [String: Any]) -> Set<String> {
    let records = batch["records"] as? [[String: Any]] ?? []
    return Set(records.compactMap { $0["recordId"] as? String })
}

@main
struct LoopbackSmokeRunner {
    static func main() {
        do {
            try run()
            print("[pass] loopback Chrome -> Mac app round trip")
        } catch {
            fputs("[fail] \(error)\n", stderr)
            exit(1)
        }
    }

    private static func run() throws {
        // Start from a clean pairing/status state so assertions reflect this run only.
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: LoopbackPairing.lastConnectedDefaultsKey)
        defaults.removeObject(forKey: LoopbackPairing.lastClientKindDefaultsKey)

        let store = AppStateStore()
        let server = try RawLoopbackServer(store: store)
        server.start()
        defer { server.stop() }

        let base = URL(string: "http://127.0.0.1:\(server.port)")!
        let code = LoopbackPairing.currentCode()
        try assert(!code.isEmpty, "pairing code should be generated on start")

        // 1. Discovery: /health is unauthenticated and advertises the contract.
        let health = try request("GET", base.appendingPathComponent("health"))
        try assert(health.status == 200, "health status was \(health.status)")
        try assert(health.json["ok"] as? Bool == true, "health ok was false")
        try assert(health.json["protocolVersion"] as? Int == 1, "health protocolVersion mismatch")
        try assert(health.json["pairing"] as? String == "token", "health should report token pairing")

        // Build a real chrome-extension push batch with the shared codec.
        let percentEncoded = "確認:かくにん".addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
        let seed: [String: Any] = [
            "schemaVersion": 1,
            "metadata": ["deviceId": "dev_chrome_smoke", "updatedAt": "2026-06-18T10:00:00.000Z"],
            "lexicalItems": [
                "確認:かくにん": [
                    "id": "確認:かくにん", "surface": "確認", "reading": "かくにん",
                    "updatedAt": "2026-06-18T10:00:00.000Z", "deviceId": "dev_chrome_smoke"
                ]
            ],
            "exposureIndex": [
                "確認:かくにん": [
                    "id": "確認:かくにん", "surface": "確認", "seenCount": 3,
                    "lastSeenAt": "2026-06-18T10:00:00.000Z",
                    "updatedAt": "2026-06-18T10:00:00.000Z", "deviceId": "dev_chrome_smoke"
                ]
            ]
        ]
        let pushBatch = IngestProtocol.createRecordBatch(
            from: seed, sourceKind: "chrome-extension", targetKind: "mac-app", direction: "push"
        )
        let expectedIds: Set<String> = ["lexicalItem:\(percentEncoded)", "exposureIndex:\(percentEncoded)"]

        // 2. Auth gate: ingest without (and with a wrong) code is rejected.
        let noAuth = try request("POST", base.appendingPathComponent("ingest-record-batch"), body: ["batch": pushBatch])
        try assert(noAuth.status == 401, "ingest without a code should be 401, got \(noAuth.status)")
        let wrongAuth = try request(
            "POST", base.appendingPathComponent("ingest-record-batch"),
            body: ["batch": pushBatch], bearer: code + "X"
        )
        try assert(wrongAuth.status == 401, "ingest with a wrong code should be 401, got \(wrongAuth.status)")

        // 3. Ingest with the real pairing code.
        let ingest = try request(
            "POST", base.appendingPathComponent("ingest-record-batch"),
            body: ["batch": pushBatch], bearer: code
        )
        try assert(ingest.status == 200, "ingest status was \(ingest.status)")
        let ack = ingest.json["ack"] as? [String: Any] ?? [:]
        try assert(ack["ok"] as? Bool == true, "ack.ok was false: \(ack)")
        let applied = Set(ack["appliedRecordIds"] as? [String] ?? [])
        try assert(expectedIds.isSubset(of: applied), "ack missing applied ids; got \(applied)")

        // 4. Pull the merged state back, as the extension would to reflect app changes.
        let pull = try request(
            "POST", base.appendingPathComponent("pull-record-batch"),
            body: ["targetKind": "chrome-extension"], bearer: code
        )
        try assert(pull.status == 200, "pull status was \(pull.status)")
        let pulledBatch = pull.json["batch"] as? [String: Any] ?? [:]
        let pulledIds = recordIds(in: pulledBatch)
        try assert(expectedIds.isSubset(of: pulledIds), "pull missing ingested records; got \(pulledIds)")

        // 5. The server should have recorded a real connection for the status UI.
        let status = LoopbackPairing.status()
        try assert(status.isListening, "server should report listening while running")
        try assert(status.lastConnectedAt != nil, "an authorized exchange should set lastConnectedAt")
        try assert(status.lastClientKind == "chrome-extension", "lastClientKind was \(String(describing: status.lastClientKind))")

        // 6. Stop clears the listening status.
        server.stop()
        try assert(!LoopbackPairing.status().isListening, "stop should clear listening status")
    }
}
