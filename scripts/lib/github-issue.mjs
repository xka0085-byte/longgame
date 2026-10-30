// 告警通道：用仓库自带的 GITHUB_TOKEN 开/关 Issue。
//
// 存在的理由：这套流水线此前所有失败都是静默的——17 个 workflow 里没有任何
// if: failure()、webhook 或通知步骤，schedule 从 2026-10-25 起彻底不触发也没有
// 任何地方会说话。没有告警通道的"自动化"只是"没人知道的停机"。
//
// 设计约束：
// 1. 去重：同一类问题同一时间只保留一个 open issue，标题带固定前缀 [auto-health]。
// 2. 无 token 时静默降级为 stderr 打印，不阻塞本地运行（本地开发没有 GITHUB_TOKEN）。
// 3. 恢复后自动关闭，避免 issue 列表变成历史垃圾场。
// 4. 不创建 label（label 需要仓库预置，缺了会 422）。

const API = 'https://api.github.com';
const MARKER = '[auto-health]';

function ctx() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/name，Actions 自动注入
  return { token, repo, ready: !!(token && repo) };
}

async function call(path, init = {}) {
  const { token } = ctx();
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'longgame-heartbeat',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github ${init.method || 'GET'} ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function openIssues() {
  const { repo } = ctx();
  const out = await call(`/repos/${repo}/issues?state=open&per_page=100`);
  return (out || []).filter(i => !i.pull_request && typeof i.title === 'string' && i.title.startsWith(MARKER));
}

function titleFor(kind) {
  return `${MARKER} ${kind}`;
}

// 确保某类告警处于 open 状态；内容变了就更新正文（保留同一个 issue 号）。
export async function raise(kind, body) {
  const c = ctx();
  if (!c.ready) {
    console.error(`[alert:no-token] ${kind}\n${body}`);
    return { ok: false, reason: 'no-token' };
  }
  try {
    const title = titleFor(kind);
    const existing = (await openIssues()).find(i => i.title === title);
    if (existing) {
      if ((existing.body || '').trim() !== body.trim()) {
        await call(`/repos/${c.repo}/issues/${existing.number}`, {
          method: 'PATCH',
          body: JSON.stringify({ body }),
        });
        return { ok: true, action: 'updated', number: existing.number };
      }
      return { ok: true, action: 'unchanged', number: existing.number };
    }
    const created = await call(`/repos/${c.repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
    });
    return { ok: true, action: 'created', number: created.number };
  } catch (e) {
    console.error(`[alert:failed] ${kind}: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

// 问题恢复后关闭对应 issue；没有则什么都不做。
export async function resolve(kind, note = '') {
  const c = ctx();
  if (!c.ready) {
    console.error(`[alert:no-token] resolve ${kind}`);
    return { ok: false, reason: 'no-token' };
  }
  try {
    const title = titleFor(kind);
    const hits = (await openIssues()).filter(i => i.title === title);
    for (const i of hits) {
      await call(`/repos/${c.repo}/issues/${i.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: note || '条件恢复，自动关闭。' }),
      });
      await call(`/repos/${c.repo}/issues/${i.number}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
      });
    }
    return { ok: true, closed: hits.length };
  } catch (e) {
    console.error(`[alert:resolve-failed] ${kind}: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

export function alertReady() {
  return ctx().ready;
}
