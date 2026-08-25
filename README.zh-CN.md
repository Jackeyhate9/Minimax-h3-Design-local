# Minimax h3 Design local

这是 MiniMax Design 已安装桌面版的本地模型路由覆盖层。原 MiniMax Design 是带无限画布、项目/素材库、Agent、内置 Skills 与媒体创作工具的 Electron 桌面应用；本项目保留这些交互与资源，只替换模型调用边界。

本仓库**不包含或再分发** MiniMax Design 安装包、可执行文件、`app.asar`、内置 Skills 或其他专有资源。它只修改用户自己拥有的本地安装，并在修改前创建带校验值的备份，可一键恢复。

## 当前完成范围

- 保留原应用画布、资产库、项目 UI、内置 Skills 与 ComfyUI 插件。
- 将 OpenCode/Agent 的 LLM 请求切换到用户自行选择的本地 OpenAI 兼容或 Ollama 服务。
- 将图片、视频、语音、音乐等模型网关请求重定向到回环地址上的本地桥。
- 已实现与原应用一致的异步提交/查询接口，并可执行用户配置的 ComfyUI API 工作流。
- 文生图与带参考图编辑可以配置两份工作流并自动分流。
- 未配置的媒体工作流一律在本地拒绝，绝不回退云端。
- 每种媒体可使用独立 ComfyUI 地址，例如图片 `8188`、视频 `6666`。
- 每次通过本地启动器启动都会检查补丁；原应用更新覆盖文件后会先备份新版文件，再自动重新应用本地化补丁。
- 可由 `services` 配置冷启动 Ollama 与多个 ComfyUI 服务；桌面快捷方式无需预先手动打开端口。

## Windows 使用方法

需要 Node.js 20+、已安装的 MiniMax Design，以及任意本地 OpenAI 兼容或 Ollama 服务。

```powershell
Copy-Item config/local.example.json config/local.json
npm run configure
# 浏览器打开 http://127.0.0.1:17666，自行选择端点、模型和工作流。
npm run doctor -- --install-dir '<MINIMAX_DESIGN安装目录>'
npm start -- --install-dir '<MINIMAX_DESIGN安装目录>'
```

首次 `npm start` 会自动打补丁，以后每次启动都会自检并在应用更新后自动重新打补丁。必须通过该命令启动；原快捷方式不会启动本地隐私网关。

本机安装完成后可直接双击桌面的 `H3 Design Local.cmd`。它会隐藏启动控制台，依次等待 Ollama、图片 ComfyUI、H3 ComfyUI 和本地桥健康，再显示 Design 窗口；启动日志保存在 `runtime/logs/desktop-launch.log`。如系统允许保留自定义 `.lnk`，也可将该脚本封装为传统快捷方式。

配置里的 `workflow` 必须是 ComfyUI 的 API 格式 JSON，而不是仅供前端显示的画布 JSON。`inputMap` 将 H3 请求字段绑定到节点输入。详见 [用户指南](docs/USER-GUIDE.zh-CN.md)。

恢复原版：

```powershell
npm run unpatch -- --install-dir '<MINIMAX_DESIGN安装目录>'
```

## 隐私边界

本地桥只监听 `127.0.0.1`。模型服务设置只接受回环或 RFC1918 私有局域网地址。未知模型路由和未配置生成路由均被拒绝，不会代理至任何远程服务。遥测、更新检查、账号等非模型接口不属于本覆盖层的模型路由范围，仍可能使用原应用接口。

如需保留登录、会员、更新与联网项目功能，可显式开启 `network.allowNonModelCloud`。桥只代理不匹配模型路由的请求；图片、视频、音频、模型与生成路由仍强制走本地适配器。默认示例保持关闭。

## 当前测试组合

指定任务中已实测选择：Krea2 Turbo INT8 用于文生图，MageFlow Edit Turbo INT8 用于人物一致性编辑，MiniMax H3 FL2V Turbo v1.1 768p 用于首帧/首尾帧视频。仓库默认配置仍保持禁用，避免绑定维护者机器；本机 `config/local.json` 可单独启用。语音和音乐没有可复用的 ComfyUI API 工作流时保持禁用并在本地失败，不会伪装成可用或回退云端。

## 声明

MiniMax 与 MiniMax Design 商标归其权利人所有。本项目是独立兼容工具，与 MiniMax 无隶属或背书关系。
