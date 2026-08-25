import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runComfyUIWorkflow } from "../src/comfyui-adapter.js";

test("submits an injected workflow and materializes the local ComfyUI output", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "h3-local-adapter-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const workflowPath = path.join(temporary, "workflow.json");
  fs.writeFileSync(workflowPath, JSON.stringify({ "1": { class_type: "Text", inputs: { value: "old" } } }));
  let submitted;
  const server = http.createServer(async (request, response) => {
    if (request.url === "/prompt") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      submitted = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ prompt_id: "p1" }));
      return;
    }
    if (request.url === "/history/p1") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ p1: { outputs: { "2": { images: [{ filename: "result.png", type: "output", subfolder: "" }] } } } }));
      return;
    }
    if (request.url.startsWith("/view?")) {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from("local-image"));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const result = await runComfyUIWorkflow({
    profile: {
      baseURL: `http://127.0.0.1:${port}`,
      workflow: workflowPath,
      timeoutSeconds: 30,
      inputMap: { prompt: { node: "1", input: "value", from: ["prompt"], required: true } }
    },
    fallbackBaseURL: "http://127.0.0.1:8188",
    body: { prompt: "LOCAL_PROMPT" },
    outputDir: path.join(temporary, "outputs"),
    pollMilliseconds: 1
  });

  assert.equal(submitted.prompt["1"].inputs.value, "LOCAL_PROMPT");
  assert.equal(fs.readFileSync(result.path, "utf8"), "local-image");
});
