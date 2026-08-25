# 用户指南

## 本项目与原 MiniMax Design 的关系

原应用负责画布、项目、资产库、Agent、Skills、文件读写和桌面交互。本项目不复制这些专有内容，而是在用户已有安装上修改 Gateway 地址及 OpenCode 模型配置。卸载补丁即可恢复备份。

## 配置模型

1. 复制 `config/local.example.json` 为 `config/local.json`。
2. 运行 `npm run configure`，打开 `http://127.0.0.1:17666`。
3. 选择本地 Ollama/OpenAI 兼容模型。
4. 为媒体填写 ComfyUI API 工作流绝对路径；每项可设置自己的 `baseURL`。
5. `inputMap` 的每项包含 `node`、`input` 和 `from`。`from` 是 H3 请求字段候选列表；可选 `upload: image`、`required: true` 以及 `aspectRatio`、`number`、`filenamePrefix` 转换。

示例：

```json
{
  "prompt": { "node": "42", "input": "text", "from": ["prompt"], "required": true },
  "reference": { "node": "7", "input": "image", "from": ["image_paths.0"], "upload": "image" }
}
```

图片配置可额外提供 `editWorkflow` 与 `editInputMap`。请求包含 `image_paths` 时自动使用编辑工作流，否则使用文生图工作流。

## 启动与更新

```powershell
npm run doctor -- --install-dir '<安装目录>'
npm start -- --install-dir '<安装目录>'
```

`start` 会自动执行以下操作：检查安装结构、在需要时创建校验备份并打补丁、刷新所有 Agent 的本地 LLM 配置、启动仅监听 `127.0.0.1` 的桥、最后启动原应用。应用更新后仍使用同一命令即可自动重补丁；若新版结构不兼容，会在写入前停止并报错。

`services` 数组可配置需要冷启动的本地服务，每项使用直接可执行文件、参数、工作目录、健康检查 URL 与等待时间。启动器只接受本地/私网健康检查地址。桌面脚本为 `scripts/start-minimax-design-local.ps1`。

## 隐私与故障处理

- 本地设置拒绝公网模型 URL。
- 未配置或禁用的模型不会出现在本地目录。
- 未知路由返回 `H3_CLOUD_ROUTE_BLOCKED`。
- 模型内容路由始终本地化。开启 `network.allowNonModelCloud` 后，账号、更新、会员与其他非模型请求可代理至原官方 Design 域名；关闭后未知云路由继续失败关闭。
- 恢复：`npm run unpatch -- --install-dir '<安装目录>'`。
