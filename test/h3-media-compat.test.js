import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { createLocalGateway } from "../src/local-gateway.js";
import { createMediaTaskRunner } from "../src/comfyui-adapter.js";
import { matchH3MediaRoute, normalizeH3MediaBody } from "../src/h3-media-compat.js";

test("matches the H3 media routes used by the selected model backends", () => {
  assert.deepEqual(matchH3MediaRoute("/api/v2/image/openai/generate", "POST"), { kind: "image", style: "cloud-v2", provider: "openai", action: "submit", taskId: undefined });
  assert.deepEqual(matchH3MediaRoute("/api/v2/image/openai/tasks/img-1", "GET"), { kind: "image", style: "cloud-v2", provider: "openai", action: "query", taskId: "img-1" });
  assert.deepEqual(matchH3MediaRoute("/api/v1/video/wan/generate", "POST"), { kind: "video", style: "wan-v1", provider: "wan", action: "submit", taskId: undefined });
  assert.deepEqual(matchH3MediaRoute("/api/v2/audio/tts", "POST"), { kind: "speech", style: "cloud-v2", provider: "minimax", action: "submit", taskId: undefined });
  assert.deepEqual(matchH3MediaRoute("/api/v2/audio/seedaudio/tts/tasks/tts-1", "GET"), { kind: "speech", style: "cloud-v2", provider: "seedaudio", action: "query", taskId: "tts-1" });
  assert.deepEqual(matchH3MediaRoute("/api/v2/audio/music/minimax/tasks/music-1", "GET"), { kind: "music", style: "cloud-v2", provider: "minimax", action: "query", taskId: "music-1" });
});

test("normalizes nested H3 image parameters for web and local adapters", () => {
  const route = matchH3MediaRoute("/api/v2/image/openai/generate", "POST");
  const normalized = normalizeH3MediaBody(route, {
    prompt: "wide scene",
    params: { aspect_ratio: "16:9", resolution: "2k", quality: "high" }
  });
  assert.equal(normalized.params.aspect_ratio, "16:9");
  assert.equal(normalized.params.resolution, "2k");
  assert.equal(normalized.params.quality, "high");
});

test("rejects a single H3 video request above the configured VRAM-safe duration", () => {
  const config = defaultConfig();
  config.media.video = {
    enabled: true,
    adapter: "comfyui",
    workflow: "fixture.json",
    maxDurationSeconds: 15
  };
  const runner = createMediaTaskRunner(config, { error() {} }, {
    comfyuiRunner: async () => ({ path: "unused.mp4" })
  });
  assert.throws(() => runner.submit("video", { params: { duration: 16 } }), {
    code: "H3_VIDEO_DURATION_OUT_OF_RANGE"
  });
});

test("serves H3-compatible image, video, speech, and music task envelopes", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-compat-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const artifacts = {};
  const submittedBodies = [];
  const mediaTasks = {
    submit(kind, body) {
      submittedBodies.push({ kind, body });
      const task_id = `${kind}-task`;
      const extension = kind === "image" ? ".png" : kind === "video" ? ".mp4" : ".mp3";
      const file = path.join(tempDir, `${task_id}${extension}`);
      fs.writeFileSync(file, Buffer.from(`${kind}-bytes`));
      artifacts[task_id] = { ok: true, task_id, status: "succeeded", result: { path: file, duration: 5 } };
      return { ok: true, task_id, status: "processing", media_type: kind };
    },
    query(taskId) { return artifacts[taskId] ?? null; }
  };
  const config = defaultConfig();
  config.listen.port = 0;
  config.storage = { outputDir: tempDir };
  const gateway = createLocalGateway(config, { log() {}, warn() {}, error() {} }, { mediaTasks });
  await gateway.listen();
  t.after(() => gateway.close());
  const baseURL = `http://127.0.0.1:${gateway.server.address().port}`;

  const imageSubmit = await fetch(`${baseURL}/api/v2/image/openai/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "frame", model: "gpt-image-2", size: "1536x1024" }) });
  assert.deepEqual(await imageSubmit.json(), { task_id: "image-task" });
  assert.equal(submittedBodies[0].body.params.aspect_ratio, "3:2");
  const imageQuery = await fetch(`${baseURL}/api/v2/image/openai/tasks/image-task`);
  const imageResult = await imageQuery.json();
  assert.equal(imageResult.status, "success");
  assert.match(imageResult.image_url, /\/api\/local\/media\/image-task$/);
  assert.equal(await (await fetch(imageResult.image_url)).text(), "image-bytes");

  const upload = await fetch(`${baseURL}/api/v1/files/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_data: "data:image/png;base64,aW1hZ2U=", file_prefix: "image" }) });
  const { url: uploadedURL } = await upload.json();
  assert.equal(await (await fetch(uploadedURL)).text(), "image");
  const videoSubmit = await fetch(`${baseURL}/api/v1/video/wan/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { prompt: "move", img_url: uploadedURL }, parameters: { duration: 5, resolution: "720P" } }) });
  assert.deepEqual(await videoSubmit.json(), { output: { task_id: "video-task" } });
  assert.equal(fs.existsSync(submittedBodies.at(-1).body.image_paths[0]), true);
  const videoResult = await (await fetch(`${baseURL}/api/v1/video/wan/tasks/video-task`)).json();
  assert.deepEqual(videoResult, { output: { task_status: "SUCCEEDED", video_url: `${baseURL}/api/local/media/video-task` } });

  for (const [kind, endpoint, promptKey] of [
    ["speech", "/api/v2/audio/tts", "text"],
    ["music", "/api/v2/audio/music/minimax", "prompt"]
  ]) {
    const response = await fetch(`${baseURL}${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [promptKey]: `${kind} prompt` }) });
    assert.deepEqual(await response.json(), { task_id: `${kind}-task` });
    const result = await (await fetch(`${baseURL}${endpoint}/tasks/${kind}-task`)).json();
    assert.equal(result.status, "success");
    assert.match(result.audio_url, new RegExp(`/api/local/media/${kind}-task$`));
  }
});
