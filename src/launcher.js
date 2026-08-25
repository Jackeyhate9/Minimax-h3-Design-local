import { spawn } from "node:child_process";
import fs from "node:fs";
import { installPaths, localGatewayURL } from "./config.js";
import { createLocalGateway } from "./local-gateway.js";
import { ensureLocalServices } from "./services.js";

export async function launchLocal(installDir, config, logger = console) {
  const paths = installPaths(installDir);
  // The installation-root executable is Velopack's short-lived updater stub.
  // Launch the real current app so the local bridge stays alive for the full UI session.
  const executable = fs.existsSync(paths.currentExe) ? paths.currentExe : paths.appExe;
  if (!fs.existsSync(executable)) throw new Error(`MiniMax Design executable not found under ${paths.root}`);

  const services = await ensureLocalServices(config.services, logger);
  const gateway = createLocalGateway(config, logger, { configPath: process.env.H3_LOCAL_CONFIG });
  await gateway.listen();

  const env = {
    ...process.env,
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
