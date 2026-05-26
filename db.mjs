import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fs from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'cache_stats.db');
const RESETS_PATH = join(__dirname, 'cost-resets.json');

export function loadResets() {
  try { return JSON.parse(fs.readFileSync(RESETS_PATH, 'utf-8')); }
  catch { return {}; }
}

export function saveReset(sessionId) {
  const r = loadResets();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  r[sessionId || '_all'] = now;
  fs.writeFileSync(RESETS_PATH, JSON.stringify(r));
  return r;
}

let db;

export function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`PRAGMA journal_mode=WAL`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT (datetime('now', 'localtime')),
        session_id TEXT DEFAULT '',
        model TEXT DEFAULT '',
        cache_hit_tokens INTEGER DEFAULT 0,
        cache_miss_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0
      )
    `);
    // Ensure all expected columns exist (migration for tables created before the column was added)
    const cols = db.prepare("PRAGMA table_info('requests')").all().map(r => r.name);
    const expected = ['session_id'];
    for (const col of expected) {
      if (!cols.includes(col)) {
        db.exec(`ALTER TABLE requests ADD COLUMN ${col} TEXT DEFAULT ''`);
      }
    }
  }
  return db;
}

export function insertRequest(usage, model, sessionId) {
  const d = getDb();
  const hit = usage.cache_read_input_tokens || 0;
  const miss = usage.input_tokens || 0;
  const write = usage.cache_creation_input_tokens || 0;
  const output = usage.output_tokens || 0;

  d.prepare(`
    INSERT INTO requests (session_id, model, cache_hit_tokens, cache_miss_tokens, cache_write_tokens, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId ?? '', model ?? '', hit, miss, write, hit + miss, output);
}

export function getOverallStats() {
  const d = getDb();
  const row = d.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(cache_hit_tokens) as total_hit,
      SUM(cache_miss_tokens) as total_miss,
      SUM(cache_write_tokens) as total_write,
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output
    FROM requests WHERE session_id != ''
  `).get();

  if (!row || row.total_requests === 0) {
    return { totalRequests: 0, message: 'No data yet. Make some API calls first.' };
  }

  const totalHit = row.total_hit;
  const totalMiss = row.total_miss;
  const totalWrite = row.total_write;
  const totalOutput = row.total_output;
  const totalCached = totalHit + totalMiss;
  const hitRate = totalCached > 0 ? (totalHit / totalCached * 100).toFixed(1) : '0.0';

  const cost = computeCost(totalHit, totalMiss, totalOutput);

  // Reset-aware cost: only count requests after reset timestamp
  const resets = loadResets();
  let costReset = null;
  if (resets._all) {
    const rr = d.prepare(`SELECT SUM(cache_hit_tokens) as hit, SUM(cache_miss_tokens) as miss, SUM(output_tokens) as output FROM requests WHERE session_id != '' AND timestamp >= ?`).get(resets._all);
    if (rr && (rr.hit || rr.miss)) costReset = computeCost(rr.hit || 0, rr.miss || 0, rr.output || 0);
  }

  return {
    totalRequests: row.total_requests,
    cacheHitRate: `${hitRate}%`,
    tokens: { hit: totalHit, miss: totalMiss, write: totalWrite, input: totalHit + totalMiss, output: totalOutput },
    cost,
    cost_cny: cost._cny,
    cost_reset: costReset ? { ...costReset, _cny: costReset._cny } : null,
    hasReset: !!resets._all,
  };
}

export function computeCost(hit, miss, output) {
  const inputPrice = 0.14, cachedPrice = 0.014, outputPrice = 0.28;
  const inputPriceCNY = 1, cachedPriceCNY = 0.1, outputPriceCNY = 2;
  const missCost = (miss * inputPrice) / 1_000_000;
  const hitCost = (hit * cachedPrice) / 1_000_000;
  const outputCost = (output * outputPrice) / 1_000_000;
  const totalCost = missCost + hitCost + outputCost;
  const costWithoutCache = missCost + (hit * inputPrice) / 1_000_000 + outputCost;
  const savings = costWithoutCache - totalCost;
  const missCostCNY = (miss * inputPriceCNY) / 1_000_000;
  const hitCostCNY = (hit * cachedPriceCNY) / 1_000_000;
  const outputCostCNY = (output * outputPriceCNY) / 1_000_000;
  const totalCostCNY = missCostCNY + hitCostCNY + outputCostCNY;
  const costWithoutCacheCNY = missCostCNY + (hit * inputPriceCNY) / 1_000_000 + outputCostCNY;
  const savingsCNY = costWithoutCacheCNY - totalCostCNY;
  return {
    miss: `$${missCost.toFixed(4)}`, hit: `$${hitCost.toFixed(4)}`, output: `$${outputCost.toFixed(4)}`,
    total: `$${totalCost.toFixed(4)}`, withoutCache: `$${costWithoutCache.toFixed(4)}`, savings: `$${savings.toFixed(4)}`,
    _cny: {
      miss: `¥${missCostCNY.toFixed(4)}`, hit: `¥${hitCostCNY.toFixed(4)}`, output: `¥${outputCostCNY.toFixed(4)}`,
      total: `¥${totalCostCNY.toFixed(4)}`, withoutCache: `¥${costWithoutCacheCNY.toFixed(4)}`, savings: `¥${savingsCNY.toFixed(4)}`,
    },
  };
}

export function getRecentRequests(limit = 20, sessionId = null, offset = 0) {
  const d = getDb();
  if (sessionId) {
    return d.prepare(`
      SELECT * FROM requests WHERE session_id = ? ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset);
  }
  return d.prepare(`
    SELECT * FROM requests WHERE session_id != '' ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

export function getTodayStats() {
  const d = getDb();
  const row = d.prepare(`SELECT SUM(cache_hit_tokens) as hit, SUM(cache_miss_tokens) as miss, SUM(output_tokens) as output FROM requests WHERE session_id != '' AND date(timestamp) = date('now', 'localtime')`).get();
  if (!row || (!row.hit && !row.miss)) return null;
  const total = (row.hit || 0) + (row.miss || 0);
  const rate = total > 0 ? Math.round((row.hit || 0) / total * 1000) / 10 : 0;
  const cost = computeCost(row.hit || 0, row.miss || 0, row.output || 0);
  return { hit_rate: rate, cost_cny_total: cost._cny.total };
}

export function getSessionStats(sessionId) {
  const d = getDb();
  const row = d.prepare(`SELECT COUNT(*) as requests, SUM(cache_hit_tokens) as hit, SUM(cache_miss_tokens) as miss, SUM(output_tokens) as output FROM requests WHERE session_id = ?`).get(sessionId);
  if (!row || row.requests === 0) return null;
  const total = row.hit + row.miss;
  const rate = total > 0 ? Math.round(row.hit / total * 1000) / 10 : 0;
  const cost = computeCost(row.hit || 0, row.miss || 0, row.output || 0);
  // Reset-aware
  const resets = loadResets();
  const since = resets[sessionId] || resets._all || null;
  let costReset = null;
  if (since) {
    const rr = d.prepare(`SELECT SUM(cache_hit_tokens) as hit, SUM(cache_miss_tokens) as miss, SUM(output_tokens) as output FROM requests WHERE session_id = ? AND timestamp >= ?`).get(sessionId, since);
    if (rr && (rr.hit || rr.miss)) costReset = computeCost(rr.hit || 0, rr.miss || 0, rr.output || 0);
  }
  return {
    requests: row.requests,
    hit_rate: rate,
    cost_cny_total: cost._cny.total,
    cost_cny_reset: costReset ? costReset._cny.total : null,
  };
}

export function getSessions(limit = 20) {
  const d = getDb();
  const rows = d.prepare(`
    SELECT
      session_id,
      COUNT(*) as requests,
      SUM(cache_hit_tokens) as hit,
      SUM(cache_miss_tokens) as miss,
      SUM(output_tokens) as output,
      ROUND(CAST(SUM(cache_hit_tokens) AS REAL) / MAX(SUM(cache_hit_tokens) + SUM(cache_miss_tokens), 1) * 100, 1) as hit_rate,
      MIN(timestamp) as first_seen,
      MAX(timestamp) as last_seen
    FROM requests
    WHERE session_id != ''
    GROUP BY session_id
    ORDER BY last_seen DESC
    LIMIT ?
  `).all(limit);
  return rows;
}

export function getHourlySummary(hours = 48) {
  const d = getDb();
  return d.prepare(`
    WITH RECURSIVE hours(slot) AS (
      SELECT strftime('%Y-%m-%dT%H:00', datetime('now', 'localtime', '-' || ? || ' hours'))
      UNION ALL
      SELECT strftime('%Y-%m-%dT%H:00', datetime(slot, '+1 hour'))
      FROM hours
      WHERE slot < strftime('%Y-%m-%dT%H:00', datetime('now', 'localtime'))
    )
    SELECT
      h.slot as hour,
      COALESCE(COUNT(r.id), 0) as requests,
      COALESCE(SUM(r.cache_hit_tokens), 0) as hit,
      COALESCE(SUM(r.cache_miss_tokens), 0) as miss,
      ROUND(CAST(COALESCE(SUM(r.cache_hit_tokens), 0) AS REAL) / MAX(COALESCE(SUM(r.cache_hit_tokens), 0) + COALESCE(SUM(r.cache_miss_tokens), 0), 1) * 100, 1) as rate
    FROM hours h
    LEFT JOIN requests r ON strftime('%Y-%m-%dT%H:00', r.timestamp) = h.slot
    GROUP BY h.slot
    ORDER BY h.slot ASC
  `).all(String(hours));
}

export function getDailySummary() {
  const d = getDb();
  return d.prepare(`
    SELECT
      date(timestamp) as day,
      COUNT(*) as requests,
      SUM(cache_hit_tokens) as hit,
      SUM(cache_miss_tokens) as miss,
      ROUND(CAST(SUM(cache_hit_tokens) AS REAL) / MAX(SUM(cache_hit_tokens) + SUM(cache_miss_tokens), 1) * 100, 1) as rate
    FROM requests
    GROUP BY date(timestamp)
    ORDER BY day DESC
    LIMIT 30
  `).all();
}
