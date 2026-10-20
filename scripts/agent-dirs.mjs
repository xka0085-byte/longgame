// Agent 密钥目录快照序列：不可回填的身份事件流（注册/轮换/吊销）
// 目标已实测可达（2026-10-20 wba_probe）。数据落 data/agent-dirs.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'longgame-portfolio/0.1 personal research' };
const DIRS = [
  'https://chatgpt.com/.well-known/http-message-signatures-directory',
  'https://agent.bot.goog/.well-known/http-message-signatures-directory',
];
const OUT = 'data/agent-dirs.json';

function keyId(jwk) { return jwk.kid || jwk.x || `${jwk.kty}:${(jwk.n || jwk.crv || '').slice(0, 16)}`; }

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [], events: [] };
const prevKeys = new Map(Object.entries(prev.runs.at(-1)?.keys || {})); // dir -> Set of kids
const run = { date: new Date().toISOString(), dirs: {}, keys: {} };
const events = [];

for (const url of DIRS) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const body = await r.text();
    let kids = [];
    try {
      const j = JSON.parse(body);
      const arr = j.keys || j.jwks?.keys || [];
      kids = arr.map(keyId).filter(Boolean);
    } catch { kids = [`unparsed:${body.length}b`]; }
    run.dirs[url] = { status: r.status, keyCount: kids.length };
    run.keys[url] = kids;
    const old = prevKeys.get(url);
    if (old) {
      const oldSet = new Set(old), newSet = new Set(kids);
      for (const k of kids) if (!oldSet.has(k)) events.push({ date: run.date, type: 'new-key', dir: url, kid: k });
      for (const k of old) if (!newSet.has(k)) events.push({ date: run.date, type: 'removed-or-rotated', dir: url, kid: k });
    }
  } catch (e) {
    run.dirs[url] = { error: String(e).slice(0, 120) };
  }
}
run.events = events;
prev.runs.push(run);
if (prev.runs.length > 300) prev.runs = prev.runs.slice(-300);
if (events.length) prev.events.push(...events);
writeFileSync(OUT, JSON.stringify(prev, null, 1));
console.log(`agent-dirs ${run.date} ` + Object.entries(run.dirs).map(([u, d]) => `${new URL(u).host}:${d.status || d.error} keys=${d.keyCount ?? '?'}`).join(' ') + ` events=${events.length}`);
