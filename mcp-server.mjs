import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getOverallStats, getRecentRequests, getDailySummary } from './db.mjs';

const server = new Server(
  { name: 'deepseek-cache-monitor', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ds_cache_overview',
      description: 'Show overall DeepSeek cache hit rate, token savings, and estimated cost saved.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'ds_cache_recent',
      description: 'Show the last N requests with per-request cache hit/miss details.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Number of recent requests (default 20)' } },
      },
    },
    {
      name: 'ds_cache_daily',
      description: 'Show daily aggregated cache hit rates for the last 30 days.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case 'ds_cache_overview': {
      const stats = getOverallStats();
      return {
        content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }],
      };
    }
    case 'ds_cache_recent': {
      const rows = getRecentRequests(args?.limit || 20);
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
      };
    }
    case 'ds_cache_daily': {
      const rows = getDailySummary();
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
      };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
