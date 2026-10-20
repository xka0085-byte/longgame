// SB253/261 docket 监视序列：CARB 披露页 diff，首窗 2026-11-10 前就位
// 零依赖，node 直跑。数据落 data/sb253-docket.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'longgame-portfolio/0.1 personal research' };
const PAGES = [
  { id: 'sb261-docket', url: 'https://ww2.arb.ca.gov/public-comments/climate-related-financial-risk-reports-sb-261-docket' },
  { id: 'sb253-reporting', url: 'https://ww2.arb.ca.gov/our-work/programs/corporate-ghg-reporting/corporate-disclosure-climate-data' },
  { id: 'sb253-program', url: 'https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk' },
];
const OUT = 'data/sb253-docket.json';

function extractLinks(html, base) {
  const out = [];
  const re = /href="([^"]+)"/g; let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/approved-comments|entity_id|\/system\/files|survey123|climate/i.test(href)) {
      try { out.push(new URL(href, base).href); } catch {}
    }
  }
  return [...new Set(out)];
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [], events: [] };
const prevLinks = new Set(prev.runs.at(-1)?.links || []);
const run = { date: new Date().toISOString(), pages: [], links: [] };
const changes = [];

for (const p of PAGES) {
  try {
    const r = await fetch(p.url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const html = await r.text();
    const links = extractLinks(html, p.url);
    const hash = Buffer.from(html).toString('base64').slice(0, 24) + ':' + html.length;
    run.pages.push({ id: p.id, status: r.status, hash, linkCount: links.length });
    const fresh = links.filter(l => !prevLinks.has(l));
    if (prevLinks.size && fresh.length) changes.push({ page: p.id, newLinks: fresh });
    run.links.push(...links);
  } catch (e) {
    run.pages.push({ id: p.id, error: String(e).slice(0, 120) });
  }
}
run.links = [...new Set(run.links)];
run.changes = changes;
prev.runs.push(run);
if (prev.runs.length > 200) prev.runs = prev.runs.slice(-200);
if (changes.length) prev.events.push({ date: run.date, changes });
writeFileSync(OUT, JSON.stringify(prev, null, 1));
console.log(`SB253 run ${run.date} pages=${run.pages.map(p => `${p.id}:${p.status || p.error}`).join(' ')} links=${run.links.length} changes=${changes.length}`);
