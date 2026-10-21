// EIA-860M 解析采集：先剔除页面上的未来月份假链接，再解析最新可用文件
// 判据：只有文件头为 PK（zip/xlsx）才算真文件。零猜测。
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', Accept: '*/*' };
const PAGE = 'https://www.eia.gov/electricity/data/eia860m/';

async function candidateLinks() {
  const r = await fetch(PAGE, { headers: UA, signal: AbortSignal.timeout(30000) });
  const html = await r.text();
  const links = [...html.matchAll(/href="([^"]+\.(?:xlsx|xls))"/gi)].map(m => m[1]);
  return [...new Set(links.map(u => new URL(u, PAGE).href))];
}

async function fetchReal(url) {
  const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!r.ok) return null;
  const b = Buffer.from(await r.arrayBuffer());
  if (b.subarray(0, 2).toString('latin1') !== 'PK') return null; // HTML 占位页，不是 xlsx
  return { buf: b, finalUrl: r.url };
}

export async function collectEia() {
  const links = await candidateLinks();
  const tried = [];
  let chosen = null;
  for (const u of links) {
    const got = await fetchReal(u);
    if (got) { chosen = { url: u, ...got }; break; }
    tried.push(u.split('/').pop());
  }
  if (!chosen) return { error: 'no real xlsx found', tried };
  const dir = mkdtempSync(path.join(tmpdir(), 'eia-'));
  const file = path.join(dir, 'generator.xlsx');
  writeFileSync(file, chosen.buf);
  const py = execFileSync('python', [path.resolve('scripts/lib/eia_parse.py'), file], { encoding: 'utf8', timeout: 120000 });
  return { url: chosen.url, bytes: chosen.buf.length, fakeLinks: tried, summary: JSON.parse(py) };
}
