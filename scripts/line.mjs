// 统一执行器：node scripts/line.mjs <line-id> collect|radar
// 采集做数据 diff，雷达扫外部最新消息，命中写 alerts。状态全部落 data/lines/<id>.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { radarOnce } from './lib/radar.mjs';

const UA = { 'User-Agent': 'longgame-portfolio/0.2 personal research' };
const [lineId, mode] = process.argv.slice(2);
if (!lineId || !mode || !['collect', 'radar'].includes(mode)) {
  console.error('usage: node scripts/line.mjs <line-id> collect|radar');
  process.exit(1);
}
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
const line = portfolio.series.find(s => s.id === lineId);
if (!line) { console.error(`unknown line ${lineId}`); process.exit(1); }
if (!line.collect && !line.radar) { console.log(`${lineId}: external line, nothing to run here`); process.exit(0); }

mkdirSync('data/lines', { recursive: true });
const OUT = `data/lines/${lineId}.json`;
const st = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { collect: { runs: [], events: [] }, radar: { runs: [], items: [], alerts: [] } };
const nowISO = new Date().toISOString();
const sinceUnix = Math.floor((st.radar.runs.at(-1)?.date ? new Date(st.radar.runs.at(-1).date) : new Date(Date.now() - 3 * 864e5)).getTime() / 1000);
const sinceDate = st.radar.runs.at(-1)?.date?.slice(0, 10) || new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
const seenUrls = new Set(st.radar.items.map(i => i.url));
const newAlerts = [];

function pushItems(ch, items) {
  // 相关度过滤：查询的主要词必须都在标题里，压掉 Algolia 模糊匹配噪声
  const tokens = (ch.query || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  for (const it of items) {
    if (!it.url || seenUrls.has(it.url)) continue;
    if (tokens.length) {
      const title = (it.title || '').toLowerCase();
      if (!tokens.every(t => title.includes(t))) continue;
    }
    const item = { line: lineId, channel: ch.channel, query: ch.query, title: it.title, url: it.url, date: it.date || nowISO, foundAt: nowISO };
    st.radar.items.push(item);
    newAlerts.push(item);
  }
}

if (mode === 'radar' && line.radar?.length) {
  for (const ch of line.radar) {
    try {
      const items = await radarOnce({ ...ch, sinceUnix, sinceDate });
      pushItems(ch, items);
      st.radar.runs.push({ date: nowISO, channel: ch.channel, query: ch.query, count: items.length });
    } catch (e) {
      st.radar.runs.push({ date: nowISO, channel: ch.channel, query: ch.query, error: String(e).slice(0, 120) });
    }
  }
  if (st.radar.items.length > 2000) st.radar.items = st.radar.items.slice(-2000);
  if (newAlerts.length) st.radar.alerts.push(...newAlerts.map(a => ({ date: nowISO, title: a.title, url: a.url, channel: a.channel })));
  if (st.radar.alerts.length > 500) st.radar.alerts = st.radar.alerts.slice(-500);
}

if (mode === 'collect' && line.collect) {
  const c = line.collect;
  const run = { date: nowISO };
  const prev = st.collect.runs.at(-1);
  if (c.type === 'pages') {
    const matchMap = c.match || {};
    run.pages = [];
    for (const p of c.pages) {
      try {
        const r = await fetch(p.url, { headers: UA, signal: AbortSignal.timeout(30000) });
        const html = await r.text();
        const sig = `${html.length}:${Buffer.from(html).toString('base64').slice(0, 20)}`;
        const last = prev?.pages.find(x => x.id === p.id);
        const changed = last && last.sig !== sig;
        const matchRe = matchMap[p.id] ? new RegExp(matchMap[p.id], 'i') : null;
        const hit = matchRe && matchRe.test(html);
        run.pages.push({ id: p.id, status: r.status, sig, changed: !!changed, keywordHit: !!hit });
        if (changed) st.collect.events.push({ date: nowISO, page: p.id, note: hit ? 'CHANGE + KEYWORD HIT' : 'content changed' });
      } catch (e) { run.pages.push({ id: p.id, error: String(e).slice(0, 100) }); }
    }
  } else if (c.type === 'dirs') {
    run.dirs = {}; const kidsMap = {};
    for (const url of c.dirs) {
      try {
        const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
        const body = await r.text();
        let kids = [];
        try { const j = JSON.parse(body); const arr = j.keys || j.jwks?.keys || []; kids = arr.map(k => k.kid || k.x || `${k.kty}`).filter(Boolean); }
        catch { kids = [`unparsed:${body.length}b`]; }
        run.dirs[url] = { status: r.status, keyCount: kids.length };
        kidsMap[url] = kids;
        const old = prev?.keys?.[url];
        if (old) {
          const o = new Set(old), n = new Set(kids);
          for (const k of kids) if (!o.has(k)) st.collect.events.push({ date: nowISO, type: 'new-key', dir: url, kid: k });
          for (const k of old) if (!n.has(k)) st.collect.events.push({ date: nowISO, type: 'removed-or-rotated', dir: url, kid: k });
        }
      } catch (e) { run.dirs[url] = { error: String(e).slice(0, 100) }; }
    }
    run.keys = kidsMap;
  } else if (c.type === 'edgar') {
    // EDGAR Form D 关键词备案量月度快照：当月计数加全历史计数，构成不可回填的资金流向序列
    run.queries = [];
    const monthStart = nowISO.slice(0, 7) + '-01';
    for (const kw of c.keywords) {
      try {
        const base = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(kw)}%22&forms=${c.form || 'D'}`;
        const all = await (await fetch(base, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
        const mo = await (await fetch(`${base}&dateRange=custom&startdt=${monthStart}&enddt=${nowISO.slice(0, 10)}`, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
        const entry = { keyword: kw, allTime: all.hits?.total?.value ?? null, thisMonth: mo.hits?.total?.value ?? null };
        run.queries.push(entry);
        const prevAll = prev?.runs?.find(r => r.queries)?.queries?.find(q => q.keyword === kw);
        if (prevAll && typeof entry.thisMonth === 'number' && entry.thisMonth > 0 && prevAll.allTime === entry.allTime) {
          // 全历史数没涨但当月有数，视为口径异常，如实记录
          st.collect.events.push({ date: nowISO, type: 'edgar-anomaly', keyword: kw });
        }
      } catch (e) { run.queries.push({ keyword: kw, error: String(e).slice(0, 100) }); }
    }
  } else if (c.type === 'lotl') {
    try {
      const r = await fetch(c.url, { headers: UA, signal: AbortSignal.timeout(30000) });
      const xml = await r.text();
      const locs = [...xml.matchAll(/(?:TSLLocation|SchemeTSLLocation)>(https?:[^<]+)/g)].map(m => m[1].trim()).filter(u => !/eu-lotl\.xml/.test(u));
      run.pointers = [...new Set(locs)].sort();
      run.pointerCount = run.pointers.length;
      const prevPtrs = prev?.pointers || [];
      if (prevPtrs.length) {
        const pset = new Set(prevPtrs);
        for (const u of run.pointers) if (!pset.has(u)) st.collect.events.push({ date: nowISO, type: 'tsl-added', url: u });
        for (const u of prevPtrs) if (!run.pointers.includes(u)) st.collect.events.push({ date: nowISO, type: 'tsl-removed', url: u });
      }
    } catch (e) { run.error = String(e).slice(0, 140); }
  }
  st.collect.runs.push(run);
  if (st.collect.runs.length > 300) st.collect.runs = st.collect.runs.slice(-300);
}

writeFileSync(OUT, JSON.stringify(st, null, 1));
const evCount = st.collect.events.length, alCount = st.radar.alerts.length;
console.log(`${lineId} ${mode} done: collectEvents=${evCount} radarAlerts=${alCount} newRadar=${newAlerts.length}`);
for (const a of newAlerts.slice(0, 8)) console.log(`  RADAR ${a.channel}: ${a.title}`);
