# Minimax h3 Design local

这是 MiniMax Design 已安装桌面版的“本地模型路由覆盖层”。

本仓库**不包含或再分发** MiniMax Design 安装包、可执行文件、`app.asar`、内置 Skills 或其他专有资源。它只修改用户自己拥有的本地安装，并在修改前创建带校验值的备份，可一键恢复。

## 当前完成范围

- 保留原应用画布、资产库、项目 UI、内置 Skills 与 ComfyUI 插件。
- 将 OpenCode/Agent 的 LLM 请求切换到用户自行选择的本地 OpenAI 兼容或 Ollama 服务。
- 将图片、视频、语音、音乐等模型网关请求重定向到回环地址上的本地桥。
- 向应用提供本地图片、视频、语音、音乐模型目录。
- 未配置的媒体工作流一律在本地拒绝，绝不回退云端。
- 检查配置的 ComfyUI API 是否在线；具体 workflow 绑定待后续选择本地模型后配置。

## Windows 使用方法

需要 Node.js 20+、已安装的 MiniMax Design，以及任意本地 OpenAI 兼容或 Ollama 服务。

```powershell
Copy-Item config/local.example.json config/local.json
npm run configure
# 浏览器打开 http://127.0.0.1:17666，自行选择端点、模型和工作流。
npm run doctor -- --install-dir '<MINIMAX_DESIGN安装目录>'
npm run patch -- --install-dir '<MINIMAX_DESIGN安装目录>'
npm start -- --install-dir '<MINIMAX_DESIGN安装目录>'
```

以后必须通过 `npm start` 启动；原快捷方式不会自动启动本地隐私网关。

恢复原版：

```powershell
npm run unpatch -- --install-dir '<MINIMAX_DESIGN安装目录>'
```

## 隐私边界

本地桥只监听 `127.0.0.1`。模型服务设置只接受回环或 RFC1918 私有局域网地址。未知模型路由和未配置生成路由均被拒绝，不会代理至任何远程服务。遥测、更新检查、账号等非模型接口不属于本覆盖层的模型路由范围，仍可能使用原应用接口。

## 下一阶段

后续根据本机实际模型，为 `media.image`、`media.video`、`media.speech` 和 `media.music` 配置具体 ComfyUI API workflow。配置前生成请求会以 `H3_LOCAL_BACKEND_NOT_CONFIGURED` 失败关闭。

## 声明

MiniMax 与 MiniMax Design 商标归其权利人所有。本项目是独立兼容工具，与 MiniMax 无隶属或背书关系。
