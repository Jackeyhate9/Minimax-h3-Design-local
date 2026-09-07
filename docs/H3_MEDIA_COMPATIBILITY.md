# H3 media compatibility contract

The local gateway keeps MiniMax Design's observable media API shapes while replacing model execution with user-configured local or CLI adapters.

| H3 backend | Submit | Query | Local execution |
| --- | --- | --- | --- |
| GPT Image 2 / OpenAI image | `POST /api/v2/image/openai/generate` | `GET /api/v2/image/openai/tasks/:id` | Configured ChatGPT web CLI first; ComfyUI fallback |
| Wan 2.6 I2V | `POST /api/v1/video/wan/generate` | `GET /api/v1/video/wan/tasks/:id` | Video ComfyUI workflow |
| MiniMax TTS | `POST /api/v2/audio/tts` | `GET /api/v2/audio/tts/tasks/:id` | Speech ComfyUI workflow when enabled |
| SeedAudio TTS | `POST /api/v2/audio/seedaudio/tts` | `GET /api/v2/audio/seedaudio/tts/tasks/:id` | Speech ComfyUI workflow when enabled |
| MiniMax / ElevenLabs music | `POST /api/v2/audio/music/:provider` | `GET /api/v2/audio/music/:provider/tasks/:id` | Music ComfyUI workflow when enabled |

Supporting endpoints:

- `POST /api/v1/files/upload` stores H3 data-URI uploads locally and returns a loopback URL.
- `GET /api/local/uploads/:id` serves a locally staged input.
- `GET /api/local/media/:taskId` serves a completed generated artifact.
- `GET /api/v1/models/concurrency/limits` and `POST /api/v1/models/concurrency/usage` expose the single-GPU scheduler contract.

Cloud-v2 task responses keep `task_id`, `status=running|success|failed`, and media URL fields (`image_url` or `audio_url`). Wan-v1 keeps its vendor envelope: `output.task_id`, `output.task_status`, and `output.video_url`.

The image CLI contract is deliberately command-agnostic. The configured executable receives argument templates with `{prompt}`, `{output}`, `{outputDir}`, `{size}`, and `{aspectRatio}` placeholders and must create the exact `{output}` file. A configured `referenceFlag` is repeated for every local reference image. A non-zero exit, timeout, missing file, or empty file triggers ComfyUI fallback.

The workstation profile uses `chatgpt-imagegen --backend web`, matching the earlier ToonFlow `local-vimax:chatgpt-web` route. This forces the logged-in ChatGPT browser surface and cannot silently consume a Codex/API quota. It requires a working `chrome-use` browser relay; when that prerequisite is absent or the web task fails, only the local ComfyUI fallback runs.
