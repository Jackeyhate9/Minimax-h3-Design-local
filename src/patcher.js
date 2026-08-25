import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { installPaths } from "./config.js";
import { localLLMProviderConfig } from "./provider-config.js";

const PATCH_MARKER = "/* H3_LOCAL_GATEWAY_OVERRIDE_V1 */";
const FUNCTION_ANCHOR = "function wrapCloudGatewayWithRuntimeBaseUrl(base) {";
const LOCAL_OVERRIDE = `${FUNCTION_ANCHOR}\n  ${PATCH_MARKER}\n  const h3LocalGatewayBaseUrl = process.env.H3_LOCAL_GATEWAY_BASE_URL?.trim();`;
const GETTER_ANCHOR = "get() {\n      const override = getCloudEnvOverride();";
const GETTER_PATCH = "get() {\n      if (h3LocalGatewayBaseUrl) return h3LocalGatewayBaseUrl.replace(/\\\/$/, \"\");\n      const override = getCloudEnvOverride();";
const TEXT_MODELS_ANCHOR = "var TEXT_MODELS = [";
const TEXT_MODEL_START = "/* H3_LOCAL_TEXT_MODEL_START */";
const TEXT_MODEL_END = "/* H3_LOCAL_TEXT_MODEL_END */";

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function mustExist(file) {
  if (!fs.existsSync(file)) throw new Error(`Required MiniMax Design file not found: ${file}`);
}

function writeAtomic(file, content) {
  const temp = `${file}.h3-local.tmp`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

function backupFiles(paths, backupRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(backupRoot, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = [];
  for (const file of paths) {
    const content = fs.readFileSync(file);
    const name = `${manifest.length}-${path.basename(file)}`;
    fs.writeFileSync(path.join(dir, name), content);
    manifest.push({ source: file, backup: name, sha256: sha256(content) });
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2));
  return dir;
}

function localTextModelBlock(config) {
  const providerId = config.llm.providerId || "local";
  const model = config.llm.model || "local-model";
  const id = `${providerId}/${model}`;
  return `${TEXT_MODEL_START}\n  {\n    id: ${JSON.stringify(id)},\n    name: ${JSON.stringify(`${model} (Local)`)},\n    model_name: ${JSON.stringify(model)},\n    provider: ${JSON.stringify(providerId)},\n    backend: BACKEND_TEXT_OPENAI,\n    subtitle: { label: \"local\", latency: \"local\" }\n  },\n  ${TEXT_MODEL_END}`;
}

function patchedGatewaySource(source, config) {
  let next = source;
  if (!next.includes(PATCH_MARKER)) {
    if (!next.includes(FUNCTION_ANCHOR) || !next.includes(GETTER_ANCHOR)) {
      throw new Error("Unsupported gateway build: local-routing anchors were not found. No file was changed.");
    }
    next = next.replace(FUNCTION_ANCHOR, LOCAL_OVERRIDE).replace(GETTER_ANCHOR, GETTER_PATCH);
  }
  const block = localTextModelBlock(config);
  const blockPattern = new RegExp(`${TEXT_MODEL_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${TEXT_MODEL_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
  if (blockPattern.test(next)) next = next.replace(blockPattern, block);
  else {
    if (!next.includes(TEXT_MODELS_ANCHOR)) throw new Error("Unsupported gateway build: TEXT_MODELS anchor was not found. No file was changed.");
    next = next.replace(TEXT_MODELS_ANCHOR, `${TEXT_MODELS_ANCHOR}\n  ${block}`);
  }
  return next;
}

function patchGateway(file, config) {
  const source = fs.readFileSync(file, "utf8");
  const next = patchedGatewaySource(source, config);
  if (next === source) return false;
  writeAtomic(file, next);
  return true;
}

function patchOpenCodeConfig(file, config) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const local = localLLMProviderConfig(config);
  parsed.enabled_providers = local.enabled_providers;
  parsed.model = local.model;
  parsed.provider = local.provider;
  parsed.agent = parsed.agent ?? {};
  for (const [name, model] of Object.entries(local.agent_model)) {
    if (parsed.agent[name]) parsed.agent[name].model = model;
  }
  writeAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`);
}

export function inspectInstall(installDir) {
  const paths = installPaths(installDir);
  const required = [paths.gatewayMain, ...paths.baseConfigs];
  return {
    paths,
    required: required.map((file) => ({ file, exists: fs.existsSync(file) })),
    patched: fs.existsSync(paths.gatewayMain) && fs.readFileSync(paths.gatewayMain, "utf8").includes(PATCH_MARKER) && fs.readFileSync(paths.gatewayMain, "utf8").includes(TEXT_MODEL_START)
  };
}

export function patchInstall(installDir, config) {
  const paths = installPaths(installDir);
  const files = [paths.gatewayMain, ...paths.baseConfigs];
  files.forEach(mustExist);
  const gatewaySource = fs.readFileSync(paths.gatewayMain, "utf8");
  if (patchedGatewaySource(gatewaySource, config) === gatewaySource) {
    return { changed: false, message: "Installation is already patched.", paths };
  }
  const backupDir = backupFiles(files, paths.backupRoot);
  try {
    patchGateway(paths.gatewayMain, config);
    paths.baseConfigs.forEach((file) => patchOpenCodeConfig(file, config));
  } catch (error) {
    restoreManifest(path.join(backupDir, "manifest.json"));
    throw error;
  }
  return { changed: true, backupDir, paths };
}

export function refreshOpenCodeConfigs(installDir, config) {
  const paths = installPaths(installDir);
  paths.baseConfigs.forEach(mustExist);
  paths.baseConfigs.forEach((file) => patchOpenCodeConfig(file, config));
  return { files: paths.baseConfigs, model: localLLMProviderConfig(config).model };
}

function restoreManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const dir = path.dirname(manifestPath);
  for (const entry of manifest.files) {
    const content = fs.readFileSync(path.join(dir, entry.backup));
    if (sha256(content) !== entry.sha256) throw new Error(`Backup checksum mismatch: ${entry.backup}`);
    writeAtomic(entry.source, content);
  }
}

export function unpatchInstall(installDir) {
  const paths = installPaths(installDir);
  mustExist(paths.backupRoot);
  const manifests = fs.readdirSync(paths.backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(paths.backupRoot, entry.name, "manifest.json"))
    .filter((file) => fs.existsSync(file))
    .sort()
    .reverse();
  if (!manifests.length) throw new Error("No H3 Local backup manifest was found.");
  restoreManifest(manifests[0]);
  return { restoredFrom: path.dirname(manifests[0]), paths };
}
