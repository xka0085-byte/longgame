// 产物层与被动分发：先在 assurance/.staging 生成候选，全部校验通过后原子替换 docs 与 data。
// 每条线一个可截图标量，全部带日期与引用行。零依赖。
import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, cpSync, rmSync, renameSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { assertGate } from './lib/assurance-gate.mjs';
import {
  evaluateRun, publicationState, normalizedSha, sha256File,
} from './lib/assurance-core.mjs';

// 发布硬门禁：没有同一份输入、同一 commit 的 gate 通过记录，直接退出。
assertGate();

const now = new Date();
const iso = now.toISOString();
const day = iso.slice(0, 10);
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));

const STAGE = 'assurance/.staging';
const STAGE_DOCS = join(STAGE, 'docs');
const STAGE_DATA = join(STAGE, 'data');
const STAGE_LLMS = join(STAGE, 'llms.txt');
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
if (existsSync('docs')) cpSync('docs', STAGE_DOCS, { recursive: true });
else mkdirSync(STAGE_DOCS, { recursive: true });
if (existsSync('data')) cpSync('data', STAGE_DATA, { recursive: true });
else mkdirSync(STAGE_DATA, { recursive: true });
mkdirSync(join(STAGE_DOCS, 'lines'), { recursive: true });

const commit = (() => {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'UNKNOWN'; }
})();
const runId = process.env.GITHUB_RUN_ID || `local-${iso.replace(/[-:.TZ]/g, '')}`;

function readLine(id) {
  const f = `data/lines/${id}.json`;
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) {
    // 损坏的数据文件不得静默跳过：跳过等于把该线从产物里删掉，必须阻断发布。
    throw new Error(`corrupt data file ${f}: ${String(e.message).slice(0, 120)}`);
  }
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function contractVersion(id) {
  const f = `assurance/contracts/datasets/${id}.yaml`;
  if (!existsSync(f)) return 'UNKNOWN';
  const m = readFileSync(f, 'utf8').match(/^contract_version:\s*(\d+)\s*$/m);
  return m ? Number(m[1]) : 'UNKNOWN';
}

function assuranceLevel(id) {
  const f = `assurance/contracts/datasets/${id}.yaml`;
  if (!existsSync(f)) return null;
  const m = readFileSync(f, 'utf8').match(/^assurance_level:\s*([0-5])\s*$/m);
  return m ? Number(m[1]) : null;
}

// 从各线数据里抽一个可分享标量。只在 PUBLISHED 状态下调用。
function scalarOf(id, st) {
  if (!st) return null;
  const runs = st.collect?.runs || [];
  const latest = runs.at(-1);
  const good = runs.slice().reverse().find(r => {
    if (r.unavailablePages) return false;
    if (r.eiaCounts?.missingFields?.length) return false;
    if (id === 'formd-sweep') return r.queries?.length > 0 && r.queries.every(q => typeof q.thisMonth === 'number');
    if (id === 'agent-dirs') return r.dirs && Object.values(r.dirs).length > 0 && Object.values(r.dirs).every(d => d.keyCount != null && d.keyCount > 0);
    if (id === 'eidas-tsl') return r.pointerCount != null && r.pointerCount > 0;
    if (id === 'grid-queue') return r.eiaCounts != null
      && r.eiaCounts.planned != null && r.eiaCounts.plannedMW != null
      && r.eiaCounts.canceled != null && r.eiaCounts.canceledMW != null;
    if (id === 'sb253-docket') return (r.pages || []).some(p => p.status === 200 && p.unavailable !== true && p.sig);
    return false;
  });
  if (!good) return null;
  const stale = latest && good !== latest;
  const stamp = good?.date?.slice(0, 10) || day;
  const suffix = stale ? `（最近一次成功采集于 ${stamp}，本期采集失败）` : '';
  if (id === 'formd-sweep' && good?.queries) {
    const ok = good.queries.filter(q => typeof q.thisMonth === 'number');
    const sum = ok.reduce((a, q) => a + q.thisMonth, 0);
    return { value: sum, label: `本月十个关键词合计新增 Form D 备案 ${sum} 件${suffix}`, unit: '件' };
  }
  if (id === 'agent-dirs' && good?.dirs) {
    const keys = Object.values(good.dirs).reduce((a, d) => a + (d.keyCount || 0), 0);
    return { value: keys, label: `当前登记的 agent 密钥 ${keys} 把${suffix}`, unit: '把' };
  }
  if (id === 'eidas-tsl' && good?.pointerCount != null) {
    return { value: good.pointerCount, label: `EU 信任列表指针 ${good.pointerCount} 个${suffix}`, unit: '个' };
  }
  if (id === 'sb253-docket' && good?.pages) {
    const links = good.links?.length ?? 0;
    return { value: links, label: `CARB 披露相关链接 ${links} 条（首窗 11-10）${suffix}`, unit: '条' };
  }
  if (id === 'grid-queue' && good?.eiaCounts) {
    const e = good.eiaCounts;
    return { value: e.plannedMW, label: `EIA-860M ${e.file} 计划新增 ${e.planned} 行合计 ${e.plannedMW} MW，已取消 ${e.canceled} 行合计 ${e.canceledMW} MW${suffix}`, unit: 'MW' };
  }
  const alerts = st.radar?.alerts?.length ?? 0;
  return alerts ? { value: alerts, label: `累计雷达命中 ${alerts} 条`, unit: '条' } : null;
}

const items = [];
const sitemap = [];
const provenance = [];
mkdirSync('assurance/provenance', { recursive: true });

for (const s of portfolio.series) {
  const st = readLine(s.id);
  if (!st) continue;
  const pub = publicationState(s.id, st);
  const contract_errors = evaluateRun(s.id, st, { strict: false });
  const latest = st.collect?.runs?.at(-1);
  // 首次观测：取该线本地采集记录中最早一次 run 的时间戳，不外推、不补日期；无本地数据则为 null。
  const firstObserved = st.collect?.runs?.[0]?.at || st.collect?.runs?.[0]?.date || null;
  const prov = {
    run_id: runId,
    line: s.id,
    commit,
    contract_version: contractVersion(s.id),
    assurance_level: assuranceLevel(s.id),
    first_observed: firstObserved,
    raw_sha256: sha256File(`data/lines/${s.id}.json`),
    normalized_sha256: normalizedSha(latest),
    validation_status: contract_errors.length === 0 ? 'PASS' : 'FAIL',
    publication_status: pub.publication_status,
    publication_reason: pub.reason,
    last_success_at: pub.last_success_at,
    generated_at: iso,
  };
  writeFileSync(`assurance/provenance/${s.id}.json`, JSON.stringify(prov, null, 2) + '\n');
  provenance.push(prov);

  const sc = pub.publication_status === 'PUBLISHED' ? scalarOf(s.id, st) : null;
  const alerts = (st.radar?.alerts || []).slice(-12).reverse();
  const events = (st.collect?.events || []).slice(-12).reverse();
  const unavailableBlock = pub.publication_status === 'QUARANTINED'
    ? `<div class="kpi warn"><div class="n">unavailable</div><div class="lbl">该线已进入 quarantine（隔离）。原因：${esc(pub.reason || 'latest run is not publish-eligible')}。最后成功时间：${esc(pub.last_success_at || '无历史成功记录')}。本页仅展示最后有效版本状态，不写零、不用旧值冒充本期数字。</div></div>`
    : '';

  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.id)} — longgame</title>
<style>:root{--bg:#f6f8fa;--surface:#fff;--border:#d0d7de;--text:#1f2328;--muted:#57606a;--brand:#1a7f37;--warn:#9a6700;--warnbg:#fff8c5}*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui;background:var(--bg);color:var(--text)}.wrap{max-width:820px;margin:0 auto;padding:32px 16px}.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin:16px 0}.kpi.warn{background:var(--warnbg);border-color:var(--warn)}.n{font-size:34px;font-weight:700;color:var(--brand)}.kpi.warn .n{color:var(--warn);font-size:28px}.lbl{font-size:14px;color:var(--muted);margin-top:4px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;color:var(--muted)}li{font-size:13px;margin:6px 0}.d{font-family:monospace;font-size:12px;color:var(--muted)}footer{margin-top:32px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}</style>
<div class="wrap"><h1>${esc(s.id)}</h1><div class="lbl">${esc(s.driver || '')}</div>
<div class="lbl">assurance_level: <b>${esc(prov.assurance_level ?? 'UNKNOWN')}</b> · 最近一次验证时间：<span class="d">${iso}</span></div>
<div class="lbl">首次观测：<span class="d">${firstObserved ? esc(firstObserved.slice(0, 19).replace('T', ' ')) + ' UTC' : '外部托管，本仓库无本地采集记录'}</span>${firstObserved ? '（取本线最早一次采集 run 的时间戳，不追溯外推）' : ''}</div>
${unavailableBlock}
${sc ? `<div class="kpi"><div class="n">${esc(sc.value)}</div><div class="lbl">${esc(sc.label)}</div><div class="d" style="margin-top:8px">数字生成于 ${day}</div></div>` : (pub.publication_status === 'PUBLISHED' ? '<div class="kpi"><div class="lbl">本期无新增可分享数字</div></div>' : '')}
<h2>最近雷达命中</h2><ul>${alerts.map(a => `<li><span class="d">${a.date.slice(0, 10)}</span> [${esc(a.channel)}] ${esc(a.title)}</li>`).join('') || '<li>无</li>'}</ul>
<h2>数据变更</h2><ul>${events.map(e => `<li><span class="d">${e.date.slice(0, 10)}</span> ${esc(e.note || e.type)} ${esc(e.page || e.url || e.kid || '')}</li>`).join('') || '<li>无</li>'}</ul>
<footer>longgame ${esc(s.id)}，数据自 2026-10 起，生成于 ${iso}。来源为公开数据，数字自带生成日期。引用格式：longgame ${esc(s.id)}（${day}）。方法与边界见 llms.txt。</footer></div>`;
  writeFileSync(join(STAGE_DOCS, 'lines', `${s.id}.html`), html);
  sitemap.push(`https://xka0085-byte.github.io/longgame/lines/${s.id}.html`);
  if (sc) items.push({ id: s.id, title: `${s.id}：${sc.label}`, date: iso, link: `lines/${s.id}.html` });
}

// 公开溯源快照
mkdirSync(join(STAGE_DOCS, 'assurance'), { recursive: true });
writeFileSync(join(STAGE_DOCS, 'assurance', 'provenance.json'), JSON.stringify({
  run_id: runId, commit, generated_at: iso, lines: provenance,
}, null, 2) + '\n');

// 单品页：只在文件已生成时写入 sitemap，避免列出 404。
for (const p of ['grid-queue-latest', 'sb253-first-window']) {
  if (existsSync(join(STAGE_DOCS, 'lines', `${p}.html`))) sitemap.push(`https://xka0085-byte.github.io/longgame/lines/${p}.html`);
}
if (existsSync(join(STAGE_DOCS, 'verify.html'))) sitemap.push('https://xka0085-byte.github.io/longgame/verify.html');
if (existsSync(join(STAGE_DOCS, 'method.html'))) sitemap.push('https://xka0085-byte.github.io/longgame/method.html');

// RSS
const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>longgame portfolio</title><link>https://xka0085-byte.github.io/longgame/</link><description>零人工测量线组合，逐线时间序列与事件流</description><lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items.map(i => `<item><title>${esc(i.title)}</title><link>https://xka0085-byte.github.io/longgame/${i.link}</link><guid>${esc(i.id)}-${day}</guid><pubDate>${now.toUTCString()}</pubDate></item>`).join('')}
</channel></rss>`;
writeFileSync(join(STAGE_DOCS, 'feed.xml'), rss);

// sitemap
writeFileSync(join(STAGE_DOCS, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://xka0085-byte.github.io/longgame/</loc><lastmod>${day}</lastmod></url>
${sitemap.map(u => `<url><loc>${u}</loc><lastmod>${day}</lastmod></url>`).join('\n')}
</urlset>`);

// llms.txt 自动引用块
const BASE = `# longgame portfolio

零人工自转的测量线组合，自 2026 年 10 月起。每条线是一个独立时间序列：采集做数据 diff，雷达每日扫外部消息，产物带生成日期与引用行。`;

const block = `<!-- AUTO-CITATIONS:START -->
## 引用格式（自动生成 ${day}）

${items.map(i => `- ${i.title}，自 2026-10，链接 https://xka0085-byte.github.io/longgame/${i.link}`).join('\n')}
<!-- AUTO-CITATIONS:END -->`;

let llms = existsSync('llms.txt') ? readFileSync('llms.txt', 'utf8') : BASE + '\n';
if (llms.includes('<!-- AUTO-CITATIONS:START -->')) {
  llms = llms.replace(/<!-- AUTO-CITATIONS:START -->[\s\S]*?<!-- AUTO-CITATIONS:END -->/, block);
} else {
  llms += '\n' + block + '\n';
}
writeFileSync(STAGE_LLMS, llms);

// grid-queue 单行 CSV 同步导出：数据只来自 data/lines/grid-queue.json 最近一次含 eiaCounts 的运行。
const env = { ...process.env, LONGGAME_DOCS: STAGE_DOCS };
try {
  execFileSync('node', ['scripts/export-grid-csv.mjs'], { stdio: 'inherit', env });
  execFileSync('node', ['scripts/grid-queue-latest.mjs'], { stdio: 'inherit', env });
} catch (e) {
  console.error(`publish: grid CSV/page step failed: ${String(e.message).slice(0, 160)}`);
  process.exit(1);
}

// sb253 首窗页：有名单就填表，名单为空或数据源不可用则保留骨架并标注，不填零、不编企业名。
try {
  execFileSync('node', ['scripts/sb253-first-window.mjs'], {
    stdio: 'inherit',
    env: { ...env, SB253_PAGE: join(STAGE_DOCS, 'lines', 'sb253-first-window.html') },
  });
} catch (e) {
  console.error(`publish: sb253 first-window step failed: ${String(e.message).slice(0, 160)}`);
  process.exit(1);
}

// 重生成 verify.html：显示每条线 assurance_level 与最近一次验证时间。
try {
  execFileSync('node', ['scripts/attest.mjs'], { stdio: 'inherit', env });
} catch (e) {
  console.error(`publish: attest step failed: ${String(e.message).slice(0, 160)}`);
  process.exit(1);
}

// 全部校验通过才替换。任何一项非零退出，staging 丢弃，线上保持最后有效版本。
function check(script, extraEnv = {}) {
  try {
    execFileSync('node', [script], { stdio: 'inherit', env: { ...process.env, ...extraEnv } });
  } catch {
    console.error(`publish: post-render check failed: ${script}; staging discarded, live files unchanged`);
    process.exit(1);
  }
}
check('scripts/validate-contracts.mjs');
check('scripts/run-fixtures.mjs');
check('scripts/verify.mjs', { LONGGAME_DOCS: STAGE_DOCS });

function swapIntoPlace(from, to) {
  const backup = `${to}.previous`;
  if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
  if (existsSync(to)) renameSync(to, backup);
  try {
    renameSync(from, to);
  } catch (e) {
    if (existsSync(backup) && !existsSync(to)) renameSync(backup, to);
    throw e;
  }
  if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
}

// quarantine 台账：每次发布把进入隔离的线追加一行，供月报统计次数。按 run_id+line 去重。
const qlog = 'assurance/quarantine-log.jsonl';
const seenQuarantine = new Set();
if (existsSync(qlog)) {
  for (const row of readFileSync(qlog, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try { const r = JSON.parse(row); seenQuarantine.add(`${r.run_id}|${r.line}`); } catch { /* 跳过坏行 */ }
  }
}
const newQuarantine = provenance
  .filter(p => p.publication_status === 'QUARANTINED' && !seenQuarantine.has(`${p.run_id}|${p.line}`))
  .map(p => JSON.stringify({
    run_id: p.run_id, line: p.line, at: p.generated_at,
    reason: p.publication_reason, last_success_at: p.last_success_at,
  }));
if (newQuarantine.length) {
  appendFileSync(qlog, newQuarantine.join('\n') + '\n');
}

swapIntoPlace(STAGE_DOCS, 'docs');
swapIntoPlace(STAGE_DATA, 'data');
swapIntoPlace(STAGE_LLMS, 'llms.txt');
rmSync(STAGE, { recursive: true, force: true });

console.log(`publish: ${items.length} line pages, feed.xml, sitemap.xml, llms.txt updated (run_id=${runId}, commit=${commit.slice(0, 7)})`);
