// 数据自洽校验：只看 data/lines/*.json 本身，不碰任何渲染产物。
//
// 为什么要把这层从 verify.mjs 里拆出来：verify.mjs 校验的是"页面上的数字
// 与数据重算结果一致"，而 docs/lines/*.html 只有 publish.mjs 才渲染。把它
// 放进 assurance-gate（在 publish 之前跑）意味着拿本月新采的数据去比对
// 上个月的旧页面，只要数字有任何更新就必然失败——monthly-report 因此每月
// 都在 gate 上挂掉，而真正该拦的"采集失败产出空数据"反而被淹没了。
//
// 现在的分工：
//   verify-data.mjs  -> 数据本身是否成立（gate 阶段，publish 之前）
//   verify.mjs       -> 页面数字是否等于数据（publish 内部，渲染之后）
import { readFileSync, existsSync } from 'node:fs';

const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
let fails = 0, checks = 0;
const fail = (id, msg) => { fails++; console.log(`FAIL ${id}: ${msg}`); };
const read = (id) => {
  const f = `data/lines/${id}.json`;
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); }
  catch (e) { fail(id, `unreadable: ${e.message}`); return null; }
};

const NUMERIC = {
  'formd-sweep': (r) => (r.queries || []).filter(q => typeof q.thisMonth === 'number').map(q => q.thisMonth),
  'grid-queue': (r) => [r.eiaCounts?.plannedMW, r.eiaCounts?.operating].filter(v => typeof v === 'number'),
  'agent-dirs': (r) => Object.values(r.dirs || {}).map(d => d.keyCount).filter(v => typeof v === 'number'),
  'eidas-tsl': (r) => [r.pointerCount].filter(v => typeof v === 'number'),
};

for (const s of portfolio.series) {
  const st = read(s.id);
  // 与 verify.mjs 一致：没数据文件的线跳过而不是判失败。
  // portfolio 里有三条线（mcpreflight-weekly / erc8004-snapshot / protocol-watch）
  // 目前没有落地的 data/lines 文件，若判失败门禁会永久为红。
  if (!st) { console.log(`skip ${s.id}: no data file`); continue; }

  const runs = st.collect?.runs;
  checks++;
  if (!Array.isArray(runs) || runs.length === 0) { fail(s.id, 'no collect runs'); continue; }

  // 每条 run 必须有可解析的日期；事件流同理
  const badRun = runs.filter(r => !r.date || Number.isNaN(Date.parse(r.date)));
  if (badRun.length) fail(s.id, `${badRun.length} collect run(s) without a valid date`);

  const events = st.collect?.events || [];
  const badEv = events.filter(e => !e.date);
  if (badEv.length) fail(s.id, `${badEv.length} collect event(s) without date`);

  // 数字不得为负
  const nums = NUMERIC[s.id] ? NUMERIC[s.id](runs[runs.length - 1]) : [];
  const neg = nums.filter(v => v < 0);
  if (neg.length) fail(s.id, `negative figure(s): ${neg.join(',')}`);

  // 缩水守卫：抓采集静默失败。历史上 monthly-report 在 CI 上出过
  // formd-sweep 重算为 0 的情况——抓取失败但没有抛错，只是写进一条全空
  // 的 run。这种"数字归零/腰斩"必须由门禁拦下，不能当成正常更新放行。
  if (NUMERIC[s.id]) {
    const withNums = runs.slice().reverse()
      .map(r => ({ date: r.date, sum: NUMERIC[s.id](r).reduce((a, v) => a + v, 0), n: NUMERIC[s.id](r).length }))
      .filter(x => x.n > 0);
    if (withNums.length >= 2) {
      const [now, prev] = withNums;
      if (prev.sum > 0 && now.sum === 0) fail(s.id, `latest run on ${now.date} collected zero (previous ${prev.sum}) — looks like a silent collection failure`);
      else if (prev.sum > 0 && now.sum < prev.sum * 0.4) fail(s.id, `latest run on ${now.date} dropped to ${now.sum} from ${prev.sum} (>60%); confirm this is real before publishing`);
    }
  }

  // 最新一次 run 的日期不得早于上一条（防止乱序追加）
  if (runs.length > 1) {
    const a = Date.parse(runs[runs.length - 2].date);
    const b = Date.parse(runs[runs.length - 1].date);
    if (a && b && b < a) fail(s.id, 'collect runs appended out of order');
  }

  if (!badRun.length && !badEv.length && !neg.length) console.log(`ok ${s.id}: ${runs.length} run(s), ${events.length} event(s)`);
}

console.log(`\nverify-data: ${checks} line(s) checked, ${fails} failure(s)`);
process.exitCode = fails ? 1 : 0;
