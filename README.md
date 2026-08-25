# Minimax h3 Design local

Local-only model-routing overlay for the installed MiniMax Design desktop app.

This repository does **not** redistribute MiniMax Design, its binaries, `app.asar`, bundled Skills, or other proprietary assets. It patches a user-owned local installation in place, with checksummed backups and a restore command.

## Current stage

- Preserves the original canvas, asset vault, project UI, bundled Skills and ComfyUI plugin.
- Redirects OpenCode/agent LLM traffic to a user-selected local OpenAI-compatible or Ollama endpoint.
- Redirects MiniMax model-gateway traffic to a loopback-only bridge.
- Publishes local image/video/speech/music catalog entries.
- Blocks every unconfigured media route locally. There is no cloud fallback.
- Probes the configured ComfyUI API endpoint. Concrete workflow bindings are intentionally left disabled until local workflows/models are selected.

## Quick start (Windows)

Requirements: Node.js 20+, an installed copy of MiniMax Design, and a locally hosted LLM endpoint.

```powershell
Copy-Item config/local.example.json config/local.json
npm run configure
# Open http://127.0.0.1:17666 and choose endpoints/models/workflows.
npm run doctor -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
npm run patch -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
npm start -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
```

Always start the app through `npm start`; launching the original shortcut does not start the local privacy gateway.

Restore the original installation:

```powershell
npm run unpatch -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
```

## Privacy model

The local bridge binds only to `127.0.0.1`. Model-service settings accept only loopback or RFC1918 private-network URLs. Unknown and unconfigured model routes are denied; they are never proxied to a remote service. Telemetry, update checks and account features are outside this overlay's model-routing scope and may still use their original non-model endpoints.

## Next stage

Populate `media.image`, `media.video`, `media.speech` and `media.music` with concrete ComfyUI API workflow bindings. Until then, generation calls fail closed with `H3_LOCAL_BACKEND_NOT_CONFIGURED`.

## Trademark

MiniMax and MiniMax Design are trademarks of their respective owners. This independent compatibility project is not affiliated with or endorsed by MiniMax.
