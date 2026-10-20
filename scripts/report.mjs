// 组合月报与仪表盘：雷达摘要、采集事件、升降级建议。人工接口=读月报点头。
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

const rows = [], proposals = [];
for (const s of portfolio.series) {
  const st = readLine(s.id);
  const collectRuns = st?.collect?.runs?.length || 0;
  const collectEvents = st?.collect?.events || [];
  const radarAlerts = st?.radar?.alerts || [];
  const lastRadar = st?.radar?.runs?.at(-1)?.date?.slice(0, 10) || '-';
  rows.push(`<tr><td><code>${s.id}</code></td><td>${s.status}</td><td>${s.cron ? `采集${s.cron.collect}/雷达${s.cron.radar}` : s.home ? 'external' : '-'}</td><td>${st ? lastRadar : '-'}</td><td>${collectEvents.length}</td><td>${radarAlerts.length}</td><td>${(s.driver || '').slice(0, 48)}</td></tr>`);
  // 反应规则：命中升级触发器的线、静默线、事件活跃线
  const upgradeHit = s.id === 'triggers' && radarAlerts.some(a => /CFTC|insurance|personality|Gateway/i.test(a.title || ''));
  if (upgradeHit) proposals.push(`${s.id}：雷达命中升级触发器，当月做十问初筛`);
  if (st && s.status === 'watch' && radarAlerts.length === 0) proposals.push(`${s.id}：watch 且持续静默，候选降级`);
  if (radarAlerts.length >= 5) proposals.push(`${s.id}：本期雷达命中 ${radarAlerts.length} 条，人工过目是否调整雷达关键词`);
}

let md = `# 组合月报 ${month}\n\n生成 ${now.toISOString()}。人工接口：读毕点头。规则：雷达命中进月报，升级触发器命中当月十问初筛，任一线连续两年三问体检答否即清仓。\n\n`;
for (const s of portfolio.series) {
  const st = readLine(s.id);
  md += `## ${s.id}（${s.status}）\n- 驱动：${s.driver || '-'}\n`;
  if (st) {
    const recent = (st.radar.alerts || []).slice(-6);
    md += `- 雷达命中累计 ${st.radar.alerts.length} 条，采集事件累计 ${st.collect.events.length} 条\n`;
    for (const a of recent) md += `  - ${a.date.slice(0, 10)} [${a.channel}] ${a.title}\n`;
  } else if (s.home) md += `- 外部序列：${s.home}\n`;
  if (s.risks) md += `- 风险：${s.risks}\n`;
  md += '\n';
}
md += '## 升降级建议\n\n' + (proposals.length ? proposals.map(p => `- ${p}`).join('\n') : '无') + '\n';
writeFileSync(`docs/report-${month}.md`, md);

const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>longgame portfolio</title>
<style>body{font-family:ui-sans-serif,system-ui;max-width:1000px;margin:40px auto;padding:0 16px;color:#1f2328}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d0d7de;padding:8px;font-size:14px;text-align:left}code{background:#f6f8fa;padding:2px 4px;border-radius:4px}h1{font-size:22px}h2{font-size:16px;border-bottom:1px solid #d0d7de;padding-bottom:6px}</style>
<h1>longgame 组合仪表盘</h1><p>更新 ${now.toISOString()}。八条线动态运行：雷达每日扫外部消息，采集按各自节奏 diff，反应规则自动进月报。</p>
<table><tr><th>线</th><th>状态</th><th>节奏</th><th>最近雷达</th><th>采集事件</th><th>雷达命中</th><th>驱动</th></tr>${rows.join('\n')}</table>
<h2>升降级建议</h2><ul>${proposals.map(p => `<li>${p}</li>`).join('') || '<li>无</li>'}</ul>`;
writeFileSync('docs/index.html', html);
console.log(`report docs/report-${month}.md + dashboard docs/index.html, proposals=${proposals.length}`);
