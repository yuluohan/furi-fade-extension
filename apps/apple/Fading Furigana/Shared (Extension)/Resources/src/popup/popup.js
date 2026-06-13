(() => {
  "use strict";

  const controls = {
    interfaceLanguage: document.querySelector("#interface-language"),
    annotationEnabled: document.querySelector("#annotation-enabled"),
    annotationMode: document.querySelector("#annotation-mode"),
    userLevel: document.querySelector("#user-level"),
    displayStyle: document.querySelector("#display-style"),
    smartContextDisplay: document.querySelector("#smart-context-display"),
    hideKnownItems: document.querySelector("#hide-known-items"),
    exposureEnabled: document.querySelector("#exposure-enabled"),
    urlPrivacy: document.querySelector("#url-privacy"),
    resetSettings: document.querySelector("#reset-settings"),
    saveSettings: document.querySelector("#save-settings"),
    refreshStats: document.querySelector("#refresh-stats"),
    todayStats: document.querySelector("#today-stats"),
    weekStats: document.querySelector("#week-stats"),
    statusText: document.querySelector("#status-text"),
    buildVersion: document.querySelector("#build-version"),
    footerVersion: document.querySelector("#footer-version"),
    storageMode: document.querySelector("#storage-mode"),
    lastUpdated: document.querySelector("#last-updated")
  };

  const MESSAGES = {
    en: {
      displaySettings: "Display settings",
      interfaceLanguage: "Language",
      annotationSettings: "Annotation settings",
      annotations: "Annotations",
      annotationsHint: "Show reading hints on Japanese words",
      mode: "Mode",
      modeAdaptive: "Adaptive",
      modeAllItems: "All items",
      modeUnknownOnly: "Unknown only",
      modeSavedOnly: "Saved only",
      modeOff: "Off",
      knownLevel: "Known up to",
      levelNone: "None",
      displayStyle: "Display style",
      displayAuto: "Auto",
      displayRuby: "Ruby",
      displayCompact: "Tap hints",
      smartContextDisplay: "Smart compact areas",
      smartContextDisplayHint: "Use tap hints in titles, navigation, and search results",
      hideKnownWords: "Hide known words",
      hideKnownWordsHint: "Fade out words already mastered",
      exposureSettings: "Exposure tracking settings",
      dailyWordStats: "Daily word stats",
      dailyWordStatsHint: "Count words seen each day",
      urlPrivacy: "URL privacy",
      urlDomainOnly: "Domain only",
      urlFull: "Full URL",
      urlNone: "No URL",
      vocabularyFrequency: "Vocabulary frequency",
      wordFrequency: "Word frequency",
      refresh: "Refresh",
      refreshStats: "Refresh stats",
      today: "Today",
      sevenDays: "7 days",
      reset: "Reset",
      save: "Save",
      ready: "Ready",
      saved: "Saved",
      noData: "No data",
      loadFailed: "Load failed",
      saveFailed: "Save failed",
      resetFailed: "Reset failed",
      refreshFailed: "Refresh failed",
      storageStatus: "Storage status",
      storage: "Storage",
      lastUpdated: "Last updated",
      storageNative: "Native ✓",
      storageFallback: "Local fallback ⚠",
      storageLocal: "Local",
      never: "never",
      justNow: "just now",
      minutesAgo: "min ago",
      hoursAgo: "h ago",
      daysAgo: "d ago"
    },
    zhHans: {
      displaySettings: "显示设置",
      interfaceLanguage: "界面语言",
      annotationSettings: "标注设置",
      annotations: "假名标注",
      annotationsHint: "在日语词上显示读音提示",
      mode: "标注模式",
      modeAdaptive: "智能自适应",
      modeAllItems: "全部词",
      modeUnknownOnly: "只显示不熟词",
      modeSavedOnly: "只显示已保存词",
      modeOff: "关闭",
      knownLevel: "已掌握到",
      levelNone: "未设置",
      displayStyle: "显示样式",
      displayAuto: "自动",
      displayRuby: "假名标注",
      displayCompact: "点按提示",
      smartContextDisplay: "智能紧凑区域",
      smartContextDisplayHint: "标题、导航和搜索结果使用点按提示",
      hideKnownWords: "隐藏已掌握词",
      hideKnownWordsHint: "已掌握的词会逐渐淡出",
      exposureSettings: "遇见统计设置",
      dailyWordStats: "每日词频统计",
      dailyWordStatsHint: "统计每天看见过的词",
      urlPrivacy: "网址隐私",
      urlDomainOnly: "只保存域名",
      urlFull: "保存完整网址",
      urlNone: "不保存网址",
      vocabularyFrequency: "词频统计",
      wordFrequency: "词频",
      refresh: "刷新",
      refreshStats: "刷新统计",
      today: "今天",
      sevenDays: "7 天",
      reset: "重置",
      save: "保存",
      ready: "就绪",
      saved: "已保存",
      noData: "暂无数据",
      loadFailed: "加载失败",
      saveFailed: "保存失败",
      resetFailed: "重置失败",
      refreshFailed: "刷新失败",
      storageStatus: "存储状态",
      storage: "存储",
      lastUpdated: "最后更新",
      storageNative: "原生存储 ✓",
      storageFallback: "本地回退 ⚠",
      storageLocal: "本地存储",
      never: "从未",
      justNow: "刚刚",
      minutesAgo: "分钟前",
      hoursAgo: "小时前",
      daysAgo: "天前"
    }
  };

  let state;
  const storageAdapter = window.FadingFuriganaStorage.createBestAvailableStorageAdapter();
  renderBuildVersion();

  async function load() {
    state = await storageAdapter.loadState();
    state.settings = window.FadingFuriganaState.normalizeSettings(state.settings);
    render();
  }

  function render() {
    const { annotation, display, exposureTracking } = state.settings;
    controls.interfaceLanguage.value = display.interfaceLanguage;
    controls.annotationEnabled.checked = annotation.enabled;
    controls.annotationMode.value = annotation.mode;
    controls.userLevel.value = annotation.userLevel || "none";
    controls.displayStyle.value = annotation.constrainedLayoutMode || "tap_only";
    controls.smartContextDisplay.checked = annotation.useSmartContextDisplay !== false;
    controls.hideKnownItems.checked = annotation.hideKnownItems;
    controls.exposureEnabled.checked = exposureTracking.enabled;
    controls.urlPrivacy.value = exposureTracking.saveUrls;
    renderI18n();
    renderStats();
    renderDiagnostics();
    setStatus("ready");
  }

  function renderDiagnostics() {
    const status = storageAdapter.getStorageStatus?.() || { transport: "unknown" };
    controls.storageMode.textContent = storageModeText(status.transport);
    controls.storageMode.classList.toggle("diagnostics__value--warn", status.transport === "fallback");
    controls.lastUpdated.textContent = formatRelativeTime(state?.metadata?.updatedAt);
  }

  function storageModeText(transport) {
    switch (transport) {
      case "native": return t("storageNative");
      case "fallback": return t("storageFallback");
      case "local": return t("storageLocal");
      default: return "—";
    }
  }

  function formatRelativeTime(iso) {
    if (!iso) return t("never");
    const diffMs = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(diffMs) || diffMs < 0) return t("justNow");
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return t("justNow");
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} ${t("minutesAgo")}`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} ${t("hoursAgo")}`;
    return `${Math.floor(hr / 24)} ${t("daysAgo")}`;
  }

  function readSettingsFromControls() {
    return window.FadingFuriganaState.normalizeSettings({
      ...state.settings,
      display: {
        ...state.settings.display,
        interfaceLanguage: controls.interfaceLanguage.value
      },
      annotation: {
        ...state.settings.annotation,
        enabled: controls.annotationEnabled.checked,
        mode: controls.annotationMode.value,
        userLevel: controls.userLevel.value,
        constrainedLayoutMode: controls.displayStyle.value,
        useSmartContextDisplay: controls.smartContextDisplay.checked,
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
    const settings = readSettingsFromControls();
    // Re-read before writing so content tabs' exposure data saved while the
    // popup was open is not overwritten by the popup's stale copy. Content
    // tabs pick the change up through storage.onChanged.
    state = await storageAdapter.loadState();
    state.settings = settings;
    await storageAdapter.saveState(state);
    setStatus("saved");
  }

  async function reset() {
    const defaults = window.FadingFuriganaState.createDefaultAppState();
    state.settings = defaults.settings;
    render();
    await save();
  }

  function getInterfaceLanguage() {
    return controls.interfaceLanguage.value || state?.settings?.display?.interfaceLanguage || "en";
  }

  function t(key) {
    const language = getInterfaceLanguage();
    return MESSAGES[language]?.[key] || MESSAGES.en[key] || key;
  }

  function renderI18n() {
    document.documentElement.lang = getInterfaceLanguage() === "zhHans" ? "zh-Hans" : "en";

    for (const element of document.querySelectorAll("[data-i18n]")) {
      element.textContent = t(element.dataset.i18n);
    }

    for (const element of document.querySelectorAll("[data-i18n-aria]")) {
      element.setAttribute("aria-label", t(element.dataset.i18nAria));
    }
  }

  function setStatus(key) {
    controls.statusText.textContent = t(key);
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
      .slice(0, 2)
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
      empty.textContent = t("noData");
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

  function renderBuildVersion() {
    const manifest = window.chrome?.runtime?.getManifest?.() || window.browser?.runtime?.getManifest?.();
    const version = manifest?.version ? `v${manifest.version}` : "v0.1.0";
    controls.buildVersion.textContent = version;
    controls.footerVersion.textContent = version;
  }

  controls.interfaceLanguage.addEventListener("change", () => {
    renderI18n();
    renderStats();
    setStatus("ready");
  });

  controls.saveSettings.addEventListener("click", () => {
    save().catch(() => setStatus("saveFailed"));
  });

  controls.resetSettings.addEventListener("click", () => {
    reset().catch(() => setStatus("resetFailed"));
  });

  controls.refreshStats.addEventListener("click", () => {
    load().catch(() => setStatus("refreshFailed"));
  });

  load().catch(() => setStatus("loadFailed"));
})();
