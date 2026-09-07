import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { localRuntimeEnvironment } from "../src/launcher.js";

test("isolates the embedded OpenCode runtime from the user's global model config", () => {
  const config = defaultConfig();
  config.llm.providerId = "local";
  config.llm.model = "toonflow-qwen3.8:27b-q4-32k";
  const configPath = path.resolve("fixture", "config", "local.json");

  const env = localRuntimeEnvironment(config, configPath);

  assert.deepEqual(JSON.parse(env.OPENCODE_CONFIG_CONTENT), {
    model: "local/toonflow-qwen3.8:27b-q4-32k",
    small_model: "local/toonflow-qwen3.8:27b-q4-32k"
  });
  const runtimeRoot = path.resolve("fixture", "runtime", "opencode-home");
  assert.equal(env.OPENCODE_TEST_HOME, path.join(runtimeRoot, "home"));
  assert.equal(env.XDG_CONFIG_HOME, path.join(runtimeRoot, "config"));
  assert.equal(env.XDG_DATA_HOME, path.join(runtimeRoot, "data"));
  assert.equal(env.XDG_STATE_HOME, path.join(runtimeRoot, "state"));
  assert.equal(env.XDG_CACHE_HOME, path.join(runtimeRoot, "cache"));
  assert.match(env.HILO_MCP_TOOL_ALLOWLIST, /generate_video/);
});
