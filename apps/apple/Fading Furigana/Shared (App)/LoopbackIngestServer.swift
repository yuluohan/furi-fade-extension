//
//  LoopbackIngestServer.swift
//  Shared (App)
//

#if os(macOS)
import Foundation
import Network

/// Persists the loopback pairing code and last-connection status in `UserDefaults` so both the
/// ingest server and the settings UI read the same source of truth. The code doubles as the
/// bearer token: the Mac App shows it, the Chrome extension stores it and sends it as
/// `Authorization: Bearer <code>`. A code is generated on first use so the port is never
/// reachable without pairing.
enum LoopbackPairing {
    static let tokenDefaultsKey = "FadingFuriganaLoopbackToken"
    static let portDefaultsKey = "FadingFuriganaLoopbackPort"
    static let lastConnectedDefaultsKey = "FadingFuriganaLoopbackLastConnectedAt"
    static let lastClientKindDefaultsKey = "FadingFuriganaLoopbackLastClientKind"

    // Crockford-style base32 minus ambiguous glyphs (0/O, 1/I/L), so a code is easy to read aloud.
    private static let alphabet = Array("ABCDEFGHJKMNPQRSTUVWXYZ23456789")

    struct Status {
        let isListening: Bool
        let port: UInt16?
        let code: String
        let lastConnectedAt: Date?
        let lastClientKind: String?
    }

    /// Returns the persisted pairing code, generating and storing one the first time.
    @discardableResult
    static func currentCode(defaults: UserDefaults = .standard) -> String {
        if let existing = normalize(defaults.string(forKey: tokenDefaultsKey)), !existing.isEmpty {
            return existing
        }
        return regenerateCode(defaults: defaults)
    }

    @discardableResult
    static func regenerateCode(defaults: UserDefaults = .standard) -> String {
        let code = generateCode()
        defaults.set(code, forKey: tokenDefaultsKey)
        return code
    }

    static func generateCode(length: Int = 8) -> String {
        String((0..<length).map { _ in alphabet[Int.random(in: 0..<alphabet.count)] })
    }

    /// Uppercases and keeps only `A-Z0-9`, so a code pasted with spaces/dashes/lowercase still
    /// matches. Both Swift and JS normalize identically before comparing.
    static func normalize(_ value: String?) -> String? {
        guard let value else { return nil }
        let filtered = value.uppercased().unicodeScalars.filter {
            ($0.value >= 65 && $0.value <= 90) || ($0.value >= 48 && $0.value <= 57)
        }
        return String(String.UnicodeScalarView(filtered))
    }

    static func recordListening(port: UInt16, defaults: UserDefaults = .standard) {
        defaults.set(Int(port), forKey: portDefaultsKey)
    }

    static func clearListening(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: portDefaultsKey)
    }

    static func recordConnection(port: UInt16?, clientKind: String?, defaults: UserDefaults = .standard) {
        if let port { defaults.set(Int(port), forKey: portDefaultsKey) }
        defaults.set(Date().timeIntervalSince1970, forKey: lastConnectedDefaultsKey)
        if let clientKind, !clientKind.isEmpty {
            defaults.set(clientKind, forKey: lastClientKindDefaultsKey)
        }
    }

    static func status(defaults: UserDefaults = .standard) -> Status {
        let portValue = defaults.integer(forKey: portDefaultsKey)
        let port: UInt16? = portValue > 0 ? UInt16(portValue) : nil
        let lastConnected = defaults.object(forKey: lastConnectedDefaultsKey) as? Double
        return Status(
            isListening: port != nil,
            port: port,
            code: currentCode(defaults: defaults),
            lastConnectedAt: lastConnected.map { Date(timeIntervalSince1970: $0) },
            lastClientKind: defaults.string(forKey: lastClientKindDefaultsKey)
        )
    }
}

final class LoopbackIngestServer {
    static let portRange: ClosedRange<UInt16> = 57310...57330

    private let store: AppStateStore
    private let queue = DispatchQueue(label: "com.japanstudylab.fadingfurigana.loopback")
    private var listener: NWListener?
    private(set) var boundPort: UInt16?

    private let maxRequestBytes = 1_048_576

    init(store: AppStateStore) {
        self.store = store
    }

    func start() {
        guard listener == nil else { return }

        // Ensure a pairing code exists before the port opens, so the server never accepts
        // unauthenticated batches.
        LoopbackPairing.currentCode()

        // NWListener binds asynchronously, so a port conflict surfaces in the state handler, not
        // as a throw. Walk the range on the server queue, advancing to the next port on failure
        // until one becomes ready.
        queue.async { [weak self] in
            self?.bind(portIndex: 0)
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self else { return }
            self.listener?.cancel()
            self.listener = nil
            self.boundPort = nil
            LoopbackPairing.clearListening()
        }
    }

    private func bind(portIndex index: Int) {
        let ports = Array(Self.portRange)
        guard index < ports.count else {
            NSLog("Fading Furigana loopback ingest server could not bind any configured port.")
            return
        }
        let port = ports[index]

        // Restrict to loopback only (never 0.0.0.0). requiredLocalEndpoint owns the port, so we
        // must not also pass `on:` — that combination is rejected with EINVAL.
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)

        let candidate: NWListener
        do {
            candidate = try NWListener(using: parameters)
        } catch {
            bind(portIndex: index + 1)
            return
        }

        candidate.newConnectionHandler = { [weak self] connection in
            self?.handle(connection)
        }
        candidate.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.boundPort = port
                LoopbackPairing.recordListening(port: port)
                NSLog("Fading Furigana loopback ingest server listening on 127.0.0.1:%d", Int(port))
            case .failed(let error):
                NSLog("Fading Furigana loopback ingest server failed on port %d: %@", Int(port), String(describing: error))
                candidate.cancel()
                if self.listener === candidate {
                    self.listener = nil
                    self.bind(portIndex: index + 1)
                }
            default:
                break
            }
        }
        self.listener = candidate
        candidate.start(queue: queue)
    }

    private func handle(_ connection: NWConnection) {
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] content, _, isComplete, error in
            guard let self else { return }
            var nextBuffer = buffer
            if let content {
                nextBuffer.append(content)
            }

            if nextBuffer.count > self.maxRequestBytes {
                self.send(connection, LoopbackResponse(status: 413, payload: ["ok": false, "error": "Request body is too large."]))
                return
            }

            if let error {
                self.send(connection, LoopbackResponse(status: 400, payload: ["ok": false, "error": String(describing: error)]))
                return
            }

            if let request = HTTPRequest.parse(nextBuffer) {
                let router = LoopbackRouter(store: self.store, boundPort: self.boundPort)
                self.send(connection, router.response(for: request))
                return
            }

            if isComplete {
                self.send(connection, LoopbackResponse(status: 400, payload: ["ok": false, "error": "Incomplete HTTP request."]))
                return
            }

            self.receive(connection, buffer: nextBuffer)
        }
    }

    private func send(_ connection: NWConnection, _ response: LoopbackResponse) {
        connection.send(content: response.httpData(), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

/// HTTP response for the loopback bridge. Owns its own serialization so the NWListener transport
/// and a plain-socket test harness emit byte-identical responses.
struct LoopbackResponse {
    let status: Int
    let payload: [String: Any]
    let origin: String?

    init(status: Int, payload: [String: Any], origin: String? = nil) {
        self.status = status
        self.payload = payload
        self.origin = origin
    }

    func httpData() -> Data {
        let body = status == 204 ? Data() : ((try? JSONSerialization.data(withJSONObject: payload, options: [])) ?? Data("{}".utf8))
        var headers = [
            "HTTP/1.1 \(status) \(HTTPReason.phrase(for: status))",
            "Content-Type: application/json; charset=utf-8",
            "Content-Length: \(body.count)",
            "Connection: close",
            "Cache-Control: no-store"
        ]
        if let origin {
            headers.append("Access-Control-Allow-Origin: \(origin)")
            headers.append("Access-Control-Allow-Headers: Content-Type, Authorization")
            headers.append("Access-Control-Allow-Methods: GET, POST, OPTIONS")
        }
        headers.append("")
        headers.append("")
        var data = Data(headers.joined(separator: "\r\n").utf8)
        data.append(body)
        return data
    }
}

/// Pure request routing for the loopback bridge — no connection state, so it can be driven over a
/// plain socket in tests as well as by NWListener in the app.
struct LoopbackRouter {
    let store: AppStateStore
    let boundPort: UInt16?

    func response(for request: HTTPRequest) -> LoopbackResponse {
        if request.method == "OPTIONS" {
            return LoopbackResponse(status: 204, payload: [:], origin: allowedOrigin(request))
        }

        // The pairing code is the real gate: only requests carrying the bearer code are
        // accepted, and responses are only readable by the paired chrome-extension origin
        // (ACAO echo). A web page can therefore neither write (no code) nor read (no ACAO),
        // so we do not reject on Origin alone — content-script flushes legitimately carry a
        // page Origin.

        switch (request.method, request.path) {
        case ("GET", "/health"):
            return LoopbackResponse(status: 200, payload: [
                "ok": true,
                "protocolVersion": 1,
                "app": "Fading Furigana",
                "transport": "loopback",
                "supports": ["recordBatch"],
                "pairing": "token"
            ], origin: allowedOrigin(request))

        case ("POST", "/ingest-record-batch"):
            guard isAuthorized(request) else {
                return LoopbackResponse(status: 401, payload: ["ok": false, "error": "Loopback token is invalid."], origin: allowedOrigin(request))
            }
            guard
                let json = parseJSONBody(request),
                let batch = json["batch"] as? [String: Any]
            else {
                return LoopbackResponse(status: 400, payload: ["ok": false, "error": "Expected JSON body with batch."], origin: allowedOrigin(request))
            }
            do {
                let ack = try store.ingestRecordBatch(batch)
                if ack.ok {
                    LoopbackPairing.recordConnection(port: boundPort, clientKind: batch["sourceKind"] as? String ?? "chrome-extension")
                }
                return LoopbackResponse(status: ack.ok ? 200 : 400, payload: ["ok": ack.ok, "ack": ack.dictionary], origin: allowedOrigin(request))
            } catch {
                return LoopbackResponse(status: 500, payload: ["ok": false, "error": error.localizedDescription], origin: allowedOrigin(request))
            }

        case ("POST", "/pull-record-batch"):
            guard isAuthorized(request) else {
                return LoopbackResponse(status: 401, payload: ["ok": false, "error": "Loopback token is invalid."], origin: allowedOrigin(request))
            }
            let json = parseJSONBody(request) ?? [:]
            let cursor = json["cursor"] as? String
            let targetKind = json["targetKind"] as? String ?? "chrome-extension"
            let batch = store.pullRecordBatch(targetKind: targetKind, cursor: cursor)
            LoopbackPairing.recordConnection(port: boundPort, clientKind: targetKind)
            return LoopbackResponse(status: 200, payload: ["ok": true, "batch": batch], origin: allowedOrigin(request))

        default:
            return LoopbackResponse(status: 404, payload: ["ok": false, "error": "Unknown loopback endpoint."], origin: allowedOrigin(request))
        }
    }

    private func parseJSONBody(_ request: HTTPRequest) -> [String: Any]? {
        guard !request.body.isEmpty else { return [:] }
        return (try? JSONSerialization.jsonObject(with: request.body)) as? [String: Any]
    }

    private func isAllowedOrigin(_ request: HTTPRequest) -> Bool {
        guard let origin = request.headers["origin"], !origin.isEmpty else { return true }
        return origin.hasPrefix("chrome-extension://")
    }

    private func allowedOrigin(_ request: HTTPRequest) -> String? {
        guard isAllowedOrigin(request) else { return nil }
        return request.headers["origin"]
    }

    private func isAuthorized(_ request: HTTPRequest) -> Bool {
        let expected = LoopbackPairing.currentCode()
        let authorization = request.headers["authorization"] ?? ""
        let presented = authorization.hasPrefix("Bearer ")
            ? String(authorization.dropFirst("Bearer ".count))
            : authorization
        return LoopbackPairing.normalize(presented) == expected
    }
}

struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data

    static func parse(_ data: Data) -> HTTPRequest? {
        guard
            let headerRange = data.range(of: Data("\r\n\r\n".utf8)),
            let headerText = String(data: data[..<headerRange.lowerBound], encoding: .utf8)
        else {
            return nil
        }

        let lines = headerText.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let requestParts = requestLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard requestParts.count >= 2 else { return nil }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let separator = line.firstIndex(of: ":") else { continue }
            let name = String(line[..<separator]).lowercased()
            let value = line[line.index(after: separator)...].trimmingCharacters(in: .whitespaces)
            headers[name] = value
        }

        let bodyStart = headerRange.upperBound
        let availableBody = data[bodyStart...]
        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        guard availableBody.count >= contentLength else { return nil }

        return HTTPRequest(
            method: requestParts[0].uppercased(),
            path: requestParts[1],
            headers: headers,
            body: Data(availableBody.prefix(contentLength))
        )
    }
}

enum HTTPReason {
    static func phrase(for status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 204: return "No Content"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 413: return "Payload Too Large"
        default: return "Internal Server Error"
        }
    }
}
#endif
