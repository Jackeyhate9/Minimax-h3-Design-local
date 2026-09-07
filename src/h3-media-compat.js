import path from "node:path";

const V2_IMAGE = /^\/api\/v2\/image\/([^/]+)\/(generate|tasks\/([^/]+))$/;
// Design dispatches MiniMax-H3 through the generic v2 video backend path
// (for example /api/v2/video/minimax_v3/generate). Treat every provider as a
// local ComfyUI video task; the provider is retained only for API compatibility.
const V2_VIDEO = /^\/api\/v2\/video\/([^/]+)\/(generate|tasks\/([^/]+))$/;
const V1_H3_VIDEO = /^\/api\/v1\/video\/minimax-v3\/(generate|tasks\/([^/]+))$/;
const V1_H3_FILE = /^\/api\/v1\/video\/minimax\/files\/([^/]+)$/;
const V2_TTS = /^\/api\/v2\/audio\/(?:(seedaudio)\/)?tts(?:\/tasks\/([^/]+))?$/;
const V2_MUSIC = /^\/api\/v2\/audio\/music\/([^/]+)(?:\/tasks\/([^/]+))?$/;
const V1_WAN = /^\/api\/v1\/video\/wan\/(generate|tasks\/([^/]+))$/;

export function matchH3MediaRoute(pathname, method) {
  let match = pathname.match(V2_IMAGE);
  if (match) {
    const taskId = match[3];
    return method === (taskId ? "GET" : "POST")
      ? { kind: "image", style: "cloud-v2", provider: match[1], action: taskId ? "query" : "submit", taskId }
      : null;
  }
  match = pathname.match(V2_VIDEO);
  if (match) {
    const taskId = match[3];
    return method === (taskId ? "GET" : "POST")
      ? { kind: "video", style: "cloud-v2", provider: match[1], action: taskId ? "query" : "submit", taskId }
      : null;
  }
  match = pathname.match(V1_H3_VIDEO);
  if (match) {
    const taskId = match[2];
    return method === (taskId ? "GET" : "POST")
      ? { kind: "video", style: "cloud-v2", provider: "minimax_v3", action: taskId ? "query" : "submit", taskId }
      : null;
  }
  match = pathname.match(V1_H3_FILE);
  if (match && method === "GET") return { kind: "video", style: "cloud-v2", provider: "minimax_v3", action: "file", taskId: match[1] };
  match = pathname.match(V2_TTS);
  if (match) {
    const taskId = match[2];
    return method === (taskId ? "GET" : "POST")
      ? { kind: "speech", style: "cloud-v2", provider: match[1] || "minimax", action: taskId ? "query" : "submit", taskId }
      : null;
  }
  match = pathname.match(V2_MUSIC);
  if (match) {
    const taskId = match[2];
    return method === (taskId ? "GET" : "POST")
      ? { kind: "music", style: "cloud-v2", provider: match[1], action: taskId ? "query" : "submit", taskId }
      : null;
  }
  match = pathname.match(V1_WAN);
  if (match) {
    const taskId = match[2];
    return method === (taskId ? "GET" : "POST")
      ? { kind: "video", style: "wan-v1", provider: "wan", action: taskId ? "query" : "submit", taskId }
      : null;
  }
  return null;
}

function ratioFromSize(size) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0)) return undefined;
  const common = (a, b) => b ? common(b, a % b) : a;
  const divisor = common(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function normalizeH3MediaBody(route, body, resolveUpload = (value) => value) {
  if (route.kind === "image") {
    const sourceParams = body?.params && typeof body.params === "object" ? body.params : {};
    const size = body?.size ?? sourceParams.size;
    return {
      prompt: String(body?.prompt || ""),
      image_paths: Array.isArray(body?.image_paths) ? body.image_paths.map(resolveUpload) : [],
      filename: body?.filename,
      params: {
        ...sourceParams,
        model_name: body?.model ?? sourceParams.model_name,
        size,
        resolution: body?.resolution ?? sourceParams.resolution,
        aspect_ratio: body?.aspect_ratio ?? body?.aspectRatio ?? sourceParams.aspect_ratio ?? ratioFromSize(size),
        quality: body?.quality ?? sourceParams.quality,
        n: body?.n ?? sourceParams.n
      },
      idempotency_key: body?.idempotency_key
    };
  }
  if (route.kind === "video") {
    const source = body?.input && typeof body.input === "object" ? body.input : body;
    const image = resolveUpload(source?.img_url ?? source?.image_url ?? source?.first_frame_image ?? body?.image_paths?.[0]);
    const audio = resolveUpload(source?.audio_url ?? body?.audio_path);
    return {
      prompt: String(source?.prompt || body?.prompt || ""),
      image_paths: image ? [image] : [],
      params: {
        duration: body?.parameters?.duration ?? body?.params?.duration,
        resolution: body?.parameters?.resolution ?? body?.params?.resolution,
        shot_type: body?.parameters?.shot_type ?? body?.params?.shot_type,
        audio_path: audio
      },
      idempotency_key: body?.idempotency_key
    };
  }
  if (route.kind === "speech") {
    return {
      prompt: String(body?.text || body?.prompt || ""),
      params: { ...body },
      idempotency_key: body?.idempotency_key
    };
  }
  return {
    prompt: String(body?.prompt || ""),
    params: { ...body },
    idempotency_key: body?.idempotency_key
  };
}

export function mediaContentType(file) {
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".flac": "audio/flac", ".ogg": "audio/ogg"
  })[path.extname(String(file)).toLowerCase()] || "application/octet-stream";
}

export function formatH3Submit(route, task) {
  return route.style === "wan-v1"
    ? { output: { task_id: task.task_id } }
    : { task_id: task.task_id };
}

export function formatH3Query(route, task, mediaURL) {
  if (route.style === "wan-v1") {
    if (task.status === "succeeded") return { output: { task_status: "SUCCEEDED", video_url: mediaURL } };
    if (task.status === "failed") return { output: { task_status: "FAILED" }, message: task.error || "Local video generation failed." };
    return { output: { task_status: "RUNNING" } };
  }
  if (task.status === "succeeded") {
    const field = route.kind === "image" ? "image_url" : route.kind === "video" ? "video_url" : "audio_url";
    if (route.kind === "video") return { status: "success", file_id: task.task_id, provider_task_id: task.task_id, video_url: mediaURL, output: { task_status: "SUCCEEDED", video_url: mediaURL }, ...(task.result?.duration ? { duration: task.result.duration } : {}) };
    return { status: "success", [field]: mediaURL, ...(task.result?.duration ? { duration: task.result.duration } : {}) };
  }
  if (task.status === "failed") {
    if (route.kind === "video") return { status: "failed", output: { task_status: "FAILED" }, message: task.error || "Local video generation failed.", base: { code: task.error_code || "local_backend_error", message: task.error || "Local video generation failed." } };
    return {
      status: "failed",
      base: { code: task.error_code || "local_backend_error", message: task.error || `Local ${route.kind} generation failed.` }
    };
  }
  return route.kind === "video" ? { status: "running", output: { task_status: "RUNNING" } } : { status: "running" };
}
