// 产物层与被动分发：逐线页面 + RSS + sitemap + llms.txt 自动引用块
// 每条线一个可截图标量，全部带日期与引用行。零依赖。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';

const now = new Date();
const iso = now.toISOString();
const day = iso.slice(0, 10);
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
mkdirSync('docs/lines', { recursive: true });

function readLine(id) {
  const f = `data/lines/${id}.json`;
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// 从各线数据里抽一个可分享标量
function scalarOf(id, st) {
  if (!st) return null;
  const last = st.collect?.runs?.at(-1);
  if (id === 'formd-sweep' && last?.queries) {
    const ok = last.queries.filter(q => typeof q.thisMonth === 'number');
    const sum = ok.reduce((a, q) => a + q.thisMonth, 0);
    return { value: sum, label: `本月十个关键词合计新增 Form D 备案 ${sum} 件`, unit: '件' };
  }
  if (id === 'agent-dirs' && last?.dirs) {
    const keys = Object.values(last.dirs).reduce((a, d) => a + (d.keyCount || 0), 0);
    return { value: keys, label: `当前登记的 agent 密钥 ${keys} 把`, unit: '把' };
  }
  if (id === 'eidas-tsl' && last?.pointerCount != null) {
    return { value: last.pointerCount, label: `EU 信任列表指针 ${last.pointerCount} 个`, unit: '个' };
  }
  if (id === 'sb253-docket' && last?.pages) {
    const links = last.links?.length ?? 0;
    return { value: links, label: `CARB 披露相关链接 ${links} 条（首窗 11-10）`, unit: '条' };
  }
  if (id === 'grid-queue' && last?.pages) {
    const p = last.pages.find(x => x.status === 200);
    return p ? { value: last.pages.length, label: `EIA-860M 页可达，等待月度文件更新`, unit: '' } : null;
  }
  const alerts = st.radar?.alerts?.length ?? 0;
  return alerts ? { value: alerts, label: `累计雷达命中 ${alerts} 条`, unit: '条' } : null;
}

const items = [];
const sitemap = [];
for (const s of portfolio.series) {
  const st = readLine(s.id);
  if (!st) continue;
  const sc = scalarOf(s.id, st);
  const alerts = (st.radar?.alerts || []).slice(-12).reverse();
  const events = (st.collect?.events || []).slice(-12).reverse();
  const title = `${s.id} · ${s.driver || ''}`.slice(0, 120);

  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.id)} — longgame</title>
<style>:root{--bg:#f6f8fa;--surface:#fff;--border:#d0d7de;--text:#1f2328;--muted:#57606a;--brand:#1a7f37}*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui;background:var(--bg);color:var(--text)}.wrap{max-width:820px;margin:0 auto;padding:32px 16px}.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin:16px 0}.n{font-size:34px;font-weight:700;color:var(--brand)}.lbl{font-size:14px;color:var(--muted);margin-top:4px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;color:var(--muted)}li{font-size:13px;margin:6px 0}.d{font-family:monospace;font-size:12px;color:var(--muted)}footer{margin-top:32px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}</style>
<div class="wrap"><h1>${esc(s.id)}</h1><div class="lbl">${esc(s.driver || '')}</div>
${sc ? `<div class="kpi"><div class="n">${esc(sc.value)}</div><div class="lbl">${esc(sc.label)}</div><div class="d" style="margin-top:8px">数字生成于 ${day}</div></div>` : '<div class="kpi"><div class="lbl">本期无新增可分享数字</div></div>'}
<h2>最近雷达命中</h2><ul>${alerts.map(a => `<li><span class="d">${a.date.slice(0, 10)}</span> [${esc(a.channel)}] ${esc(a.title)}</li>`).join('') || '<li>无</li>'}</ul>
<h2>数据变更</h2><ul>${events.map(e => `<li><span class="d">${e.date.slice(0, 10)}</span> ${esc(e.note || e.type)} ${esc(e.page || e.url || e.kid || '')}</li>`).join('') || '<li>无</li>'}</ul>
<footer>longgame ${esc(s.id)}，数据自 2026-10 起，生成于 ${iso}。来源为公开数据，数字自带生成日期。引用格式：longgame ${esc(s.id)}（${day}）。方法与边界见 llms.txt。</footer></div>`;
  writeFileSync(`docs/lines/${s.id}.html`, html);
  sitemap.push(`https://longgame.example/lines/${s.id}.html`);
  if (sc) items.push({ id: s.id, title: `${s.id}：${sc.label}`, date: iso, link: `lines/${s.id}.html` });
}

// RSS
const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>longgame portfolio</title><link>https://longgame.example/</link><description>零人工测量线组合，逐线时间序列与事件流</description><lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items.map(i => `<item><title>${esc(i.title)}</title><link>https://longgame.example/${i.link}</link><guid>${esc(i.id)}-${day}</guid><pubDate>${now.toUTCString()}</pubDate></item>`).join('')}
</channel></rss>`;
writeFileSync('docs/feed.xml', rss);

// sitemap
writeFileSync('docs/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://longgame.example/</loc><lastmod>${day}</lastmod></url>
${sitemap.map(u => `<url><loc>${u}</loc><lastmod>${day}</lastmod></url>`).join('\n')}
</urlset>`);

// llms.txt 自动引用块
const BASE = `# longgame portfolio

零人工自转的测量线组合，自 2026 年 10 月起。每条线是一个独立时间序列：采集做数据 diff，雷达每日扫外部消息，产物带生成日期与引用行。`

const block = `<!-- AUTO-CITATIONS:START -->
## 引用格式（自动生成 ${day}）

${items.map(i => `- ${i.title}，自 2026-10，链接 https://longgame.example/${i.link}`).join('\n')}
<!-- AUTO-CITATIONS:END -->`;

let llms = existsSync('llms.txt') ? readFileSync('llms.txt', 'utf8') : BASE + '\n';
if (llms.includes('<!-- AUTO-CITATIONS:START -->')) {
  llms = llms.replace(/<!-- AUTO-CITATIONS:START -->[\s\S]*?<!-- AUTO-CITATIONS:END -->/, block);
} else {
  llms += '\n' + block + '\n';
}
writeFileSync('llms.txt', llms);
console.log(`publish: ${items.length} line pages, feed.xml, sitemap.xml, llms.txt updated`);
