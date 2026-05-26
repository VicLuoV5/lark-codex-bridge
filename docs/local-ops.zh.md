# Feishu Codex Bridge 本地运维说明

本文档面向 Windows 本地部署。所有示例都避免写入个人凭据；App Secret、Codex 登录态和飞书登录态只应保存在用户本机配置目录。

## 常用命令

在 PowerShell 里进入仓库：

```powershell
cd '<repo>\feishu-codex-bridge'
```

查看状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\status-local.ps1
```

启动隐藏后台进程：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\start-local.ps1
```

重启隐藏后台进程：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\start-local.ps1 -Restart
```

停止所有 bridge 进程：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\stop-local.ps1
```

## 用户登录自启动

安装当前 Windows 用户的登录自启动，不需要管理员权限：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\install-startup.ps1
```

它会在当前用户 Startup 文件夹里写入：

```text
FeishuCodexBridge.cmd
```

卸载自启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\windows\uninstall-startup.ps1
```

## Windows Helper 行为

`start-local.ps1` 会生成：

```text
%USERPROFILE%\.feishu-codex-bridge\run-bridge.cmd
```

生成的 launcher 会：

- 设置 `CODEX_HOME`。如果当前 shell 没有该变量，默认使用 `C:\CodexData`。
- 设置 `FEISHU_CODEX_WORKSPACE_ROOT` 为仓库父目录。
- 如果存在 `FEISHU_CODEX_BRIDGE_PROXY`、`HTTPS_PROXY` 或 `HTTP_PROXY`，把代理传给 bridge 和 Codex 子进程。
- bridge 异常退出时等待 60 秒再自动重启。
- bridge 正常退出时不重启。

如果你需要固定代理，建议写入用户环境变量，而不是改仓库文件：

```powershell
[Environment]::SetEnvironmentVariable(
  'FEISHU_CODEX_BRIDGE_PROXY',
  'http://127.0.0.1:<port>',
  'User'
)
```

## 端到端自测清单

1. 私聊 bot，发送 `/status`，应返回当前 cwd、agent 和 reasoning 设置。
2. 私聊发送 `/reset`，再发送 `Reply exactly OK`，应收到 Codex 正常回复。
3. 私聊发送 `/new 我的新任务`，应创建一个新群，并提示 cwd 已继承。
4. 发送 `/cd <workspace-root>\feishu-codex-bridge`，应切换成功。
5. 发送 `/ws save bridge`，再发送 `/ws list`，应看到命名工作空间。
6. 在群里 @ bot 发送简单问题，确认群里只在 @ 时响应。
7. 发送 `/resume`，确认可以列出当前 cwd 的 Codex 会话。
8. 发送一个小文本文件或截图，确认 bot 能下载并把本地路径交给 Codex。

## 日志位置

```text
%USERPROFILE%\.feishu-codex-bridge\logs\manual-stdout.log
%USERPROFILE%\.feishu-codex-bridge\logs\manual-stderr.log
%USERPROFILE%\.feishu-codex-bridge\logs\YYYY-MM-DD.log
```

如果普通问题卡在 `Thinking...`，优先查看当天结构化日志里的 `agent.stderr`、`network`、`ws` 和 `keepalive` 记录。

## Codex CLI 登录和网络

登录自启动环境不一定继承 Codex App 或当前 PowerShell 进程里的环境变量。请用 `status-local.ps1` 确认：

- `CODEX_HOME`
- `FEISHU_CODEX_WORKSPACE_ROOT`
- Codex `model`
- Codex `model_reasoning_effort`

如果 `/status` 正常但普通问题提示 agent 失败，先在项目根目录运行：

```powershell
"Reply exactly OK" | codex exec --json --sandbox workspace-write --skip-git-repo-check -
```

如果手动 Codex CLI 也失败，优先检查 Codex 登录态、模型配置和本机代理。
