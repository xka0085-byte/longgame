// sb253 首窗页更新器：node scripts/sb253-first-window.mjs
// 规则：
//  1) 只有 data/sb253-entities.json 里存在真实企业记录时才填表；没有名单就保留骨架。
//  2) 最新一次采集为 data-source-unavailable（202/204/空响应/抓取失败）时，页面显式标注
//     「数据源暂不可用」，不填零、不编企业名、不覆盖最近一次成功值。
//  3) 五个状态取值固定，出现其他值直接报错，避免页面自造状态。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PAGE = process.env.SB253_PAGE || 'docs/lines/sb253-first-window.html';
const STATE = 'data/lines/sb253-docket.json';
const ENTITIES = process.env.SB253_ENTITIES || 'data/sb253-entities.json';

const ALLOWED = new Set(['已确认提交', '官方记录中未发现', '提交渠道未核实', '数据源暂不可用', '状态存在争议']);
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

if (!existsSync(PAGE)) { console.error(`${PAGE} not found`); process.exit(1); }
let page = readFileSync(PAGE, 'utf8');

const st = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
const runs = st?.collect?.runs || [];
const latest = runs.at(-1);
const lastGood = runs.slice().reverse().find(r => r.status !== 'data-source-unavailable' && (r.pages || []).some(p => p.status === 200 && p.unavailable !== true && p.sig));

let entities = [];
if (existsSync(ENTITIES)) {
  const raw = JSON.parse(readFileSync(ENTITIES, 'utf8'));
  entities = Array.isArray(raw) ? raw : (raw.entities || []);
}
for (const [i, e] of entities.entries()) {
  if (!e.name) { console.error(`entities[${i}] missing name`); process.exit(1); }
  if (e.status && !ALLOWED.has(e.status)) { console.error(`entities[${i}] invalid status: ${e.status}`); process.exit(1); }
  if (e.docket && !['是', '否', '未核实'].includes(e.docket)) { console.error(`entities[${i}] invalid docket: ${e.docket}`); process.exit(1); }
}

const day = process.env.LONGGAME_TODAY || new Date().toISOString().slice(0, 10);
const runDay = latest?.date?.slice(0, 10) || null;
const codes = (latest?.pages || []).map(p => `${p.id}:${p.status ?? p.reason ?? p.error ?? '?'}`).join(' ');

let statusText;
if (entities.length) {
  statusText = `数据源状态：已载入 ${entities.length} 条企业记录；最近一次采集 ${esc(latest?.date || '无')}。` +
    (latest?.status === 'data-source-unavailable' ? ' 本次抓取无有效正文，名单沿用最近一次成功抽取的版本。' : '');
} else if (!latest) {
  statusText = '数据源状态：尚无采集记录，页面保持骨架。';
} else if (latest.status === 'data-source-unavailable') {
  statusText = `数据源状态：<strong>数据源暂不可用</strong>。最近一次采集 ${esc(latest.date)} 无有效正文（${esc(codes)}）。本期不产生任何企业记录，页面保留骨架，不填零、不编企业名。` +
    (lastGood ? ` 最近一次有效抓取为 ${esc(lastGood.date)}。` : '');
} else {
  statusText = `数据源状态：最近一次采集 ${esc(latest.date)} 成功，但数据源内未出现企业名单字段，页面保持骨架。`;
}

let rows;
if (entities.length) {
  rows = entities.map(e => `    <tr>
      <td>${esc(e.name)}</td>
      <td>${esc(e.docket || '未核实')}</td>
      <td>${esc(e.date || '')}</td>
      <td>${e.url ? `<a href="${esc(e.url)}" rel="nofollow noopener">${esc(e.url)}</a>` : ''}</td>
      <td>${esc(e.status || '未核实')}</td>
    </tr>`).join('\n');
} else {
  const note = latest?.status === 'data-source-unavailable'
    ? `本期采集无有效正文（${esc(codes)}），标注为数据源暂不可用。`
    : '本地数据集内没有企业名单字段。';
  rows = `    <tr>
      <td class="empty" colspan="5">
        本页当前为骨架版本：${note}因此没有可填的企业行。
<p class="note">数据源说明：截至 ${esc(day)}，我方未检索到 CARB 公开发布的 SB 253 首窗提交名单。entity_id=47456 的 docket 属于 SB 261，不得当作 SB 253 名单使用。SB 253 的官方入口是 2026 Report Intake Platform 与 climatedisclosure@arb.ca.gov，是否会公开发布尚不可知。核实记录见 <a href="../notes/sb253-source-verification-2026-10-21.md">来源核实文档</a>。</p>
        名单载入后每家企业一行。此处的空表不代表任何企业提交与否，见页首声明句。
      </td>
    </tr>`;
}

if (!page.includes('<!-- ENTITY-ROWS:START -->') || !page.includes('<!-- ENTITY-ROWS:END -->')) {
  console.error('ENTITY-ROWS markers missing in page'); process.exit(1);
}
page = page.replace(/<!-- ENTITY-ROWS:START -->[\s\S]*?<!-- ENTITY-ROWS:END -->/,
  `<!-- ENTITY-ROWS:START -->\n${rows}\n    <!-- ENTITY-ROWS:END -->`);
page = page.replace(/<div class="panel" id="source-status"[^>]*>[\s\S]*?<\/div>/,
  `<div class="panel" id="source-status" style="border-left:4px solid #9a6700;font-size:13px">${statusText}</div>`);
page = page.replace(/<div class="cite" id="cite-line">[\s\S]*?<\/div>/,
  `<div class="cite" id="cite-line">longgame sb253-docket，首窗名单，生成于 2026-11-10。</div>`);
// 名单已载入时去掉「模板」字样；仍为空名单时保留，避免把骨架页说成正式名单。
const titleSuffix = entities.length ? '' : '（模板）';
page = page.replace(/<title>[^<]*<\/title>/, `<title>sb253 首窗名单${titleSuffix} — longgame</title>`);
page = page.replace(/(<h1[^>]*>)SB 253 首窗名单（模板）(<\/h1>)/, `$1SB 253 首窗名单${titleSuffix}$2`);
page = page.replace(/<div style="margin-top:6px" id="build-record">[\s\S]*?<\/div>/,
  `<div style="margin-top:6px" id="build-record">构建记录：本骨架构建于 2026-10-21；首窗采集窗口 2026-11-01 至 2026-11-15，窗口内每日采集后刷新；页面最近更新 ${day}。以上为我方扫描结果，未经第三方复算。方法与边界见 <a href="../../llms.txt">llms.txt</a>。</div>`);

writeFileSync(PAGE, page);
console.log(`sb253 first-window page updated: entities=${entities.length} latest=${latest?.status || 'none'} page=${PAGE}`);
