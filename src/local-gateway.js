import http from "node:http";
import { localModelCatalog, ollamaProviderConfig } from "./provider-config.js";

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
  const [ollama, comfyui] = await Promise.all([
    probe(config.ollama.tagsURL),
    probe(`${config.comfyui.baseURL.replace(/\/$/, "")}/system_stats`)
  ]);
  return {
    localOnly: true,
    cloudFallback: false,
    ollama: { ...ollama, url: config.ollama.baseURL, model: config.ollama.model },
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

export function createLocalGateway(config, logger = console) {
  const server = http.createServer(async (request, response) => {
    const host = request.headers.host ?? `${config.listen.host}:${config.listen.port}`;
    const url = new URL(request.url ?? "/", `http://${host}`);
    const pathname = url.pathname;

    if (pathname === "/health" || pathname === "/api/health" || pathname === "/api/health/live") {
      sendJSON(response, 200, { ok: true, service: "minimax-h3-design-local", local_only: true });
      return;
    }
    if (pathname === "/doctor") {
      sendJSON(response, 200, await diagnostics(config));
      return;
    }
    if (pathname === "/api/v1/config") {
      sendJSON(response, 200, ollamaProviderConfig(config));
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
