// 统一执行器：node scripts/line.mjs <line-id> collect|radar
// 采集做数据 diff，雷达扫外部最新消息，命中写 alerts。状态全部落 data/lines/<id>.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { radarOnce } from './lib/radar.mjs';
import { collectEia } from './lib/eia860m.mjs';
import { parseSb253Html, parseSb253Csv, findCsvLinks } from './lib/sb253-entities.mjs';

const UA = { 'User-Agent': 'longgame-portfolio/0.2 personal research' };
const [lineId, mode] = process.argv.slice(2);
if (!lineId || !mode || !['collect', 'radar'].includes(mode)) {
  console.error('usage: node scripts/line.mjs <line-id> collect|radar');
  process.exit(1);
}
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
const line = portfolio.series.find(s => s.id === lineId);
if (!line) { console.error(`unknown line ${lineId}`); process.exit(1); }
if (!line.collect && !line.radar) { console.log(`${lineId}: external line, nothing to run here`); process.exit(0); }

mkdirSync('data/lines', { recursive: true });
const OUT = `data/lines/${lineId}.json`;
const st = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { collect: { runs: [], events: [] }, radar: { runs: [], items: [], alerts: [] } };
const nowISO = new Date().toISOString();
const sinceUnix = Math.floor((st.radar.runs.at(-1)?.date ? new Date(st.radar.runs.at(-1).date) : new Date(Date.now() - 3 * 864e5)).getTime() / 1000);
const sinceDate = st.radar.runs.at(-1)?.date?.slice(0, 10) || new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
const seenUrls = new Set(st.radar.items.map(i => i.url));
const newAlerts = [];

function pushItems(ch, items) {
  // 相关度过滤：查询的主要词必须都在标题里，压掉 Algolia 模糊匹配噪声
  const tokens = (ch.query || '').toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const excludeRe = ch.exclude ? new RegExp(ch.exclude, 'i') : null;
  for (const it of items) {
    if (!it.url || seenUrls.has(it.url)) continue;
    if (excludeRe && excludeRe.test(it.title || '')) continue;
    if (tokens.length) {
      const title = (it.title || '').toLowerCase();
      if (!tokens.every(t => title.includes(t))) continue;
    }
    const item = { line: lineId, channel: ch.channel, query: ch.query, title: it.title, url: it.url, date: it.date || nowISO, foundAt: nowISO };
    st.radar.items.push(item);
    newAlerts.push(item);
  }
}

if (mode === 'radar' && line.radar?.length) {
  for (const ch of line.radar) {
    try {
      const items = await radarOnce({ ...ch, sinceUnix, sinceDate });
      pushItems(ch, items);
      st.radar.runs.push({ date: nowISO, channel: ch.channel, query: ch.query, count: items.length });
    } catch (e) {
      st.radar.runs.push({ date: nowISO, channel: ch.channel, query: ch.query, error: String(e).slice(0, 120) });
    }
  }
  if (st.radar.items.length > 2000) st.radar.items = st.radar.items.slice(-2000);
  if (newAlerts.length) st.radar.alerts.push(...newAlerts.map(a => ({ date: nowISO, title: a.title, url: a.url, channel: a.channel })));
  if (st.radar.alerts.length > 500) st.radar.alerts = st.radar.alerts.slice(-500);
}

if (mode === 'collect' && line.collect) {
  const c = line.collect;
  const run = { date: nowISO };
  const prev = st.collect.runs.at(-1);
  let collectFailure = false;
  if (c.type === 'pages') {
    const matchMap = c.match || {};
    run.pages = [];
    for (const p of c.pages) {
      const prevPage = prev?.pages?.find(x => x.id === p.id);
      // 与上一轮「有效」抓取比对签名，跳过历史里被标记为不可用的运行
      const prevGood = [...st.collect.runs].reverse()
        .map(r => (r.pages || []).find(x => x.id === p.id))
        .find(x => x && x.status === 200 && x.unavailable !== true && x.sig);
      try {
        // 反爬/限流类状态码（202/403/417/429）先重试一次：CARB 这类站点对非浏览器客户端会随机拦截，
        // 单次抖动不该被记成数据源失效。仍失败才进入 unavailable 分支并留事件。
        const RETRYABLE = new Set([202, 403, 417, 429]);
        let r = await fetch(p.url, { headers: UA, signal: AbortSignal.timeout(30000) });
        let html = await r.text();
        if ((!r.ok || r.status === 202) && RETRYABLE.has(r.status)) {
          await new Promise(res => setTimeout(res, 2000));
          r = await fetch(p.url, { headers: UA, signal: AbortSignal.timeout(30000) });
          html = await r.text();
        }
        const bytes = Buffer.byteLength(html);
        const empty = html.trim().length === 0;
        // 202 (Accepted) 与空正文都不是成功抓取：CARB 一类站点会对非浏览器客户端
        // 返回 202 + 0 字节。此时既不能判定「内容变化」，也不能覆盖上一轮有效数据。
        const unavailable = r.status === 202 || r.status === 204 || !r.ok || empty;
        if (unavailable) {
          const reason = r.status === 202 ? 'http-202'
            : r.status === 204 ? 'http-204'
            : !r.ok ? `http-${r.status}`
            : 'empty-body';
          run.pages.push({ id: p.id, status: r.status, bytes, unavailable: true, tolerated: p.tolerate === true, throttled: RETRYABLE.has(r.status) || empty, reason, sig: null, changed: false, keywordHit: false });
          if (!prevPage?.unavailable) st.collect.events.push({ date: nowISO, page: p.id, type: 'data-source-unavailable', status: r.status, bytes, reason });
          continue;
        }
        const sig = `${html.length}:${Buffer.from(html).toString('base64').slice(0, 20)}`;
        const changed = prevGood && prevGood.sig !== sig;
        const matchRe = matchMap[p.id] ? new RegExp(matchMap[p.id], 'i') : null;
        const hit = matchRe && matchRe.test(html);
        run.pages.push({ id: p.id, status: r.status, bytes, sig, changed: !!changed, keywordHit: !!hit, unavailable: false });
        if (changed) st.collect.events.push({ date: nowISO, page: p.id, note: hit ? 'CHANGE + KEYWORD HIT' : 'content changed' });
        if (prevPage?.unavailable) st.collect.events.push({ date: nowISO, page: p.id, type: 'data-source-recovered', status: r.status, bytes });
        // SB 253 首窗：只有页面出现显式「企业名 + 档案号/状态」表格或 CSV 名单时才落盘；
        // 抽不到就保留上一份名单，绝不用空数组覆盖，也绝不猜企业名。
        // 只解析 SB 253 自身的页面：SB 261 的表单/评论名单不得当作 SB 253 名单。
        if (lineId === 'sb253-docket' && /sb[-_ ]?253/i.test(`${p.id} ${p.url}`)) {
          let entities = parseSb253Html(html);
          if (!entities.length) {
            for (const csvUrl of findCsvLinks(html, p.url)) {
              try {
                const cr = await fetch(csvUrl, { headers: UA, signal: AbortSignal.timeout(30000) });
                if (!cr.ok) continue;
                const parsed = parseSb253Csv(await cr.text());
                if (parsed.length) { entities = parsed.map(e => ({ ...e, url: csvUrl })); break; }
              } catch { /* 单个名单链接失败不阻断整轮采集 */ }
            }
          }
          if (entities.length) {
            writeFileSync('data/sb253-entities.json', JSON.stringify({
              source: p.url,
              extractedAt: nowISO,
              pageId: p.id,
              entities,
            }, null, 2));
            st.collect.events.push({ date: nowISO, page: p.id, type: 'sb253-entities-extracted', count: entities.length });
          }
        }
      } catch (e) {
        run.pages.push({ id: p.id, error: String(e).slice(0, 100), unavailable: true, tolerated: p.tolerate === true, reason: 'fetch-error' });
        if (!prevPage?.unavailable) st.collect.events.push({ date: nowISO, page: p.id, type: 'data-source-unavailable', reason: 'fetch-error' });
      }
    }
    const un = run.pages.filter(x => x.unavailable);
    if (un.length) {
      run.unavailablePages = un.length;
      run.status = un.length === run.pages.length ? 'data-source-unavailable' : 'partial';
      // 三档判定，目标是"数据不断档"同时不放过真故障：
      // 1) tolerate=true —— 该源已知长期不可抓取，永远只记事件（portfolio 里显式声明）；
      // 2) throttled —— 反爬/限流类状态码（202/403/417/429/空正文挑战页），属环境性拦截，
      //    不是数据源下线，放行但记事件，避免整周采集被单站反爬拖死；
      // 3) 其余（404/410/5xx/解析失败）—— 首次告警放行，连续两轮不可用才判失败。
      // 全线所有页同时不可用一律判失败，防止整条线静默停摆。
      const blocking = un.filter(x => {
        if (x.tolerated === true || x.throttled === true) return false;
        const prevSame = prev?.pages?.find(y => y.id === x.id);
        return prevSame?.unavailable === true;
      });
      const allDown = un.length === run.pages.length && !un.every(x => x.tolerated === true || x.throttled === true);
      if (blocking.length || allDown) {
        collectFailure = true;
        console.error(`${lineId}: ${un.length}/${run.pages.length} page(s) unavailable (blocking=${blocking.length}, allDown=${allDown})`);
      } else {
        console.warn(`${lineId}: ${un.length}/${run.pages.length} page(s) unavailable (tolerated/throttled/first occurrence, recorded as events only)`);
      }
    }
  } else if (c.type === 'dirs') {
    run.dirs = {}; const kidsMap = {};
    for (const url of c.dirs) {
      try {
        const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
        if (!r.ok) {
          run.dirs[url] = { status: r.status, unavailable: true, reason: `http-${r.status}` };
          collectFailure = true;
          console.error(`${lineId}: directory ${url} unavailable (status=${r.status})`);
          continue;
        }
        const body = await r.text();
        let kids = [];
        let parsed = false;
        try { const j = JSON.parse(body); const arr = j.keys || j.jwks?.keys || []; kids = arr.map(k => k.kid || k.x || `${k.kty}`).filter(Boolean); parsed = true; }
        catch { parsed = false; }
        if (!parsed) {
          run.dirs[url] = { status: r.status, unavailable: true, reason: 'unparseable' };
          collectFailure = true;
          console.error(`${lineId}: directory ${url} unparseable (${body.length}b)`);
          continue;
        }
        run.dirs[url] = { status: r.status, keyCount: kids.length };
        kidsMap[url] = kids;
        if (!r.ok || kids.length === 0) {
          collectFailure = true;
          console.error(`${lineId}: directory ${url} unusable (status=${r.status}, keys=${kids.length})`);
        }
        const old = prev?.keys?.[url];
        if (old) {
          const o = new Set(old), n = new Set(kids);
          for (const k of kids) if (!o.has(k)) st.collect.events.push({ date: nowISO, type: 'new-key', dir: url, kid: k });
          for (const k of old) if (!n.has(k)) st.collect.events.push({ date: nowISO, type: 'removed-or-rotated', dir: url, kid: k });
        }
      } catch (e) { run.dirs[url] = { error: String(e).slice(0, 100) }; collectFailure = true; console.error(`${lineId}: directory ${url} failed`); }
    }
    run.keys = kidsMap;
  } else if (c.type === 'edgar') {
    // EDGAR Form D 关键词备案量月度快照：当月计数加全历史计数，构成不可回填的资金流向序列
    run.queries = [];
    // 统计口径：取"最近一个完整自然月"，不是"当月至今"。
    // 原因：monthly-report 固定在每月 1 号跑，按当月至今统计时月初必然接近 0，
    // 2026-11-01 的 run 就是这样产出 10 个关键词全 0、被 verify-data 缩水守卫拦下。
    // 记完整上月才有月度可比性，也才配得上"月度备案量序列"这个定位。
    const _d = new Date(nowISO);
    const monthEndD = new Date(Date.UTC(_d.getUTCFullYear(), _d.getUTCMonth(), 0));
    const monthStartD = new Date(Date.UTC(monthEndD.getUTCFullYear(), monthEndD.getUTCMonth(), 1));
    const _iso = (x) => x.toISOString().slice(0, 10);
    const monthStart = _iso(monthStartD);
    const monthEnd = _iso(monthEndD);
    const monthLabel = monthStart.slice(0, 7);
    run.monthWindow = { month: monthLabel, startdt: monthStart, enddt: monthEnd };
    for (const kw of c.keywords) {
      try {
        const base = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(kw)}%22&forms=${c.form || 'D'}`;
        const all = await (async () => {
          for (let i = 0; i < 2; i++) {
            const j = await (await fetch(base, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
            if (j.hits?.total?.value != null) return j;
            await new Promise(r => setTimeout(r, 1500));
          }
          return {};
        })();
        const mo = await (await fetch(`${base}&dateRange=custom&startdt=${monthStart}&enddt=${monthEnd}`, { headers: UA, signal: AbortSignal.timeout(30000) })).json();
        const entry = { keyword: kw, month: monthLabel, allTime: all.hits?.total?.value ?? null, thisMonth: mo.hits?.total?.value ?? null };
        run.queries.push(entry);
        if (entry.allTime == null || entry.thisMonth == null) {
          collectFailure = true;
          console.error(`${lineId}: edgar keyword ${kw} returned missing totals`);
        }
        const prevAll = prev?.runs?.find(r => r.queries)?.queries?.find(q => q.keyword === kw);
        if (prevAll && typeof entry.thisMonth === 'number' && entry.thisMonth > 0 && prevAll.allTime === entry.allTime) {
          // 全历史数没涨但当月有数，视为口径异常，如实记录
          st.collect.events.push({ date: nowISO, type: 'edgar-anomaly', keyword: kw });
        }
      } catch (e) { run.queries.push({ keyword: kw, error: String(e).slice(0, 100) }); collectFailure = true; console.error(`${lineId}: edgar keyword ${kw} failed`); }
    }
  } else if (c.type === 'eia860m') {
    try {
      const res = await collectEia();
      run.eia = res;
      if (res.summary) {
        const s = res.summary;
        run.eiaCounts = {
          operating: s.sheets.Operating ?? null,
          planned: s.sheets.Planned ?? null,
          retired: s.sheets.Retired ?? null,
          canceled: s.sheets['Canceled or Postponed'] ?? null,
          plannedMW: s.plannedMW ?? null,
          canceledMW: s.canceledMW ?? null,
          retiredMW: s.retiredMW ?? null,
          file: res.url.split('/').pop(),
          bytes: res.bytes,
          fakeLinks: res.fakeLinks?.length ?? 0,
        };
        const prevE = prev?.eiaCounts;
        const missing = Object.entries(run.eiaCounts)
          .filter(([k, v]) => k !== 'file' && k !== 'bytes' && k !== 'fakeLinks' && v == null)
          .map(([k]) => k);
        if (missing.length) {
          run.eiaCounts.missingFields = missing;
          collectFailure = true;
          console.error(`${lineId}: EIA counts missing ${missing.join(',')}`);
        }
        if (prevE && prevE.planned !== run.eiaCounts.planned) {
          st.collect.events.push({ date: nowISO, type: 'planned-units-changed', from: prevE.planned, to: run.eiaCounts.planned });
        }
        if (prevE && prevE.canceled !== run.eiaCounts.canceled) {
          st.collect.events.push({ date: nowISO, type: 'canceled-units-changed', from: prevE.canceled, to: run.eiaCounts.canceled });
        }
      } else if (res.error) {
        collectFailure = true;
        console.error(`${lineId}: EIA no valid file`);
        st.collect.events.push({ date: nowISO, type: 'eia-no-valid-file', tried: res.tried });
      }
    } catch (e) { run.error = String(e).slice(0, 160); collectFailure = true; console.error(`${lineId}: EIA collect failed: ${run.error}`); }
  } else if (c.type === 'lotl') {
    try {
      const r = await fetch(c.url, { headers: UA, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`LOTL http-${r.status}`);
      const xml = await r.text();
      const locs = [...xml.matchAll(/(?:TSLLocation|SchemeTSLLocation)>(https?:[^<]+)/g)].map(m => m[1].trim()).filter(u => !/eu-lotl\.xml/.test(u));
      run.pointers = [...new Set(locs)].sort();
      run.pointerCount = run.pointers.length;
      if (run.pointerCount === 0) {
        collectFailure = true;
        console.error(`${lineId}: LOTL unusable (status=${r.status}, pointers=${run.pointerCount})`);
      }
      const prevPtrs = prev?.pointers || [];
      if (prevPtrs.length) {
        const pset = new Set(prevPtrs);
        for (const u of run.pointers) if (!pset.has(u)) st.collect.events.push({ date: nowISO, type: 'tsl-added', url: u });
        for (const u of prevPtrs) if (!run.pointers.includes(u)) st.collect.events.push({ date: nowISO, type: 'tsl-removed', url: u });
      }
    } catch (e) { run.error = String(e).slice(0, 140); collectFailure = true; console.error(`${lineId}: LOTL collect failed`); }
  }
  st.collect.runs.push(run);
  // 把本轮的成败判定写进数据本身。没有这个字段时，下游只能靠"数不可用页"反推，
  // 而 dirs / edgar / eia / lotl 这几类线根本没有 pages 字段，会被误判成"整轮全挂"。
  // 判定权归采集器自己，下游只读结论。
  run.ok = !collectFailure;
  if (st.collect.runs.length > 300) st.collect.runs = st.collect.runs.slice(-300);
  writeFileSync(OUT, JSON.stringify(st, null, 1));
  if (collectFailure) {
    console.error(`${lineId} collect FAILED: partial/unavailable data recorded, refusing success exit`);
    process.exit(1);
  }
}

writeFileSync(OUT, JSON.stringify(st, null, 1));
const evCount = st.collect.events.length, alCount = st.radar.alerts.length;
console.log(`${lineId} ${mode} done: collectEvents=${evCount} radarAlerts=${alCount} newRadar=${newAlerts.length}`);
for (const a of newAlerts.slice(0, 8)) console.log(`  RADAR ${a.channel}: ${a.title}`);
