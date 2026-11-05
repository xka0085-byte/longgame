// 文档卫生检查：编辑器会把 AIGC 标识块和"内容由 AI 生成"尾注自动塞进 markdown，
// 这些块既不描述数据，也与"数字来自公开数据、可复算"的对外口径冲突。
// 它们曾经混进 decisions.md 与 assurance 报告并随提交上线，所以在门禁里拦住。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const EXT = /\.(md|html|txt|json|ya?ml)$/i;
const PATTERNS = [
  [/^---[ \t]*\r?\nAIGC:/m, 'AIGC front-matter'],
  [/ContentProducer|PropagateID|ReservedCode\d/m, 'AIGC identifier fields'],
  [/内容由\s*AI\s*生成/, '"内容由AI生成" 尾注'],
];

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(full);
      continue;
    }
    if (!EXT.test(name)) continue;
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (rel.startsWith('assurance/.gate')) continue;
    const text = readFileSync(full, 'utf8');
    for (const [re, label] of PATTERNS) {
      const m = re.exec(text);
      if (!m) continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(`${rel}:${line} ${label}`);
      break;
    }
  }
}

walk(ROOT);

if (hits.length) {
  console.error('doc-hygiene: 发现 AIGC 标识或尾注，与对外口径冲突，请删除后再提交');
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('doc-hygiene: clean');
