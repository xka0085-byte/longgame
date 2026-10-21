// Build externally checkable attestations for every longgame line.
// Writes docs/attestations.json and docs/verify.html.
// Read-only with respect to portfolio.json and data files.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const portfolio = JSON.parse(fs.readFileSync(path.join(ROOT, 'portfolio.json'), 'utf8'));
const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/status.json'), 'utf8'));
const statusById = new Map(status.lines.map(l => [l.id, l]));

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

function headSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const commit = headSha();
const lines = [];

for (const s of portfolio.series) {
  const dataFile = path.join(ROOT, 'data/lines', `${s.id}.json`);
  const pageFile = path.join(ROOT, 'docs/lines', `${s.id}.html`);
  const st = statusById.get(s.id) || {};
  const sources = (s.collect?.pages || []).map(p => p.url).filter(Boolean);
  lines.push({
    id: s.id,
    kind: s.managed_in && s.managed_in !== 'longgame' ? 'external' : 'local',
    managed_in: s.managed_in || 'longgame',
    data_file: fs.existsSync(dataFile) ? `data/lines/${s.id}.json` : null,
    data_sha256: sha256(dataFile),
    page_file: fs.existsSync(pageFile) ? `docs/lines/${s.id}.html` : null,
    page_sha256: sha256(pageFile),
    source_urls: sources,
    last_success_at: st.last_success_at ?? null,
    freshness: st.freshness ?? null,
    external_checks: st.evidence_count_90d ?? 0,
    reproduce: 'node scripts/verify.mjs && node scripts/self-audit.mjs && node scripts/attest.mjs',
  });
}

const out = {
  generated_at: new Date().toISOString(),
  commit,
  note: 'Hashes identify the exact files behind each status. They are not a validation of correctness. External checks counts only entries in docs/evidence.json that came from someone outside this project.',
  lines,
};
fs.writeFileSync(path.join(ROOT, 'docs/attestations.json'), JSON.stringify(out, null, 2));

const rows = lines.map(l => {
  const short = l.data_sha256 ? l.data_sha256.slice(0, 12) : '—';
  const ev = l.external_checks ? String(l.external_checks) : '0';
  return `<tr><td><code>${l.id}</code></td><td>${l.kind}</td><td>${l.freshness ?? '—'}</td><td>${short}</td><td>${ev}</td><td>${l.source_urls[0] ? `<a href="${l.source_urls[0]}">source</a>` : '—'}</td></tr>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify longgame status yourself</title>
<meta name="description" content="Reproducible status attestations for longgame data series. Hashes, source URLs and the exact commands to check every number.">
<style>
:root{--bg:#0f1115;--fg:#e6e6e6;--muted:#9aa0a6;--line:#2a2f3a;--accent:#7ac7ff;--warn:#ffb86b}
@media (prefers-color-scheme:light){:root{--bg:#fafafa;--fg:#1b1b1b;--muted:#5a5f66;--line:#e2e4e8;--accent:#0b62a4;--warn:#a85b00}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:44px 20px 72px}
h1{font-size:28px;margin:0 0 8px}h2{font-size:19px;margin:32px 0 10px}
.sub{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}code{background:rgba(127,127,127,.14);padding:1px 5px;border-radius:4px}
.note{border-left:3px solid var(--warn);padding:10px 14px;background:rgba(255,184,107,.08);margin:16px 0}
a{color:var(--accent)}.cite{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
</style></head><body><main>
<h1>Verify this yourself</h1>
<p class="sub">Generated ${out.generated_at} at commit <code>${commit ? commit.slice(0, 12) : 'unknown'}</code>. Longgame data series.</p>
<p>Nothing on this page asks you to trust us. Each row points to the raw data file, its hash, the public source, and the command that recomputes every published number. If a hash does not match the file you downloaded, the status is not the one we published.</p>
<div class="note">External checks is the number of recorded cases where someone outside this project used, cited or recomputed a series. It is currently zero for most lines. A zero here means no external check exists, not that the data is correct.</div>
<h2>Status attestations</h2>
<table><thead><tr><th>Line</th><th>Kind</th><th>Freshness</th><th>Data SHA-256</th><th>External checks</th><th>Source</th></tr></thead>
<tbody>${rows}</tbody></table>
<h2>Reproduce</h2>
<pre><code>git clone https://github.com/xka0085-byte/longgame
cd longgame
node scripts/verify.mjs
node scripts/self-audit.mjs
node scripts/attest.mjs</code></pre>
<p><code>verify.mjs</code> recomputes published figures from raw data and exits non-zero on any mismatch. <code>self-audit.mjs</code> rebuilds freshness for all lines. <code>attest.mjs</code> rebuilds this page and the hash list.</p>
<h2>What is not verified</h2>
<p>No third party has independently recomputed the full set. The only two external reviews on record concern mcpreflight scanner results, not these series. If you recompute something and get a different number, open an issue with the command you ran and the output.</p>
<p><a href="https://github.com/xka0085-byte/longgame/issues">Issue tracker</a> · <a href="attestations.json">attestations.json</a></p>
<p class="cite">Citation: longgame status attestations, generated ${out.generated_at}. https://xka0085-byte.github.io/longgame/verify.html</p>
</main></body></html>`;
fs.writeFileSync(path.join(ROOT, 'docs/verify.html'), html);
console.log(`attest: ${lines.length} lines, commit ${commit ? commit.slice(0, 12) : 'unknown'}`);
