import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { patchInstall } from "../src/patcher.js";

test("injects the configured local LLM into MiniMax TEXT_MODELS", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "h3-patcher-text-"));
  try {
    const gateway = path.join(root, "current", "resources", "gateway", "dist", "main.js");
    const configs = [
      path.join(root, "current", "resources", "opencode", "config", "base.json"),
      path.join(root, "current", "resources", "agent-profiles", "v2", "config", "base.json")
    ];
    fs.mkdirSync(path.dirname(gateway), { recursive: true });
    fs.writeFileSync(gateway, [
      "function wrapCloudGatewayWithRuntimeBaseUrl(base) {",
      "  return { get() {",
      "      const override = getCloudEnvOverride();",
      "  } };",
      "}",
      "var TEXT_MODELS = [",
      "];"
    ].join("\n"));
    for (const file of configs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "{}");
    }
    const config = defaultConfig();
    config.llm.model = "fixture-model";
    patchInstall(root, config);
    const patched = fs.readFileSync(gateway, "utf8");
    assert.match(patched, /id: "local\/fixture-model"/);
    assert.match(patched, /backend: BACKEND_TEXT_OPENAI/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
