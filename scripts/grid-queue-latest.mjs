// grid-queue 月度简报页生成器：node scripts/grid-queue-latest.mjs
// 输入只取两处：data/lines/grid-queue.json 最近一次含 eiaCounts 的运行；
// docs/data/grid-queue-latest.csv（单行，由 export-grid-csv.mjs 从同一运行导出）。
// 两处数字必须一致，不一致直接报错退出，不生成页面、不用旧值或 0 顶替。
// 页面只做描述性汇总：无预测、无「全网电力需求」类表述。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const JSON_PATH = 'data/lines/grid-queue.json';
const DOCS = process.env.LONGGAME_DOCS || 'docs';
const CSV_PATH = `${DOCS}/data/grid-queue-latest.csv`;
const OUT = `${DOCS}/lines/grid-queue-latest.html`;

if (!existsSync(JSON_PATH)) { console.error(`${JSON_PATH} not found`); process.exit(1); }
if (!existsSync(CSV_PATH)) { console.error(`${CSV_PATH} not found`); process.exit(1); }

const state = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const run = [...(state.collect?.runs || [])].reverse().find(r => r.eiaCounts);
if (!run) { console.error('no run with eiaCounts in grid-queue.json'); process.exit(1); }
const e = run.eiaCounts;

const lines = readFileSync(CSV_PATH, 'utf8').trim().split(/\r?\n/);
if (lines.length !== 2) { console.error(`expected header + 1 row in ${CSV_PATH}, got ${lines.length} lines`); process.exit(1); }
const head = lines[0].split(',');
const row = lines[1].split(',');
const csv = Object.fromEntries(head.map((k, i) => [k, row[i]]));

const pairs = [
  ['planned_rows', 'planned', Number],
  ['planned_mw', 'plannedMW', Number],
  ['canceled_rows', 'canceled', Number],
  ['canceled_mw', 'canceledMW', Number],
  ['operating_rows', 'operating', Number],
  ['retired_rows', 'retired', Number],
  ['retired_mw', 'retiredMW', Number],
];
const mismatch = pairs.filter(([ck, jk, cast]) => cast(csv[ck]) !== Number(e[jk]));
if (mismatch.length) {
  console.error('CSV / JSON mismatch: ' + mismatch.map(([ck, jk]) => `${ck}=${csv[ck]} vs ${jk}=${e[jk]}`).join('; '));
  process.exit(1);
}
if (csv.source_file !== e.file) {
  console.error(`source_file mismatch: csv=${csv.source_file} json=${e.file}`);
  process.exit(1);
}
if (csv.date !== run.date.slice(0, 10)) {
  console.error(`date mismatch: csv=${csv.date} json_run=${run.date.slice(0, 10)}`);
  process.exit(1);
}

const day = run.date.slice(0, 10);
const generated = new Date().toISOString();
const srcUrl = run.eia?.url || '';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const html = `<!doctype html>
<html lang="zh">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>grid-queue 月度简报：计划新增 ${esc(e.plannedMW)} MW — longgame</title>
<style>
:root{--bg:#f6f8fa;--surface:#fff;--border:#d0d7de;--text:#1f2328;--muted:#57606a;--brand:#1a7f37;--cancel:#a40e26}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,system-ui;background:var(--bg);color:var(--text);line-height:1.55}
.wrap{max-width:820px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0}
h2{font-size:15px;margin:28px 0 8px;color:var(--muted)}
.sub{font-size:13px;color:var(--muted);margin-top:6px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin:16px 0}
.n{font-size:38px;font-weight:700;color:var(--brand);line-height:1.1}
.unit{font-size:22px;font-weight:600;color:var(--brand);margin-left:6px}
.lbl{font-size:14px;color:var(--muted);margin-top:6px}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:6px 18px;margin:12px 0}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border-bottom:1px solid var(--border);padding:10px 8px;text-align:left}
th{font-size:12px;color:var(--muted);font-weight:600}
td.num{font-family:ui-monospace,monospace;text-align:right}
tr:last-child td{border-bottom:none}
.cancel{color:var(--cancel);font-weight:600}
ul{font-size:13px;margin:6px 0;padding-left:20px}
li{margin:5px 0}
.d{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}
footer{margin-top:32px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}
</style>
<div class="wrap">
<h1>grid-queue 月度简报：计划新增 ${esc(e.plannedMW)} MW</h1>
<div class="sub">EIA-860M 发电机组数据 · 数据文件 ${esc(e.file)} · 采集运行 ${esc(run.date)}</div>

<div class="kpi">
  <div><span class="n">${esc(e.plannedMW)}</span><span class="unit">MW</span></div>
  <div class="lbl">计划新增（planned）合计，对应 ${esc(e.planned)} 行机组记录</div>
</div>

<h2>计划新增与已取消对比</h2>
<div class="panel">
<table>
  <thead><tr><th>类别</th><th style="text-align:right">行数</th><th style="text-align:right">容量合计（MW）</th></tr></thead>
  <tbody>
    <tr><td>计划新增（planned）</td><td class="num">${esc(e.planned)}</td><td class="num">${esc(e.plannedMW)}</td></tr>
    <tr><td class="cancel">已取消（canceled）</td><td class="num">${esc(e.canceled)}</td><td class="num">${esc(e.canceledMW)}</td></tr>
  </tbody>
</table>
</div>
<div class="sub">同一份月度文件中的两个状态分类，行数与 MW 均按文件原值列出，未做调整或估算。</div>

<h2>同文件其他状态（参考）</h2>
<div class="panel">
<table>
  <thead><tr><th>类别</th><th style="text-align:right">行数</th><th style="text-align:right">容量合计（MW）</th></tr></thead>
  <tbody>
    <tr><td>运行中（operating）</td><td class="num">${esc(e.operating)}</td><td class="num">—</td></tr>
    <tr><td>已退役（retired）</td><td class="num">${esc(e.retired)}</td><td class="num">${esc(e.retiredMW)}</td></tr>
  </tbody>
</table>
</div>
<div class="sub">operating 行的 MW 未在本页引用，因为当前数据文件只登记了该分类的行数。</div>

<h2>数据来源</h2>
<ul>
  <li>原始文件：EIA-860M ${srcUrl ? `<a href="${esc(srcUrl)}" rel="nofollow noopener">${esc(e.file)}</a>` : `<span class="d">${esc(e.file)}</span>`}（${esc(e.bytes)} bytes）</li>
  <li>机器可读：<a href="../data/grid-queue-latest.csv">docs/data/grid-queue-latest.csv</a>（单行，列序固定）</li>
  <li>采集记录：<span class="d">data/lines/grid-queue.json</span> 最近一次含 eiaCounts 的运行，时间 ${esc(run.date)}</li>
  <li>本页数字生成日期：${esc(day)}</li>
</ul>

<h2>口径与边界</h2>
<ul>
  <li>本页是单份 EIA-860M 月度文件的计数汇总，只描述该文件内的记录状态，不做任何外推。</li>
  <li>planned / canceled 为文件中的状态标签，本页不改写、不推断项目是否复工或取消原因。</li>
  <li>口径仅限该文件内的机组记录，不代表任何区域电网的实时供需。</li>
  <li>CSV 与 JSON 由同一运行导出；两者数字不一致时生成脚本报错，不发布页面。</li>
</ul>

<footer>longgame grid-queue 月度简报，本期为 ${esc(day)} 单份 EIA-860M 文件快照，页面生成于 ${esc(generated)}。<br>
<div class="cite" id="cite-line">引用格式：longgame grid-queue 月度简报（${esc(day)}），数字见 docs/data/grid-queue-latest.csv。</div>
方法与边界见 <a href="../../llms.txt">llms.txt</a>。</footer>
</div>
</html>
`;

writeFileSync(OUT, html);
console.log(`grid-queue latest page written: ${OUT} (${e.plannedMW} MW planned / ${e.canceledMW} MW canceled, ${day})`);
