#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_INSTALL_DIR, loadConfig, projectRoot } from "./config.js";
import { createLocalGateway, diagnostics } from "./local-gateway.js";
import { launchLocal } from "./launcher.js";
import { inspectInstall, patchInstall, unpatchInstall } from "./patcher.js";

function parseArgs(argv) {
  const [command = "doctor", ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--install-dir") options.installDir = rest[++index];
    else if (value === "--config") options.configPath = rest[++index];
    else if (value === "--model") options.model = rest[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return { command, options };
}

function ensureLocalConfig(configPath, config) {
  if (fs.existsSync(configPath)) return;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`[h3-local] created ${configPath}`);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const loaded = loadConfig(options.configPath);
  if (options.model) loaded.config.ollama.model = options.model;
  const installDir = options.installDir ?? process.env.H3_INSTALL_DIR ?? DEFAULT_INSTALL_DIR;

  if (command === "doctor") {
    console.log(JSON.stringify({
      projectRoot,
      configPath: loaded.configPath,
      install: inspectInstall(installDir),
      services: await diagnostics(loaded.config)
    }, null, 2));
    return;
  }
  if (command === "patch") {
    ensureLocalConfig(loaded.configPath, loaded.config);
    console.log(JSON.stringify(patchInstall(installDir, loaded.config), null, 2));
    return;
  }
  if (command === "unpatch") {
    console.log(JSON.stringify(unpatchInstall(installDir), null, 2));
    return;
  }
  if (command === "serve") {
    const gateway = createLocalGateway(loaded.config);
    await gateway.listen();
    return;
  }
  if (command === "start") {
    ensureLocalConfig(loaded.configPath, loaded.config);
    const state = inspectInstall(installDir);
    if (!state.patched) throw new Error("MiniMax Design is not patched. Run `npm run patch -- --install-dir <path>` first.");
    await launchLocal(installDir, loaded.config);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`[h3-local] ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
