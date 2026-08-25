export function ollamaProviderConfig(config) {
  const model = config.ollama.model;
  return {
    enabled_providers: ["ollama"],
    model: `ollama/${model}`,
    provider: {
      ollama: {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama Local (H3 Local)",
        options: { baseURL: config.ollama.baseURL },
        models: {
          [model]: {
            name: `${model} (Local)`,
            limit: { context: 32768, output: 8192 }
          }
        }
      }
    },
    agent_model: {
      "media-agent": `ollama/${model}`,
      image: `ollama/${model}`,
      video: `ollama/${model}`,
      speech: `ollama/${model}`,
      music: `ollama/${model}`,
      editing: `ollama/${model}`,
      "comfyui-agent": `ollama/${model}`
    }
  };
}

const select = (label, options, value) => ({
  type: "select",
  label,
  options,
  default: value
});

function mediaModel({ id, name, backend, type, tool, refs = 0, params = {} }) {
  return {
    id,
    name,
    backend,
    model_name: id,
    max_refs: refs,
    params,
    type,
    display_name: name,
    description: "Local-only placeholder routed to ComfyUI by H3 Local Bridge.",
    tool_names: [tool],
    visibility: "local",
    icon_url: "",
    hot: true
  };
}

export function localModelCatalog(config) {
  const textId = `ollama/${config.ollama.model}`;
  return {
    imageModels: [mediaModel({
      id: "gpt-image-2",
      name: "Local ComfyUI Image",
      backend: "openai",
      type: "image",
      tool: "hub_generate_image",
      refs: 16,
      params: {
        aspect_ratio: select("比例", ["1:1", "16:9", "9:16", "4:3", "3:4"], "1:1"),
        resolution: select("分辨率", ["1k", "2k", "4k"], "1k")
      }
    })],
    videoModels: [mediaModel({
      id: "wan2.6-i2v",
      name: "Local ComfyUI Video",
      backend: "wan_i2v",
      type: "video",
      tool: "hub_generate_video",
      refs: 1,
      params: {
        duration: select("时长", ["5", "10", "15"], "5"),
        resolution: select("分辨率", ["720P", "1080P"], "720P")
      }
    })],
    audioModels: [
      mediaModel({
        id: "speech-2.8-hd",
        name: "Local ComfyUI Speech",
        backend: "minimax_tts",
        type: "audio",
        tool: "hub_generate_audio_speech"
      }),
      mediaModel({
        id: "music-2.0",
        name: "Local ComfyUI Music",
        backend: "minimax_music",
        type: "audio",
        tool: "hub_generate_audio_music"
      })
    ],
    textModels: [{
      id: textId,
      name: `${config.ollama.model} (Local)`,
      provider: "ollama",
      supportsVideo: false,
      supportsAudio: false
    }],
    defaultTextModelId: textId
  };
}
