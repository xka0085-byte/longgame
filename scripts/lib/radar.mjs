// 雷达频道库：四频道抓取器，全部免费无键。零依赖。
const UA = { 'User-Agent': 'longgame-portfolio/0.2 personal research' };

async function jget(url, timeout = 30000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function tget(url, timeout = 30000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// HN 新故事
export async function hn(query, sinceUnix) {
  const u = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${sinceUnix}&hitsPerPage=5`;
  const j = await jget(u);
  return (j.hits || []).map(h => ({ title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, date: h.created_at }));
}

// 联邦公报新文件
export async function federalRegister(term, sinceDate) {
  const u = `https://www.federalregister.gov/api/v1/documents.json?conditions%5Bterm%5D=${encodeURIComponent(term)}&conditions%5Bpublication_date%5D%5Bgte%5D=${sinceDate}&per_page=5`;
  const j = await jget(u);
  return (j.results || []).map(d => ({ title: d.title, url: d.html_url, date: d.publication_date }));
}

// Google News RSS（免费无键）
export async function googleNews(query) {
  const u = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:EN`;
  const xml = await tget(u);
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5).map(m => m[1]);
  return items.map(it => ({
    title: (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
    url: (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]?.trim(),
    date: (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]?.trim(),
  })).filter(x => x.title);
}

// GitHub 最新 release（可选频道）
export async function ghReleases(repo) {
  const j = await jget(`https://api.github.com/repos/${repo}/releases?per_page=3`);
  return j.map(r => ({ title: `${repo} ${r.tag_name}`, url: r.html_url, date: r.published_at }));
}

export async function radarOnce(ch) {
  if (ch.channel === 'hn') return hn(ch.query, ch.sinceUnix);
  if (ch.channel === 'fr') return federalRegister(ch.query, ch.sinceDate);
  if (ch.channel === 'gn') return googleNews(ch.query);
  if (ch.channel === 'ghrel') return ghReleases(ch.repo);
  throw new Error(`unknown channel ${ch.channel}`);
}
