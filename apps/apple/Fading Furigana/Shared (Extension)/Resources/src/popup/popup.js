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
    siteHost: document.querySelector("#site-host"),
    siteToggle: document.querySelector("#site-toggle"),
    pageStatus: document.querySelector("#page-status"),
    accessText: document.querySelector("#access-text"),
    openFullSettings: document.querySelector("#open-full-settings"),
    refreshStats: document.querySelector("#refresh-stats"),
    seenTodayCount: document.querySelector("#seen-today-count"),
    savedCount: document.querySelector("#saved-count"),
    statusText: document.querySelector("#status-text"),
    buildVersion: document.querySelector("#build-version"),
    footerVersion: document.querySelector("#footer-version"),
    storageMode: document.querySelector("#storage-mode"),
    lastUpdated: document.querySelector("#last-updated")
  };

  const MESSAGES = {
    en: {
      currentPage: "Current page",
      quickControls: "Quick annotation controls",
      currentSite: "Current site",
      unsupportedPage: "Unsupported page",
      pauseSite: "Pause site",
      enableSite: "Enable site",
      annotations: "Annotations",
      annotationsHint: "Control this browser's annotation behavior",
      mode: "Focus",
      modeAdaptive: "Adaptive",
      modeAllItems: "All items",
      modeUnknownOnly: "Unknown only",
      modeSavedOnly: "Saved only",
      modeOff: "Off",
      knownLevel: "Level",
      levelAll: "All",
      displayStyle: "Display",
      displayAuto: "Auto",
      displayRuby: "Ruby",
      displayCompact: "Tap hints",
      moreControls: "More controls",
      interfaceLanguage: "Language",
      smartContextDisplay: "Smart compact areas",
      smartContextDisplayHint: "Use tap hints in titles, links, and search results",
      hideKnownWords: "Hide known words",
      hideKnownWordsHint: "Fade out words already mastered",
      dailyWordStats: "Daily word stats",
      dailyWordStatsHint: "Count words seen each day",
      urlPrivacy: "URL privacy",
      urlDomainOnly: "Domain only",
      urlFull: "Full URL",
      urlNone: "No URL",
      todaySummary: "Today summary",
      seenToday: "Seen today",
      savedWords: "Saved words",
      fullSettings: "Full settings",
      refresh: "Refresh",
      ready: "Ready",
      saved: "Saved",
      sitePaused: "Site paused",
      siteEnabled: "Site enabled",
      openAppHint: "Open the app for full settings",
      loadFailed: "Load failed",
      saveFailed: "Save failed",
      refreshFailed: "Refresh failed",
      storageStatus: "Storage status",
      storage: "Storage",
      lastUpdated: "Updated",
      storageNative: "Native",
      storageFallback: "Fallback",
      storageLocal: "Local",
      never: "never",
      justNow: "just now",
      minutesAgo: "min ago",
      hoursAgo: "h ago",
      daysAgo: "d ago",
      statusAnnotating: "Annotating this browser with your current settings.",
      statusPausedSite: "Paused on this site. Existing annotations clear after the page refreshes.",
      statusOff: "Annotations are off.",
      statusUnsupported: "This browser page cannot be controlled here.",
      accessTrial: "Trial active",
      accessBasic: "Basic unlocked",
      accessPro: "Pro active",
      accessExpired: "Trial expired: saving new words needs Basic",
      accessUnknown: "Local access"
    },
    zhHans: {
      currentPage: "当前页面",
      quickControls: "快速标注控制",
      currentSite: "当前网站",
      unsupportedPage: "不支持的页面",
      pauseSite: "暂停本站",
      enableSite: "启用本站",
      annotations: "假名标注",
      annotationsHint: "控制这个浏览器里的标注方式",
      mode: "标注重点",
      modeAdaptive: "智能自适应",
      modeAllItems: "全部词",
      modeUnknownOnly: "只显示不熟词",
      modeSavedOnly: "只显示已保存词",
      modeOff: "关闭",
      knownLevel: "等级",
      levelAll: "全部",
      displayStyle: "显示",
      displayAuto: "自动",
      displayRuby: "假名",
      displayCompact: "点按",
      moreControls: "更多控制",
      interfaceLanguage: "界面语言",
      smartContextDisplay: "智能紧凑区域",
      smartContextDisplayHint: "标题、链接和搜索结果使用点按提示",
      hideKnownWords: "隐藏已掌握词",
      hideKnownWordsHint: "已掌握的词会逐渐淡出",
      dailyWordStats: "每日词频统计",
      dailyWordStatsHint: "统计每天看见过的词",
      urlPrivacy: "网址隐私",
      urlDomainOnly: "只保存域名",
      urlFull: "保存完整网址",
      urlNone: "不保存网址",
      todaySummary: "今日摘要",
      seenToday: "今日看到",
      savedWords: "已保存词",
      fullSettings: "完整设置",
      refresh: "刷新",
      ready: "就绪",
      saved: "已保存",
      sitePaused: "已暂停本站",
      siteEnabled: "已启用本站",
      openAppHint: "请打开 App 查看完整设置",
      loadFailed: "加载失败",
      saveFailed: "保存失败",
      refreshFailed: "刷新失败",
      storageStatus: "存储状态",
      storage: "存储",
      lastUpdated: "更新",
      storageNative: "原生",
      storageFallback: "回退",
      storageLocal: "本地",
      never: "从未",
      justNow: "刚刚",
      minutesAgo: "分钟前",
      hoursAgo: "小时前",
      daysAgo: "天前",
      statusAnnotating: "正在按当前设置为这个浏览器标注。",
      statusPausedSite: "本站已暂停。刷新页面后已有标注会清除。",
      statusOff: "标注已关闭。",
      statusUnsupported: "这个浏览器页面不能在这里控制。",
      accessTrial: "试用中",
      accessBasic: "Basic 已解锁",
      accessPro: "Pro 已启用",
      accessExpired: "试用已结束：保存新词需要 Basic",
      accessUnknown: "本地权限"
    }
  };

  let state;
  let activeTab = null;
  let activeHost = "";
  const storageAdapter = window.FadingFuriganaStorage.createBestAvailableStorageAdapter();
  renderBuildVersion();

  async function load() {
    [activeTab, state] = await Promise.all([getActiveTab(), storageAdapter.loadState()]);
    activeHost = getHostname(activeTab?.url);
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
    renderCurrentPage();
    renderSummary();
    renderDiagnostics();
    setStatus("ready");
  }

  function renderCurrentPage() {
    const paused = isCurrentSitePaused();
    const annotation = state.settings.annotation;
    controls.siteHost.textContent = activeHost || t("unsupportedPage");
    controls.siteToggle.disabled = !activeHost;
    controls.siteToggle.textContent = paused ? t("enableSite") : t("pauseSite");
    controls.siteToggle.classList.toggle("is-paused", paused);

    if (!activeHost) {
      controls.pageStatus.textContent = t("statusUnsupported");
    } else if (paused) {
      controls.pageStatus.textContent = t("statusPausedSite");
    } else if (!annotation.enabled || annotation.mode === "off") {
      controls.pageStatus.textContent = t("statusOff");
    } else {
      controls.pageStatus.textContent = t("statusAnnotating");
    }
    controls.accessText.textContent = accessText();
  }

  function renderSummary() {
    controls.seenTodayCount.textContent = String(countSeenToday());
    controls.savedCount.textContent = String(countSavedWords());
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

  function accessText() {
    switch (state.entitlements?.access?.tier) {
      case "trial": return t("accessTrial");
      case "basic": return t("accessBasic");
      case "pro": return t("accessPro");
      case "expired": return t("accessExpired");
      default: return t("accessUnknown");
    }
  }

  function countSeenToday() {
    const today = window.FadingFuriganaState.getLocalDateKey();
    return Object.values(state.dailyExposureSummaries || {})
      .filter((summary) => summary.date === today)
      .reduce((sum, summary) => sum + (summary.totalSeenCount || 0), 0);
  }

  function countSavedWords() {
    return Object.values(state.userLexicalStates || {}).filter((wordState) => wordState.userIntent?.saved).length;
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
      },
      siteOverrides: {
        ...(state.settings.siteOverrides || {})
      }
    });
  }

  async function saveControls() {
    const settings = readSettingsFromControls();
    state = await storageAdapter.loadState();
    state.settings = settings;
    await storageAdapter.saveState(state);
    state.settings = window.FadingFuriganaState.normalizeSettings(state.settings);
    render();
    setStatus("saved");
  }

  async function toggleCurrentSite() {
    if (!activeHost) {
      setStatus("refreshFailed");
      return;
    }

    state = await storageAdapter.loadState();
    state.settings = window.FadingFuriganaState.normalizeSettings(state.settings);
    const overrides = { ...(state.settings.siteOverrides || {}) };
    const paused = overrides[activeHost]?.annotationEnabled === false;
    if (paused) {
      delete overrides[activeHost];
    } else {
      overrides[activeHost] = {
        annotationEnabled: false,
        updatedAt: window.FadingFuriganaState.createTimestamp()
      };
    }
    state.settings = window.FadingFuriganaState.normalizeSettings({
      ...state.settings,
      siteOverrides: overrides
    });
    await storageAdapter.saveState(state);
    render();
    setStatus(paused ? "siteEnabled" : "sitePaused");
  }

  function isCurrentSitePaused() {
    if (!activeHost) return false;
    return state.settings.siteOverrides?.[activeHost]?.annotationEnabled === false;
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

  function renderBuildVersion() {
    const manifest = window.chrome?.runtime?.getManifest?.() || window.browser?.runtime?.getManifest?.();
    const version = manifest?.version ? `v${manifest.version}` : "v0.1.0";
    controls.buildVersion.textContent = version;
    controls.footerVersion.textContent = version;
  }

  function getHostname(url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/iu.test(parsed.protocol)) return "";
      return window.FadingFuriganaState.normalizeHostname(parsed.hostname);
    } catch {
      return "";
    }
  }

  function getActiveTab() {
    if (window.browser?.tabs?.query) {
      return window.browser.tabs
        .query({ active: true, currentWindow: true })
        .then((result) => result?.[0] || null, () => null);
    }

    const tabs = window.chrome?.tabs;
    if (!tabs?.query) return Promise.resolve(null);

    return new Promise((resolve) => {
      try {
        tabs.query({ active: true, currentWindow: true }, (result) => {
          const lastError = window.chrome?.runtime?.lastError || window.browser?.runtime?.lastError;
          resolve(lastError ? null : result?.[0] || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  const instantControls = [
    controls.interfaceLanguage,
    controls.annotationEnabled,
    controls.annotationMode,
    controls.userLevel,
    controls.displayStyle,
    controls.smartContextDisplay,
    controls.hideKnownItems,
    controls.exposureEnabled,
    controls.urlPrivacy
  ];

  for (const control of instantControls) {
    control.addEventListener("change", () => {
      saveControls().catch(() => setStatus("saveFailed"));
    });
  }

  controls.siteToggle.addEventListener("click", () => {
    toggleCurrentSite().catch(() => setStatus("saveFailed"));
  });

  controls.openFullSettings.addEventListener("click", () => {
    setStatus("openAppHint");
  });

  controls.refreshStats.addEventListener("click", () => {
    load().catch(() => setStatus("refreshFailed"));
  });

  load().catch(() => setStatus("loadFailed"));
})();
