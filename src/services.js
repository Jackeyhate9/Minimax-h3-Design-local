import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertLocalHealthURL(value) {
  const url = new URL(String(value));
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host === "::1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!local || !["http:", "https:"].includes(url.protocol)) throw new Error(`Service health URL must be local/private: ${value}`);
  return url.toString();
}

async function isReady(healthURL) {
  return new Promise((resolve) => {
    const client = healthURL.startsWith("https:") ? https : http;
    const request = client.get(healthURL, { timeout: 2500 }, (response) => {
      response.resume();
      resolve((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300);
    });
    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
  });
}

async function startService(definition, started, logger) {
    if (definition?.enabled === false) throw new Error(`Service is disabled: ${definition?.id ?? definition?.name ?? "unknown"}`);
    const healthURL = assertLocalHealthURL(definition.healthURL);
    if (await isReady(healthURL)) {
      logger.log(`[h3-local] service ready: ${definition.name ?? healthURL}`);
      return { external: true };
    }
    if (!definition.command) throw new Error(`Service command is missing: ${definition.name ?? healthURL}`);
    logger.log(`[h3-local] starting service: ${definition.name ?? definition.command}`);
    const child = spawn(String(definition.command), (definition.args ?? []).map(String), {
      cwd: definition.cwd || undefined,
      env: { ...process.env, ...(definition.env ?? {}) },
      stdio: "ignore",
      windowsHide: true
    });
    started.push(child);
    const deadline = Date.now() + Math.max(10, Number(definition.timeoutSeconds) || 180) * 1000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`Service exited before becoming ready: ${definition.name ?? definition.command}`);
      if (await isReady(healthURL)) break;
      await sleep(1000);
    }
    if (!(await isReady(healthURL))) throw new Error(`Service readiness timeout: ${definition.name ?? healthURL}`);
    logger.log(`[h3-local] service ready: ${definition.name ?? healthURL}`);
    return { child, external: false };
}

export function createLocalServiceManager(definitions = [], logger = console) {
  const available = new Map();
  const started = [];
  const pending = new Map();
  for (const definition of definitions) {
    if (!definition || definition.enabled === false) continue;
    const id = String(definition.id ?? definition.name ?? "").trim();
    if (!id) throw new Error("Every local service needs an id or name.");
    available.set(id, definition);
  }

  const ensure = async (id) => {
    const key = String(id ?? "").trim();
    if (!key) return null;
    const definition = available.get(key);
    if (!definition) throw new Error(`Local service is not configured: ${key}`);
    if (!pending.has(key)) {
      const task = startService(definition, started, logger).finally(() => pending.delete(key));
      pending.set(key, task);
    }
    return pending.get(key);
  };

  return {
    started,
    ensure,
    async ensureStartup() {
      for (const [id, definition] of available) {
        if (definition.startup !== "lazy") await ensure(id);
      }
    },
    async stop() {
      for (const child of [...started].reverse()) {
        if (child.exitCode === null) child.kill();
      }
      started.length = 0;
      pending.clear();
    }
  };
}

export async function ensureLocalServices(definitions = [], logger = console) {
  const manager = createLocalServiceManager(definitions, logger);
  await manager.ensureStartup();
  return manager;
}
