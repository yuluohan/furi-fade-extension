(() => {
  "use strict";

  function createId(...parts) {
    return window.FadingFuriganaState.createId(...parts);
  }

  // Per-record last-write-wins, matching packages/core-schema/merge-rules.md:
  // newer `updatedAt` wins; `deviceId` is the deterministic tie-breaker.
  function pickNewerRecord(a, b) {
    if (!a) return b;
    if (!b) return a;
    const ta = a.updatedAt || "";
    const tb = b.updatedAt || "";
    if (ta > tb) return a;
    if (tb > ta) return b;
    const da = a.deviceId || "";
    const db = b.deviceId || "";
    return db > da ? b : a;
  }

  // Union the keys of two record maps, resolving collisions by LWW. Records that
  // exist on only one side are always kept (no domain is ever wiped wholesale).
  function mergeRecordMaps(base, overlay) {
    const result = { ...(base || {}) };
    for (const [id, record] of Object.entries(overlay || {})) {
      result[id] = pickNewerRecord(result[id], record);
    }
    return result;
  }

  // Record-keyed domains that any client may mutate. A content tab persisting its
  // own changes must merge these against the freshest on-disk copy rather than
  // overwrite them, or it would clobber data written by the Mac app (e.g. review
  // grading writes `reviewLogs` and per-word `learning` schedule) since page load.
  const RECORD_DOMAINS = [
    "lexicalItems",
    "userLexicalStates",
    "sourceOccurrences",
    "dailyExposureSummaries",
    "reviewLogs"
  ];

  // A word the user has acted on in any way that creates durable learning value
  // (saved/known/ignored/forgot/pinned, opened the tooltip, or reviewed). Used to
  // protect such words from exposure-only compaction.
  function isInteractedState(userState) {
    if (!userState) return false;
    const intent = userState.userIntent || {};
    const interaction = userState.interaction || {};
    const learning = userState.learning || {};
    return Boolean(
      intent.saved ||
        intent.ignored ||
        intent.manuallyMarkedKnown ||
        intent.manuallyMarkedUnknown ||
        intent.pinnedAnnotation ||
        (interaction.tooltipOpenCount || 0) > 0 ||
        (interaction.savedCount || 0) > 0 ||
        (interaction.markedKnownCount || 0) > 0 ||
        (interaction.ignoredCount || 0) > 0 ||
        (learning.reviewCount || 0) > 0
    );
  }

  class BasicAccessLockedError extends Error {
    constructor(message = "Basic access is required to save new words.") {
      super(message);
      this.name = "BasicAccessLockedError";
      this.code = "basic_access_locked";
    }
  }

  class WordRepositoryService {
    constructor(storageAdapter, { pageContextProvider = createBrowserPageContext, persistDelayMs = 250 } = {}) {
      this.storageAdapter = storageAdapter;
      this.pageContextProvider = pageContextProvider;
      this.state = window.FadingFuriganaState.createDefaultAppState();
      this.lexicalItems = new window.FadingFuriganaRepositories.LexicalItemRepository(() => this.state);
      this.userLexicalStates = new window.FadingFuriganaRepositories.UserLexicalStateRepository(() => this.state);
      this.exposures = new window.FadingFuriganaRepositories.ExposureRepository(() => this.state);
      this.persistScheduler = new window.FadingFuriganaPersistScheduler.PersistScheduler(
        () => this.persistImmediately(),
        { delayMs: persistDelayMs }
      );
    }

    async load() {
      // Read-only: persisting here would make every storage.onChanged-driven
      // reload write storage again and feed an endless change/reload loop.
      this.state = await this.storageAdapter.loadState();
    }

    async persist() {
      await this.persistScheduler.flush();
    }

    async persistImmediately() {
      this.compactState();
      // The popup/settings app owns settings and entitlement changes; a
      // content tab persisting exposure data must not write stale copies back.
      const stored = await this.storageAdapter.loadState();
      const nextState = {
        ...this.state,
        settings: stored?.settings || this.state.settings,
        entitlements: stored?.entitlements || this.state.entitlements
      };
      // Merge every record-keyed domain against the freshest on-disk copy so this
      // tab's exposure/intent writes apply without discarding records another
      // client changed since page load (notably Mac app review logs + schedule).
      for (const domain of RECORD_DOMAINS) {
        nextState[domain] = mergeRecordMaps(stored?.[domain], this.state[domain]);
      }

      try {
        await this.storageAdapter.saveState(nextState);
        this.persistFailureLogged = false;
      } catch (error) {
        if (!this.persistFailureLogged) {
          this.persistFailureLogged = true;
          console.warn("[Fading Furigana] Failed to save state:", error?.message || error);
        }
        throw error;
      }
    }

    // Keeps stored state within storage quota: drops expired exposure
    // summaries, legacy per-page titles, meanings of words the user never
    // interacted with (the dictionary re-supplies them at annotation time), and
    // exposure-only word records whose last sighting predates the retention
    // window (T066 — passive reading must not grow the store unbounded).
    compactState() {
      const retentionDays = this.state.settings.exposureTracking.retentionDays || 90;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoff = window.FadingFuriganaState.getLocalDateKey(cutoffDate);

      for (const [id, summary] of Object.entries(this.state.dailyExposureSummaries)) {
        if (summary.date < cutoff) {
          delete this.state.dailyExposureSummaries[id];
          continue;
        }
        for (const page of Object.values(summary.pages || {})) {
          delete page.pageTitle;
        }
      }

      // Evict exposure-only words the user never interacted with once their last
      // exposure predates the retention window. Interacted words (saved/known/
      // ignored/forgot/pinned/reviewed/tooltip-opened) are always kept.
      const exposureCutoffMs = cutoffDate.getTime();
      for (const [id, userState] of Object.entries(this.state.userLexicalStates)) {
        if (isInteractedState(userState)) continue;
        if (userState.lifecycleStatus && userState.lifecycleStatus !== "new") continue;
        const lastSeenMs = userState.exposure?.lastSeenAt
          ? Date.parse(userState.exposure.lastSeenAt)
          : NaN;
        if (!Number.isFinite(lastSeenMs) || lastSeenMs >= exposureCutoffMs) continue;
        delete this.state.userLexicalStates[id];
        delete this.state.lexicalItems[id];
      }

      for (const [id, item] of Object.entries(this.state.lexicalItems)) {
        if (!item.meanings || Object.keys(item.meanings).length === 0) continue;
        if (!isInteractedState(this.state.userLexicalStates[id])) item.meanings = {};
      }
    }

    get settings() {
      return this.state.settings;
    }

    getUserWordState(wordId) {
      return this.userLexicalStates.getByLexicalItemId(wordId);
    }

    getLegacyUserWordState(wordId) {
      const state = this.getUserWordState(wordId);
      if (!state) return null;
      return {
        status: state.lifecycleStatus === "mastered" ? "mastered" : state.lifecycleStatus,
        annotationLevel: state.annotationLevel === "hidden" ? "hidden" : "ruby"
      };
    }

    upsertLexicalItem(token, now = new Date().toISOString()) {
      return this.lexicalItems.upsertFromToken(token, now);
    }

    ensureUserState(lexicalItemId, now = new Date().toISOString()) {
      return this.userLexicalStates.ensure(lexicalItemId, now);
    }

    applySavedWord(token, sourceSentence, now = new Date().toISOString()) {
      const item = this.upsertLexicalItem(token, now);
      const occurrenceId = createId("occurrence", item.id, sourceSentence, now);
      this.userLexicalStates.markSaved(item.id, now);

      this.state.sourceOccurrences[occurrenceId] = {
        id: occurrenceId,
        lexicalItemId: item.id,
        surface: token.surface,
        sentence: sourceSentence,
        ...this.getPageContext(),
        createdAt: now,
        updatedAt: now,
        deviceId: this.state.metadata?.deviceId || "dev_unknown"
      };

      return { item, occurrenceId };
    }

    createWordSnapshot(lexicalItemId) {
      return {
        lexicalItem:
          this.state.lexicalItems[lexicalItemId] === undefined
            ? undefined
            : JSON.parse(JSON.stringify(this.state.lexicalItems[lexicalItemId])),
        userState:
          this.state.userLexicalStates[lexicalItemId] === undefined
            ? undefined
            : JSON.parse(JSON.stringify(this.state.userLexicalStates[lexicalItemId]))
      };
    }

    restoreWordSnapshot(lexicalItemId, snapshot, occurrenceId) {
      if (snapshot.lexicalItem === undefined) {
        delete this.state.lexicalItems[lexicalItemId];
      } else {
        this.state.lexicalItems[lexicalItemId] = snapshot.lexicalItem;
      }

      if (snapshot.userState === undefined) {
        delete this.state.userLexicalStates[lexicalItemId];
      } else {
        this.state.userLexicalStates[lexicalItemId] = snapshot.userState;
      }

      if (occurrenceId) {
        delete this.state.sourceOccurrences[occurrenceId];
      }
    }

    async saveWord(token, sourceSentence) {
      await this.assertBasicUnlockedForSave();
      const lexicalItemId = token.lexicalItemId || token.id;
      const snapshot = this.createWordSnapshot(lexicalItemId);
      const { item, occurrenceId } = this.applySavedWord(token, sourceSentence);

      try {
        await this.persist();
        return item;
      } catch (error) {
        this.restoreWordSnapshot(item.id, snapshot, occurrenceId);
        throw error;
      }
    }

    saveWordOptimistically(token, sourceSentence) {
      const lexicalItemId = token.lexicalItemId || token.id;
      const snapshot = this.createWordSnapshot(lexicalItemId);
      const { item, occurrenceId } = this.applySavedWord(token, sourceSentence);

      return {
        item,
        commit: (async () => {
          try {
            await this.assertBasicUnlockedForSave();
            await this.persist();
            return item;
          } catch (error) {
            this.restoreWordSnapshot(item.id, snapshot, occurrenceId);
            throw error;
          }
        })()
      };
    }

    async assertBasicUnlockedForSave() {
      const stored = await this.storageAdapter.loadState();
      if (stored?.entitlements) {
        this.state.entitlements = stored.entitlements;
      }
      if (this.state.entitlements?.access?.basicUnlocked === false) {
        throw new BasicAccessLockedError();
      }
    }

    markKnown(token) {
      return this.setStatus(token, "known", "hidden");
    }

    ignore(token) {
      return this.setStatus(token, "ignored", "hidden");
    }

    async markForgotten(token) {
      const now = new Date().toISOString();
      // Forgot on an unsaved word calls resetLearning, which sets
      // userIntent.saved = true — i.e. it creates a saved learning entry, the same
      // paid asset as Save. Gate it like Save after the trial. Re-forgetting a word
      // that is already saved (a review re-grade) stays available (T067).
      const lexicalItemId = token.lexicalItemId || createId(token.baseForm, token.reading);
      const alreadySaved = this.getUserWordState(lexicalItemId)?.userIntent?.saved === true;
      if (!alreadySaved) {
        await this.assertBasicUnlockedForSave();
      }
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.resetLearning(item.id, now);
      await this.persist();
    }

    async pinAnnotation(token) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.setPinnedAnnotation(item.id, true, now);
      await this.persist();
    }

    async recordSeen(token) {
      const now = new Date().toISOString();
      // Exposure-only words store no meanings (the dictionary provides them
      // at annotation time); full entries are written when the user saves or
      // marks a word. Existing items are left untouched to avoid churn.
      const lexicalItemId = token.lexicalItemId || token.id;
      const item =
        this.lexicalItems.getById(lexicalItemId) || this.upsertLexicalItem({ ...token, meanings: {} }, now);
      this.userLexicalStates.recordSeen(item.id, now);
      this.recordDailyExposure(item.id, token.surface, now);
      this.persistScheduler.schedule();
    }

    recordDailyExposure(lexicalItemId, surface, seenAt) {
      // Exposure summaries never store page titles; titles only belong to
      // explicitly saved occurrences.
      const { pageTitle, ...pageContext } = this.getPageContext();
      return this.exposures.recordDailyExposure({
        lexicalItemId,
        surface,
        ...pageContext,
        seenAt
      });
    }

    getPageContext() {
      return createPrivacyAwarePageContext(
        this.state.settings.exposureTracking.saveUrls,
        this.pageContextProvider()
      );
    }

    listDailyExposures(date = window.FadingFuriganaState.getLocalDateKey()) {
      return this.exposures.listDailyExposures(date);
    }

    listFrequentItems(range) {
      return this.exposures.listFrequentItems(range);
    }

    async setStatus(token, status, annotationLevel) {
      const now = new Date().toISOString();
      const item = this.upsertLexicalItem(token, now);
      this.userLexicalStates.setStatus(item.id, status, annotationLevel, now);
      await this.persist();
    }
  }

  function createBrowserPageContext() {
    const location = window.location || {};
    return {
      url: location.href,
      domain: location.hostname,
      pageTitle: document.title
    };
  }

  function createPrivacyAwarePageContext(saveUrls, pageContext) {
    if (saveUrls === "none") {
      return {
        pageKey: "private-page",
        url: undefined,
        domain: undefined,
        pageTitle: undefined
      };
    }

    if (saveUrls === "full") {
      return {
        pageKey: pageContext.url,
        url: pageContext.url,
        domain: pageContext.domain,
        pageTitle: pageContext.pageTitle
      };
    }

    return {
      pageKey: pageContext.domain || "unknown-page",
      url: undefined,
      domain: pageContext.domain,
      pageTitle: pageContext.pageTitle
    };
  }

  window.FadingFuriganaWordRepository = {
    WordRepositoryService,
    BasicAccessLockedError,
    isBasicAccessLockedError: (error) => error?.code === "basic_access_locked",
    createPrivacyAwarePageContext
  };
})();
