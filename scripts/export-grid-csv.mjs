// 导出 grid-queue 单行 CSV：只取最近一次含 eiaCounts 的运行，全部数值来自 json，不估算、不补零。
// 找不到 eiaCounts 直接报错退出，绝不写空行。
// 用法：node scripts/export-grid-csv.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = 'data/lines/grid-queue.json';
const OUT = 'docs/data/grid-queue-latest.csv';
const COLS = [
  'date',
  'source_file',
  'operating_rows',
  'planned_rows',
  'planned_mw',
  'canceled_rows',
  'canceled_mw',
  'retired_rows',
  'retired_mw',
];

const die = msg => {
  console.error(`export-grid-csv: ${msg}`);
  process.exit(1);
};

if (!existsSync(SRC)) die(`source not found: ${SRC}`);

let state;
try {
  state = JSON.parse(readFileSync(SRC, 'utf8'));
} catch (e) {
  die(`cannot parse ${SRC}: ${e.message}`);
}

const runs = Array.isArray(state?.collect?.runs) ? state.collect.runs : [];
const run = runs
  .slice()
  .reverse()
  .find(r => r && r.eiaCounts && typeof r.eiaCounts.plannedMW === 'number');

if (!run) {
  die(`no run with eiaCounts in ${SRC}; refusing to write a placeholder or empty row`);
}

const e = run.eiaCounts;
const num = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) die(`${name} is not a finite number in run ${run.date}`);
  return v;
};
const str = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) die(`${name} is missing or empty in run ${run.date}`);
  return v.trim();
};

const row = {
  date: str(run.date, 'run.date').slice(0, 10),
  source_file: str(e.file, 'eiaCounts.file'),
  operating_rows: num(e.operating, 'eiaCounts.operating'),
  planned_rows: num(e.planned, 'eiaCounts.planned'),
  planned_mw: num(e.plannedMW, 'eiaCounts.plannedMW'),
  canceled_rows: num(e.canceled, 'eiaCounts.canceled'),
  canceled_mw: num(e.canceledMW, 'eiaCounts.canceledMW'),
  retired_rows: num(e.retired, 'eiaCounts.retired'),
  retired_mw: num(e.retiredMW, 'eiaCounts.retiredMW'),
};

const cell = v => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csv = [COLS.join(','), COLS.map(c => cell(row[c])).join(',')].join('\n') + '\n';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv, 'utf8');

// 自检：写出的第二行 planned_mw 必须逐字等于 json 里的 eiaCounts.plannedMW
const second = csv.split('\n')[1].split(',');
if (second[COLS.indexOf('planned_mw')] !== String(e.plannedMW)) {
  die(`written planned_mw does not match eiaCounts.plannedMW (${e.plannedMW})`);
}

console.log(
  `export-grid-csv: wrote ${OUT} (date=${row.date}, source_file=${row.source_file}, planned_mw=${row.planned_mw}, source_run=${run.date})`,
);
