import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installPaths, localGatewayURL } from "./config.js";
import { createLocalGateway } from "./local-gateway.js";
import { createLocalServiceManager } from "./services.js";

export function localRuntimeEnvironment(config, configPath = process.env.H3_LOCAL_CONFIG) {
  const resolvedConfig = path.resolve(configPath || path.join(process.cwd(), "config", "local.json"));
  const runtimeRoot = path.resolve(path.dirname(resolvedConfig), "..", "runtime", "opencode-home");
  const model = `${config.llm.providerId || "local"}/${config.llm.model}`;
  const toolAllowlist = Array.isArray(config.agentTools?.allowlist)
    ? config.agentTools.allowlist.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()).join(",")
    : "";
  return {
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model, small_model: model }),
    OPENCODE_TEST_HOME: path.join(runtimeRoot, "home"),
    XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
    XDG_DATA_HOME: path.join(runtimeRoot, "data"),
    XDG_STATE_HOME: path.join(runtimeRoot, "state"),
    XDG_CACHE_HOME: path.join(runtimeRoot, "cache"),
    // Read by the small, version-checked mcp-tools patch in patcher.js.
    HILO_MCP_TOOL_ALLOWLIST: toolAllowlist
  };
}

export async function launchLocal(installDir, config, logger = console) {
  const paths = installPaths(installDir);
  // The installation-root executable is Velopack's short-lived updater stub.
  // Launch the real current app so the local bridge stays alive for the full UI session.
  const executable = fs.existsSync(paths.currentExe) ? paths.currentExe : paths.appExe;
  if (!fs.existsSync(executable)) throw new Error(`MiniMax Design executable not found under ${paths.root}`);

  const services = createLocalServiceManager(config.services, logger);
  await services.ensureStartup();
  const gateway = createLocalGateway(config, logger, { configPath: process.env.H3_LOCAL_CONFIG, serviceManager: services });
  await gateway.listen();

  const env = {
    ...process.env,
    ...localRuntimeEnvironment(config),
    CLOUD_GATEWAY_BASE_URL: localGatewayURL(config),
    H3_LOCAL_GATEWAY_BASE_URL: localGatewayURL(config),
    H3_LOCAL_MODE: "1"
  };
  const child = spawn(executable, [], {
    cwd: paths.root,
    env,
    stdio: "inherit",
    windowsHide: false
  });
  logger.log(`[h3-local] started ${executable}`);

  const stop = async () => {
    await gateway.close().catch(() => undefined);
    await services.stop().catch(() => undefined);
  };
  child.once("exit", stop);
  child.once("error", stop);
  return { child, gateway };
}
