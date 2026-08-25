export function localLLMProviderConfig(config) {
  const llm = config.llm;
  const model = llm.model || "local-model";
  const providerId = llm.providerId || "local";
  return {
    enabled_providers: [providerId],
    model: `${providerId}/${model}`,
    provider: {
      [providerId]: {
        npm: "@ai-sdk/openai-compatible",
        name: llm.name || "Local LLM",
        options: { baseURL: llm.baseURL },
        models: {
          [model]: {
            name: `${model} (Local)`,
            limit: { context: llm.context || 32768, output: llm.output || 8192 }
          }
        }
      }
    },
    agent_model: {
      "media-agent": `${providerId}/${model}`,
      image: `${providerId}/${model}`,
      video: `${providerId}/${model}`,
      speech: `${providerId}/${model}`,
      music: `${providerId}/${model}`,
      editing: `${providerId}/${model}`,
      "comfyui-agent": `${providerId}/${model}`
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
  const textId = `${config.llm.providerId}/${config.llm.model}`;
  const imageName = config.media.image.model ? `Local Image · ${config.media.image.model}` : "Local ComfyUI Image";
  const videoName = config.media.video.model ? `Local Video · ${config.media.video.model}` : "Local ComfyUI Video";
  const speechName = config.media.speech.model ? `Local Speech · ${config.media.speech.model}` : "Local ComfyUI Speech";
  const musicName = config.media.music.model ? `Local Music · ${config.media.music.model}` : "Local ComfyUI Music";
  return {
    imageModels: [mediaModel({
      id: "gpt-image-2",
      name: imageName,
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
      name: videoName,
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
        name: speechName,
        backend: "minimax_tts",
        type: "audio",
        tool: "hub_generate_audio_speech"
      }),
      mediaModel({
        id: "music-2.0",
        name: musicName,
        backend: "minimax_music",
        type: "audio",
        tool: "hub_generate_audio_music"
      })
    ],
    textModels: [{
      id: textId,
      name: `${config.llm.model} (Local)`,
      provider: config.llm.providerId,
      supportsVideo: false,
      supportsAudio: false
    }],
    defaultTextModelId: textId
  };
}
