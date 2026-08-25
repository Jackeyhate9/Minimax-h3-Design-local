# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

MiniMax Design users who want to keep its canvas, assets, projects, agents and Skills while selecting their own locally hosted models.

## Product Purpose

Provide a reversible local routing overlay and a user-owned configuration surface. Success means model content never falls back to a cloud model endpoint and users can change local providers without editing the application bundle by hand.

## Positioning

The overlay preserves the installed application and intercepts only its model-routing boundary, with local failure-closed behavior and checksummed restore points.

## Operating Context

Windows desktop, a user-owned MiniMax Design installation, local OpenAI-compatible or Ollama LLM servers, and ComfyUI API workflows for media generation.

## Capabilities and Constraints

- Model endpoints must resolve to loopback or private-network addresses.
- Unknown and unconfigured model routes are blocked rather than proxied.
- Concrete ComfyUI workflow bindings remain user-selectable and may be incomplete until the user supplies compatible workflows.
- Proprietary MiniMax binaries and Skills are never committed to this repository.

## Evidence on Hand

The target application exposes local OpenCode configuration, a local Gateway, a ComfyUI plugin, canvas materialization APIs and plaintext agent/Skill routing files. The repository contains tests for local provider configuration and failure-closed routing.

## Product Principles

- User configuration over machine-specific assumptions.
- Local by construction, not by convention.
- Preserve the application; patch the narrowest stable boundary.
- Every mutation is backed up and reversible.
