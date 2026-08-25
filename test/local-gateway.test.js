import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.js";
import { createLocalGateway } from "../src/local-gateway.js";

test("serves local Ollama provider config and never cloud fallback", async () => {
  const config = defaultConfig();
  config.listen.port = 0;
  const gateway = createLocalGateway(config, { log() {}, warn() {} });
  await gateway.listen();
  const address = gateway.server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${baseURL}/api/v1/config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.model, `ollama/${config.ollama.model}`);
    assert.equal(body.provider.ollama.options.baseURL, config.ollama.baseURL);
    assert.deepEqual(body.enabled_providers, ["ollama"]);
  } finally {
    await gateway.close();
  }
});

test("blocks an unconfigured media route locally", async () => {
  const config = defaultConfig();
  config.listen.port = 0;
  const gateway = createLocalGateway(config, { log() {}, warn() {} });
  await gateway.listen();
  const address = gateway.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/video/wan/generate`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.local_only, true);
    assert.equal(body.error.code, "H3_LOCAL_BACKEND_NOT_CONFIGURED");
  } finally {
    await gateway.close();
  }
});

test("blocks unknown upstream routes instead of proxying", async () => {
  const config = defaultConfig();
  config.listen.port = 0;
  const gateway = createLocalGateway(config, { log() {}, warn() {} });
  await gateway.listen();
  const address = gateway.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/private/unknown`);
    assert.equal(response.status, 451);
    const body = await response.json();
    assert.equal(body.error.code, "H3_CLOUD_ROUTE_BLOCKED");
  } finally {
    await gateway.close();
  }
});
