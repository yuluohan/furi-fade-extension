(() => {
  "use strict";

  async function boot() {
    if (!document.body || window.__fadingFuriganaLoaded) return;
    window.__fadingFuriganaLoaded = true;

    const storageAdapter = window.FadingFuriganaStorage.createBestAvailableStorageAdapter();
    const repository = new window.FadingFuriganaWordRepository.WordRepositoryService(storageAdapter);
    await repository.load();
    const dictionaryProvider = new window.FadingFuriganaDictionary.LocalDictionaryProvider();
    const analyzer = new window.FadingFuriganaDictionary.JapaneseAnalyzer(dictionaryProvider);
    let engine;
    const tooltip = new window.FadingFuriganaTooltip.Tooltip(repository, () => engine.refresh());
    engine = new window.FadingFuriganaAnnotationEngine.AnnotationEngine({
      analyzer,
      repository,
      tooltip
    });
    engine.start();

    if (window.chrome?.runtime?.onMessage) {
      window.chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== "FADING_FURIGANA_SETTINGS_UPDATED") return false;

        repository
          .load()
          .then(() => {
            engine.refresh();
            sendResponse({ ok: true });
          })
          .catch((error) => {
            sendResponse({ ok: false, error: error.message });
          });
        return true;
      });
    }
  }

  boot();
})();
