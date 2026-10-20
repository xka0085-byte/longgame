// 组合月报与仪表盘生成：读 portfolio.json 与全部 data/*.json，产出 docs/index.html 与 docs/report-YYYY-MM.md
// 零依赖。人工接口就是每月读一次月报点头。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const now = new Date();
const month = now.toISOString().slice(0, 7);
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));

function lastRunSummary(file) {
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const r = j.runs?.at(-1);
    if (!r) return null;
    return { date: r.dateISO || r.date, events: (j.events?.length) || 0, lastEvent: j.events?.at(-1)?.date || null, raw: r };
  } catch { return null; }
}

const series = portfolio.series.map(s => {
  const map = {
    'sb253-docket': 'data/sb253-docket.json',
    'agent-dirs': 'data/agent-dirs.json',
    'eidas-tsl': 'data/eidas-tsl.json',
    'aiact-register': 'data/aiact-register.json',
    'triggers': 'data/triggers.json',
  };
  const file = map[s.id];
  return { ...s, summary: file ? lastRunSummary(file) : null };
});
portfolio.updated = now.toISOString();
writeFileSync('portfolio.json', JSON.stringify(portfolio, null, 2));

const alerts = existsSync('data/triggers.json') ? JSON.parse(readFileSync('data/triggers.json', 'utf8')).alerts.slice(-20) : [];

// 月报 markdown
let md = `# 组合月报 ${month}\n\n生成时间 ${now.toISOString()}。人工接口：读毕点头即可，无需其他动作。\n\n`;
for (const s of series) {
  md += `## ${s.id}（${s.status}）\n`;
  md += `- 驱动：${s.driver || '-'}\n`;
  if (s.summary) {
    md += `- 最近运行：${s.summary.date}，历史事件数：${s.summary.events}\n`;
    if (s.summary.lastEvent) md += `- 最近事件：${s.summary.lastEvent}\n`;
  } else if (s.home) {
    md += `- 外部序列，仓库：${s.home}\n`;
  }
  if (s.notes) md += `- 备注：${s.notes}\n`;
  md += '\n';
}
md += `## 触发信号\n\n`;
if (!alerts.length) md += '本期无触发。\n';
for (const a of alerts) md += `- ${a.date} ${a.id}：${a.note}${a.titles ? '，' + a.titles.join('；') : ''}\n`;
md += `\n## 每年三问体检\n\n一 驱动时间表是否推进。二 历史是否出现真实买方或稳定引用方。三 是否出现资金充足的回填者。任一问连续两年答否即降级或清仓。\n`;
writeFileSync(`docs/report-${month}.md`, md);

// 仪表盘 HTML
const rows = series.map(s => {
  const lastStr = s.summary?.date ? new Date(s.summary.date).toISOString().slice(0, 10) : (s.home ? 'external' : '-');
  const evStr = s.summary ? s.summary.events : '-';
  const stColor = s.status === 'active' ? '#1a7f37' : s.status === 'auto-wait' ? '#9a6700' : '#57606a';
  return `<tr><td><code>${s.id}</code></td><td style="color:${stColor};font-weight:600">${s.status}</td><td>${s.cron || '-'}</td><td>${lastStr}</td><td>${evStr}</td><td>${(s.driver || '').slice(0, 60)}</td></tr>`;
}).join('\n');
const alertRows = alerts.map(a => `<li><code>${a.id}</code> ${a.date.slice(0, 10)} ${a.note}</li>`).join('') || '<li>无</li>';
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>longgame portfolio</title>
<style>body{font-family:ui-sans-serif,system-ui;max-width:960px;margin:40px auto;padding:0 16px;color:#1f2328}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d7de;padding:8px;font-size:14px;text-align:left}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}h1{font-size:22px}h2{font-size:16px;border-bottom:1px solid #d0d7de;padding-bottom:6px}</style>
<h1>longgame 组合仪表盘</h1><p>更新 ${now.toISOString()}。规则：全部序列 cron 自转，人工每月读月报一小时。升级规则：触发信号命中当月十问初筛。</p>
<h2>序列状态</h2><table><tr><th>序列</th><th>状态</th><th>节奏</th><th>最近运行</th><th>事件数</th><th>驱动</th></tr>${rows}</table>
<h2>最近触发信号</h2><ul>${alertRows}</ul>`;
writeFileSync('docs/index.html', html);
console.log(`report written docs/report-${month}.md, dashboard docs/index.html`);
