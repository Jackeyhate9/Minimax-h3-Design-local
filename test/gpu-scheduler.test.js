import assert from "node:assert/strict";
import test from "node:test";
import { createGpuScheduler } from "../src/gpu-scheduler.js";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test("serializes GPU work across different model types", async () => {
  const scheduler = createGpuScheduler({ log() {} });
  const events = [];
  let active = 0;
  let maximumActive = 0;
  const run = (label, milliseconds) => scheduler.run(label, async () => {
    events.push(`${label}:start`);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await delay(milliseconds);
    active -= 1;
    events.push(`${label}:end`);
  });

  await Promise.all([run("llm", 20), run("image", 5), run("video", 1)]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(events, ["llm:start", "llm:end", "image:start", "image:end", "video:start", "video:end"]);
  assert.deepEqual(scheduler.status(), { active: null, queued: 0 });
});
