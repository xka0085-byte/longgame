// 数据线独立复算：从原始 data/lines/*.json 重算每个对外数字，断言页面里的数字与重算一致。
// 这是自洽检验，不是第三方验证。任何人可跑：node scripts/verify.mjs
import { readFileSync, existsSync } from 'node:fs';

const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
// 允许校验候选产物目录（CI 先在临时目录渲染，再门禁，再替换 docs）。
const DOCS = process.env.LONGGAME_DOCS || 'docs';
const read = id => { const f = `data/lines/${id}.json`; return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
let fails = 0, checks = 0;
const fail = (id, msg) => { fails++; console.log(`FAIL ${id}: ${msg}`); };

for (const s of portfolio.series) {
  const st = read(s.id);
  if (!st) { console.log(`skip ${s.id}: no data`); continue; }
  const last = (st.collect?.runs || []).slice().reverse().find(r => {
    if (s.id === 'formd-sweep') return r.queries?.some(q => typeof q.thisMonth === 'number');
    if (s.id === 'agent-dirs') return r.dirs && Object.values(r.dirs).some(d => d.keyCount != null);
    if (s.id === 'eidas-tsl') return r.pointerCount != null;
    if (s.id === 'grid-queue') return r.eiaCounts != null;
    return false;
  });
  let expected = null;
  if (s.id === 'formd-sweep' && last?.queries) {
    expected = last.queries.filter(q => typeof q.thisMonth === 'number').reduce((a, q) => a + q.thisMonth, 0);
  } else if (s.id === 'grid-queue' && last?.eiaCounts) {
    expected = last.eiaCounts.plannedMW;
  } else if (s.id === 'agent-dirs' && last?.dirs) {
    expected = Object.values(last.dirs).reduce((a, d) => a + (d.keyCount || 0), 0);
  } else if (s.id === 'eidas-tsl' && last?.pointerCount != null) {
    expected = last.pointerCount;
  }
  const pagePath = `${DOCS}/lines/${s.id}.html`;
  if (!existsSync(pagePath)) { fail(s.id, `page missing ${pagePath}`); continue; }
  const html = readFileSync(pagePath, 'utf8');
  checks++;
  // 每个页面必须带生成日期
  if (!/生成于 \d{4}-\d{2}-\d{2}T|数字生成于 \d{4}-\d{2}-\d{2}/.test(html)) fail(s.id, 'page has no dated number');
  if (expected != null && !html.includes(`>${expected}<`)) fail(s.id, `page number does not match recomputed ${expected}`);
  else if (expected != null) console.log(`ok ${s.id}: ${expected} matches page`);
}
// 事件流完整性：每条事件必须带日期
for (const s of portfolio.series) {
  const st = read(s.id);
  if (!st) continue;
  checks++;
  const bad = (st.collect?.events || []).filter(e => !e.date).length;
  if (bad) fail(s.id, `${bad} collect events without date`);
}
console.log(`\nverify: ${checks} checks, ${fails} failures`);
process.exitCode = fails ? 1 : 0;
