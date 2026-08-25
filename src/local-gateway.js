import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { localModelCatalog, localLLMProviderConfig } from "./provider-config.js";
import { settingsPage } from "./settings-page.js";

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
      discoveryURL: llm.discoveryURL ? assertLocalServiceURL(String(llm.discoveryURL), "模型发现地址") : "",
      model: String(llm.model || "").trim().slice(0, 200),
      context: Math.max(2048, Math.min(1048576, Number(llm.context) || 32768)),
      output: Math.max(512, Math.min(262144, Number(llm.output) || 8192))
    },
    comfyui: { baseURL: assertLocalServiceURL(String(value.comfyui?.baseURL || ""), "ComfyUI URL") },
    media: {}
  };
  if (!normalized.llm.providerId || !normalized.llm.model) throw new Error("Provider ID 和默认模型 ID 不能为空。");
  for (const kind of ["image", "video", "speech", "music"]) {
    const entry = media[kind] ?? {};
    const workflow = entry.workflow ? path.resolve(String(entry.workflow)) : null;
    if (entry.enabled && (!workflow || !fs.existsSync(workflow))) throw new Error(`${kind} 已启用，但 workflow 文件不存在。`);
    const inputMap = entry.inputMap && typeof entry.inputMap === "object" && !Array.isArray(entry.inputMap) ? entry.inputMap : {};
    const outputMap = entry.outputMap && typeof entry.outputMap === "object" && !Array.isArray(entry.outputMap) ? entry.outputMap : {};
    normalized.media[kind] = {
      enabled: entry.enabled === true,
      model: String(entry.model || "").trim().slice(0, 200),
      workflow,
      inputMap,
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
        sendJSON(response, 200, await discoverModels(url.searchParams.get("baseURL") ?? "", url.searchParams.get("discoveryURL") ?? ""));
      } catch (error) {
        sendJSON(response, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (pathname === "/health" || pathname === "/api/health" || pathname === "/api/health/live") {
      sendJSON(response, 200, { ok: true, service: "minimax-h3-design-local", local_only: true });
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
    if (MODEL_ROUTE.test(pathname) || CONFIG_ROUTES.has(pathname)) {
      logger.warn(`[local-only] blocked unconfigured model route ${request.method} ${pathname}`);
      sendJSON(response, 503, localBackendUnavailable(pathname, config));
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
