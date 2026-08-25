import crypto from "node:crypto";

function localBaseURL(value) {
  const url = new URL(String(value));
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = host === "localhost" || host === "::1" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (!local || !["http:", "https:"].includes(url.protocol)) throw new Error(`Local LLM URL must be local/private: ${value}`);
  return url.toString().replace(/\/$/, "");
}

export async function unloadLocalLLM(config, logger = console) {
  if (config.gpu?.unloadAfterTask === false || config.llm.unloadStrategy === "none") return;
  const root = localBaseURL(config.llm.baseURL).replace(/\/v1\/?$/i, "");
  try {
    const response = await fetch(`${root}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.llm.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) logger.warn?.(`[h3-local] Ollama unload returned HTTP ${response.status}`);
    else logger.log?.(`[h3-local] Ollama model unloaded: ${config.llm.model}`);
  } catch (error) {
    logger.warn?.(`[h3-local] Ollama unload failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function generateText(config, body) {
  const baseURL = localBaseURL(config.llm.baseURL);
  const messages = [];
  if (body.params?.system_prompt) messages.push({ role: "system", content: String(body.params.system_prompt) });
  messages.push({ role: "user", content: String(body.prompt || "") });
  const payload = { model: config.llm.model, messages, stream: false };
  if (Number.isFinite(Number(body.params?.temperature))) payload.temperature = Number(body.params.temperature);
  if (Number.isFinite(Number(body.params?.max_tokens))) payload.max_tokens = Number(body.params.max_tokens);
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer local" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Math.max(30000, Number(config.llm.timeoutSeconds) || 1800000))
  });
  if (!response.ok) throw new Error(`Local LLM returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  const result = await response.json();
  const content = result?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Local LLM returned empty text.");
  return content;
}

export function createTextTaskRunner(config, logger = console, options = {}) {
  const tasks = new Map();
  return {
    submit(body) {
      if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) throw new Error("Text prompt is required.");
      const taskId = crypto.randomUUID();
      tasks.set(taskId, { task_id: taskId, status: "processing" });
      const run = options.gpuScheduler?.run?.bind(options.gpuScheduler) ?? ((_label, task) => task());
      run("llm", async () => {
        if (config.llm.service) await options.serviceManager?.ensure(config.llm.service);
        try {
          return await generateText(config, body);
        } finally {
          await unloadLocalLLM(config, logger);
        }
      }).then((text) => tasks.set(taskId, { task_id: taskId, status: "success", text }))
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error?.(`[h3-local] text task ${taskId} failed: ${message}`);
          tasks.set(taskId, { task_id: taskId, status: "failed", base: { message, user_message: message } });
        });
      return { task_id: taskId, status: "processing" };
    },
    query(taskId) {
      return tasks.get(taskId) ?? null;
    }
  };
}
