import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(moduleDir, "..");

export const DEFAULT_INSTALL_DIR = "";

export function defaultConfig() {
  return {
    listen: { host: "127.0.0.1", port: 17666 },
    llm: {
      providerId: "local",
      name: "Local LLM",
      baseURL: "http://127.0.0.1:11434/v1",
      discoveryURL: "http://127.0.0.1:11434/api/tags",
      model: "local-model",
      context: 32768,
      output: 8192
    },
    comfyui: { baseURL: "http://127.0.0.1:8188" },
    media: {
      image: { enabled: false, adapter: "comfyui", baseURL: "", model: "", workflow: null, timeoutSeconds: 900, inputMap: {}, outputMap: {} },
      video: { enabled: false, adapter: "comfyui", baseURL: "", model: "", workflow: null, timeoutSeconds: 3600, inputMap: {}, outputMap: {} },
      speech: { enabled: false, adapter: "comfyui", baseURL: "", model: "", workflow: null, timeoutSeconds: 900, inputMap: {}, outputMap: {} },
      music: { enabled: false, adapter: "comfyui", baseURL: "", model: "", workflow: null, timeoutSeconds: 1800, inputMap: {}, outputMap: {} }
    },
    privacy: { blockUnknownRoutes: true, allowCloudFallback: false }
  };
}

function merge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return base;
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? merge(base[key] ?? {}, value)
      : value;
  }
  return result;
}

export function resolveConfigPath(explicitPath) {
  return path.resolve(explicitPath ?? process.env.H3_LOCAL_CONFIG ?? path.join(projectRoot, "config", "local.json"));
}

export function loadConfig(explicitPath) {
  const configPath = resolveConfigPath(explicitPath);
  if (!fs.existsSync(configPath)) return { config: defaultConfig(), configPath, source: "defaults" };
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!parsed.llm && parsed.ollama) {
    parsed.llm = {
      providerId: "local",
      name: "Local LLM",
      baseURL: parsed.ollama.baseURL,
      discoveryURL: parsed.ollama.tagsURL,
      model: parsed.ollama.model
    };
    delete parsed.ollama;
  }
  return { config: merge(defaultConfig(), parsed), configPath, source: "file" };
}

export function localGatewayURL(config) {
  return `http://${config.listen.host}:${config.listen.port}`;
}

export function installPaths(installDir) {
  const root = path.resolve(installDir);
  const resources = path.join(root, "current", "resources");
  return {
    root,
    appExe: path.join(root, "MiniMax Design.exe"),
    currentExe: path.join(root, "current", "MiniMax Design.exe"),
    gatewayMain: path.join(resources, "gateway", "dist", "main.js"),
    baseConfigs: [
      path.join(resources, "opencode", "config", "base.json"),
      path.join(resources, "agent-profiles", "v2", "config", "base.json")
    ],
    backupRoot: path.join(root, ".h3-local-backup")
  };
}
