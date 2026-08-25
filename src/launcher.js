import { spawn } from "node:child_process";
import fs from "node:fs";
import { installPaths, localGatewayURL } from "./config.js";
import { createLocalGateway } from "./local-gateway.js";

export async function launchLocal(installDir, config, logger = console) {
  const paths = installPaths(installDir);
  const executable = fs.existsSync(paths.appExe) ? paths.appExe : paths.currentExe;
  if (!fs.existsSync(executable)) throw new Error(`MiniMax Design executable not found under ${paths.root}`);

  const gateway = createLocalGateway(config, logger);
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
  };
  child.once("exit", stop);
  child.once("error", stop);
  return { child, gateway };
}
