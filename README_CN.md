# deepseek-cache-monitor

[English](README.md)

DeepSeek API 缓存命中率监控面板。本地反向代理 + Web 仪表盘，实时追踪 Claude Code 使用 DeepSeek 时的缓存命中、Token 消耗和费用。

## 仪表盘

访问 `http://localhost:8787`：

- 统计卡片：总请求数、缓存命中率、费用节省（USD / CNY 双币种）
- 48 小时缓存命中率趋势图（按小时粒度，hover 显示详情）
- Token 与费用明细面板
- 按 Session 聚合的请求表格（Tab 切换，支持按会话下钻）
- 自动捕获每个 Session 的首条用户消息（hover 预览）
- 亮色 / 暗色主题切换（跟随系统偏好，手动切换记忆）

## 架构

```
Claude Code ──→ localhost:8787 (proxy) ──→ api.deepseek.com/anthropic
                      │
                      ├── 解析 SSE 流 → 提取 cache_read / input / output tokens
                      ├── 写入 SQLite (WAL 模式)
                      ├── 记录 session_id (x-claude-code-session-id 头)
                      └── 捕获首条用户消息 → session-names.json

仪表盘 ←── /api/* ←── SQLite (getOverallStats / getHourlySummary / getSessions / getRecentRequests)

MCP Server ←── stdio ←── 同上查询函数 (ds_cache_overview / ds_cache_recent / ds_cache_daily)
```

## 文件结构

```
├── proxy.mjs           # HTTP 反向代理 (端口 8787) + API 路由 + 仪表盘服务
├── db.mjs              # SQLite 数据层 (建表 / 查询 / 写入)
├── mcp-server.mjs      # MCP stdio 服务端 (3 个工具)
├── dashboard.html      # 仪表盘前端 (零外部依赖，CSS 变量主题)
├── start.sh / restart.sh  # 进程管理脚本
├── session-names.json  # Session → 首条消息映射 (自动维护)
└── logs/               # 按天分日志文件，3 天后自动清理
```

## 使用

### 1. 启动代理

```bash
npm run restart
# 或: bash restart.sh
```

### 2. 配置 Claude Code

在 `~/.claude/settings.json` 中添加：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8787",
    "ANTHROPIC_AUTH_TOKEN": "sk-your-deepseek-api-key",
    "ANTHROPIC_MODEL": "deepseek-v4-pro[1m]",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v4-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro"
  }
}
```

### 3. 打开仪表盘

浏览器访问 `http://localhost:8787`。

### 4. （可选）配置 MCP

在 Claude Code 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "ds-cache-monitor": {
      "command": "node",
      "args": ["/path/to/ds-cache-monitor/mcp-server.mjs"]
    }
  }
}
```

之后可在 Claude Code 中直接查询：

- `ds_cache_overview` — 总缓存命中率、Token 用量、费用
- `ds_cache_recent` — 最近 N 次请求明细
- `ds_cache_daily` — 近 30 天按日汇总

## API

| 端点 | 说明 |
|------|------|
| `GET /` | 仪表盘 HTML |
| `GET /health` | 健康检查 |
| `GET /api/overview` | 总统计 (请求数、命中率、Token、费用) |
| `GET /api/hourly?hours=48` | 按小时汇总 |
| `GET /api/daily` | 按日汇总 (30 天) |
| `GET /api/sessions` | 按 Session 聚合 |
| `GET /api/session-names` | Session 首条消息映射 |
| `GET /api/recent?limit=30&session=X` | 最近请求 (可选按 session 过滤) |

其他路径和方法的请求透明转发至 DeepSeek API。

## 费用模型

基于 DeepSeek 官方定价（每百万 Token）：

| | USD | CNY |
|---|-----|-----|
| 输入（非缓存） | $0.14 | ¥1 |
| 缓存命中 | $0.014 | ¥0.1 |
| 输出 | $0.28 | ¥2 |

仪表盘同时展示 USD 和 CNY。节省金额 = 无缓存费用 − 实际费用。

## 日志

日志写入 `logs/proxy-YYYY-MM-DD.log`。每天凌晨 1:00 自动清理 3 天前的文件，重启时也会触发清理。

## 依赖

- Node.js ≥ 22（使用内置 `node:sqlite`）
- `@modelcontextprotocol/sdk`（仅 MCP server 需要）
- 其余均为 Node 内置模块（`node:http`、`node:fs`、`node:path`、`node:crypto`）

仪表盘无任何外部 CSS/JS 依赖，纯 HTML + 内联 SVG 图表。

## License

MIT
