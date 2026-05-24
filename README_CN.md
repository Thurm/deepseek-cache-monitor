<p align="center">
  <a href="README.md">English</a>
  &nbsp;·&nbsp;
  <strong>简体中文</strong>
</p>

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-4ec9b0?style=flat-square&labelColor=161b22" alt="MIT"></a>
  <a href="#usage"><img src="https://img.shields.io/badge/node-%3E%3D22-4ec9b0?style=flat-square&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="Node >= 22"></a>
  <a href="dashboard.html"><img src="https://img.shields.io/badge/前端-零依赖-4ec9b0?style=flat-square&labelColor=161b22" alt="零前端依赖"></a>
</p>

<br/>

<h3 align="center">DeepSeek API 缓存命中实时监控</h3>
<p align="center">本地反向代理 + Web 仪表盘 — 直观看到 DeepSeek 前缀缓存为你节省了多少费用，精确到每个 Session。</p>

<br/>

> [!TIP]
> **仪表盘的核心指标：缓存命中率。** DeepSeek 对缓存命中的输入仅收费 ¥0.1/M，而非缓存输入收费 ¥1/M — 相差 10 倍。这个项目告诉你每个 Session 落在等式的哪一边。

> [!NOTE]
> **实际使用一周数据：** 5500 万输入 Token，**99.6% 缓存命中**，实际花费 ~¥6.86，无缓存费用 ~¥63.83。Proxy 一直运行在本机所有 Claude Code 会话背后，仪表盘记录着每一笔账。

<br/>

## 安装

需要 Node ≥ 22（使用内置 `node:sqlite`）：

```bash
git clone https://github.com/Thurm/deepseek-cache-monitor.git
cd deepseek-cache-monitor
npm install        # 仅 MCP server 需要 @modelcontextprotocol/sdk
bash restart.sh    # 启动代理，监听 :8787
```

## 使用

### 1. 将 Claude Code 指向代理

编辑 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8787",
    "ANTHROPIC_AUTH_TOKEN": "sk-your-deepseek-api-key",
    "ANTHROPIC_MODEL": "deepseek-v4-pro[1m]"
  }
}
```

所有 Claude Code API 流量现在经过代理。请求透明转发到 DeepSeek — 代理仅观察 SSE 流以提取缓存指标。

### 2. 打开仪表盘

`http://localhost:8787`

统计卡片展示总请求数、缓存命中率和费用节省（USD + CNY）。48 小时按小时趋势图可悬停查看精确数值。Session 表格按 `x-claude-code-session-id` 分组 — 点击 Session Tab 查看单次请求明细，悬停 Session 行预览首条用户消息。

### 3. （可选）MCP 集成

在 Claude Code MCP 配置中添加，无需离开终端即可查询统计数据：

```json
{
  "mcpServers": {
    "deepseek-cache-monitor": {
      "command": "node",
      "args": ["/path/to/deepseek-cache-monitor/mcp-server.mjs"]
    }
  }
}
```

之后在 Claude Code 中直接查询：

| 工具 | 返回 |
|------|------|
| `ds_cache_overview` | 总命中率、Token 数量、USD + CNY 费用 |
| `ds_cache_recent` | 最近 N 次请求明细 |
| `ds_cache_daily` | 30 天按日汇总 |

<br/>

## 架构

```
Claude Code ──→ localhost:8787 (proxy.mjs) ──→ api.deepseek.com/anthropic
                      │
                      ├── 解析 SSE 流，提取 Token 用量
                      ├── 写入 cache_stats.db (SQLite, WAL 模式)
                      ├── 从 x-claude-code-session-id 头记录 session_id
                      └── 捕获首条真实用户消息 → session-names.json

仪表盘 ←── /api/* ←── SQLite 查询

MCP Server ←── stdio ←── 相同查询函数
```

整个代理是单个 Node 进程，不到 260 行。解析 DeepSeek 的 SSE 响应流，提取 `cache_read_input_tokens`、`input_tokens`、`cache_creation_input_tokens` 和 `output_tokens`。每次请求连同 session ID 写入 SQLite，仪表盘提供静态 HTML 页面，从 `/api/*` 端点获取 JSON 数据。

### 不做的事

- 无认证、无多用户。监听 `localhost:8787` — 仅本机访问。
- SQLite 之外无持久化。如需跨机器保留历史，备份 `cache_stats.db` 即可。
- 不记录请求体。代理只看到请求头和 Token 计数，不会看到你的提示词。

## 仪表盘 API

| 端点 | 说明 |
|------|------|
| `GET /` | 仪表盘 HTML |
| `GET /health` | 健康检查 — 返回 `{"status":"ok"}` |
| `GET /api/overview` | 总览：请求数、命中率、Token、USD + CNY 费用 |
| `GET /api/hourly?hours=48` | 按小时汇总（完整时间线，空时段填零） |
| `GET /api/daily` | 按日汇总，近 30 天 |
| `GET /api/sessions` | 按 Session 聚合（命中率、Token 总量、时间范围） |
| `GET /api/session-names` | Session ID → 首条用户消息映射 |
| `GET /api/recent?limit=30&session=X` | 请求级详情，可选按 Session 过滤 |

其他路径和方法透明转发至 DeepSeek API。

## 费用模型

基于 [DeepSeek API 定价](https://platform.deepseek.com/api-docs/pricing)（每百万 Token）：

| | USD | CNY |
|---|-----|-----|
| 输入（缓存未命中） | $0.14 | ¥1.00 |
| 缓存读取（命中） | $0.014 | ¥0.10 |
| 输出 | $0.28 | ¥2.00 |

仪表盘计算公式：**节省金额 = 无缓存费用 − 实际费用**。两种货币并排显示。

## 日志

按天写入 `logs/proxy-YYYY-MM-DD.log`。每天凌晨 1:00 和每次重启时自动清理 3 天前的文件。

## License

MIT
