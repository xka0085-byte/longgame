// 复算 Form D 关键词备案量，与 data/lines/formd-sweep.json 最近一次快照逐项比对。
// 用法：node scripts/verify-formd.mjs   （无参数）
// 退出码：0 一致；1 与快照不一致；2 抓取或数据缺失，未能完成比对。
import { readFileSync } from 'node:fs';

const UA = { 'User-Agent': 'longgame-portfolio/0.2 personal research' };
const SNAP = 'data/lines/formd-sweep.json';

function fail(code, msg) {
  console.error(`ERROR ${msg}`);
  process.exit(code);
}

const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
const line = portfolio.series.find(s => s.id === 'formd-sweep');
if (!line?.collect?.keywords?.length) fail(2, 'portfolio.json 里找不到 formd-sweep 的 keywords');

const form = line.collect.form || 'D';
const keywords = line.collect.keywords;

const snap = JSON.parse(readFileSync(SNAP, 'utf8'));
const runs = snap.collect?.runs || [];
const target = [...runs].reverse().find(r => (r.queries || []).some(q => typeof q.thisMonth === 'number'));
if (!target) fail(2, `${SNAP} 里没有含可用 thisMonth 的运行，无法比对`);

// 复算窗口与快照运行同一窗口：该月 1 日至快照日，保证「同一口径、同一区间」。
const monthStart = target.date.slice(0, 7) + '-01';
const endDate = target.date.slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(monthStart) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
  fail(2, `快照运行时间无法解析：${target.date}`);
}

console.log(`snapshot run: ${target.date}`);
console.log(`window: ${monthStart} .. ${endDate}  form=${form}  keywords=${keywords.length}`);

async function total(url, label) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const v = j.hits?.total?.value;
      if (typeof v === 'number') return v;
      throw new Error('no hits.total.value');
    } catch (e) {
      if (attempt === 1) fail(2, `${label} 抓取失败：${String(e).slice(0, 120)}`);
      await new Promise(res => setTimeout(res, 1500));
    }
  }
}

const stored = new Map((target.queries || []).map(q => [q.keyword, q]));
const rows = [];
let recomputedMonth = 0;
let storedMonth = 0;

for (const kw of keywords) {
  const base = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(kw)}%22&forms=${form}`;
  const allTime = await total(base, `${kw} allTime`);
  const thisMonth = await total(`${base}&dateRange=custom&startdt=${monthStart}&enddt=${endDate}`, `${kw} thisMonth`);
  const s = stored.get(kw);
  if (!s || typeof s.thisMonth !== 'number' || typeof s.allTime !== 'number') {
    fail(2, `快照里缺少关键词「${kw}」的可用计数`);
  }
  storedMonth += s.thisMonth;
  recomputedMonth += thisMonth;
  const okFlag = s.thisMonth === thisMonth && s.allTime === allTime;
  rows.push({ kw, sMonth: s.thisMonth, rMonth: thisMonth, sAll: s.allTime, rAll: allTime, ok: okFlag });
  await new Promise(res => setTimeout(res, 200));
}

const mismatch = rows.filter(r => !r.ok);
const totalOk = storedMonth === recomputedMonth;

console.log('\nkeyword | thisMonth(stored/recomputed) | allTime(stored/recomputed) | match');
for (const r of rows) {
  console.log(`${r.kw} | ${r.sMonth}/${r.rMonth} | ${r.sAll}/${r.rAll} | ${r.ok ? 'ok' : 'MISMATCH'}`);
}
console.log(`\nthisMonth total: stored=${storedMonth} recomputed=${recomputedMonth} ${totalOk ? 'ok' : 'MISMATCH'}`);

if (!totalOk || mismatch.length) {
  console.log(`\nFAIL ${mismatch.length} keyword(s) differ, total ${totalOk ? 'matches' : 'differs'}`);
  process.exit(1);
}
console.log('\nPASS: recomputed counts match the stored snapshot');
process.exit(0);
