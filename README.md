# Minimax h3 Design local

Local-only model-routing overlay for the installed MiniMax Design desktop app. The original app is an Electron creative workspace with an infinite canvas, projects/assets, agents, bundled Skills, and media tools; this overlay preserves that surface and replaces only the model boundary.

This repository does **not** redistribute MiniMax Design, its binaries, `app.asar`, bundled Skills, or other proprietary assets. It patches a user-owned local installation in place, with checksummed backups and a restore command.

## Current stage

- Preserves the original canvas, asset vault, project UI, bundled Skills and ComfyUI plugin.
- Redirects OpenCode/agent LLM traffic to a user-selected local OpenAI-compatible or Ollama endpoint.
- Redirects MiniMax model-gateway traffic to a loopback-only bridge.
- Implements the app's async media submit/query contract and runs user-supplied ComfyUI API workflows.
- Supports separate ComfyUI endpoints per media kind and automatic text-to-image versus reference-edit workflow selection.
- Blocks every unconfigured media route locally. There is no cloud fallback.
- Re-checks the patch on every launch and automatically reapplies it, with a new backup, when an app update replaces patched files.

## Quick start (Windows)

Requirements: Node.js 20+, an installed copy of MiniMax Design, and a locally hosted LLM endpoint.

```powershell
Copy-Item config/local.example.json config/local.json
npm run configure
# Open http://127.0.0.1:17666 and choose endpoints/models/workflows.
npm run doctor -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
npm start -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
```

The first `npm start` patches automatically. Always start through this launcher; the original shortcut does not start the local privacy gateway.

On the configured Windows machine, the desktop `H3 Design Local.cmd` runs `scripts/start-minimax-design-local.ps1`, cold-starts configured local services, waits for health checks, and then opens the app. Logs are written to `runtime/logs/desktop-launch.log`.

Restore the original installation:

```powershell
npm run unpatch -- --install-dir '<MINIMAX_DESIGN_INSTALL_DIR>'
```

## Privacy model

The local bridge binds only to `127.0.0.1`. Model-service settings accept only loopback or RFC1918 private-network URLs. Unknown and unconfigured model routes are denied; they are never proxied to a remote service. Telemetry, update checks and account features are outside this overlay's model-routing scope and may still use their original non-model endpoints.

The tested local profile uses Krea2 Turbo INT8 for text-to-image, MageFlow Edit Turbo INT8 for identity-preserving edits, and MiniMax H3 FL2V Turbo v1.1 768p for first/last-frame video. Repository defaults remain disabled and machine-neutral. Speech and music stay unavailable until the user supplies compatible ComfyUI API workflows; they never fall back to cloud services.

## Trademark

MiniMax and MiniMax Design are trademarks of their respective owners. This independent compatibility project is not affiliated with or endorsed by MiniMax.
