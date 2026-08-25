import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Windows launcher does not treat harmless native stderr as a startup failure", { skip: process.platform !== "win32" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "h3-launcher-test-"));
  const logFile = path.join(temporary, "native.log");
  fs.writeFileSync(logFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("legacy", "utf16le")]));
  const helper = path.resolve("scripts", "invoke-native-logged.ps1").replaceAll("'", "''");
  const executable = process.execPath.replaceAll("'", "''");
  const log = logFile.replaceAll("'", "''");
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `. '${helper}'`,
    `$code = Invoke-NativeLogged -FilePath '${executable}' -ArgumentList @('-e', 'console.error(\"harmless-warning\")') -LogFile '${log}'`,
    "if ($code -ne 0) { exit $code }"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { encoding: "utf8" });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(fs.readFileSync(logFile, "utf8"), /harmless-warning/);
    assert.equal(fs.existsSync(path.join(temporary, "native.legacy-utf16.log")), true);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
