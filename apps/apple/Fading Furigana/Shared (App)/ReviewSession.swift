//
//  ReviewSession.swift
//  Shared (App)
//
//  Review queue + lightweight SRS scheduling over the shared AppState JSON.
//  reviewLogs entries are append-only with client-generated IDs so they can
//  sync without conflicts (docs/SYNC_AND_CLIENTS_DESIGN.md §3).
//

#if os(macOS)
import Cocoa

enum ReviewResult: String {
    case forgot
    case good
    case easy
}

enum ReviewScheduler {
    static let sessionLimit = 20
    static let graduationStreak = 6

    // Day intervals indexed by correctStreak - 1; graduation to "known" hides
    // the annotation the same way the manual Known action does.
    private static var intervalLadderDays: [Int] { [1, 3, 7, 14, 30, 60, 120] }

    struct Outcome {
        let reviewStage: String
        let lifecycleStatus: String
        let correctStreak: Int
        let intervalDays: Int
        let nextReviewAt: Date
        let knowledgeConfidence: Double
        let annotationLevel: String?
        let reasonCode: String?
    }

    static func outcome(for result: ReviewResult, previousStreak: Int, now: Date = Date()) -> Outcome {
        if result == .forgot {
            return Outcome(
                reviewStage: "lapsed",
                lifecycleStatus: "learning",
                correctStreak: 0,
                intervalDays: 0,
                nextReviewAt: now,
                knowledgeConfidence: 0,
                annotationLevel: "full_ruby",
                reasonCode: "review_lapsed"
            )
        }

        let streak = max(0, previousStreak) + (result == .easy ? 2 : 1)
        let ladder = intervalLadderDays
        let intervalDays = ladder[min(max(streak - 1, 0), ladder.count - 1)]
        let nextReviewAt = Calendar.current.date(byAdding: .day, value: intervalDays, to: now)
            ?? now.addingTimeInterval(Double(intervalDays) * 86_400)

        if streak >= graduationStreak {
            return Outcome(
                reviewStage: "known",
                lifecycleStatus: "known",
                correctStreak: streak,
                intervalDays: intervalDays,
                nextReviewAt: nextReviewAt,
                knowledgeConfidence: 1,
                annotationLevel: "hidden",
                reasonCode: "review_graduated"
            )
        }

        let stage = streak >= 3 ? "reviewing" : "learning"
        let confidence = (Double(streak) / Double(graduationStreak) * 100).rounded() / 100
        return Outcome(
            reviewStage: stage,
            lifecycleStatus: stage,
            correctStreak: streak,
            intervalDays: intervalDays,
            nextReviewAt: nextReviewAt,
            knowledgeConfidence: confidence,
            annotationLevel: nil,
            reasonCode: nil
        )
    }

    static func dueWords(in words: [WordRow], now: Date = Date()) -> [WordRow] {
        words
            .filter { isDue($0, now: now) }
            .sorted { lhs, rhs in
                let lhsBucket = priorityBucket(lhs)
                let rhsBucket = priorityBucket(rhs)
                if lhsBucket != rhsBucket { return lhsBucket < rhsBucket }
                let lhsDue = parseISODate(lhs.nextReviewAt) ?? .distantPast
                let rhsDue = parseISODate(rhs.nextReviewAt) ?? .distantPast
                if lhsDue != rhsDue { return lhsDue < rhsDue }
                if lhs.seenCount != rhs.seenCount { return lhs.seenCount > rhs.seenCount }
                return lhs.surface < rhs.surface
            }
    }

    static func isDue(_ row: WordRow, now: Date) -> Bool {
        if row.ignored { return false }
        if row.lifecycleStatus == "known" || row.lifecycleStatus == "mastered" { return false }
        let tracked = row.saved
            || row.lifecycleStatus == "learning"
            || row.lifecycleStatus == "reviewing"
            || row.reviewStage == "lapsed"
        guard tracked else { return false }
        guard let next = parseISODate(row.nextReviewAt) else { return true }
        return next <= now
    }

    // Lapsed words first, then never-reviewed saves, then overdue reviews.
    private static func priorityBucket(_ row: WordRow) -> Int {
        if row.reviewStage == "lapsed" { return 0 }
        if parseISODate(row.nextReviewAt) == nil { return 1 }
        return 2
    }

    // The extension writes JS toISOString() timestamps (fractional seconds),
    // the app writes ISO8601DateFormatter ones (none) — accept both.
    static func parseISODate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        if let date = fractionalFormatter.date(from: value) { return date }
        return plainFormatter.date(from: value)
    }

    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plainFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}

final class ReviewSessionViewController: NSViewController {

    private let store: AppStateStore
    private var pending: [WordRow]
    private let onComplete: () -> Void

    private let initialWordCount: Int
    private var answeredCount = 0
    private var forgotWordIds = Set<String>()
    private var finished = false

    private let progressLabel = NSTextField(labelWithString: "")
    private let surfaceLabel = NSTextField(labelWithString: "")
    private let readingLabel = NSTextField(labelWithString: "")
    private let meaningLabel = NSTextField(wrappingLabelWithString: "")
    private let errorLabel = NSTextField(labelWithString: "")
    private let revealButton = NSButton(title: "Show Answer", target: nil, action: nil)
    private let forgotButton = NSButton(title: "Forgot", target: nil, action: nil)
    private let goodButton = NSButton(title: "Got It", target: nil, action: nil)
    private let easyButton = NSButton(title: "Easy", target: nil, action: nil)
    private let closeButton = NSButton(title: "End Session", target: nil, action: nil)

    init(queue: [WordRow], store: AppStateStore, onComplete: @escaping () -> Void) {
        self.store = store
        self.pending = queue
        self.initialWordCount = queue.count
        self.onComplete = onComplete
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 400))
        preferredContentSize = NSSize(width: 560, height: 400)

        let root = NSStackView()
        root.orientation = .vertical
        root.alignment = .centerX
        root.spacing = 14
        root.edgeInsets = NSEdgeInsets(top: 24, left: 28, bottom: 20, right: 28)
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)

        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            root.topAnchor.constraint(equalTo: view.topAnchor),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        progressLabel.font = NSFont.systemFont(ofSize: 12, weight: .medium)
        progressLabel.textColor = .secondaryLabelColor

        surfaceLabel.font = NSFont.systemFont(ofSize: 44, weight: .semibold)
        surfaceLabel.alignment = .center
        surfaceLabel.lineBreakMode = .byTruncatingTail

        readingLabel.font = NSFont.systemFont(ofSize: 22)
        readingLabel.textColor = .secondaryLabelColor
        readingLabel.alignment = .center

        meaningLabel.font = NSFont.systemFont(ofSize: 14)
        meaningLabel.textColor = .labelColor
        meaningLabel.alignment = .center
        meaningLabel.maximumNumberOfLines = 4

        errorLabel.font = NSFont.systemFont(ofSize: 11)
        errorLabel.textColor = .systemRed
        errorLabel.maximumNumberOfLines = 2

        revealButton.title = L.t("Show Answer")
        forgotButton.title = L.t("Forgot")
        goodButton.title = L.t("Got It")
        easyButton.title = L.t("Easy")
        closeButton.title = L.t("End Session")

        for button in [revealButton, forgotButton, goodButton, easyButton, closeButton] {
            button.bezelStyle = .rounded
            button.target = self
        }
        revealButton.action = #selector(revealClicked)
        forgotButton.action = #selector(forgotClicked)
        goodButton.action = #selector(goodClicked)
        easyButton.action = #selector(easyClicked)
        closeButton.action = #selector(closeClicked)
        closeButton.controlSize = .small

        let gradeStack = NSStackView(views: [forgotButton, goodButton, easyButton])
        gradeStack.orientation = .horizontal
        gradeStack.spacing = 10

        let cardStack = NSStackView(views: [surfaceLabel, readingLabel, meaningLabel])
        cardStack.orientation = .vertical
        cardStack.alignment = .centerX
        cardStack.spacing = 10

        NSLayoutConstraint.activate([
            meaningLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 480),
            cardStack.heightAnchor.constraint(greaterThanOrEqualToConstant: 180)
        ])

        root.addArrangedSubview(progressLabel)
        root.addArrangedSubview(cardStack)
        root.addArrangedSubview(revealButton)
        root.addArrangedSubview(gradeStack)
        root.addArrangedSubview(errorLabel)
        root.addArrangedSubview(closeButton)

        renderCurrentCard()
    }

    private var currentRow: WordRow? {
        pending.first
    }

    private func renderCurrentCard() {
        guard let row = currentRow else {
            renderSummary()
            return
        }

        finished = false
        progressLabel.stringValue = L.f("Remaining %d of %d · Answered %d", pending.count, initialWordCount, answeredCount)
        surfaceLabel.stringValue = row.surface
        readingLabel.stringValue = row.reading.isEmpty ? L.t("(no reading)") : row.reading
        meaningLabel.stringValue = row.meaning.isEmpty ? L.t("No meaning saved yet") : row.meaning
        readingLabel.isHidden = true
        meaningLabel.isHidden = true
        errorLabel.stringValue = ""

        revealButton.isHidden = false
        revealButton.keyEquivalent = "\r"
        forgotButton.isHidden = true
        goodButton.isHidden = true
        easyButton.isHidden = true
        goodButton.keyEquivalent = ""
        closeButton.title = L.t("End Session")
    }

    private func renderSummary() {
        finished = true
        progressLabel.stringValue = L.t("Session complete")
        surfaceLabel.stringValue = L.t("All done")
        readingLabel.isHidden = true
        meaningLabel.isHidden = false
        meaningLabel.stringValue = L.f("Reviewed %d answers · %d words marked forgot", answeredCount, forgotWordIds.count)
        errorLabel.stringValue = ""

        revealButton.isHidden = true
        forgotButton.isHidden = true
        goodButton.isHidden = true
        easyButton.isHidden = true
        closeButton.title = L.t("Done")
        closeButton.keyEquivalent = "\r"
        closeButton.controlSize = .regular
    }

    @objc private func revealClicked() {
        readingLabel.isHidden = false
        meaningLabel.isHidden = false
        revealButton.isHidden = true
        revealButton.keyEquivalent = ""
        forgotButton.isHidden = false
        goodButton.isHidden = false
        easyButton.isHidden = false
        goodButton.keyEquivalent = "\r"
    }

    @objc private func forgotClicked() {
        grade(.forgot)
    }

    @objc private func goodClicked() {
        grade(.good)
    }

    @objc private func easyClicked() {
        grade(.easy)
    }

    @objc private func closeClicked() {
        dismiss(self)
        onComplete()
    }

    private func grade(_ result: ReviewResult) {
        guard let row = currentRow else { return }

        do {
            try store.applyReview(result, lexicalItemId: row.id)
        } catch {
            errorLabel.stringValue = L.f("Could not save review: %@", error.localizedDescription)
            return
        }

        answeredCount += 1
        pending.removeFirst()
        if result == .forgot {
            forgotWordIds.insert(row.id)
            pending.append(row)
        }
        renderCurrentCard()
    }
}
#endif
