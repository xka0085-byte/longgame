// 扫描日的周口径，与 mcpreflight/scripts/lib/period.mjs 同源（两边都改了要同步）。
//
// 本仓库只用它做一件事：判断上游 registry-changes.json 的一次 diff 是不是真正的
// 跨周对比。上游在手动 dispatch 或重试时会重新生成 feed，如果 longgame 照单全收，
// 就会把"今天 10:13 对今天 08:57"的扫描抖动记成一次周变化——171 条 statusChanged
// 会被月报当成"一周内 171 个端点变了"。所以只有跨 ISO 周的 diff 才允许推进序列。

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(s) {
  if (typeof s !== 'string') return null;
  const m = YMD.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return d;
}

export function isoWeekKey(s) {
  const d = parseYmd(s);
  if (!d) return null;
  const day = d.getUTCDay() || 7;
  const thursday = new Date(d.getTime());
  thursday.setUTCDate(d.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export function daysBetween(fromYmd, toYmd) {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function comparisonKind(scanDate, comparedAgainst) {
  if (!comparedAgainst) return 'baseline';
  const a = parseYmd(scanDate);
  const b = parseYmd(comparedAgainst);
  if (!a || !b) return 'unknown';
  if (scanDate === comparedAgainst) return 'same-day';
  return isoWeekKey(scanDate) === isoWeekKey(comparedAgainst) ? 'same-week' : 'cross-week';
}
