import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { insertRequest, getOverallStats, getRecentRequests, getDailySummary, getHourlySummary, getSessions, loadResets, saveReset } from './db.mjs';

const DASHBOARD_PATH = path.join(import.meta.dirname, 'dashboard.html');
const SESSION_NAMES_PATH = path.join(import.meta.dirname, 'session-names.json');

function loadSessionNames() {
  try { return JSON.parse(fs.readFileSync(SESSION_NAMES_PATH, 'utf-8')); }
  catch { return {}; }
}
function saveSessionName(sid, text) {
  const names = loadSessionNames();
  if (names[sid]) return;
  names[sid] = text;
  fs.writeFileSync(SESSION_NAMES_PATH, JSON.stringify(names));
}

const PID_FILE = path.join(import.meta.dirname, 'proxy.pid');
fs.writeFileSync(PID_FILE, String(process.pid));
process.on('exit', () => { try { fs.unlinkSync(PID_FILE); } catch {} });

const DEEPSEEK_BASE = 'https://api.deepseek.com/anthropic';
const PORT = 8787;

function sessionFingerprint(body) {
  if (!body) return '';
  try {
    const obj = JSON.parse(body.toString());
    const msgs = obj.messages || [];
    // Use first 2 user messages + system as session fingerprint
    const key = msgs.slice(0, 4).map(m => `${m.role}:${(m.content||'').slice(0, 80)}`).join('|');
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  } catch {
    return '';
  }
}

function pickHeaders(incoming) {
  const keep = ['content-type', 'authorization', 'anthropic-version', 'anthropic-beta', 'x-api-key'];
  const out = {};
  for (const k of keep) {
    if (incoming[k]) out[k] = incoming[k];
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

function extractUsage(text) {
  const usage = {};
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      const u =
        obj.usage ||
        obj.message?.usage ||
        obj.delta?.usage ||
        obj.result?.usage ||
        {};
      if (Object.keys(u).length > 0) console.log('[usage-raw]', JSON.stringify(u));
      for (const [k, v] of Object.entries(u)) {
        if (typeof v === 'number') usage[k] = v;
      }
      const model =
        obj.model || obj.message?.model || '';
      if (model) usage._model = model;
    } catch {}
  }
  return usage;
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleOverview(res) {
  try { sendJSON(res, getOverallStats()); }
  catch (e) { sendJSON(res, { error: e.message }, 500); }
}

function handleResetCost(res, url) {
  try {
    const sid = url.searchParams.get('session') || '_all';
    const r = saveReset(sid);
    sendJSON(res, { ok: true, reset: r });
  } catch (e) { sendJSON(res, { error: e.message }, 500); }
}

function handleRecent(res, url) {
  try {
    const sid = url.searchParams.get('session') || null;
    const limit = parseInt(url.searchParams.get('limit')) || 20;
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    sendJSON(res, getRecentRequests(limit, sid, offset));
  } catch (e) { sendJSON(res, { error: e.message }, 500); }
}

function handleSessions(res) {
  try { sendJSON(res, getSessions(50)); }
  catch (e) { sendJSON(res, { error: e.message }, 500); }
}

function handleDaily(res) {
  try { sendJSON(res, getDailySummary()); }
  catch (e) { sendJSON(res, { error: e.message }, 500); }
}

function handleHourly(res, url) {
  try { sendJSON(res, getHourlySummary(parseInt(url.searchParams.get('hours')) || 48)); }
  catch (e) { sendJSON(res, { error: e.message }, 500); }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    const u = new URL(req.url, 'http://localhost');
    const path = u.pathname;

    if (path === '/') {
      try {
        const html = fs.readFileSync(DASHBOARD_PATH, 'utf-8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch { res.writeHead(500); res.end('dashboard not found'); }
      return;
    }
    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (path === '/api/overview') { handleOverview(res); return; }
    if (path === '/api/reset-cost') { handleResetCost(res, u); return; }
    if (path === '/api/recent')   { handleRecent(res, u); return; }
    if (path === '/api/daily')    { handleDaily(res); return; }
    if (path === '/api/hourly')   { handleHourly(res, u); return; }
    if (path === '/api/sessions') { handleSessions(res); return; }
    if (path === '/api/session-names') { sendJSON(res, loadSessionNames()); return; }
  }

  const target = `${DEEPSEEK_BASE}${req.url}`;
  const body = await readBody(req);
  // TEMP: dump all headers to find session identifier
  console.log('[all-headers]', JSON.stringify(req.headers));
  const headers = pickHeaders(req.headers);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
    });
  } catch (err) {
    console.error(`[ds-proxy] fetch error: ${err.message}`);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'upstream unreachable' }));
    return;
  }

  // Copy status & headers
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers));

  if (!upstream.body) {
    res.end();
    return;
  }

  // Stream body, collecting SSE data lines for usage parsing
  let collected = '';
  const reader = upstream.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
      collected += new TextDecoder().decode(value, { stream: true });
    }
  } catch (err) {
    console.error(`[ds-proxy] stream error: ${err.message}`);
  } finally {
    res.end();
    reader.releaseLock?.();
  }

  // Parse and save usage
  const usage = extractUsage(collected);
  if (Object.keys(usage).length > 1) {
    const model = usage._model || '';
    const sid = req.headers['x-claude-code-session-id'] || '';
    delete usage._model;
    insertRequest(usage, model, sid);
    if (sid && body) {
      try {
        const obj = JSON.parse(body.toString());
        const msgs = obj.messages || [];
        // Find last non-system user message — captures the actual user intent at session start
        const isSystemText = (t) => {
          if (!t || t.length <= 10) return true;
          if (t.startsWith('<') || t.startsWith('[')) return true;
          if (t.startsWith('Base directory for this skill')) return true;
          if (t.startsWith('This session is being continued')) return true;
          if (t.startsWith('# ') && t.length > 30) return true; // markdown doc headers
          return false;
        };
        const isReal = (m) => {
          if (m.role !== 'user') return false;
          if (typeof m.content === 'string') return !isSystemText(m.content);
          if (Array.isArray(m.content)) return m.content.some(b => b.text && !isSystemText(b.text));
          return false;
        };
        const realUser = msgs.find(isReal);
        if (realUser) {
          let text = '';
          if (typeof realUser.content === 'string') {
            text = realUser.content;
          } else if (Array.isArray(realUser.content)) {
            text = realUser.content.filter(b => b.text && !b.text.startsWith('<')).map(b => b.text).join(' ').trim();
          }
          if (text) saveSessionName(sid, text.slice(0, 120));
        }
        console.log('[session-debug]', sid.slice(0,12), msgs.length, 'msgs first3:', msgs.slice(0,3).map(m => ({role:m.role,type:typeof m.content,preview:typeof m.content==='string'?m.content.slice(0,60):Array.isArray(m.content)?m.content.slice(0,2).map(b=>({type:b.type,t:b.text?.slice(0,40)})):'other'})));
        console.log('[session-debug]', 'found:', !!realUser, realUser ? 'preview:'+ (typeof realUser.content==='string'?realUser.content.slice(0,80):'[array]') : '');
      } catch (e) { console.log('[session-err]', e.message); }
    }
  }
});

server.listen(PORT, () => {
  console.log(`[deepseek-cache-monitor] proxy on http://localhost:${PORT}`);
  console.log(`[deepseek-cache-monitor] forwarding → ${DEEPSEEK_BASE}`);
});

// Clean logs older than 3 days, every day at 1:00 AM local
const LOGS_DIR = path.join(import.meta.dirname, 'logs');
function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOGS_DIR);
    const cutoff = Date.now() - 3 * 86400_000;
    for (const f of files) {
      if (!f.startsWith('proxy-')) continue;
      const fp = path.join(LOGS_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) {
        fs.unlinkSync(fp);
        console.log(`[deepseek-cache-monitor] cleaned old log: ${f}`);
      }
    }
  } catch {}
}
function scheduleDaily(hour, minute, fn) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  setTimeout(() => { fn(); setInterval(fn, 86400_000); }, ms);
}
scheduleDaily(1, 0, cleanOldLogs);
