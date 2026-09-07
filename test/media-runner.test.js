import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { createMediaTaskRunner } from "../src/comfyui-adapter.js";
import { runCommandImage } from "../src/command-image-adapter.js";

async function waitForTask(runner, id) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const task = runner.query(id);
    if (task?.status !== "processing") return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("task did not finish");
}

function imageConfig(tempDir) {
  const config = defaultConfig();
  config.storage = { outputDir: tempDir };
  config.gpu.unloadAfterTask = false;
  config.media.image = {
    enabled: true,
    adapter: "comfyui",
    service: "image",
    workflow: path.join(tempDir, "workflow.json"),
    cli: { enabled: true, command: "unused.exe", args: [], timeoutSeconds: 30, outputExtension: ".png" }
  };
  fs.writeFileSync(config.media.image.workflow, "{}");
  return config;
}

test("uses the configured image CLI before acquiring a local GPU slot", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-cli-image-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const config = imageConfig(tempDir);
  const calls = [];
  const file = path.join(tempDir, "cli.png");
  fs.writeFileSync(file, "cli-image");
  const runner = createMediaTaskRunner(config, { warn() {}, error() {} }, {
    commandImageRunner: async () => { calls.push("cli"); return { ok: true, path: file, source: "cli" }; },
    comfyuiRunner: async () => { calls.push("comfyui"); return { ok: true, path: file }; },
    gpuScheduler: { run: async (_kind, work) => { calls.push("gpu"); return work(); } }
  });
  const submitted = runner.submit("image", { prompt: "test" });
  const task = await waitForTask(runner, submitted.task_id);
  assert.equal(task.status, "succeeded");
  assert.deepEqual(calls, ["cli"]);
});

test("falls back to ComfyUI when the image CLI is unavailable and replays idempotent submits", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-cli-fallback-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const config = imageConfig(tempDir);
  const calls = [];
  const file = path.join(tempDir, "local.png");
  fs.writeFileSync(file, "local-image");
  const runner = createMediaTaskRunner(config, { warn() { calls.push("warn"); }, error() {} }, {
    commandImageRunner: async () => { calls.push("cli"); throw new Error("not logged in"); },
    comfyuiRunner: async () => { calls.push("comfyui"); return { ok: true, path: file, source: "comfyui" }; },
    serviceManager: { ensure: async () => calls.push("service") },
    gpuScheduler: { run: async (_kind, work) => { calls.push("gpu"); return work(); } }
  });
  const body = { prompt: "test", idempotency_key: "same-intent" };
  const first = runner.submit("image", body);
  const replay = runner.submit("image", body);
  assert.equal(replay.task_id, first.task_id);
  const task = await waitForTask(runner, first.task_id);
  assert.equal(task.result.source, "comfyui");
  assert.deepEqual(calls, ["cli", "warn", "gpu", "service", "comfyui"]);
  assert.throws(() => runner.submit("image", { prompt: "different", idempotency_key: "same-intent" }), /different media request/);
});

test("image CLI receives normalized size, aspect ratio, environment, and repeated references", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-cli-contract-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const script = path.join(tempDir, "capture.mjs");
  const first = path.join(tempDir, "first.png");
  const second = path.join(tempDir, "second.png");
  fs.writeFileSync(first, "one");
  fs.writeFileSync(second, "two");
  fs.writeFileSync(script, "import fs from 'node:fs'; const [out,size,ratio,...refs]=process.argv.slice(2); fs.writeFileSync(out,JSON.stringify({size,ratio,refs,marker:process.env.H3_TEST_MARKER}));");
  const result = await runCommandImage({
    profile: { cli: {
      enabled: true,
      command: process.execPath,
      args: [script, "{output}", "{size}", "{aspectRatio}"],
      env: { H3_TEST_MARKER: "present" },
      referenceFlag: "--ref",
      timeoutSeconds: 30,
      outputExtension: ".json"
    } },
    body: { prompt: "test", image_paths: [first, second], params: { resolution: "2k", aspect_ratio: "16:9" } },
    outputDir: tempDir
  });
  const captured = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.equal(captured.size, "3072x2048");
  assert.equal(captured.ratio, "16:9");
  assert.deepEqual(captured.refs, ["--ref", first, "--ref", second]);
  assert.equal(captured.marker, "present");
});
