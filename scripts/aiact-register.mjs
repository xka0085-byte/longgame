// AI Act 官方注册库等待型 diff：机器可读数据落地侦测（落地之日即立项之日）
// 数据落 data/aiact-register.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'longgame-portfolio/0.1 personal research' };
// 候选官方页（记录哪些可达），外加第三方实现时间线做代理监视
const PAGES = [
  { id: 'ec-gpai-practice', url: 'https://digital-strategy.ec.europa.eu/en/policies/code-practice-gpai' },
  { id: 'ec-aiact-policy', url: 'https://digital-strategy.ec.europa.eu/en/policies/ai-act' },
  { id: 'ec-register-hr', url: 'https://digital-strategy.ec.europa.eu/en/policies/register-high-risk-ai-systems' },
  { id: 'proxy-timeline', url: 'https://artificialintelligenceact.eu/implementation-timeline/' },
];
const OUT = 'data/aiact-register.json';

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [], events: [] };
const run = { date: new Date().toISOString(), pages: [] };

for (const p of PAGES) {
  try {
    const r = await fetch(p.url, { headers: UA, signal: AbortSignal.timeout(30000) });
    const html = await r.text();
    // 机器可读落地侦测：出现 JSON/XML/API/CSV 下载链接
    const machineReadable = /data\.europa\.eu|\.json["'\)]|api\.|\.xml["'\)]|download.*csv|opendata/i.test(html);
    const sig = `${html.length}:${Buffer.from(html).toString('base64').slice(0, 20)}`;
    const last = prev.runs.at(-1)?.pages.find(x => x.id === p.id);
    const changed = last && last.sig !== sig;
    run.pages.push({ id: p.id, status: r.status, sig, machineReadable, changed: !!changed });
    if (changed) prev.events.push({ date: run.date, page: p.id, note: machineReadable ? 'MACHINE-READABLE SIGNAL + CHANGE' : 'content changed' });
  } catch (e) {
    run.pages.push({ id: p.id, error: String(e).slice(0, 120) });
  }
}
prev.runs.push(run);
if (prev.runs.length > 100) prev.runs = prev.runs.slice(-100);
writeFileSync(OUT, JSON.stringify(prev, null, 1));
console.log(`aiact-register ${run.date} ` + run.pages.map(p => `${p.id}:${p.status || p.error}${p.machineReadable ? ' [MR]' : ''}${p.changed ? ' [CHANGED]' : ''}`).join(' '));
