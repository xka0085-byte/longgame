// SB 253 首窗名单抽取器：只从显式表格或 CSV 链接里取「企业名 + 可核实字段」。
// 原则：宁可不填，也不猜。没有表头能识别的企业名列时返回空数组，调用方不得覆盖已有名单。
const NAME_RE = /(entity|company|organization|business|corporation|企业|公司|机构|申报主体|名称)/i;
const DOCKET_RE = /(docket|entity[\s_-]?id|record[\s_-]?id|编号|档案号)/i;
const DATE_RE = /(date|submitted|filed|received|提交|日期|时间)/i;
const STATUS_RE = /(status|result|状态|结果)/i;

function textOf(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cellsOf(rowHtml) {
  return [...String(rowHtml).matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => textOf(m[1]));
}

function mapStatus(s) {
  const v = String(s ?? '').trim();
  if (!v) return '';
  if (/(confirmed|verified|approved|已确认|已提交|确认提交)/i.test(v)) return '已确认提交';
  if (/(not\s+found|no\s+record|未发现|未查到|无记录)/i.test(v)) return '官方记录中未发现';
  if (/(dispute|challenge|争议|异议)/i.test(v)) return '状态存在争议';
  if (/(unverified|unconfirmed|未核实|待核实)/i.test(v)) return '提交渠道未核实';
  return '';
}

function mapDocket(s) {
  const v = String(s ?? '').trim();
  if (/^(yes|y|true|是|有)$/i.test(v)) return '是';
  if (/^(no|n|false|否|无)$/i.test(v)) return '否';
  return '未核实';
}

function pickIndex(headers, re) {
  return headers.findIndex(h => re.test(h));
}

function rowsFromTable(tableHtml) {
  const rows = [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => cellsOf(m[1]));
  if (rows.length < 2) return [];
  const headers = rows[0];
  const ni = pickIndex(headers, NAME_RE);
  if (ni < 0) return [];
  const di = pickIndex(headers, DOCKET_RE);
  const ti = pickIndex(headers, DATE_RE);
  const si = pickIndex(headers, STATUS_RE);
  // 必须同时认出「企业名 + 档案号/状态」两类列，避免把导航表、日程表当成名单。
  if (di < 0 && si < 0) return [];
  const out = [];
  for (const cells of rows.slice(1)) {
    const name = String(cells[ni] ?? '').trim();
    if (name.length < 2 || name.length > 200) continue;
    if (/^(name|entity|company|企业|公司|名称)$/i.test(name)) continue;
    out.push({
      name,
      docket: di >= 0 ? mapDocket(cells[di]) : '未核实',
      date: ti >= 0 ? String(cells[ti] ?? '').trim().slice(0, 40) : '',
      status: si >= 0 ? mapStatus(cells[si]) : '',
      url: '',
    });
  }
  return out;
}

export function parseSb253Html(html) {
  const tables = [...String(html ?? '').matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(m => m[0]);
  for (const t of tables) {
    const rows = rowsFromTable(t);
    if (rows.length) return rows;
  }
  return [];
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseSb253Csv(csv) {
  const lines = String(csv ?? '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const ni = pickIndex(headers, NAME_RE);
  if (ni < 0) return [];
  const di = pickIndex(headers, DOCKET_RE);
  const ti = pickIndex(headers, DATE_RE);
  const si = pickIndex(headers, STATUS_RE);
  // 必须同时认出「企业名 + 档案号/状态」两类列，避免把导航表、日程表当成名单。
  if (di < 0 && si < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const name = String(cells[ni] ?? '').trim();
    if (name.length < 2 || name.length > 200) continue;
    out.push({
      name,
      docket: di >= 0 ? mapDocket(cells[di]) : '未核实',
      date: ti >= 0 ? String(cells[ti] ?? '').slice(0, 40) : '',
      status: si >= 0 ? mapStatus(cells[si]) : '',
      url: '',
    });
  }
  return out;
}

export function findCsvLinks(html, baseUrl) {
  const out = [];
  for (const m of String(html ?? '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const label = textOf(m[2]);
    if (!/\.csv(\?|#|$)/i.test(href)) continue;
    if (!/(list|entity|entities|filing|submission|名单|企业|提交)/i.test(label + ' ' + href)) continue;
    try { out.push(new URL(href, baseUrl).toString()); } catch { /* skip */ }
  }
  return [...new Set(out)];
}
