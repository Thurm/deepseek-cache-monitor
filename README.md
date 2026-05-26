<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README_CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-4ec9b0?style=flat-square&labelColor=161b22" alt="MIT"></a>
  <a href="#usage"><img src="https://img.shields.io/badge/node-%3E%3D22-4ec9b0?style=flat-square&labelColor=161b22&logo=nodedotjs&logoColor=white" alt="Node >= 22"></a>
  <a href="dashboard.html"><img src="https://img.shields.io/badge/frontend-zero%20deps-4ec9b0?style=flat-square&labelColor=161b22" alt="Zero frontend deps"></a>
</p>

<br/>

<h3 align="center">Real-time cache hit monitoring for DeepSeek API.</h3>
<p align="center">A local reverse proxy with a web dashboard — see exactly how much DeepSeek's prefix-cache is saving you, per session.</p>

<br/>

> [!TIP]
> **The dashboard shows the number that matters: cache hit rate.** DeepSeek charges $0.014/M for cached input vs $0.14/M for fresh input — a 10x difference. This project tells you which side of that equation your sessions land on.

> [!NOTE]
> **Real usage, one week:** 55M input tokens, **99.6% cache hit**, ~$0.96 instead of ~$8.94 without cache. The proxy has been running behind every Claude Code session on this machine — the dashboard shows the receipts.

<br/>

## Install

Requires Node ≥ 22 (uses built-in `node:sqlite`). Clone and start:

```bash
git clone https://github.com/Thurm/deepseek-cache-monitor.git
cd deepseek-cache-monitor
npm install        # only needs @modelcontextprotocol/sdk for MCP server
bash restart.sh    # starts proxy on :8787
```

## Usage

### 1. Point Claude Code at the proxy

In `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8787",
    "ANTHROPIC_AUTH_TOKEN": "sk-your-deepseek-api-key",
    "ANTHROPIC_MODEL": "deepseek-v4-pro[1m]"
  }
}
```

All Claude Code API traffic now flows through the proxy. Requests are forwarded to DeepSeek transparently — the proxy only observes SSE streams to extract cache metrics.

### 2. Open the dashboard

`http://localhost:8787`

Stat cards show total requests, cache hit rate, and cost savings in USD + CNY. The 48-hour hourly chart lets you hover any data point for exact numbers. The session table groups requests by `x-claude-code-session-id` — click a session tab to drill into individual requests, hover a session row to preview its first user message.

### 3. (Optional) MCP integration

Add to Claude Code's MCP config to query stats without leaving the terminal:

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

Then in any Claude Code session:

| Tool | Returns |
|------|---------|
| `ds_cache_overview` | Aggregate hit rate, token counts, USD + CNY costs |
| `ds_cache_recent` | Last N requests with per-request cache hit/miss |
| `ds_cache_daily` | 30-day daily breakdown |

<br/>

## Architecture

```
Claude Code ──→ localhost:8787 (proxy.mjs) ──→ api.deepseek.com/anthropic
                      │
                      ├── Parse SSE stream, extract token usage
                      ├── Write cache_stats.db (SQLite, WAL mode)
                      ├── Record session_id from x-claude-code-session-id header
                      └── Capture first real user message → session-names.json

Dashboard ←── /api/* ←── SQLite queries

MCP Server ←── stdio ←── same query functions
```

The proxy is a single Node process under 260 lines. It parses DeepSeek's SSE response stream to extract `cache_read_input_tokens`, `input_tokens`, `cache_creation_input_tokens`, and `output_tokens` — the same fields Anthropic's streaming API uses. Each request is logged to SQLite with its session ID, and the dashboard serves a static HTML page that fetches JSON from `/api/*` endpoints.

### What it doesn't do

- No auth, no multi-user. It listens on `localhost:8787` — same machine only.
- No persistent session storage beyond the SQLite file. Backup `cache_stats.db` if you want to keep history across machines.
- No request body logging. The proxy sees headers and token counts, not your prompts.

## Dashboard API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard HTML |
| `GET /health` | Health check — returns `{"status":"ok"}` |
| `GET /api/overview` | Aggregate: requests, hit rate, tokens, USD + CNY costs |
| `GET /api/hourly?hours=48` | Hourly breakdown with complete timeline (zero-filled gaps) |
| `GET /api/daily` | Daily breakdown, last 30 days |
| `GET /api/sessions` | Per-session aggregation (hit rate, token totals, time range) |
| `GET /api/session-names` | Session ID → first user message map |
| `GET /api/recent?limit=30&session=X` | Request-level detail, optional session filter |

All other paths and methods forward transparently to the DeepSeek API.

## Pricing model

Based on [DeepSeek API pricing](https://platform.deepseek.com/api-docs/pricing) (per 1M tokens):

| | USD | CNY |
|---|-----|-----|
| Input (cache miss) | $0.42 | ¥3.00 |
| Cache read (hit) | $0.0035 | ¥0.025 |
| Output | $0.84 | ¥6.00 |

The dashboard computes: **savings = (cost without cache) − (actual cost)**. Both currencies are shown side by side.

## Logging

Daily log files at `logs/proxy-YYYY-MM-DD.log`. Cleanup runs at 1:00 AM local time and on each restart — files older than 3 days are deleted automatically.

## License

MIT
