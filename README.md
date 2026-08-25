# Minimax h3 Design local

Local-only model-routing overlay for the installed MiniMax Design desktop app.

This repository does **not** redistribute MiniMax Design, its binaries, `app.asar`, bundled Skills, or other proprietary assets. It patches a user-owned local installation in place, with checksummed backups and a restore command.

## Current stage

- Preserves the original canvas, asset vault, project UI, bundled Skills and ComfyUI plugin.
- Redirects OpenCode/agent LLM traffic to local Ollama.
- Redirects MiniMax model-gateway traffic to a loopback-only bridge.
- Publishes local image/video/speech/music catalog entries.
- Blocks every unconfigured media route locally. There is no cloud fallback.
- Probes the configured ComfyUI API endpoint. Concrete workflow bindings are intentionally left disabled until local workflows/models are selected.

## Quick start (Windows)

Requirements: Node.js 20+, an installed copy of MiniMax Design, and Ollama.

```powershell
Copy-Item config/local.example.json config/local.json
npm run doctor -- --install-dir 'D:\AI\gongzuoliu\H3 design\MiniMax Design'
npm run patch -- --install-dir 'D:\AI\gongzuoliu\H3 design\MiniMax Design' --model 'qwen3.8:latest'
npm start -- --install-dir 'D:\AI\gongzuoliu\H3 design\MiniMax Design'
```

Always start the app through `npm start`; launching the original shortcut does not start the local privacy gateway.

Restore the original installation:

```powershell
npm run unpatch -- --install-dir 'D:\AI\gongzuoliu\H3 design\MiniMax Design'
```

## Privacy model

The local bridge binds only to `127.0.0.1`. Unknown and unconfigured model routes are denied; they are never proxied to a remote service. Telemetry, update checks and account features are outside this overlay's model-routing scope and may still use their original non-model endpoints.

## Next stage

Populate `media.image`, `media.video`, `media.speech` and `media.music` with concrete ComfyUI API workflow bindings. Until then, generation calls fail closed with `H3_LOCAL_BACKEND_NOT_CONFIGURED`.

## Trademark

MiniMax and MiniMax Design are trademarks of their respective owners. This independent compatibility project is not affiliated with or endorsed by MiniMax.
