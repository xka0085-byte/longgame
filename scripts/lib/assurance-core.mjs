// 工程保证核心：契约样本判定、发布资格、规范化哈希、溯源与隔离状态。
// 只读业务口径；不生成任何业务数字，不修改 data/。
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const ROOT = process.cwd();
export const PAGE_LINES = new Set([
  'sb253-docket', 'aiact-register', 'c2pa-spec', 'compute-futures', 'state-ai-laws', 'triggers',
]);

export function readJSON(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function sha256Bytes(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(path) {
  if (!existsSync(path)) return null;
  return sha256Bytes(readFileSync(path));
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

export function normalizedSha(run) {
  if (!run) return null;
  return sha256Bytes(Buffer.from(JSON.stringify(canonical(run))));
}

export function isIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isInt(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function pageRecordErrors(lineId, page, index, { strict }) {
  const errors = [];
  const where = `page[${index}]`;
  if (!page || typeof page !== 'object' || Array.isArray(page)) return [`${where} is not an object`];
  if (typeof page.id !== 'string' || !page.id) errors.push(`${where}.id must be non-empty string`);

  if (!isInt(page.status)) errors.push(`${where}.status must be integer`);
  if (typeof page.changed !== 'boolean') {
    if (strict || page.changed !== undefined) errors.push(`${where}.changed must be boolean`);
  }
  if (typeof page.keywordHit !== 'boolean') {
    if (strict || page.keywordHit !== undefined) errors.push(`${where}.keywordHit must be boolean`);
  }

  const hasUnavailable = Object.prototype.hasOwnProperty.call(page, 'unavailable');
  if (!hasUnavailable && strict) errors.push(`${where}.unavailable is required`);
  const unavailable = hasUnavailable ? page.unavailable : (isInt(page.status) && (page.status < 200 || page.status >= 300));
  if (hasUnavailable && typeof page.unavailable !== 'boolean') errors.push(`${where}.unavailable must be boolean`);

  const hasBytes = Object.prototype.hasOwnProperty.call(page, 'bytes');
  if (!hasBytes && strict) errors.push(`${where}.bytes is required`);
  if (hasBytes && (!isInt(page.bytes) || page.bytes < 0)) errors.push(`${where}.bytes must be a non-negative integer`);

  if (!Object.prototype.hasOwnProperty.call(page, 'sig') && strict) errors.push(`${where}.sig is required (string or null)`);
  if (page.sig !== undefined && page.sig !== null && typeof page.sig !== 'string') {
    errors.push(`${where}.sig must be string or null`);
  }

  if (isInt(page.status) && (page.status < 200 || page.status >= 300) && unavailable !== true) {
    errors.push(`${where}: non-2xx status ${page.status} must set unavailable=true`);
  }
  // 新格式显式写 unavailable=true 时必须无签名；历史记录没有该字段，
  // 其 sig 是旧实现留下的上一轮签名，不能追溯判为新增违规。
  if (unavailable === true && page.sig !== null && (strict || hasUnavailable)) {
    errors.push(`${where}: unavailable=true must not carry a content signature`);
  }
  if (unavailable === true && isInt(page.status) && page.status === 200 && !page.reason) {
    errors.push(`${where}: status 200 marked unavailable requires a reason`);
  }
  if (lineId === 'triggers' && strict && typeof page.keywordHit !== 'boolean') {
    errors.push(`${where}.keywordHit must be boolean for triggers`);
  }
  return errors;
}

export function evaluateRun(lineId, data, { strict = false } = {}) {
  const errors = [];
  const runs = data?.collect?.runs;
  if (!Array.isArray(runs) || runs.length === 0) return ['collect.runs is empty'];
  const latest = runs.at(-1);
  if (!isIso(latest.date)) errors.push('run.date must be an ISO timestamp');

  if (PAGE_LINES.has(lineId)) {
    const pages = latest.pages;
    if (!Array.isArray(pages) || pages.length === 0) {
      errors.push('pages must be a non-empty array');
    } else {
      const ids = new Set();
      pages.forEach((page, i) => {
        errors.push(...pageRecordErrors(lineId, page, i, { strict }));
        if (page && typeof page.id === 'string') {
          if (ids.has(page.id)) errors.push(`duplicate page.id ${page.id}`);
          ids.add(page.id);
        }
      });
    }
  } else if (lineId === 'agent-dirs') {
    const dirs = latest.dirs;
    const keys = latest.keys;
    if (!dirs || typeof dirs !== 'object' || Array.isArray(dirs) || Object.keys(dirs).length === 0) {
      errors.push('dirs must be a non-empty object');
    } else {
      for (const [url, dir] of Object.entries(dirs)) {
        if (!dir || typeof dir !== 'object') { errors.push(`dirs[${url}] must be an object`); continue; }
        if (!isInt(dir.keyCount) || dir.keyCount < 0) errors.push(`dirs[${url}].keyCount must be non-negative integer`);
        if (!isInt(dir.status)) errors.push(`dirs[${url}].status must be integer`);
        if (!keys || typeof keys !== 'object' || Array.isArray(keys)) errors.push('keys must be an object keyed by directory URL');
        else if (Array.isArray(keys[url]) && isInt(dir.keyCount) && keys[url].length !== dir.keyCount) {
          errors.push(`dirs[${url}].keyCount=${dir.keyCount} disagrees with keys[${url}].length=${keys[url].length}`);
        }
      }
    }
  } else if (lineId === 'eidas-tsl') {
    if (!Array.isArray(latest.pointers) || latest.pointers.length === 0) errors.push('pointers must be a non-empty array');
    else if (!latest.pointers.every(p => typeof p === 'string' && p.length > 0)) errors.push('pointers must contain non-empty strings');
    if (!isInt(latest.pointerCount) || latest.pointerCount < 0) errors.push('pointerCount must be a non-negative integer');
    else if (Array.isArray(latest.pointers) && latest.pointerCount !== latest.pointers.length) {
      errors.push(`pointerCount=${latest.pointerCount} disagrees with pointers.length=${latest.pointers.length}`);
    }
  } else if (lineId === 'formd-sweep') {
    if (!Array.isArray(latest.queries) || latest.queries.length === 0) {
      errors.push('queries must be a non-empty array');
    } else {
      latest.queries.forEach((q, i) => {
        if (!q || typeof q !== 'object') { errors.push(`query[${i}] is not an object`); return; }
        if (typeof q.keyword !== 'string' || !q.keyword) errors.push(`query[${i}].keyword must be non-empty string`);
        if (!isInt(q.allTime) || q.allTime < 0) errors.push(`query[${i}].allTime must be non-negative integer`);
        if (!isInt(q.thisMonth) || q.thisMonth < 0) errors.push(`query[${i}].thisMonth must be non-negative integer`);
      });
    }
  } else if (lineId === 'grid-queue') {
    const e = latest.eiaCounts;
    if (!e || typeof e !== 'object' || Array.isArray(e)) {
      errors.push('eiaCounts must be an object');
    } else {
      for (const key of ['operating', 'planned', 'retired', 'canceled', 'plannedMW', 'canceledMW', 'retiredMW', 'bytes']) {
        if (e[key] !== null && e[key] !== undefined && (typeof e[key] !== 'number' || !Number.isFinite(e[key]))) {
          errors.push(`eiaCounts.${key} must be a finite number`);
        }
      }
      if (typeof e.file !== 'string' || !/\.(xlsx|xls)$/i.test(e.file)) errors.push('eiaCounts.file must be an xlsx/xls file name');
      if (latest.eia?.error) errors.push(`collection error recorded: ${latest.eia.error}`);
      if (latest.eia?.parseError) errors.push(`parse error recorded: ${latest.eia.parseError}`);
    }
  } else if (lineId === 'trust-delta') {
    // 这条线只有两个坐标是硬的：这一次扫描的规模（本来在册多少个端点）与这一次判定的
    // 变化数。上游只要少给一个，这轮就不能算注册表没变化，必须显式判失败。
    if (typeof latest.scanDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(latest.scanDate)) {
      errors.push('scanDate must be a YYYY-MM-DD string');
    }
    const sum = latest.summary;
    if (!sum || typeof sum !== 'object' || Array.isArray(sum)) {
      errors.push('summary must be an object');
    } else {
      if (!isInt(sum.serversThisWeek) || sum.serversThisWeek <= 0) errors.push('summary.serversThisWeek must be a positive integer');
      if (!isInt(sum.statusChanged) || sum.statusChanged < 0) errors.push('summary.statusChanged must be a non-negative integer');
      for (const k of ['added', 'addedUncomparable', 'removed']) {
        if (sum[k] != null && (!isInt(sum[k]) || sum[k] < 0)) errors.push(`summary.${k} must be a non-negative integer when present`);
      }
    }
    const dir = latest.direction;
    if (!dir || typeof dir !== 'object' || Array.isArray(dir)) {
      errors.push('direction must be an object');
    } else {
      for (const k of ['toPass', 'fromPass', 'unknownStatusInvolved']) {
        if (!isInt(dir[k]) || dir[k] < 0) errors.push(`direction.${k} must be a non-negative integer`);
      }
      // 方向分解是 statusChanged 的子集。加起来超了说明解析串位或重复计数。
      if (isInt(dir.toPass) && isInt(dir.fromPass) && isInt(sum?.statusChanged)
        && dir.toPass + dir.fromPass > sum.statusChanged) {
        errors.push(`direction.toPass+fromPass=${dir.toPass + dir.fromPass} exceeds summary.statusChanged=${sum.statusChanged}`);
      }
      if (isInt(dir.unknownStatusInvolved) && isInt(sum?.statusChanged) && dir.unknownStatusInvolved > sum.statusChanged) {
        errors.push(`direction.unknownStatusInvolved=${dir.unknownStatusInvolved} exceeds summary.statusChanged=${sum.statusChanged}`);
      }
    }
    const sm = latest.samples;
    if (!sm || typeof sm !== 'object' || Array.isArray(sm)) {
      errors.push('samples must be an object');
    } else {
      for (const k of ['added', 'removed', 'statusChanged']) {
        if (!Array.isArray(sm[k])) { errors.push(`samples.${k} must be an array`); continue; }
        sm[k].forEach((x, i) => {
          if (!x || typeof x !== 'object' || Array.isArray(x)) { errors.push(`samples.${k}[${i}] is not an object`); return; }
          if (typeof x.name !== 'string' || !x.name) errors.push(`samples.${k}[${i}].name must be a non-empty string`);
        });
      }
    }
    // 采集器自己判失败时（HTTP/解析/形状）数据里留着 error，不能当有效运行读。
    if (typeof latest.error === 'string' && latest.error) errors.push(`collection error recorded: ${latest.error}`);
  }
  return errors;
}

function runEligible(lineId, run) {
  if (!run) return false;
  if (lineId === 'sb253-docket') {
    return Array.isArray(run.pages) && run.pages.some(p => p.status === 200 && p.unavailable !== true && p.sig);
  }
  if (PAGE_LINES.has(lineId)) {
    return Array.isArray(run.pages) && run.pages.length > 0 && run.pages.every(p =>
      isInt(p.status) && p.status >= 200 && p.status < 300 && p.unavailable !== true && p.sig);
  }
  if (lineId === 'agent-dirs') {
    return run.dirs && Object.keys(run.dirs).length > 0 &&
      Object.values(run.dirs).every(d => d.status === 200 && isInt(d.keyCount) && d.keyCount > 0);
  }
  if (lineId === 'eidas-tsl') return isInt(run.pointerCount) && run.pointerCount > 0;
  if (lineId === 'formd-sweep') {
    return Array.isArray(run.queries) && run.queries.length > 0 &&
      run.queries.every(q => isInt(q.thisMonth) && q.thisMonth >= 0);
  }
  if (lineId === 'grid-queue') {
    return run.eiaCounts && !run.eia?.error && !run.eia?.parseError &&
      isInt(run.eiaCounts.planned) && isInt(run.eiaCounts.canceled);
  }
  if (lineId === 'trust-delta') {
    // 可发布的前提是这一次扫描本身可用：有扫描日、规模为正、采集器没记 error。
    return typeof run.scanDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(run.scanDate) &&
      isInt(run.summary?.serversThisWeek) && run.summary.serversThisWeek > 0 &&
      isInt(run.summary?.statusChanged) && !run.error;
  }
  return false;
}

export function publicationState(lineId, data) {
  const runs = data?.collect?.runs;
  if (!Array.isArray(runs) || runs.length === 0) {
    return { publication_status: 'QUARANTINED', reason: 'no collection run', last_success_at: null, eligible: false };
  }
  const latest = runs.at(-1);
  const eligible = runEligible(lineId, latest);
  const good = [...runs].reverse().find(r => runEligible(lineId, r));
  let reason = null;
  if (!eligible) {
    if (lineId === 'sb253-docket' && latest.status === 'data-source-unavailable') reason = 'data-source-unavailable';
    else if (PAGE_LINES.has(lineId) && Array.isArray(latest.pages) && latest.pages.some(p => p.unavailable === true)) reason = 'data-source-unavailable';
    else reason = 'latest run is not publish-eligible';
  }
  return {
    publication_status: eligible ? 'PUBLISHED' : 'QUARANTINED',
    reason,
    last_success_at: good?.date ?? null,
    eligible,
  };
}

export function latestAssuranceLevel(contractText) {
  const m = contractText.match(/^assurance_level:\s*([0-5])\s*$/m);
  return m ? Number(m[1]) : null;
}
