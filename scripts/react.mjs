// 反应层：把雷达命中分类成可执行动作，写 data/reaction-queue.json 与月报
// 四类：corrective（须实测后回应，限既有线程）、removal（立即兑现）、demand（唯一允许进入主动触达评估的类型）、rule（改参数/出解读）、noise（只记录）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
const now = new Date().toISOString();
const qPath = 'data/reaction-queue.json';
const prev = existsSync(qPath) ? JSON.parse(readFileSync(qPath, 'utf8')) : { items: [] };
const known = new Set(prev.items.map(i => i.url));

const RULES = [
  { type: 'removal', re: /\b(remove|take down|delist|stop (sending|contacting))\b/i, action: '立即兑现，当日处理，写台账' },
  { type: 'corrective', re: /\b(not intentional|false positive|please re-?check|incorrect|wrong|isn.t (right|correct))\b/i, action: '先实测，再在既有线程回证据，不开新 issue' },
  { type: 'demand', re: /\b(would pay|wish there (was|were)|looking for a tool|need a tool|no good tool)\b/i, action: '唯一可进入触达评估的类型，需原话链接加 guard 加台账' },
  { type: 'rule', re: /\b(final rule|effective date|adopted|enforcement|deadline|effective from|enters into force|public input|request for comment|seeks? comments?)\b/i, action: '更新该线参数，必要时出解读' },
];

// 每次重算全部分类，避免规则升级后旧条目卡在旧分类
for (const it of prev.items) {
  const rule = RULES.find(r => r.re.test(it.title || '')) || { type: 'noise', action: '只记录' };
  it.type = rule.type;
  it.action = rule.action;
}

const fresh = [];
for (const s of portfolio.series) {
  const f = `data/lines/${s.id}.json`;
  if (!existsSync(f)) continue;
  let st; try { st = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
  for (const a of st.radar?.alerts || []) {
    if (!a.url || known.has(a.url)) continue;
    const type = (RULES.find(r => r.re.test(a.title || '')) || { type: 'noise', action: '只记录' }).type;
    const rule = RULES.find(r => r.type === type);
    fresh.push({ date: now, line: s.id, channel: a.channel, title: a.title, url: a.url, type, action: rule?.action || '只记录' });
    known.add(a.url);
  }
}
prev.items.push(...fresh);
if (prev.items.length > 500) prev.items = prev.items.slice(-500);
prev.updated = now;
writeFileSync(qPath, JSON.stringify(prev, null, 1));

const actionable = prev.items.filter(i => i.type !== 'noise');
console.log(`reaction-queue: +${fresh.length} new, total ${prev.items.length}, actionable ${actionable.length}`);
for (const i of fresh.slice(0, 10)) console.log(`  [${i.type}] ${i.line} ${i.title}`);
