#!/usr/bin/env node
// IndexNow：把改动过的 URL 主动推给 Bing / Yandex / Seznam 等参与该协议的引擎。
// 目的不是排名，是缩短"发布 → 可被检索 → 可被引用"的间隔；被动等爬虫的周期以天计。
// 协议不需要账号，只需站点根有一个 <key>.txt 且内容等于 key。
// 失败不阻断发布：这是加速器，不是发布的前置条件。
import { readFileSync, existsSync } from 'node:fs';

const SITE = 'https://xka0085-byte.github.io/longgame';
const KEY = process.env.INDEXNOW_KEY || 'a7f3c9d21e8b4a6f5c0d9e2b7a1f4c83';
const DOCS = process.env.LONGGAME_DOCS || 'docs';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

function urlsFromSitemap() {
  const p = `${DOCS}/sitemap.xml`;
  if (!existsSync(p)) return [];
  return [...readFileSync(p, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

// 只提交"有内容可引用"的页 + 三个机器可读入口。noise 越少，抓取预算越集中。
function entrypoints() {
  return [
    `${SITE}/`,
    `${SITE}/llms.txt`,
    `${SITE}/llms-full.txt`,
    `${SITE}/citation.json`,
    `${SITE}/method.html`,
  ];
}

const urlList = [...new Set([...entrypoints(), ...urlsFromSitemap()])];
if (!urlList.length) {
  console.error('indexnow: no urls, skip');
  process.exit(0);
}

if (process.env.INDEXNOW_DRY === '1') {
  console.log(`indexnow(dry): ${urlList.length} urls\n${urlList.join('\n')}`);
  process.exit(0);
}

const body = JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList });

try {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
    signal: AbortSignal.timeout(20000),
  });
  // 200/202 为接受；422 多因 URL 不属于 host 或 key 文件不可达，这里只记录不重试。
  console.log(`indexnow: status=${res.status} urls=${urlList.length}`);
  if (res.status >= 400) console.log(`indexnow: body=${(await res.text()).slice(0, 200)}`);
} catch (e) {
  console.log(`indexnow: failed (non-blocking): ${String(e.message).slice(0, 160)}`);
}
