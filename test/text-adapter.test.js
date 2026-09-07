import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { assertLocalLLMAvailable } from "../src/text-adapter.js";

test("fails fast when a different Ollama model owns the available VRAM", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    models: [{ name: "another-local-agent:9b", size_vram: 9_880_000_000 }]
  }), { status: 200, headers: { "content-type": "application/json" } });

  const config = defaultConfig();
  config.llm.model = "h3-qwen3.8rvn:27b-q4-40k";

  await assert.rejects(
    () => assertLocalLLMAvailable(config),
    /H3_LOCAL_OLLAMA_BUSY: Ollama is currently holding another-local-agent:9b/
  );
});
