#!/usr/bin/env node
import { getOverallStats, getSessionStats, getTodayStats } from './db.mjs';
import fs from 'node:fs';
import path from 'node:path';

const R = '\x1b[0m', D = '\x1b[90m', C = '\x1b[36m';
const THEME_FILE = path.join(import.meta.dirname, '.statusline-theme');

function loadTheme() {
  try { return fs.readFileSync(THEME_FILE, 'utf-8').trim(); }
  catch { return 'simple'; }
}

// Powerline arrow:  (U+E0B0) — standard in Nerd Fonts, iTerm2, Kitty, WezTerm
// Falls back to ▸ if terminal doesn't render the glyph
const PL_ARROW = '\uE0B0';

function rateColor(rate) {
  if (rate >= 95) return { c: '\x1b[32m', fg: 48, label: 'high' };
  if (rate >= 80) return { c: '\x1b[33m', fg: 228, label: 'mid' };
  return { c: '\x1b[31m', fg: 210, label: 'low' };
}

// ── Simple theme ──────────────────────────────────────────────
function renderSimple(total, today, session) {
  const segs = [];
  if (total) segs.push(`${D}total${R} ${D}hit${R} ${total.c}${total.rate}${R} ${D}cost${R} ${C}${total.cost}${R}`);
  if (today) segs.push(`${D}today${R} ${D}hit${R} ${today.c}${today.rate}${R} ${D}cost${R} ${C}${today.cost}${R}`);
  if (session) segs.push(`${D}session${R} ${D}hit${R} ${session.c}${session.rate}${R} ${D}cost${R} ${C}${session.cost}${R}`);
  return segs.length
    ? `${C}DS${R} ${D}║${R} ${segs.join(` ${D}║${R} `)} ${D}║${R}`
    : `${D}DS --${R}`;
}

// ── Powerline theme ───────────────────────────────────────────
function arrow(fromBg, toBg) {
  return `\x1b[38;5;${fromBg};48;5;${toBg}m${PL_ARROW}`;
}

function powerlineBlock(label, rate, cost, bg, fgColor) {
  const F = (n) => `\x1b[38;5;${n}m`;
  const B = (n) => `\x1b[48;5;${n}m`;
  // All items share the same background — no reset between them
  return (
    B(bg) + ' ' +
    F(15) + label + ' ' +
    F(7) + 'hit ' +
    F(fgColor) + rate + ' ' +
    F(7) + 'cost ' +
    F(fgColor) + cost + ' '
  );
}

function renderPowerline(total, today, session) {
  const totalBg = 24, todayBg = 28, sessBg = 53;  // teal · green · purple

  if (!total && !today && !session) return `${D}DS --${R}`;

  let out = `\x1b[48;5;236m \x1b[38;5;14mDS `;
  let prev = 236;

  if (total) {
    out += arrow(prev, totalBg) + powerlineBlock('total', total.rate, total.cost, totalBg, total.fg || 48);
    prev = totalBg;
  }
  if (today) {
    out += arrow(prev, todayBg) + powerlineBlock('today', today.rate, today.cost, todayBg, today.fg || 48);
    prev = todayBg;
  }
  if (session) {
    out += arrow(prev, sessBg) + powerlineBlock('session', session.rate, session.cost, sessBg, session.fg || 48);
  }
  return out + R;
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  let input = '';
  if (!process.stdin.isTTY) {
    for await (const chunk of process.stdin) input += chunk;
  }
  let sid = '';
  try { sid = JSON.parse(input || '{}').session_id || ''; } catch {}

  const totalStats = getOverallStats();
  const sessStats = sid ? getSessionStats(sid) : null;
  const todayStats = getTodayStats();

  let total = null, today = null, session = null;

  if (totalStats.totalRequests) {
    const r = parseFloat(totalStats.cacheHitRate);
    const cc = rateColor(r);
    const tCost = totalStats.cost_reset?._cny?.total || totalStats.cost_cny?.total || '¥0';
    total = { rate: totalStats.cacheHitRate, cost: tCost, c: cc.c, fg: cc.fg };
  }
  if (todayStats) {
    const cc = rateColor(todayStats.hit_rate);
    today = { rate: todayStats.hit_rate + '%', cost: todayStats.cost_cny_total, c: cc.c, fg: cc.fg };
  }
  if (sessStats && sessStats.requests > 0) {
    const cc = rateColor(sessStats.hit_rate);
    const sCost = sessStats.cost_cny_reset || sessStats.cost_cny_total;
    session = { rate: sessStats.hit_rate + '%', cost: sCost, c: cc.c, fg: cc.fg };
  }

  const theme = loadTheme();
  const out = theme === 'powerline'
    ? renderPowerline(total, today, session)
    : renderSimple(total, today, session);

  console.log(out);
}

main();
