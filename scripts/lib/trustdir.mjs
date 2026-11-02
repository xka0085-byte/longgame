// registry-changes.json 的解析与形状校验：只做本地判定，不发网络请求。
//
// 源的语义由 mcpreflight 每周 rescan 生成（trust-data/registry-changes.json）：
// 它只描述"这一个扫描日相对上一个扫描日"的差异，本身没有时间序列。
// 本模块把一份 diff 转成一条可长期追加的记录，并在源异常时明确拒绝，
// 避免把上游的坏数据当成"注册表发生变化"写进历史。
//
// 为什么单独成文件而不是写在 line.mjs 里：line.mjs 的分支是 fetch + 落盘的
// 混合体，无法在没有网络的情况下验收解析逻辑；抽出来后 fail 判定的三种情形
// （正常、空、非法）可以单独跑，后续补固定样本时不用再改采集器。

export const KNOWN_STATUSES = new Set(['PASS', 'FAIL', 'AUTH_GATED', 'UNKNOWN']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// 只认 {name,url} 的样本，缺 name 的条目直接丢弃——下游要用 name 做引用，
// 留一条没有主键的记录只会让月报里出现空条目。
function pickSample(arr, limit) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === 'object' && typeof x.name === 'string' && x.name)
    .slice(0, limit)
    .map((x) => {
      const out = { name: x.name, url: typeof x.url === 'string' ? x.url : null };
      if (typeof x.from === 'string') out.from = x.from;
      if (typeof x.to === 'string') out.to = x.to;
      if (typeof x.lastStatus === 'string') out.lastStatus = x.lastStatus;
      return out;
    });
}

/**
 * @param {object} doc  registry-changes.json 解析后的对象
 * @param {object} opt  { nowISO, prevScan, sampleLimit }
 * @returns {{ run: object, events: object[], errors: string[] }}
 */
export function buildTrustDeltaRun(doc, { nowISO, prevScan = null, sampleLimit = 20 } = {}) {
  const errors = [];
  const run = {};

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { run, events: [], errors: ['root is not an object'] };
  }

  const scanDate = typeof doc.scanDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(doc.scanDate) ? doc.scanDate : null;
  if (!scanDate) errors.push('scanDate is not a YYYY-MM-DD string');

  const sum = doc.summary;
  if (!sum || typeof sum !== 'object' || Array.isArray(sum)) errors.push('summary is missing');

  const summary = {
    serversThisWeek: isNum(sum?.serversThisWeek) ? sum.serversThisWeek : null,
    added: isNum(sum?.added) ? sum.added : null,
    addedUncomparable: isNum(sum?.addedUncomparable) ? sum.addedUncomparable : null,
    removed: isNum(sum?.removed) ? sum.removed : null,
    statusChanged: isNum(sum?.statusChanged) ? sum.statusChanged : null,
  };
  // 规模与变化数是这条线的两个坐标，缺任何一个都不能算一次有效采集。
  for (const k of ['serversThisWeek', 'statusChanged']) {
    if (summary[k] === null) errors.push(`summary.${k} is not a non-negative number`);
  }
  // 规模为 0 只可能是上游采集失败（注册表不会一夜清空），不能记成"注册表归零"。
  if (summary.serversThisWeek === 0) errors.push('serversThisWeek is 0');

  run.scanDate = scanDate;
  run.generatedAt = typeof doc.generatedAt === 'string' ? doc.generatedAt : null;
  run.feedVersion = typeof doc.feedVersion === 'number' ? doc.feedVersion : null;
  run.baseline = doc.baseline === true;
  run.comparedAgainst = typeof doc.comparedAgainst === 'string' ? doc.comparedAgainst : null;
  run.comparedAgainstComplete = doc.comparedAgainstComplete === true;
  run.comparedAgainstCoverage = isNum(doc.comparedAgainstCoverage) ? doc.comparedAgainstCoverage : null;
  run.summary = summary;
  run.samples = {
    added: pickSample(doc.added, sampleLimit),
    removed: pickSample(doc.removed, sampleLimit),
    statusChanged: pickSample(doc.statusChanged, sampleLimit),
  };

  // 方向分解：PASS 是"这个匿名端点真的能连上"。其余状态在外部看都是同一个
  // "查不到"，但 PASS 与 AUTH_GATED 之间的迁移含义完全不同——前者更像回归，
  // 后者多半是对方开始要求凭据。分开计数，避免用一个"变化 264"盖过去。
  const sc = Array.isArray(doc.statusChanged) ? doc.statusChanged.filter((x) => x && typeof x === 'object') : [];
  const up = sc.filter((x) => x.to === 'PASS' && x.from !== 'PASS');
  const down = sc.filter((x) => x.from === 'PASS' && x.to !== 'PASS');
  const unknown = sc.filter((x) => !KNOWN_STATUSES.has(x.from) || !KNOWN_STATUSES.has(x.to));
  run.direction = {
    toPass: up.length,
    fromPass: down.length,
    unknownStatusInvolved: unknown.length,
  };

  const events = [];

  if (prevScan?.summary) {
    const before = prevScan.summary.serversThisWeek;
    if (typeof before === 'number' && typeof summary.serversThisWeek === 'number' && before !== summary.serversThisWeek) {
      events.push({
        date: nowISO,
        type: 'directory-size-changed',
        from: before,
        to: summary.serversThisWeek,
        delta: summary.serversThisWeek - before,
        since: prevScan.scanDate || null,
      });
    }
  }

  if (typeof summary.removed === 'number' && summary.removed > 0) {
    events.push({
      date: nowISO,
      type: 'endpoints-removed',
      count: summary.removed,
      sample: run.samples.removed.map((x) => x.name).slice(0, 5),
    });
  }

  for (const x of down.slice(0, 10)) {
    events.push({ date: nowISO, type: 'endpoint-downgraded', name: x.name, url: x.url ?? null, from: x.from, to: x.to });
  }
  for (const x of up.slice(0, 10)) {
    events.push({ date: nowISO, type: 'endpoint-upgraded', name: x.name, url: x.url ?? null, from: x.from, to: x.to });
  }

  // 抖动：上一轮是 A->B、这一轮是 B->A，说明判定在两次扫描之间来回翻。
  // 这类端点的"降级"不能当趋势读，所以单独计数并在事件里留痕。
  // 注意样本只有 sampleLimit 条，抖动数是下界，不是全量。
  const prevSamples = Array.isArray(prevScan?.samples?.statusChanged) ? prevScan.samples.statusChanged : [];
  const prevDir = new Map(prevSamples.map((x) => [x.url, `${x.from}->${x.to}`]));
  const flap = sc.filter((x) => x.url && prevDir.get(x.url) === `${x.to}->${x.from}`);
  if (flap.length) {
    run.flapping = flap.length;
    run.flappingBasis = `与 ${prevScan.scanDate || '上一轮'} 的抽样（${prevSamples.length} 条）比对，为非全量下界`;
    events.push({
      date: nowISO,
      type: 'status-flapping',
      count: flap.length,
      sample: flap.slice(0, 5).map((x) => x.name),
      basis: 'sample-only',
    });
  }

  return { run, events, errors };
}
