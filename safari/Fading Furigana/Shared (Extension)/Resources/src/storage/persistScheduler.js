(() => {
  "use strict";

  class PersistScheduler {
    constructor(persist, { delayMs = 250, timers = window } = {}) {
      this.persist = persist;
      this.delayMs = delayMs;
      this.timers = timers;
      this.timerId = null;
      this.pendingPersist = null;
    }

    schedule() {
      if (this.timerId !== null) {
        this.timers.clearTimeout(this.timerId);
      }

      this.timerId = this.timers.setTimeout(() => {
        this.timerId = null;
        this.runPersist();
      }, this.delayMs);
    }

    async flush() {
      if (this.timerId !== null) {
        this.timers.clearTimeout(this.timerId);
        this.timerId = null;
        return this.runPersist();
      }

      if (this.pendingPersist) {
        return this.pendingPersist;
      }

      return this.runPersist();
    }

    runPersist() {
      const persistPromise = Promise.resolve()
        .then(() => this.persist())
        .finally(() => {
          if (this.pendingPersist === persistPromise) {
            this.pendingPersist = null;
          }
        });
      this.pendingPersist = persistPromise;
      return persistPromise;
    }
  }

  window.FadingFuriganaPersistScheduler = {
    PersistScheduler
  };
})();
