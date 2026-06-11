const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");

function loadBrowserScript(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, "utf8"), { filename: filePath });
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`[pass] ${name}`);
  } catch (error) {
    console.error(`[fail] ${name}`);
    throw error;
  }
}

function createFakeTimers() {
  const timers = [];
  return {
    timers,
    setTimeout(callback, delayMs) {
      const id = timers.length;
      timers.push({ callback, delayMs, cleared: false });
      return id;
    },
    clearTimeout(id) {
      timers[id].cleared = true;
    },
    run(id) {
      if (!timers[id].cleared) timers[id].callback();
    }
  };
}

global.window = global;
loadBrowserScript("src/storage/persistScheduler.js");

const { PersistScheduler } = window.FadingFuriganaPersistScheduler;
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("batches repeated schedules into the latest timer", () => {
  const fakeTimers = createFakeTimers();
  let persistCount = 0;
  const scheduler = new PersistScheduler(() => {
    persistCount += 1;
  }, { delayMs: 50, timers: fakeTimers });

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();

  assert.equal(fakeTimers.timers.length, 3);
  assert.equal(fakeTimers.timers[0].cleared, true);
  assert.equal(fakeTimers.timers[1].cleared, true);
  assert.equal(fakeTimers.timers[2].delayMs, 50);

  fakeTimers.run(0);
  fakeTimers.run(1);
  assert.equal(persistCount, 0);

  fakeTimers.run(2);
  assert.equal(persistCount, 0);
});

test("runs a single persist after the latest timer fires", async () => {
  const fakeTimers = createFakeTimers();
  let persistCount = 0;
  const scheduler = new PersistScheduler(() => {
    persistCount += 1;
  }, { delayMs: 50, timers: fakeTimers });

  scheduler.schedule();
  scheduler.schedule();
  fakeTimers.run(1);
  await scheduler.flush();

  assert.equal(persistCount, 1);
});

test("flush cancels a scheduled timer and persists immediately", async () => {
  const fakeTimers = createFakeTimers();
  let persistCount = 0;
  const scheduler = new PersistScheduler(() => {
    persistCount += 1;
  }, { delayMs: 50, timers: fakeTimers });

  scheduler.schedule();
  await scheduler.flush();

  assert.equal(fakeTimers.timers[0].cleared, true);
  assert.equal(persistCount, 1);

  fakeTimers.run(0);
  assert.equal(persistCount, 1);
});

(async () => {
  for (const { name, fn } of tests) {
    await runTest(name, fn);
  }
})();
