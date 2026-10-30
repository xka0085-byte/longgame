// 组合月报与仪表盘：分组线卡 + 反应链路图 + 雷达命中流。人工接口=读月报点头。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const now = new Date();
const month = now.toISOString().slice(0, 7);
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
portfolio.updated = now.toISOString();
writeFileSync('portfolio.json', JSON.stringify(portfolio, null, 2));

function readLine(id) {
  const f = `data/lines/${id}.json`;
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

const GROUPS = [
  { name: 'Agent 经济', lines: ['mcpreflight-weekly', 'erc8004-snapshot', 'protocol-watch', 'agent-dirs'] },
  { name: '气候与能源', lines: ['sb253-docket', 'grid-queue'] },
  { name: '合规与身份信任', lines: ['aiact-register', 'eidas-tsl', 'c2pa-spec', 'state-ai-laws'] },
  { name: '算力金融与守候', lines: ['formd-sweep', 'compute-futures', 'triggers'] },
];
const byId = Object.fromEntries(portfolio.series.map(s => [s.id, s]));
const stOf = id => readLine(id);

function auditSummaryMarkdown() {
  const p = 'docs/status.json';
  if (!existsSync(p)) return '## 审计摘要\n\n未找到 docs/status.json；本月未运行 self-audit。\n';
  try {
    const status = JSON.parse(readFileSync(p, 'utf8'));
    const lines = Array.isArray(status.lines) ? status.lines : [];
    const count = k => lines.filter(l => l.freshness === k).length;
    const attention = lines.filter(l => l.freshness !== 'fresh' || l.page_ok === false || l.csv_ok === false || l.source_status === 'partial');
    return `## 审计摘要\n\n生成 ${status.generated_at || '-'}。fresh ${count('fresh')} 条，stale ${count('stale')} 条，unavailable ${count('unavailable')} 条，never ${count('never')} 条。需关注 ${attention.length} 项。\n\n自检明细见 [docs/audit/latest.md](docs/audit/latest.md)。审计只做状态汇总与证据触发提案，不修改任何线，也不代表第三方复算。\n`;
  } catch (e) {
    return `## 审计摘要\n\ndocs/status.json 无法读取：${e.message}\n`;
  }
}

function assuranceSummaryMarkdown() {
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  const contracts = readJson('assurance/results/contracts.json');
  const fixtures = readJson('assurance/results/fixtures.json');
  const aTotal = contracts?.assertions ?? null;
  const aFail = contracts?.failures ?? null;
  const fTotal = fixtures?.samples ?? null;
  const fPass = fixtures?.passed ?? null;
  const fNa = fixtures?.not_applicable ?? 0;
  let rate = 'UNKNOWN';
  if (aTotal !== null && aFail !== null && fTotal !== null && fPass !== null && aTotal + fTotal > 0) {
    rate = `${(((aTotal - aFail + fPass) / (aTotal + fTotal)) * 100).toFixed(1)}%（契约 ${aTotal - aFail}/${aTotal}，样本 ${fPass}/${fTotal}${fNa ? `，另 ${fNa} 条外部线 NOT_APPLICABLE 不计入` : ''}）`;
  }

  // 本月 quarantine 次数：来自发布台账，每次进入隔离记一条。
  let qCount = 0;
  if (existsSync('assurance/quarantine-log.jsonl')) {
    for (const row of readFileSync('assurance/quarantine-log.jsonl', 'utf8').split(/\r?\n/).filter(Boolean)) {
      try { if (JSON.parse(row).at?.slice(0, 7) === month) qCount += 1; } catch { /* 跳过坏行 */ }
    }
  }

  let evidence = 0;
  const ev = readJson('docs/evidence.json');
  if (Array.isArray(ev)) evidence = ev.length;

  const levels = [];
  for (const s of portfolio.series) {
    let lvl = 'UNKNOWN';
    const f = `assurance/contracts/datasets/${s.id}.yaml`;
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/^assurance_level:\s*([0-5])\s*$/m);
      if (m) lvl = m[1];
    }
    levels.push(`| ${s.id} | ${lvl} |`);
  }

  return `## 工程保证月报

- 断言通过率：${rate}
- 本月 quarantine 次数：${qCount}（来源 assurance/quarantine-log.jsonl，按进入隔离的线每次记一条）
- 外部证据数：${evidence}（docs/evidence.json 中来自项目外部的条目总数）
- 各线 assurance_level：

| 线 | assurance_level |
| --- | --- |
${levels.join('\n')}

说明：本地线最高 2，外部线最高 1，无任何线达到 Level 3。通过率与等级只描述当前可复现的检查结果，不代表第三方独立验证。
`;
}

let md = `# 组合月报 ${month}\n\n生成 ${now.toISOString()}。人工接口：读毕点头。规则：雷达命中进月报，升级触发器命中当月十问初筛，任一线连续两年三问体检答否即降级或清仓。\n\n`;
for (const s of portfolio.series) {
  const st = stOf(s.id);
  md += `## ${s.id}（${s.status}）\n- 驱动：${s.driver || '-'}\n`;
  if (s.artifact) md += `- 产物：${s.artifact}\n`;
  if (st) {
    md += `- 雷达命中累计 ${st.radar.alerts.length} 条，采集事件累计 ${st.collect.events.length} 条\n`;
    for (const a of (st.radar.alerts || []).slice(-5)) md += `  - ${a.date.slice(0, 10)} [${a.channel}] ${a.title}\n`;
  } else if (s.home) md += `- 外部序列：${s.home}\n`;
  if (s.risks) md += `- 风险：${s.risks}\n`;
  md += '\n';
}
const alertsAll = portfolio.series.flatMap(s => (stOf(s.id)?.radar.alerts || []).slice(-3).map(a => ({ line: s.id, ...a }))).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);
md += '## 最近雷达命中\n\n' + (alertsAll.length ? alertsAll.map(a => `- ${a.date.slice(0, 10)} [${a.line}] ${a.title}`).join('\n') : '无') + '\n';
md += '\n' + assuranceSummaryMarkdown() + '\n';
md += '\n' + auditSummaryMarkdown() + '\n';
md += '## 每年三问体检\n\n一 驱动时间表是否推进。二 历史是否出现真实买方或稳定引用方。三 是否出现资金充足的回填者。任一问连续两年答否即降级或清仓。\n';
writeFileSync(`docs/report-${month}.md`, md);

// 分组线卡 HTML
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
function lineCard(id) {
  const s = byId[id];
  if (!s) return '';
  const st = stOf(id);
  const radarN = st?.radar.alerts.length ?? '-';
  const evN = st?.collect.events.length ?? '-';
  const lastRadar = st?.radar.runs.at(-1)?.date?.slice(0, 10) ?? (s.home ? 'external' : '待首跑');
  const chs = (s.radar || []).map(r => r.channel).filter((v, i, a) => a.indexOf(v) === i);
  const statusColor = s.status === 'active' ? '#1a7f37' : s.status === 'auto-wait' ? '#9a6700' : '#57606a';
  return `<div class="card${id === 'sb253-docket' ? ' focal' : ''}">
  <div class="row"><code>${id}</code><span class="pill" style="color:${statusColor};border-color:${statusColor}">${s.status}</span></div>
  <div class="driver">${esc(s.driver || '')}</div>
  ${s.artifact ? `<div class="artifact">产物：${esc(s.artifact)}</div>` : ''}
  <div class="meta">采集 ${s.cron?.collect ?? '-'} · 雷达 ${s.cron?.radar ?? '-'}${chs.length ? ' · ' + chs.map(esc).join('/') : ''}</div>
  <div class="stats">雷达命中 <b>${radarN}</b> · 采集事件 <b>${evN}</b> · 最近雷达 ${lastRadar}</div>
</div>`;
}
const groupHtml = GROUPS.map(g => `<div class="group"><h2>${g.name}</h2><div class="cards">${g.lines.map(lineCard).join('')}</div></div>`).join('\n');

// 反应链路 SVG（6 节点 5 箭头，符合预算）
const flowSvg = `<svg viewBox="0 0 720 96" width="100%" height="auto" role="img" aria-label="数据流">
<defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path d="M1 1 L7 4 L1 7 Z" fill="var(--text-muted)"/></marker></defs>
${[['数据源', 40], ['雷达', 170], ['采集', 300], ['事件流', 430], ['月报', 560]].map(([t, x], i) => `<rect x="${x}" y="28" width="100" height="40" rx="8" fill="var(--surface)" stroke="var(--border)"/><text x="${x + 50}" y="52" text-anchor="middle" font-size="14" fill="var(--text)">${t}</text>${i < 4 ? `<path d="M${x + 104} 48 H${x + 126}" stroke="var(--text-muted)" stroke-width="1.5" fill="none" marker-end="url(#ah)"/>` : ''}`).join('')}
<rect x="660" y="28" width="60" height="40" rx="20" fill="var(--brand-soft)" stroke="var(--brand)"/><text x="690" y="52" text-anchor="middle" font-size="13" fill="var(--brand-text)">反应</text>
</svg>`;

const alertsHtml = alertsAll.map(a => `<li><span class="d">${a.date.slice(0, 10)}</span> <code>${a.line}</code> ${esc(a.title)}</li>`).join('') || '<li>暂无命中</li>';
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>longgame portfolio</title>
<style>
:root{--bg:#f6f8fa;--surface:#ffffff;--border:#d0d7de;--text:#1f2328;--muted:#57606a;--brand:#1a7f37;--brand-soft:#dafbe1}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,'Segoe UI';background:var(--bg);color:var(--text)}
.wrap{max-width:1080px;margin:0 auto;padding:28px 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 10px;color:var(--muted);text-transform:letter-spacing:.5px}
.sub{color:var(--muted);font-size:13px;margin-bottom:18px}
.group{margin-bottom:22px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}
.card.focal{border:2px solid var(--brand)}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
code{background:var(--bg);padding:2px 6px;border-radius:6px;font-size:13px}
.pill{font-size:11px;border:1px solid;border-radius:999px;padding:1px 8px}
.driver{font-size:13px;margin-top:8px;color:var(--muted)}
.artifact{font-size:12px;margin-top:6px;background:var(--bg);border-radius:8px;padding:6px 8px}
.meta,.stats{font-size:12px;color:var(--muted);margin-top:6px}
.flow{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px}
ul.hits{columns:1;font-size:13px;padding-left:18px}.hits li{margin:4px 0}
.d{color:var(--muted);font-family:monospace;font-size:12px}
footer{margin-top:30px;font-size:12px;color:var(--muted)}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--brand:#3fb950;--brand-soft:#12261e}}
</style><div class="wrap">
<h1>longgame 组合仪表盘</h1>
<div class="sub">更新 ${now.toISOString()} · ${portfolio.series.length} 条线 · 雷达每日 · 采集按各自节奏 · 反应规则自动进月报</div>
<div class="flow">${flowSvg}</div>
${groupHtml}
<h2>最近雷达命中</h2><ul class="hits">${alertsHtml}</ul>
<footer>longgame portfolio，零人工测量线组合自 2026-10。引用格式见 llms.txt。数据全部来自公开来源，数字自带生成日期。每年三问体检：驱动推进、买方与引用、回填者。<br><a href="health.html">系统当前健康状态</a> · <a href="ops.html">运维手册（含已知缺口与恢复步骤）</a> · <a href="method.html">采集与门禁方法</a></footer>
</div>`;
writeFileSync('docs/index.html', html);
console.log(`report docs/report-${month}.md + dashboard docs/index.html (grouped cards), lines=${portfolio.series.length}`);
