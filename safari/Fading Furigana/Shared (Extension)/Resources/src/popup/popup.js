(() => {
  "use strict";

  const controls = {
    annotationEnabled: document.querySelector("#annotation-enabled"),
    annotationMode: document.querySelector("#annotation-mode"),
    hideKnownItems: document.querySelector("#hide-known-items"),
    exposureEnabled: document.querySelector("#exposure-enabled"),
    urlPrivacy: document.querySelector("#url-privacy"),
    resetSettings: document.querySelector("#reset-settings"),
    saveSettings: document.querySelector("#save-settings"),
    refreshStats: document.querySelector("#refresh-stats"),
    todayStats: document.querySelector("#today-stats"),
    weekStats: document.querySelector("#week-stats"),
    statusText: document.querySelector("#status-text")
  };

  let state;
  const storageAdapter = window.FadingFuriganaStorage.createBestAvailableStorageAdapter();

  async function load() {
    state = await storageAdapter.loadState();
    state.settings = window.FadingFuriganaState.normalizeSettings(state.settings);
    render();
  }

  function render() {
    const { annotation, exposureTracking } = state.settings;
    controls.annotationEnabled.checked = annotation.enabled;
    controls.annotationMode.value = annotation.mode;
    controls.hideKnownItems.checked = annotation.hideKnownItems;
    controls.exposureEnabled.checked = exposureTracking.enabled;
    controls.urlPrivacy.value = exposureTracking.saveUrls;
    renderStats();
    setStatus("Ready");
  }

  function readSettingsFromControls() {
    return window.FadingFuriganaState.normalizeSettings({
      ...state.settings,
      annotation: {
        ...state.settings.annotation,
        enabled: controls.annotationEnabled.checked,
        mode: controls.annotationMode.value,
        hideKnownItems: controls.hideKnownItems.checked
      },
      exposureTracking: {
        ...state.settings.exposureTracking,
        enabled: controls.exposureEnabled.checked,
        saveUrls: controls.urlPrivacy.value
      }
    });
  }

  async function save() {
    state.settings = readSettingsFromControls();
    await storageAdapter.saveState(state);
    await notifyActiveTab();
    setStatus("Saved");
  }

  async function reset() {
    const defaults = window.FadingFuriganaState.createDefaultAppState();
    state.settings = defaults.settings;
    render();
    await save();
  }

  async function notifyActiveTab() {
    if (!window.chrome?.tabs?.query || !window.chrome?.tabs?.sendMessage) return;

    const [tab] = await window.chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await window.chrome.tabs.sendMessage(tab.id, { type: "FADING_FURIGANA_SETTINGS_UPDATED" });
    } catch {
      // The active tab may not have the content script, such as chrome:// pages.
    }
  }

  function setStatus(text) {
    controls.statusText.textContent = text;
  }

  function renderStats() {
    const today = window.FadingFuriganaState.getLocalDateKey();
    const weekStartDate = new Date();
    weekStartDate.setDate(weekStartDate.getDate() - 6);
    const weekStart = window.FadingFuriganaState.getLocalDateKey(weekStartDate);

    renderWordList(controls.todayStats, listFrequentItems({ startDate: today, endDate: today }));
    renderWordList(controls.weekStats, listFrequentItems({ startDate: weekStart, endDate: today }));
  }

  function listFrequentItems({ startDate, endDate }) {
    const totals = new Map();

    for (const summary of Object.values(state.dailyExposureSummaries || {})) {
      if (summary.date < startDate || summary.date > endDate) continue;
      const existing = totals.get(summary.lexicalItemId) || {
        lexicalItemId: summary.lexicalItemId,
        totalSeenCount: 0,
        surfaceForms: {}
      };
      existing.totalSeenCount += summary.totalSeenCount;
      for (const [surface, count] of Object.entries(summary.surfaceForms || {})) {
        existing.surfaceForms[surface] = (existing.surfaceForms[surface] || 0) + count;
      }
      totals.set(summary.lexicalItemId, existing);
    }

    return [...totals.values()]
      .sort((a, b) => b.totalSeenCount - a.totalSeenCount)
      .slice(0, 5)
      .map((item) => ({
        ...item,
        label: getFrequentSurface(item) || state.lexicalItems[item.lexicalItemId]?.surface || item.lexicalItemId
      }));
  }

  function getFrequentSurface(item) {
    return Object.entries(item.surfaceForms || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  function renderWordList(element, items) {
    element.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "word-list__empty";
      empty.textContent = "No data";
      element.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("li");
      const label = document.createElement("span");
      const count = document.createElement("em");
      label.textContent = item.label;
      count.textContent = item.totalSeenCount;
      row.appendChild(label);
      row.appendChild(count);
      element.appendChild(row);
    }
  }

  controls.saveSettings.addEventListener("click", () => {
    save().catch(() => setStatus("Save failed"));
  });

  controls.resetSettings.addEventListener("click", () => {
    reset().catch(() => setStatus("Reset failed"));
  });

  controls.refreshStats.addEventListener("click", () => {
    load().catch(() => setStatus("Refresh failed"));
  });

  load().catch(() => setStatus("Load failed"));
})();
