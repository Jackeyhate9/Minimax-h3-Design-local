import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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
    assert.equal(body.model, `local/${config.llm.model}`);
    assert.equal(body.provider.local.options.baseURL, config.llm.baseURL);
    assert.deepEqual(body.enabled_providers, ["local"]);
  } finally {
    await gateway.close();
  }
});

test("starts the configured LLM service only when the local OpenAI route is called", async (t) => {
  let unloadBody = null;
  const upstream = http.createServer(async (request, response) => {
    if (request.url === "/api/generate") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      unloadBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: request.url }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const config = defaultConfig();
  config.listen.port = 0;
  config.llm.baseURL = `http://127.0.0.1:${upstream.address().port}/v1`;
  config.llm.gatewayBaseURL = "http://127.0.0.1:17666/v1";
  config.llm.service = "ollama";
  const calls = [];
  const gateway = createLocalGateway(config, { log() {}, warn() {} }, { serviceManager: { ensure: async (id) => calls.push(id) } });
  await gateway.listen();
  t.after(() => gateway.close());

  assert.deepEqual(calls, []);
  const response = await fetch(`http://127.0.0.1:${gateway.server.address().port}/v1/models`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { path: "/v1/models" });
  assert.deepEqual(calls, ["ollama"]);
  for (let attempt = 0; attempt < 20 && !unloadBody; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(unloadBody, { model: config.llm.model, keep_alive: 0 });
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

test("proxies only non-model routes when official networking is enabled", async (t) => {
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ path: request.url, token: request.headers.token }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const upstreamPort = upstream.address().port;
  const config = defaultConfig();
  config.listen.port = 0;
  config.network = { allowNonModelCloud: true, upstreamBaseURL: `http://127.0.0.1:${upstreamPort}` };
  const gateway = createLocalGateway(config, { log() {}, warn() {} });
  await gateway.listen();
  t.after(() => gateway.close());
  const address = gateway.server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  const account = await fetch(`${baseURL}/api/v1/account/profile?x=1`, { headers: { token: "local-test-token" } });
  assert.equal(account.status, 200);
  assert.deepEqual(await account.json(), { path: "/api/v1/account/profile?x=1", token: "local-test-token" });

  const model = await fetch(`${baseURL}/api/v1/image/openai/generate`, { method: "POST", body: "{}" });
  assert.equal(model.status, 503);
  assert.equal((await model.json()).error.code, "H3_LOCAL_BACKEND_NOT_CONFIGURED");
});

test("rejects public model endpoints in user settings", async () => {
  const config = defaultConfig();
  config.listen.port = 0;
  const gateway = createLocalGateway(config, { log() {}, warn() {} }, { configPath: "unused.json" });
  await gateway.listen();
  const address = gateway.server.address();
  try {
    const next = structuredClone(config);
    next.llm.baseURL = "https://api.openai.com/v1";
    const response = await fetch(`http://127.0.0.1:${address.port}/api/local/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next)
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /回环|局域网/);
  } finally {
    await gateway.close();
  }
});

test("serves the self-configuration control panel", async () => {
  const config = defaultConfig();
  config.listen.port = 0;
  const gateway = createLocalGateway(config, { log() {}, warn() {} });
  await gateway.listen();
  const address = gateway.server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /本地模型配置/);
    assert.match(html, /发现模型/);
  } finally {
    await gateway.close();
  }
});

test("persists an explicit user model selection", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "h3-local-settings-"));
  const configPath = path.join(tempDir, "local.json");
  const config = defaultConfig();
  config.listen.port = 0;
  const gateway = createLocalGateway(config, { log() {}, warn() {} }, { configPath });
  await gateway.listen();
  const address = gateway.server.address();
  try {
    const next = structuredClone(config);
    next.llm.model = "user-selected-model";
    next.listen.port = address.port;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/local/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next)
    });
    assert.equal(response.status, 200);
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(saved.llm.model, "user-selected-model");
    assert.equal(saved.privacy.allowCloudFallback, false);
  } finally {
    await gateway.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
