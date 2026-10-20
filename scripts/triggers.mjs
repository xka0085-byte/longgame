// 触发信号月扫：守候清单 B/C 全部触发器，命中即写入 alerts
// 数据落 data/triggers.json，首跑只建基线不报警
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'longgame-portfolio/0.1 personal research' };
const OUT = 'data/triggers.json';
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [], alerts: [] };
const last = prev.runs.at(-1);
const sinceDate = last?.dateISO?.slice(0, 10) || '2026-10-20';
const sinceUnix = last ? Math.floor(new Date(last.dateISO).getTime() / 1000) : Math.floor(Date.now() / 1000) - 30 * 86400;

const CHECKS = [
  { id: 'cftc-compute', type: 'fr', term: 'compute derivatives futures' },
  { id: 'irs-agent-income', type: 'fr', term: 'autonomous agent income' },
  { id: 'hn-compute-futures', type: 'hn', query: 'compute futures' },
  { id: 'hn-cf-gateway', type: 'hn', query: 'Cloudflare Monetization Gateway' },
  { id: 'hn-agent-insurance', type: 'hn', query: 'agent insurance' },
  { id: 'hn-parametric-ai', type: 'hn', query: 'parametric AI insurance' },
  { id: 'x402-spec', type: 'hash', url: 'https://www.x402.org/', match: /v1\.0|specification/i },
  { id: 'coloprice-marketplace', type: 'hash', url: 'https://coloprice.com/marketplace/' },
  { id: 'parametrix-llm', type: 'hash', url: 'https://www.parametrixinsurance.com/', match: /LLM|language model|AI/i },
  { id: 'lloyds-lab', type: 'hash', url: 'https://www.lloyds.com/insights/lloyds-lab', match: /AI|agent/i },
  { id: 'hr8915', type: 'hash', url: 'https://www.govtrack.us/congress/bills/119/hr8915', match: /passed|passed House|passed Senate|became law/i },
];

const run = { dateISO: new Date().toISOString(), results: [], alerts: [] };
const firstRun = !last;

for (const c of CHECKS) {
  const res = { id: c.id };
  try {
    if (c.type === 'fr') {
      const u = `https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=${encodeURIComponent(c.term)}&conditions%5Bpublication_date%5D%5Bgte%5D=${sinceDate}&per_page=5`;
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      res.count = j.count ?? 0;
      res.titles = (j.results || []).slice(0, 3).map(d => d.title);
      if (res.count > 0) run.alerts.push({ date: run.dateISO, id: c.id, note: `${res.count} 条联邦公报新文件`, titles: res.titles });
    } else if (c.type === 'hn') {
      const u = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(c.query)}&tags=story&numericFilters=created_at_i>${sinceUnix}&hitsPerPage=5`;
      const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      res.count = j.nbHits ?? 0;
      res.titles = (j.hits || []).slice(0, 3).map(h => h.title);
      if (res.count > 0) run.alerts.push({ date: run.dateISO, id: c.id, note: `${res.count} 条 HN 新故事`, titles: res.titles });
    } else {
      const r = await fetch(c.url, { headers: UA, signal: AbortSignal.timeout(30000) });
      const html = await r.text();
      res.status = r.status;
      res.sig = `${html.length}:${Buffer.from(html).toString('base64').slice(0, 20)}`;
      const prevRes = last?.results.find(x => x.id === c.id);
      const changed = prevRes && prevRes.sig !== res.sig;
      const matched = c.match && c.match.test(html);
      res.changed = !!changed;
      if (!firstRun && changed) run.alerts.push({ date: run.dateISO, id: c.id, note: matched ? '页面变更且命中关键词' : '页面变更' });
    }
  } catch (e) {
    res.error = String(e).slice(0, 120);
  }
  run.results.push(res);
}
prev.runs.push(run);
if (prev.runs.length > 60) prev.runs = prev.runs.slice(-60);
prev.alerts.push(...run.alerts.map(a => ({ ...a })));
if (prev.alerts.length > 300) prev.alerts = prev.alerts.slice(-300);
writeFileSync(OUT, JSON.stringify(prev, null, 1));
console.log(`triggers ${run.dateISO} checks=${CHECKS.length} alerts=${run.alerts.length}${firstRun ? ' (首跑基线)' : ''}`);
for (const a of run.alerts) console.log(`  ALERT ${a.id}: ${a.note}${a.titles ? ' | ' + a.titles.join(' ; ') : ''}`);
