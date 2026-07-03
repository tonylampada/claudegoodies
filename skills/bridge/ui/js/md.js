// tiny markdown renderer — escape-first, no HTML injection
import { esc } from './util.js';

function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function md(src) {
  const lines = esc(src || '').split('\n');
  let out = '', inCode = false, inList = false, para = [];
  const flushPara = () => { if (para.length) { out += '<p>' + mdInline(para.join(' ')) + '</p>'; para = []; } };
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      flushPara(); closeList();
      out += inCode ? '</code></pre>' : '<pre><code>';
      inCode = !inCode; continue;
    }
    if (inCode) { out += line + '\n'; continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) { flushPara(); closeList(); out += '<h' + h[1].length + '>' + mdInline(h[2]) + '</h' + h[1].length + '>'; continue; }
    const li = /^\s*[-*]\s+(.*)/.exec(line);
    if (li) { flushPara(); if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + mdInline(li[1]) + '</li>'; continue; }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    para.push(line);
  }
  flushPara(); closeList();
  if (inCode) out += '</code></pre>';
  return out;
}
