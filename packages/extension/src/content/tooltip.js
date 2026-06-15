(() => {
  "use strict";

  function getMeaningText(item, preferredLanguages) {
    const meanings = item.meanings || {};
    for (const locale of preferredLanguages || []) {
      if (meanings[locale]?.length) return meanings[locale].join("; ");
    }
    return Object.values(meanings).find((values) => values?.length)?.join("; ") || "";
  }

  function cleanLexicalText(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed && trimmed !== "*" ? trimmed : "";
  }

  function getDisplaySurface(token) {
    const surface = cleanLexicalText(token.surface);
    const baseForm = cleanLexicalText(token.baseForm);
    const lemma = cleanLexicalText(token.lemma);
    const baseReading = cleanLexicalText(token.baseReadingKana);
    if (baseReading && baseForm && baseForm !== surface) return baseForm;
    if (baseReading && lemma && lemma !== surface) return lemma;
    return surface || baseForm || lemma;
  }

  function getDisplayReading(token) {
    if (token.loanword?.originalForm) return token.loanword.originalForm;
    const surface = cleanLexicalText(token.surface);
    const displaySurface = getDisplaySurface(token);
    const baseReading = cleanLexicalText(token.baseReadingKana);
    if (baseReading && displaySurface && displaySurface !== surface) return baseReading;
    return cleanLexicalText(token.readingKana) || cleanLexicalText(token.reading) || baseReading;
  }

  const COPY = {
    en: {
      saveLocked: "Trial ended. Open the Mac app to unlock Basic and continue saving words.",
      saveFailed: "Save failed. Please try again."
    },
    zhHans: {
      saveLocked: "试用已结束。打开 Mac app 解锁 Basic 后可继续保存新词。",
      saveFailed: "保存失败，请再试一次。"
    }
  };

  function getInterfaceLanguage(repository) {
    const language = repository.state?.settings?.display?.interfaceLanguage;
    return language === "zhHans" ? "zhHans" : "en";
  }

  function t(repository, key) {
    const language = getInterfaceLanguage(repository);
    return COPY[language]?.[key] || COPY.en[key] || "";
  }

  class Tooltip {
    constructor(repository, onStateChange = () => {}) {
      this.repository = repository;
      this.onStateChange = onStateChange;
      this.element = document.createElement("div");
      this.element.className = "jr-tooltip";
      this.element.hidden = true;
      document.documentElement.appendChild(this.element);

      document.addEventListener("click", (event) => {
        if (!this.element.contains(event.target) && !event.target.closest(".jr-ruby")) {
          this.hide();
        }
      });
    }

    show(target, token, sourceSentence) {
      const preferredLanguages = this.repository.state.userProfile.preferredMeaningLanguages;
      const meaningText = getMeaningText(token, preferredLanguages);
      const surfaceText = getDisplaySurface(token);
      const readingText = getDisplayReading(token);
      this.element.hidden = false;
      this.element.innerHTML = `
        <div class="jr-tooltip__surface"></div>
        <div class="jr-tooltip__reading"></div>
        <div class="jr-tooltip__meaning"></div>
        <div class="jr-tooltip__sentence"></div>
        <div class="jr-tooltip__status" hidden></div>
        <div class="jr-tooltip__actions">
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="forgot">Forgot</button>
          <button type="button" data-action="pin">Always Show</button>
          <button type="button" data-action="ignore">Ignore</button>
          <button type="button" data-action="known">Mark as Known</button>
        </div>
      `;

      this.element.querySelector(".jr-tooltip__surface").textContent = surfaceText;
      this.element.querySelector(".jr-tooltip__reading").textContent = readingText;
      this.element.querySelector(".jr-tooltip__meaning").textContent = meaningText;
      this.element.querySelector(".jr-tooltip__sentence").textContent = sourceSentence || "";

      this.element.querySelector("[data-action='save']").addEventListener("click", () => {
        const saveButton = this.element.querySelector("[data-action='save']");
        saveButton.disabled = true;

        const showSaveError = (error, restoreAnnotation = false) => {
          if (restoreAnnotation) {
            this.onStateChange(token);
            this.show(target, token, sourceSentence);
          } else {
            saveButton.disabled = false;
          }

          const isLocked =
            window.FadingFuriganaWordRepository.isBasicAccessLockedError?.(error) ||
            error?.code === "basic_access_locked";
          this.showStatus(isLocked ? t(this.repository, "saveLocked") : t(this.repository, "saveFailed"));
          if (!isLocked) {
            console.warn("[Fading Furigana] Save failed:", error?.message || error);
          }
        };

        try {
          if (typeof this.repository.saveWordOptimistically === "function") {
            const saveAttempt = this.repository.saveWordOptimistically(token, sourceSentence);
            this.hide();
            this.onStateChange(token);
            Promise.resolve(saveAttempt?.commit).catch((error) => showSaveError(error, true));
            return;
          }

          Promise.resolve(this.repository.saveWord(token, sourceSentence))
            .then(() => {
              this.hide();
              this.onStateChange(token);
            })
            .catch((error) => showSaveError(error));
        } catch (error) {
          showSaveError(error);
        }
      });
      this.element.querySelector("[data-action='ignore']").addEventListener("click", () => {
        this.repository.ignore(token);
        this.hide();
        this.onStateChange(token);
      });
      this.element.querySelector("[data-action='forgot']").addEventListener("click", () => {
        Promise.resolve(this.repository.markForgotten(token))
          .then(() => {
            this.hide();
            this.onStateChange(token);
          })
          .catch((error) => {
            const isLocked =
              window.FadingFuriganaWordRepository.isBasicAccessLockedError?.(error) ||
              error?.code === "basic_access_locked";
            this.showStatus(isLocked ? t(this.repository, "saveLocked") : t(this.repository, "saveFailed"));
            if (!isLocked) {
              console.warn("[Fading Furigana] Forgot failed:", error?.message || error);
            }
          });
      });
      this.element.querySelector("[data-action='pin']").addEventListener("click", () => {
        this.repository.pinAnnotation(token);
        this.hide();
        this.onStateChange(token);
      });
      this.element.querySelector("[data-action='known']").addEventListener("click", () => {
        this.repository.markKnown(token);
        this.hide();
        this.onStateChange(token);
      });

      const rect = target.getBoundingClientRect();
      const top = Math.min(window.innerHeight - this.element.offsetHeight - 12, rect.bottom + 8);
      const left = Math.min(window.innerWidth - this.element.offsetWidth - 12, Math.max(12, rect.left));
      this.element.style.top = `${Math.max(12, top)}px`;
      this.element.style.left = `${left}px`;
    }

    hide() {
      this.element.hidden = true;
    }

    showStatus(message) {
      const status = this.element.querySelector(".jr-tooltip__status");
      if (!status) return;
      status.textContent = message;
      status.hidden = false;
    }
  }

  window.FadingFuriganaTooltip = {
    Tooltip,
    getDisplayReading,
    getDisplaySurface,
    getMeaningText,
    getInterfaceLanguage
  };
})();
