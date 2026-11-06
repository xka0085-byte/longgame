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
const SITE = 'https://xka0085-byte.github.io/longgame';
// 归档锚点：Zenodo 冻结快照的 DOI 不随仓库改动变化，是"永远能打开的同一条链接"。
// 写进产物而不是只写进 README，是因为机器可读入口（citation.json / llms.txt）才是
// 引用方实际抓取的地方；重生产物时必须带上，否则下一次 publish 就把它抹掉了。
const ARCHIVE_DOI = '10.5281/zenodo.23998349';
const ARCHIVE_DOI_URL = `https://doi.org/${ARCHIVE_DOI}`;
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

// 同日重扫判定：comparedAgainst 与 scanDate 相同，说明这一 run 是同一批上游快照的日内重跑，
// 它的 statusChanged 是扫描抖动，不是周变化。历史 run 没有 refreshOnly / comparisonKind 字段，
// 只能靠 comparedAgainst 判定——所以这里不能依赖新字段，否则旧数据会绕过口径直接进标题。
const sameDayRefresh = r => !!r && (
  r.refreshOnly === true || r.comparisonKind === 'same-day'
  || (typeof r.scanDate === 'string' && r.comparedAgainst === r.scanDate)
);

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
    // 只认跨周运行：周内刷新（同日/同周重跑）的 statusChanged 是扫描抖动，
    // 不能作为发布口径。没有跨周运行时退回上次的跨周记录，并标注为刷新。
    if (id === 'trust-delta') return typeof r.scanDate === 'string' && r.summary?.serversThisWeek > 0 && !r.error && !sameDayRefresh(r);
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
  // trust-delta 的"落后"有两种：本期采集失败，或本期只是周内刷新（不为周变化口径）。
  // 后者不是失败，措辞必须分开，否则会被读成采集出了问题。
  const suffix = stale
    ? (id === 'trust-delta' && sameDayRefresh(latest)
      ? `（最近一次采集 ${latest.scanDate} 为${latest.comparedAgainst === latest.scanDate || latest.comparisonKind === 'same-day' ? '当日' : '同周'}刷新，只更新在册与状态快照；周变化仍按 ${good.comparedAgainst || '上次基线'} 起算的上一次跨周对比）`
      : `（最近一次成功采集于 ${stamp}，本期采集失败）`)
    : '';
  if (id === 'formd-sweep' && good?.queries) {
    const ok = good.queries.filter(q => typeof q.thisMonth === 'number');
    const sum = ok.reduce((a, q) => a + q.thisMonth, 0);
    return { asOf: good?.scanDate || stamp, value: sum, label: `本月十个关键词合计新增 Form D 备案 ${sum} 件${suffix}`, unit: '件' };
  }
  if (id === 'agent-dirs' && good?.dirs) {
    const keys = Object.values(good.dirs).reduce((a, d) => a + (d.keyCount || 0), 0);
    return { asOf: good?.scanDate || stamp, value: keys, label: `当前登记的 agent 密钥 ${keys} 把${suffix}`, unit: '把' };
  }
  if (id === 'eidas-tsl' && good?.pointerCount != null) {
    return { asOf: good?.scanDate || stamp, value: good.pointerCount, label: `EU 信任列表指针 ${good.pointerCount} 个${suffix}`, unit: '个' };
  }
  if (id === 'sb253-docket' && good?.pages) {
    const links = good.links?.length ?? 0;
    return { asOf: good?.scanDate || stamp, value: links, label: `CARB 披露相关链接 ${links} 条（首窗 11-10）${suffix}`, unit: '条' };
  }
  if (id === 'trust-delta' && good?.summary) {
    const s = good.summary;
    const dir = good.direction || {};
    const scope = good.baseline === true ? '（本轮为首个基线，无上一轮可比）'
      : good.comparedAgainstComplete === false ? '（上游本轮对比覆盖不完整，新增/消失数只作参考）' : '';
    return {
      asOf: good?.scanDate || stamp,
      value: s.serversThisWeek,
      label: `Trust Directory 在册端点 ${s.serversThisWeek} 个，本轮判定变更 ${s.statusChanged} 次（转 PASS ${dir.toPass ?? 0}、离开 PASS ${dir.fromPass ?? 0}），消失 ${s.removed ?? 0} 个${scope}${suffix}`,
      unit: '个',
    };
  }
  if (id === 'grid-queue' && good?.eiaCounts) {
    const e = good.eiaCounts;
    return { asOf: good?.scanDate || stamp, value: e.plannedMW, label: `EIA-860M ${e.file} 计划新增 ${e.planned} 行合计 ${e.plannedMW} MW，已取消 ${e.canceled} 行合计 ${e.canceledMW} MW${suffix}`, unit: 'MW' };
  }
  const alerts = st.radar?.alerts?.length ?? 0;
  return alerts ? { asOf: stamp, value: alerts, label: `累计雷达命中 ${alerts} 条`, unit: '条' } : null;
}

const items = [];
const citations = [];
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

  // 结构化元数据：回答"这段数字是什么、什么时候的、能不能核、怎么引"。
  // AI 抽取与 Google Dataset Search 都靠 JSON-LD 判时效，纯 HTML 文本会被当成无日期内容。
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `longgame ${s.id}`,
    alternateName: `${s.id} (longgame public data series)`,
    description: sc ? sc.label : `${s.id} 本期无新增可分享数字（${pub.publication_status}）`,
    // 同名实体消歧：longgame 在搜索里主要指向游戏/软件，这里明确是公开数据序列，
    // 否则检索方会把这条线的数字挂到错误实体上。
    disambiguatingDescription: 'Independently maintained public-data time series (regulatory dockets, filings, energy queue, trust lists). Not a game, not a software product.',
    keywords: ['public data', 'time series', s.id, 'regulatory disclosure', 'open data'],
    url: `https://xka0085-byte.github.io/longgame/lines/${s.id}.html`,
    sameAs: `https://xka0085-byte.github.io/longgame/lines/${s.id}.json`,
    identifier: `longgame:${s.id}`,
    dateModified: iso,
    datePublished: firstObserved || day,
    isAccessibleForFree: true,
    creator: { '@type': 'Organization', name: 'longgame', url: 'https://xka0085-byte.github.io/longgame/' },
    license: 'https://github.com/xka0085-byte/longgame/blob/master/LICENSE',
    citation: sc ? `longgame ${s.id}（${sc.asOf || day}）：${sc.label}` : undefined,
    variableMeasured: sc ? { '@type': 'PropertyValue', name: sc.label, unitText: sc.unit || undefined, value: sc.value } : undefined,
    distribution: {
      '@type': 'DataDownload',
      contentUrl: `https://raw.githubusercontent.com/xka0085-byte/longgame/master/data/lines/${s.id}.json`,
      encodingFormat: 'application/json',
      sha256: prov.raw_sha256,
    },
  };
  const headExtra = `<link rel="alternate" type="application/json" href="${esc(s.id)}.json">`
    + `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;

  const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.id)} — longgame</title>${headExtra}
<style>:root{--bg:#f6f8fa;--surface:#fff;--border:#d0d7de;--text:#1f2328;--muted:#57606a;--brand:#1a7f37;--warn:#9a6700;--warnbg:#fff8c5}*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui;background:var(--bg);color:var(--text)}.wrap{max-width:820px;margin:0 auto;padding:32px 16px}.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin:16px 0}.kpi.warn{background:var(--warnbg);border-color:var(--warn)}.n{font-size:34px;font-weight:700;color:var(--brand)}.kpi.warn .n{color:var(--warn);font-size:28px}.lbl{font-size:14px;color:var(--muted);margin-top:4px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:24px 0 8px;color:var(--muted)}li{font-size:13px;margin:6px 0}.d{font-family:monospace;font-size:12px;color:var(--muted)}footer{margin-top:32px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}</style>
<div class="wrap"><h1>${esc(s.id)}</h1><div class="lbl">${esc(s.driver || '')}</div>
<div class="lbl">assurance_level: <b>${esc(prov.assurance_level ?? 'UNKNOWN')}</b> · 最近一次验证时间：<span class="d">${iso}</span></div>
<div class="lbl">首次观测：<span class="d">${firstObserved ? esc(firstObserved.slice(0, 19).replace('T', ' ')) + ' UTC' : '外部托管，本仓库无本地采集记录'}</span>${firstObserved ? '（取本线最早一次采集 run 的时间戳，不追溯外推）' : ''}</div>
${unavailableBlock}
${sc ? `<div class="kpi"><div class="n">${esc(sc.value)}</div><div class="lbl">${esc(sc.label)}</div><div class="d" style="margin-top:8px">数字生成于 ${sc.asOf || day}${sc.asOf && sc.asOf !== day ? `（本期按 ${sc.asOf} 的采集数据发布，页面生成于 ${day}）` : ''}</div></div>` : (pub.publication_status === 'PUBLISHED' ? '<div class="kpi"><div class="lbl">本期无新增可分享数字</div></div>' : '')}
<h2>最近雷达命中</h2><ul>${alerts.map(a => `<li><span class="d">${a.date.slice(0, 10)}</span> [${esc(a.channel)}] ${esc(a.title)}</li>`).join('') || '<li>无</li>'}</ul>
<h2>数据变更</h2><ul>${events.map(e => `<li><span class="d">${e.date.slice(0, 10)}</span> ${esc(e.note || e.type)} ${esc(e.page || e.url || e.kid || '')}</li>`).join('') || '<li>无</li>'}</ul>
<footer>longgame ${esc(s.id)}，数据自 2026-10 起，生成于 ${iso}。来源为公开数据，数字自带生成日期。引用格式：longgame ${esc(s.id)}（${day}）。方法与边界见 llms.txt。</footer></div>`;
  writeFileSync(join(STAGE_DOCS, 'lines', `${s.id}.html`), html);
  sitemap.push(`https://xka0085-byte.github.io/longgame/lines/${s.id}.html`);
  if (sc) items.push({ id: s.id, title: `${s.id}：${sc.label}`, date: iso, link: `lines/${s.id}.html` });

  // 每条线一份机器可读引用：一句话可直接整句粘贴，带 as_of、线页、原始数据与复算入口。
  // 无可发布标量时明写状态与原因，不写零、不拿旧值顶当期。
  const cite = {
    id: s.id,
    title: s.driver || s.id,
    as_of: sc?.asOf || day,
    url: `https://xka0085-byte.github.io/longgame/lines/${s.id}.html`,
    data_url: `https://raw.githubusercontent.com/xka0085-byte/longgame/master/data/lines/${s.id}.json`,
    citation: sc
      ? `longgame ${s.id}（${sc.asOf || day}）：${sc.label}`
      : `longgame ${s.id}（${day}）：本期无新增可分享数字（${pub.publication_status}${pub.reason ? `：${pub.reason}` : ''}）`,
    scalar: sc ? { value: sc.value, unit: sc.unit ?? null, label: sc.label } : null,
    // 只有真拿到数字的线才适合被整句引用；QUARANTINED 或本期无数字的线
    // 引用出来是一句"没有数字"，对引用者是噪声，程序侧也应能一眼过滤。
    citable: Boolean(sc) && sc.value !== null && sc.value !== undefined,
    publication_status: pub.publication_status,
    assurance_level: prov.assurance_level,
    contract_version: prov.contract_version,
    raw_sha256: prov.raw_sha256,
    generated_at: iso,
    reproduce: `node scripts/verify-data.mjs  # 校验 data/lines/${s.id}.json 自洽`,
    license: '数据来自公开政府与监管页面；引用请保留 as_of 与 url',
  };
  writeFileSync(join(STAGE_DOCS, 'lines', `${s.id}.json`), JSON.stringify(cite, null, 2) + '\n');
  citations.push(cite);
}

// 汇总引用：单文件入口，给 LLM / agent 一次拿全部可引用句，不用逐页抓。
writeFileSync(join(STAGE_DOCS, 'citation.json'), JSON.stringify({
  project: 'longgame',
  updated: day,
  archive_doi: ARCHIVE_DOI,
  archive_doi_url: ARCHIVE_DOI_URL,
  how_to_cite: '整句引用 citation 字段；数字随 as_of 变化，跨期引用必须同时给出 as_of。',
  lines: citations,
}, null, 2) + '\n');

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
// 健康页与运维手册也要能被搜到：一个说明"现在还活着吗"，一个说明"死了怎么救"
if (existsSync(join(STAGE_DOCS, 'health.html'))) sitemap.push('https://xka0085-byte.github.io/longgame/health.html');
if (existsSync(join(STAGE_DOCS, 'ops.html'))) sitemap.push('https://xka0085-byte.github.io/longgame/ops.html');

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

// robots.txt：之前站点根没有这个文件（404）。缺它不只是少个提示——AI 检索管线
// 常先读 robots 找 Sitemap 与政策，读不到就按默认策略冷启动，且无法确认是否被欢迎抓取。
const robots = `# longgame — 公开数据，欢迎检索与引用。请保留 as_of 与 url。
User-agent: *
Allow: /

# AI / LLM 抓取方显式放行（未列出者同样允许，这里只是避免被上游默认策略误伤）
${['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended',
  'CCBot', 'Bytespider', 'meta-externalagent', 'cohere-ai', 'Diffbot']
  .map(ua => `User-agent: ${ua}\nAllow: /`).join('\n\n')}

Sitemap: https://xka0085-byte.github.io/longgame/sitemap.xml
# 给 LLM/agent 的机器可读索引与引用清单：
# llms.txt     https://xka0085-byte.github.io/longgame/llms.txt
# llms-full.txt https://xka0085-byte.github.io/longgame/llms-full.txt
# citation.json https://xka0085-byte.github.io/longgame/citation.json
`;
writeFileSync(join(STAGE_DOCS, 'robots.txt'), robots);

// llms.txt 自动引用块
const BASE = `# longgame portfolio

零人工自转的测量线组合，自 2026 年 10 月起。每条线是一个独立时间序列：采集做数据 diff，雷达每日扫外部消息，产物带生成日期与引用行。`;

// 引用块置顶：AI 读 llms.txt 往往只看前几百字，引用行必须出现在方法与边界之前，
// 否则会被当成正文的一部分而不是"可直接抄的一句"。
const block = `<!-- AUTO-CITATIONS:START -->
## 一句话引用（自动生成 ${day}）

每条线一行，可整句引用。括号里的 as_of 是数字的数据日期，不是文档日期——跨期引用必须连 as_of 一起给。
机器可读全文（全部线、含原始数据 hash 与复算命令）：https://xka0085-byte.github.io/longgame/citation.json
带方法与边界的一次性全文（不必再逐页抓）：https://xka0085-byte.github.io/longgame/llms-full.txt
本快照的归档 DOI（不随仓库改动变化）：${ARCHIVE_DOI_URL}

${citations.filter(c => c.citable).map(c => `- ${c.citation}${c.url ? ` — ${c.url}` : ''}${c.data_url ? ` · 原始数据 ${c.data_url}` : ''}`).join('\n')}
${citations.some(c => !c.citable) ? `
### 当前没有可引用数字的线（${citations.filter(c => !c.citable).map(c => c.id).join('、')}）

这些线本期没有产出数字，引用它们只会得到一句"没有数字"。列在这里是为了透明，不是让你引用。
${citations.filter(c => !c.citable).map(c => `- ${c.id}：${c.publication_status === 'QUARANTINED' ? '隔离中（数据源不可用）' : '本期无新增数字'} — ${c.url}`).join('\n')}
` : ''}
<!-- AUTO-CITATIONS:END -->`;

let llms = existsSync('llms.txt') ? readFileSync('llms.txt', 'utf8') : BASE + '\n';
// 先剥掉旧块（无论在哪个位置），再插到首个二级标题之前，保证块唯一且置顶。
const stripped = llms
  .replace(/<!-- AUTO-CITATIONS:START -->[\s\S]*?<!-- AUTO-CITATIONS:END -->\n?/g, '')
  .replace(/\n{3,}/g, '\n\n');
const at = stripped.search(/^## /m);
llms = at === -1
  ? stripped.trimEnd() + '\n\n' + block + '\n'
  : stripped.slice(0, at) + block + '\n\n' + stripped.slice(at);
writeFileSync(STAGE_LLMS, llms);
// 站点根也要有一份：AI/爬虫请求的是 https://<site>/llms.txt，而不是仓库根文件。
// 只放仓库根等于只有会翻 GitHub 的人能看到引用行。
writeFileSync(join(STAGE_DOCS, 'llms.txt'), llms);

// llms-full.txt：llms.txt 是索引，这个是全文。检索型 agent 拿到索引后还要再抓 N 次才能凑齐
// 上下文，一次给出全文能把"能不能引用"的判断成本压到一次请求。
// 与 llms.txt 同源生成，避免两处口径分叉。
const full = `# longgame portfolio — full context
> 零人工测量的公开数据线组合。每条线一个可核查标量，自带 as_of、原始数据 sha256 与复算命令。
> Independently maintained public-data series. One verifiable scalar per line, each with its own as_of date, raw-data sha256 and a reproduce command.
> Site: ${SITE}/ · Machine-readable: ${SITE}/citation.json · Updated: ${day}

## 这是什么 / What this is
${portfolio.series.length} 条独立时间序列，每条记录一个"事后无法重建"的量（监管名单变更、备案计数、装机队列、信任列表指针、agent 密钥目录等）。
数据来自公开政府与监管页面，采集做 diff，产物带生成日期。没有任何人工填写的数字。
${portfolio.series.length} independent time series, each recording a quantity that cannot be reconstructed after the fact.
All numbers come from public government/regulator pages; the pipeline diffs raw sources and stamps every artifact with its data date.

## 不是什么 / What this is not
- 不是预测，不含外推值（no forecasts, no extrapolation）
- 不是第三方复算结果：除标注外均为我方扫描，页面写明"未经第三方复算"（not third-party audited）
- 不补零：数据源不可用时该线进入 quarantine，页面写"无可分享数字"，不用旧值冒充当期
- 与游戏/其它同名项目无关（this is a public-data series, unrelated to any game or software of the same name）

## 怎么引 / How to cite
整句引用下面 "citation" 字段；括号中的 as_of 是数据日期，不是文档日期，跨期引用必须同时给出 as_of。
Quote the citation string verbatim. The date in parentheses is the data date (as_of), not the publication date — always carry it along.
机器可读全文 / machine-readable: ${SITE}/citation.json
归档 DOI / archive DOI (frozen snapshot, does not move): ${ARCHIVE_DOI_URL}

## 可引用的线 / Citable lines
${citations.filter(c => c.citable).map(c => `### ${c.id} — as_of ${c.as_of}
- citation: ${c.citation}
- page: ${c.url}
- raw data: ${c.data_url}
- raw sha256: ${c.raw_sha256}
- reproduce: \`${c.reproduce}\`
- status: ${c.publication_status} · assurance: ${c.assurance_level} · contract: v${c.contract_version}`).join('\n\n')}

## 暂无数字的线 / Lines currently without a citable number
${citations.filter(c => !c.citable).map(c => `- ${c.id}: ${c.publication_status}${c.publication_status === 'QUARANTINED' ? '（数据源不可用 / source unavailable）' : '（本期无新增 / no new number this period）'} — ${c.url}`).join('\n') || '- 无'}

## 方法与边界 / Method and limits
- 采集器逐日 diff 源页面，变更进事件流；每条线有契约校验（validate-contracts）与故障注入门禁（fault-injection 6/6 BLOCKED）
- 每条线的数字只在通过校验时发布，未通过则 quarantine 并公开原因
- 方法页 / method: ${SITE}/method.html · 健康状态 / health: ${SITE}/health.html
- 已知缺口写在运维手册 / known gaps: ${SITE}/ops.html — 不隐藏失败

## 许可 / License
数据来自公开来源；引用请保留 as_of 与 url。代码与文案 CC BY 4.0。
LICENSE: https://github.com/xka0085-byte/longgame/blob/master/LICENSE
`;
writeFileSync(join(STAGE_DOCS, 'llms-full.txt'), full);

// IndexNow 的 key 文件：协议要求站点根可达 <key>.txt 且内容等于 key，否则提交被拒。
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'a7f3c9d21e8b4a6f5c0d9e2b7a1f4c83';
writeFileSync(join(STAGE_DOCS, `${INDEXNOW_KEY}.txt`), INDEXNOW_KEY + '\n');

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
