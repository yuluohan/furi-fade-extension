(() => {
  "use strict";

  async function boot() {
    if (!document.body || window.__fadingFuriganaLoaded) return;
    window.__fadingFuriganaLoaded = true;

    const storageAdapter = window.FadingFuriganaStorage.createBestAvailableStorageAdapter();
    // Batch exposure writes generously; every persist serializes the whole
    // state, which is expensive on annotation-heavy pages.
    const repository = new window.FadingFuriganaWordRepository.WordRepositoryService(storageAdapter, {
      persistDelayMs: 2000
    });
    await repository.load();
    const dictionaryProvider = new window.FadingFuriganaDictionary.LocalDictionaryProvider();
    const localAnalyzer = new window.FadingFuriganaDictionary.JapaneseAnalyzer(dictionaryProvider);
    const analyzer = window.FadingFuriganaBackgroundTokenizer
      ? window.FadingFuriganaBackgroundTokenizer.createBestAvailableAnalyzer({
          localProvider: dictionaryProvider,
          fallbackAnalyzer: localAnalyzer
        })
      : localAnalyzer;
    let engine;
    // Word-level actions only re-evaluate that word's annotations in place;
    // a full refresh() would strip and redraw the whole page.
    const tooltip = new window.FadingFuriganaTooltip.Tooltip(repository, (token) =>
      token?.lexicalItemId ? engine.refreshWord(token.lexicalItemId) : engine.refresh()
    );
    engine = new window.FadingFuriganaAnnotationEngine.AnnotationEngine({
      analyzer,
      repository,
      tooltip
    });
    engine.start();

    let settingsReloadInFlight = false;

    if (window.chrome?.storage?.onChanged) {
      window.chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;

        const change = changes[window.FadingFuriganaStorage.STORAGE_KEY];
        if (!change) return;

        // Normalize both sides so the comparison is canonical: raw stored
        // objects can differ in key order or missing defaults without any
        // semantic change, and that must never trigger a refresh.
        const normalize = window.FadingFuriganaState.normalizeSettings;
        const nextState = parseStoredState(change.newValue);
        const nextSettings = normalize(nextState?.settings || {});
        const currentSettings = normalize(repository.settings || {});
        const nextAccess = JSON.stringify(nextState?.entitlements?.access || {});
        const currentAccess = JSON.stringify(repository.state?.entitlements?.access || {});
        if (JSON.stringify(nextSettings) === JSON.stringify(currentSettings) && nextAccess === currentAccess) return;

        if (settingsReloadInFlight) return;
        settingsReloadInFlight = true;
        repository
          .load()
          .then(() => engine.refresh())
          .catch(() => {})
          .finally(() => {
            settingsReloadInFlight = false;
          });
      });
    }
  }

  function parseStoredState(raw) {
    if (!raw || typeof raw === "object") return raw || null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  boot();
})();
