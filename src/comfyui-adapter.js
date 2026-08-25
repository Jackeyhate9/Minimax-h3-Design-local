import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import crypto from "node:crypto";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function localRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const body = options.body == null ? null : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body);
    const headers = { ...(options.headers ?? {}) };
    if (body && headers["content-length"] == null) headers["content-length"] = String(body.length);
    const request = client.request(target, { method: options.method ?? "GET", headers, timeout: options.timeout ?? 120000 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const payload = Buffer.concat(chunks);
        resolve({
          ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
          status: response.statusCode ?? 500,
          async text() { return payload.toString("utf8"); },
          async json() { return JSON.parse(payload.toString("utf8")); },
          async arrayBuffer() { return payload; }
        });
      });
    });
    request.once("timeout", () => request.destroy(new Error(`Local request timeout: ${target}`)));
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function localBaseURL(value) {
  const url = new URL(String(value));
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateHost = host === "localhost" || host === "::1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!["http:", "https:"].includes(url.protocol) || !privateHost) throw new Error(`ComfyUI URL must be loopback or RFC1918 private network: ${value}`);
  return url.toString().replace(/\/$/, "");
}

function valueAt(source, dottedPath) {
  return String(dottedPath).split(".").reduce((value, key) => {
    if (value == null) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)];
    return value[key];
  }, source);
}

function firstValue(source, paths) {
  for (const candidate of Array.isArray(paths) ? paths : [paths]) {
    const value = valueAt(source, candidate);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function transformed(value, transform) {
  if (transform === "number") return Number(value);
  if (transform === "aspectRatio") {
    const ratio = String(value).trim();
    return ({
      "1:1": "1:1 (Square)",
      "16:9": "16:9 (Widescreen)",
      "9:16": "9:16 (Portrait)",
      "4:3": "4:3 (Landscape)",
      "3:4": "3:4 (Portrait)"
    })[ratio] ?? ratio;
  }
  if (transform === "filenamePrefix") return path.parse(String(value)).name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return value;
}

async function uploadImage(baseURL, file) {
  const absolute = path.resolve(String(file));
  if (!fs.existsSync(absolute)) throw new Error(`Input media file not found: ${absolute}`);
  const boundary = `----h3-local-${crypto.randomUUID()}`;
  const filename = path.basename(absolute).replace(/["\r\n]/g, "_");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fs.readFileSync(absolute),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${boundary}--\r\n`)
  ]);
  const response = await localRequest(`${baseURL}/upload/image`, { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body });
  if (!response.ok) throw new Error(`ComfyUI upload failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

async function applyInputMap(workflow, body, inputMap, baseURL) {
  for (const descriptor of Object.values(inputMap ?? {})) {
    if (!descriptor || typeof descriptor !== "object") continue;
    const node = workflow[String(descriptor.node)];
    if (!node?.inputs || !descriptor.input) throw new Error(`Workflow input target is invalid: ${JSON.stringify(descriptor)}`);
    let value = firstValue(body, descriptor.from ?? descriptor.source ?? []);
    if (value === undefined) value = descriptor.default;
    if (value === undefined) {
      if (descriptor.required) throw new Error(`Required generation input is missing: ${descriptor.from ?? descriptor.source}`);
      continue;
    }
    if (descriptor.upload === "image") value = await uploadImage(baseURL, value);
    node.inputs[descriptor.input] = transformed(value, descriptor.transform);
  }
}

function outputFiles(history) {
  const files = [];
  for (const output of Object.values(history?.outputs ?? {})) {
    for (const key of ["images", "videos", "audio", "gifs"]) {
      for (const item of output?.[key] ?? []) if (item?.filename) files.push(item);
    }
  }
  return files;
}

async function downloadOutput(baseURL, item, outputDir) {
  const query = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? "", type: item.type ?? "output" });
  const response = await localRequest(`${baseURL}/view?${query}`);
  if (!response.ok) throw new Error(`ComfyUI output download failed (${response.status})`);
  fs.mkdirSync(outputDir, { recursive: true });
  const extension = path.extname(item.filename) || ".bin";
  const output = path.join(outputDir, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  fs.writeFileSync(output, Buffer.from(await response.arrayBuffer()));
  return output;
}

export async function runComfyUIWorkflow({ profile, fallbackBaseURL, body, outputDir, pollMilliseconds = 1000 }) {
  const editing = Array.isArray(body.image_paths) && body.image_paths.length > 0 && profile.editWorkflow;
  const selected = editing ? { ...profile, workflow: profile.editWorkflow, inputMap: profile.editInputMap ?? profile.inputMap } : profile;
  const baseURL = localBaseURL(selected.baseURL || fallbackBaseURL);
  const workflow = JSON.parse(fs.readFileSync(selected.workflow, "utf8"));
  await applyInputMap(workflow, body, selected.inputMap, baseURL);
  const submitted = await localRequest(`${baseURL}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: `h3-local-${crypto.randomUUID()}` })
  });
  if (!submitted.ok) throw new Error(`ComfyUI prompt failed (${submitted.status}): ${await submitted.text()}`);
  const { prompt_id: promptId } = await submitted.json();
  if (!promptId) throw new Error("ComfyUI did not return a prompt_id.");

  const deadline = Date.now() + (Number(profile.timeoutSeconds) || 900) * 1000;
  while (Date.now() < deadline) {
    await sleep(pollMilliseconds);
    const response = await localRequest(`${baseURL}/history/${encodeURIComponent(promptId)}`);
    if (!response.ok) continue;
    const history = (await response.json())[promptId];
    if (!history) continue;
    if (history.status?.status_str === "error") throw new Error(`ComfyUI execution failed: ${JSON.stringify(history.status?.messages ?? [])}`);
    const files = outputFiles(history);
    if (!files.length) continue;
    const paths = [];
    for (const item of files) paths.push(await downloadOutput(baseURL, item, outputDir));
    return { ok: true, path: paths[0], ...(paths.length > 1 ? { paths } : {}) };
  }
  throw new Error(`ComfyUI workflow timed out after ${profile.timeoutSeconds || 900} seconds.`);
}

export function createMediaTaskRunner(config, logger = console) {
  const tasks = new Map();
  const outputDir = config.storage?.outputDir || path.join(process.cwd(), "runtime", "outputs");
  return {
    submit(kind, body) {
      const profile = config.media?.[kind];
      if (!profile?.enabled || profile.adapter !== "comfyui" || !profile.workflow) {
        const error = new Error(`Local ${kind} workflow is not enabled or configured.`);
        error.code = "H3_LOCAL_BACKEND_NOT_CONFIGURED";
        throw error;
      }
      const taskId = crypto.randomUUID();
      tasks.set(taskId, { ok: true, task_id: taskId, status: "processing" });
      runComfyUIWorkflow({ profile, fallbackBaseURL: config.comfyui.baseURL, body, outputDir })
        .then((result) => tasks.set(taskId, { ok: true, task_id: taskId, status: "succeeded", result }))
        .catch((error) => {
          logger.error(`[h3-local] ${kind} task ${taskId} failed: ${error.message}`);
          tasks.set(taskId, { ok: false, task_id: taskId, status: "failed", cloud_terminal: true, error: error.message, error_code: "local_backend_error" });
        });
      return { ok: true, task_id: taskId, status: "processing", media_type: kind };
    },
    query(taskId) {
      return tasks.get(taskId) ?? null;
    }
  };
}
