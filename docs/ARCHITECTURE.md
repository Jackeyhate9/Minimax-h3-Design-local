# Localisation architecture

```text
MiniMax Design canvas / agents / bundled Skills
                    |
          original local Gateway contract
                    |
        H3 Local Bridge (127.0.0.1:17666)
          |                         |
 local OpenAI-compatible LLM   async media tasks
                                    |
                     user-configured ComfyUI APIs
```

The patch changes two boundaries only: the Gateway base URL and OpenCode provider/model definitions. The bridge implements the original `/api/generate/{kind}/submit` plus `/api/generate/tasks/{id}/query` protocol. It uploads reference images, injects request values into API-format workflows, submits `/prompt`, polls `/history`, downloads `/view` outputs, and returns local absolute paths.

Unknown routes are denied. The repository contains no MiniMax binaries, Skills, user projects, model weights, or machine-specific active configuration.
