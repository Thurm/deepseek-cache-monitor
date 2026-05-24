#!/usr/bin/env node
import { getOverallStats, getSessionStats } from './db.mjs';
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
function renderSimple(total, session) {
  const segs = [];
  if (total) {
    segs.push(`${D}total${R} ${D}hit${R} ${total.c}${total.rate}${R} ${D}cost${R} ${C}${total.cost}${R}`);
  }
  if (session) {
    segs.push(`${D}session${R} ${D}hit${R} ${session.c}${session.rate}${R} ${D}cost${R} ${C}${session.cost}${R}`);
  }
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

function renderPowerline(total, session) {
  const totalBg = 24, sessBg = 53;  // teal · purple

  if (!total && !session) return `${D}DS --${R}`;

  // DS label block
  let out = `\x1b[48;5;236m \x1b[38;5;14mDS `;

  if (total) {
    out += arrow(236, totalBg) + powerlineBlock('total', total.rate, total.cost, totalBg, total.fg || 48);
  }
  if (session) {
    if (total) out += arrow(totalBg, sessBg);
    else out += arrow(236, sessBg);
    out += powerlineBlock('session', session.rate, session.cost, sessBg, session.fg || 48);
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

  let total = null, session = null;

  if (totalStats.totalRequests) {
    const r = parseFloat(totalStats.cacheHitRate);
    const cc = rateColor(r);
    total = { rate: totalStats.cacheHitRate, cost: totalStats.cost_cny?.total || '¥0', c: cc.c, fg: cc.fg };
  }
  if (sessStats && sessStats.requests > 0) {
    const cc = rateColor(sessStats.hit_rate);
    session = { rate: sessStats.hit_rate + '%', cost: sessStats.cost_cny_total, c: cc.c, fg: cc.fg };
  }

  const theme = loadTheme();
  const out = theme === 'powerline'
    ? renderPowerline(total, session)
    : renderSimple(total, session);

  console.log(out);
}

main();
