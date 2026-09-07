import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

function substitute(value, variables) {
  return String(value).replace(/\{(prompt|output|outputDir|size|aspectRatio)\}/g, (_match, key) => variables[key]);
}

function imageSize(body) {
  const explicit = String(body?.params?.size || "").trim();
  if (/^\d+x\d+$/i.test(explicit)) return explicit;
  const ratio = String(body?.params?.aspect_ratio || "1:1").trim();
  const resolution = String(body?.params?.resolution || explicit || "1k").toLowerCase();
  const edge = resolution.includes("4k") ? 4096 : resolution.includes("2k") ? 2048 : 1024;
  if (["16:9", "4:3"].includes(ratio)) return `${Math.round(edge * 1.5)}x${edge}`;
  if (["9:16", "3:4"].includes(ratio)) return `${edge}x${Math.round(edge * 1.5)}`;
  return `${edge}x${edge}`;
}

export async function runCommandImage({ profile, body, outputDir }) {
  const cli = profile.cli;
  if (!cli?.enabled || !cli.command) throw new Error("Image CLI is not configured.");
  const command = path.resolve(String(cli.command));
  if (!fs.existsSync(command)) throw new Error(`Image CLI executable not found: ${command}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const extension = /^\.[a-zA-Z0-9]{2,5}$/.test(cli.outputExtension || "") ? cli.outputExtension : ".png";
  const output = path.join(outputDir, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  const variables = {
    prompt: String(body?.prompt || ""),
    output,
    outputDir,
    size: imageSize(body),
    aspectRatio: String(body?.params?.aspect_ratio || "1:1")
  };
  const args = (Array.isArray(cli.args) ? cli.args : []).map((value) => substitute(value, variables));
  const referenceFlag = typeof cli.referenceFlag === "string" ? cli.referenceFlag.trim() : "";
  if (referenceFlag) {
    for (const reference of body?.image_paths ?? []) args.push(referenceFlag, path.resolve(String(reference)));
  }
  const timeoutMs = Math.max(30, Number(cli.timeoutSeconds) || 900) * 1000;
  const logs = [];
  const environment = { ...process.env, ...(cli.env ?? {}) };
  if (cli.pathPrepend) environment.PATH = `${cli.pathPrepend}${path.delimiter}${environment.PATH || ""}`;
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: outputDir,
      windowsHide: true,
      shell: false,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const capture = (chunk) => {
      logs.push(String(chunk));
      if (logs.join("").length > 16000) logs.shift();
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Image CLI failed (${signal || `exit ${code}`}): ${logs.join("").slice(-2000)}`));
    });
  });
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new Error(`Image CLI completed without creating the contracted output file: ${output}`);
  }
  return { ok: true, path: output, source: "cli" };
}
