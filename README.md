<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="README_CN.md">简体中文</a>
</p>

# deepseek-cache-monitor

A local reverse proxy and web dashboard for monitoring DeepSeek API cache hit rates, token usage, and costs when using Claude Code with DeepSeek's Anthropic-compatible endpoint.

## Dashboard

Visit `http://localhost:8787`:

- Stat cards: total requests, cache hit rate, cost savings (USD + CNY)
- 48-hour cache hit rate trend chart (hourly granularity, hover for details)
- Token and cost breakdown panels
- Session-grouped request table with tabs (per-session drill-down)
- Auto-captured first user message per session (hover to preview)
- Light / dark theme toggle (follows system preference, persisted)

## Architecture

```
Claude Code ──→ localhost:8787 (proxy) ──→ api.deepseek.com/anthropic
                      │
                      ├── Parse SSE stream → extract cache_read / input / output tokens
                      ├── Write SQLite (WAL mode)
                      ├── Record session_id (x-claude-code-session-id header)
                      └── Capture first user message → session-names.json

Dashboard ←── /api/* ←── SQLite (getOverallStats / getHourlySummary / getSessions / getRecentRequests)

MCP Server ←── stdio ←── same query functions (ds_cache_overview / ds_cache_recent / ds_cache_daily)
```

## Files

```
├── proxy.mjs           # HTTP reverse proxy (port 8787) + API routes + dashboard serving
├── db.mjs              # SQLite data layer (schema, queries, inserts)
├── mcp-server.mjs      # MCP stdio server (3 tools)
├── dashboard.html      # Dashboard frontend (zero-dependency, CSS custom properties theming)
├── start.sh / restart.sh  # Process management scripts
├── session-names.json  # Session → first-message mapping (auto-maintained)
└── logs/               # Daily log files, auto-cleaned after 3 days
```

## Usage

### 1. Start the proxy

```bash
npm run restart
# or: bash restart.sh
```

### 2. Configure Claude Code

In `~/.claude/settings.json`:

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

### 3. Open the dashboard

`http://localhost:8787`

### 4. (Optional) MCP integration

Add to Claude Code MCP config:

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

Then query directly in Claude Code:

- `ds_cache_overview` — overall hit rate, token usage, costs
- `ds_cache_recent` — last N request details
- `ds_cache_daily` — 30-day daily summary

## API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard HTML |
| `GET /health` | Health check |
| `GET /api/overview` | Aggregate stats (requests, hit rate, tokens, cost) |
| `GET /api/hourly?hours=48` | Hourly breakdown |
| `GET /api/daily` | Daily breakdown (30 days) |
| `GET /api/sessions` | Per-session aggregation |
| `GET /api/session-names` | Session → first message map |
| `GET /api/recent?limit=30&session=X` | Recent requests (optional session filter) |

All other paths and methods are transparently forwarded to the DeepSeek API.

## Pricing model

Based on DeepSeek official pricing (per 1M tokens):

| | USD | CNY |
|---|-----|-----|
| Input (non-cached) | $0.14 | ¥1 |
| Cache read (hit) | $0.014 | ¥0.1 |
| Output | $0.28 | ¥2 |

The dashboard displays both USD and CNY. Savings = (cost without cache) − (actual cost).

## Logs

Logs are written to `logs/proxy-YYYY-MM-DD.log`. Files older than 3 days are automatically cleaned at 1:00 AM daily, and on each restart.

## Dependencies

- Node.js ≥ 22 (uses built-in `node:sqlite`)
- `@modelcontextprotocol/sdk` (MCP server only)
- Everything else: Node built-ins (`node:http`, `node:fs`, `node:path`, `node:crypto`)

The dashboard has zero external CSS/JS dependencies — pure HTML + inline SVG charts.

## License

MIT
