import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { localModelCatalog, localLLMProviderConfig } from "./provider-config.js";
import { settingsPage } from "./settings-page.js";
import { createMediaTaskRunner } from "./comfyui-adapter.js";
import { createGpuScheduler } from "./gpu-scheduler.js";
import { createTextTaskRunner, unloadLocalLLM } from "./text-adapter.js";

const MODEL_ROUTE = /^\/api\/(?:v\d+\/)?(?:image|video|audio|speech|music|tool|generate|models|super-resolution)(?:\/|$)/i;
const CONFIG_ROUTES = new Set(["/api/v1/config", "/api/v1/models/config"]);

function sendJSON(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  response.end(payload);
}

function nonModelUpstreamBaseURL(value) {
  const url = new URL(String(value));
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localHttp = url.protocol === "http:" && (host === "localhost" || host === "::1" || host.startsWith("127."));
  if (url.protocol !== "https:" && !localHttp) throw new Error("Non-model upstream must use HTTPS (or loopback HTTP for testing).");
  return url.toString().replace(/\/$/, "");
}

async function readRawBody(request, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Upstream request body too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function proxyNonModelRequest(request, response, config) {
  const baseURL = nonModelUpstreamBaseURL(config.network.upstreamBaseURL);
  const target = new URL(request.url ?? "/", `${baseURL}/`);
  const headers = { ...request.headers };
  for (const name of ["host", "content-length", "connection", "transfer-encoding"]) delete headers[name];
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readRawBody(request);
  const upstream = await fetch(target, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(120000) });
  const outputHeaders = {};
  upstream.headers.forEach((value, name) => {
    if (!["content-length", "transfer-encoding", "connection"].includes(name.toLowerCase())) outputHeaders[name] = value;
  });
  const payload = Buffer.from(await upstream.arrayBuffer());
  outputHeaders["content-length"] = String(payload.length);
  response.writeHead(upstream.status, outputHeaders);
  response.end(payload);
}

function proxyLocalLLMRequest(request, response, config) {
  const baseURL = assertLocalServiceURL(config.llm.baseURL, "LLM Base URL");
  const target = new URL(request.url ?? "/", `${baseURL.replace(/\/v1\/?$/i, "")}/`);
  const headers = { ...request.headers };
  for (const name of ["host", "connection", "transfer-encoding"]) delete headers[name];
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const upstreamRequest = client.request(target, { method: request.method, headers }, (upstreamResponse) => {
      const outputHeaders = { ...upstreamResponse.headers };
      for (const name of ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade"]) delete outputHeaders[name];
      response.writeHead(upstreamResponse.statusCode ?? 502, outputHeaders);
      upstreamResponse.pipe(response);
      upstreamResponse.once("end", resolve);
      upstreamResponse.once("error", reject);
    });
    upstreamRequest.once("error", reject);
    request.once("aborted", () => upstreamRequest.destroy());
    response.once("close", () => {
      if (!response.writableEnded) upstreamRequest.destroy(new Error("Local LLM client disconnected."));
    });
    request.pipe(upstreamRequest);
  });
}

async function probe(url, timeoutMs = 2000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function diagnostics(config) {
  const [llm, comfyui] = await Promise.all([
    probe(config.llm.discoveryURL || `${config.llm.baseURL.replace(/\/v1\/?$/, "")}/v1/models`),
    probe(`${config.comfyui.baseURL.replace(/\/$/, "")}/system_stats`)
  ]);
  return {
    localOnly: true,
    cloudFallback: false,
    llm: { ...llm, url: config.llm.baseURL, model: config.llm.model },
    comfyui: { ...comfyui, url: config.comfyui.baseURL },
    media: config.media
  };
}

function localBackendUnavailable(pathname, config) {
  const kind = pathname.includes("/image/") ? "image"
    : pathname.includes("/video/") ? "video"
      : pathname.includes("/music/") ? "music"
        : pathname.includes("/audio/") || pathname.includes("/speech/") ? "speech"
          : "media";
  return {
    error: {
      type: "local_backend_not_configured",
      code: "H3_LOCAL_BACKEND_NOT_CONFIGURED",
      message: `Cloud access blocked. Configure the local ${kind} workflow for ComfyUI at ${config.comfyui.baseURL}.`
    },
    local_only: true,
    target: config.comfyui.baseURL,
    kind
  };
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function assertLocalServiceURL(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} 不是有效 URL。`); }
  const hostname = url.hostname.toLowerCase();
  const local = hostname === "localhost" || hostname === "::1" || hostname === "[::1]" || isPrivateIPv4(hostname);
  if (!local) throw new Error(`${label} 必须使用回环或 RFC1918 局域网地址，已拒绝 ${hostname}。`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} 只支持 HTTP(S)。`);
  return url.toString().replace(/\/$/, "");
}

function sanitizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("配置必须是 JSON 对象。");
  const llm = value.llm ?? {};
  const media = value.media ?? {};
  const normalized = {
    ...value,
    llm: {
      providerId: String(llm.providerId || "local").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64),
      name: String(llm.name || "Local LLM").trim().slice(0, 100),
      baseURL: assertLocalServiceURL(String(llm.baseURL || ""), "LLM Base URL"),
      gatewayBaseURL: llm.gatewayBaseURL ? assertLocalServiceURL(String(llm.gatewayBaseURL), "LLM Gateway URL") : "",
      service: String(llm.service || "").trim().slice(0, 100),
      unloadStrategy: llm.unloadStrategy === "none" ? "none" : "ollama",
      discoveryURL: llm.discoveryURL ? assertLocalServiceURL(String(llm.discoveryURL), "模型发现地址") : "",
      model: String(llm.model || "").trim().slice(0, 200),
      context: Math.max(2048, Math.min(1048576, Number(llm.context) || 32768)),
      output: Math.max(512, Math.min(262144, Number(llm.output) || 8192))
    },
    comfyui: { baseURL: assertLocalServiceURL(String(value.comfyui?.baseURL || ""), "ComfyUI URL") },
    media: {}
  };
  normalized.network = {
    allowNonModelCloud: value.network?.allowNonModelCloud === true,
    upstreamBaseURL: value.network?.upstreamBaseURL ? nonModelUpstreamBaseURL(value.network.upstreamBaseURL) : ""
  };
  normalized.gpu = { mode: "serial", unloadAfterTask: value.gpu?.unloadAfterTask !== false };
  if (!normalized.llm.providerId || !normalized.llm.model) throw new Error("Provider ID 和默认模型 ID 不能为空。");
  for (const kind of ["image", "video", "speech", "music"]) {
    const entry = media[kind] ?? {};
    const workflow = entry.workflow ? path.resolve(String(entry.workflow)) : null;
    const editWorkflow = entry.editWorkflow ? path.resolve(String(entry.editWorkflow)) : null;
    if (entry.enabled && (!workflow || !fs.existsSync(workflow))) throw new Error(`${kind} 已启用，但 workflow 文件不存在。`);
    if (editWorkflow && !fs.existsSync(editWorkflow)) throw new Error(`${kind} editWorkflow 文件不存在。`);
    const inputMap = entry.inputMap && typeof entry.inputMap === "object" && !Array.isArray(entry.inputMap) ? entry.inputMap : {};
    const editInputMap = entry.editInputMap && typeof entry.editInputMap === "object" && !Array.isArray(entry.editInputMap) ? entry.editInputMap : {};
    const outputMap = entry.outputMap && typeof entry.outputMap === "object" && !Array.isArray(entry.outputMap) ? entry.outputMap : {};
    normalized.media[kind] = {
      enabled: entry.enabled === true,
      adapter: "comfyui",
      service: String(entry.service || "").trim().slice(0, 100),
      baseURL: entry.baseURL ? assertLocalServiceURL(String(entry.baseURL), `${kind} ComfyUI URL`) : "",
      model: String(entry.model || "").trim().slice(0, 200),
      workflow,
      editWorkflow,
      timeoutSeconds: Math.max(30, Math.min(21600, Number(entry.timeoutSeconds) || (kind === "video" ? 3600 : 900))),
      inputMap,
      editInputMap,
      outputMap
    };
  }
  normalized.privacy = { blockUnknownRoutes: true, allowCloudFallback: false };
  normalized.listen = { host: "127.0.0.1", port: Number(value.listen?.port) || 17666 };
  return normalized;
}

async function readBody(request, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("配置请求过大。");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function discoverModels(baseURL, discoveryURL) {
  const candidates = [];
  if (discoveryURL) candidates.push(assertLocalServiceURL(discoveryURL, "模型发现地址"));
  const safeBase = assertLocalServiceURL(baseURL, "LLM Base URL");
  candidates.push(`${safeBase.replace(/\/$/, "")}/models`);
  if (/\/v1$/i.test(safeBase)) candidates.push(`${safeBase.replace(/\/v1$/i, "")}/api/tags`);
  const errors = [];
  for (const url of [...new Set(candidates)]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) { errors.push(`${url}: HTTP ${response.status}`); continue; }
      const body = await response.json();
      const models = Array.isArray(body.models)
        ? body.models.map((item) => item?.id ?? item?.model ?? item?.name).filter((item) => typeof item === "string")
        : Array.isArray(body.data) ? body.data.map((item) => item?.id).filter((item) => typeof item === "string") : [];
      if (models.length) return { source: url, models: [...new Set(models)].sort() };
      errors.push(`${url}: 未返回模型列表`);
    } catch (error) { errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(errors.join("；") || "未发现本地模型。");
}

function saveSettings(configPath, config) {
  if (!configPath) throw new Error("未提供可写配置路径。");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temp = `${configPath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(temp, configPath);
}

export function createLocalGateway(config, logger = console, options = {}) {
  const gpuScheduler = options.gpuScheduler ?? createGpuScheduler(logger);
  const mediaTasks = createMediaTaskRunner(config, logger, { serviceManager: options.serviceManager, gpuScheduler });
  const textTasks = createTextTaskRunner(config, logger, { serviceManager: options.serviceManager, gpuScheduler });
  const server = http.createServer(async (request, response) => {
    const host = request.headers.host ?? `${config.listen.host}:${config.listen.port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);
    const pathname = url.pathname;

    if (pathname === "/" && request.method === "GET") {
      const payload = settingsPage();
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(payload), "cache-control": "no-store" });
      response.end(payload);
      return;
    }
    if (pathname === "/api/local/settings" && request.method === "GET") {
      sendJSON(response, 200, config);
      return;
    }
    if (pathname === "/api/local/settings" && request.method === "PUT") {
      try {
        const origin = request.headers.origin;
        if (origin) {
          const originURL = new URL(origin);
          if (!(["127.0.0.1", "localhost", "::1"].includes(originURL.hostname) && Number(originURL.port || 80) === Number(config.listen.port))) {
            throw new Error("拒绝来自非本地配置页的写入请求。");
          }
        }
        const next = sanitizeSettings(await readBody(request));
        saveSettings(options.configPath, next);
        for (const key of Object.keys(config)) delete config[key];
        Object.assign(config, next);
        sendJSON(response, 200, { ok: true, restartRequired: true, config });
      } catch (error) {
        sendJSON(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (pathname === "/api/local/discover" && request.method === "GET") {
      try {
        if (config.llm.service) await options.serviceManager?.ensure(config.llm.service);
        sendJSON(response, 200, await discoverModels(url.searchParams.get("baseURL") ?? "", url.searchParams.get("discoveryURL") ?? ""));
      } catch (error) {
        sendJSON(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (pathname === "/health" || pathname === "/api/health" || pathname === "/api/health/live") {
      sendJSON(response, 200, { ok: true, service: "minimax-h3-design-local", local_only: true, gpu: gpuScheduler.status() });
      return;
    }
    if (pathname === "/doctor") {
      sendJSON(response, 200, await diagnostics(config));
      return;
    }
    if (pathname === "/api/v1/config") {
      sendJSON(response, 200, localLLMProviderConfig(config));
      return;
    }
    if (pathname === "/api/v1/models/config") {
      sendJSON(response, 200, localModelCatalog(config));
      return;
    }
    if (/^\/v1(?:\/|$)/.test(pathname)) {
      try {
        await gpuScheduler.run("llm", async () => {
          if (config.llm.service) await options.serviceManager?.ensure(config.llm.service);
          try {
            await proxyLocalLLMRequest(request, response, config);
          } finally {
            await unloadLocalLLM(config, logger);
          }
        });
      } catch (error) {
        if (!response.headersSent) sendJSON(response, 502, { error: { type: "local_llm_error", message: error instanceof Error ? error.message : String(error) }, local_only: true });
        else response.destroy(error instanceof Error ? error : undefined);
      }
      return;
    }
    if (pathname === "/api/v2/text/generate" && request.method === "POST") {
      try {
        sendJSON(response, 202, textTasks.submit(await readBody(request)));
      } catch (error) {
        sendJSON(response, 400, { error: error instanceof Error ? error.message : String(error), local_only: true });
      }
      return;
    }
    const textTaskMatch = pathname.match(/^\/api\/v2\/text\/tasks\/([^/]+)$/);
    if (textTaskMatch && request.method === "GET") {
      const task = textTasks.query(decodeURIComponent(textTaskMatch[1]));
      sendJSON(response, task ? 200 : 404, task ?? { status: "failed", base: { message: "Local text task not found." } });
      return;
    }
    const submitMatch = pathname.match(/^\/api\/generate\/(image|video|speech|music)\/submit$/);
    if (submitMatch && request.method === "POST") {
      try {
        sendJSON(response, 202, mediaTasks.submit(submitMatch[1], await readBody(request)));
      } catch (error) {
        sendJSON(response, 503, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          error_code: error?.code ?? "local_backend_error",
          failure_presentation: "terminal",
          local_only: true
        });
      }
      return;
    }
    const taskMatch = pathname.match(/^\/api\/generate\/tasks\/([^/]+)\/query$/);
    if (taskMatch && request.method === "GET") {
      const task = mediaTasks.query(decodeURIComponent(taskMatch[1]));
      sendJSON(response, task ? 200 : 404, task ?? { ok: false, error: "Local generation task not found." });
      return;
    }
    if (MODEL_ROUTE.test(pathname) || CONFIG_ROUTES.has(pathname)) {
      logger.warn(`[local-only] blocked unconfigured model route ${request.method} ${pathname}`);
      sendJSON(response, 503, localBackendUnavailable(pathname, config));
      return;
    }

    if (config.network?.allowNonModelCloud && config.network?.upstreamBaseURL) {
      try {
        await proxyNonModelRequest(request, response, config);
      } catch (error) {
        sendJSON(response, 502, { error: { type: "non_model_upstream_error", message: error instanceof Error ? error.message : String(error) } });
      }
      return;
    }
    logger.warn(`[local-only] blocked unknown route ${request.method} ${pathname}`);
    sendJSON(response, 451, {
      error: {
        type: "local_only_policy",
        code: "H3_CLOUD_ROUTE_BLOCKED",
        message: "Unknown upstream route blocked by local-only policy."
      },
      local_only: true
    });
  });

  return {
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.listen.port, config.listen.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      logger.log(`[h3-local] listening on http://${config.listen.host}:${config.listen.port}`);
      return server;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  };
}
