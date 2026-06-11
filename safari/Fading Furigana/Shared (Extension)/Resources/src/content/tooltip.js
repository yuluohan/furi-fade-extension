(() => {
  "use strict";

  function getMeaningText(item, preferredLanguages) {
    const meanings = item.meanings || {};
    for (const locale of preferredLanguages || []) {
      if (meanings[locale]?.length) return meanings[locale].join("; ");
    }
    return Object.values(meanings).find((values) => values?.length)?.join("; ") || "";
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
      const readingText = token.loanword?.originalForm || token.readingKana || token.reading;
      this.element.hidden = false;
      this.element.innerHTML = `
        <div class="jr-tooltip__surface"></div>
        <div class="jr-tooltip__reading"></div>
        <div class="jr-tooltip__meaning"></div>
        <div class="jr-tooltip__sentence"></div>
        <div class="jr-tooltip__actions">
          <button type="button" data-action="save">Save</button>
          <button type="button" data-action="ignore">Ignore</button>
          <button type="button" data-action="known">Mark as Known</button>
        </div>
      `;

      this.element.querySelector(".jr-tooltip__surface").textContent = token.surface;
      this.element.querySelector(".jr-tooltip__reading").textContent = readingText;
      this.element.querySelector(".jr-tooltip__meaning").textContent = meaningText;
      this.element.querySelector(".jr-tooltip__sentence").textContent = sourceSentence || "";

      this.element.querySelector("[data-action='save']").addEventListener("click", () => {
        this.repository.saveWord(token, sourceSentence);
        this.hide();
      });
      this.element.querySelector("[data-action='ignore']").addEventListener("click", () => {
        this.repository.ignore(token);
        this.hide();
        this.onStateChange();
      });
      this.element.querySelector("[data-action='known']").addEventListener("click", () => {
        this.repository.markKnown(token);
        this.hide();
        this.onStateChange();
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
  }

  window.FadingFuriganaTooltip = {
    Tooltip,
    getMeaningText
  };
})();
