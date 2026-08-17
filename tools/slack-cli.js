#!/usr/bin/env node
const SLACK_XOXP_TOKEN = process.env.SLACK_XOXP_TOKEN;
const WORKSPACE = process.env.SLACK_WORKSPACE;
const BOT_NAME = process.env.SLACK_BOT_NAME || 'Bot';

if (!SLACK_XOXP_TOKEN) { console.error('Missing SLACK_XOXP_TOKEN env var'); process.exit(1); }
if (!WORKSPACE) { console.error('Missing SLACK_WORKSPACE env var'); process.exit(1); }

// Print error to stderr and exit non-zero. Used for usage messages, missing
// args, file-read failures, and Slack API errors. Without this, callers
// (cron jobs, shell scripts under `set -e`) silently treat failures as success.
function die(...args) { console.error(...args); process.exit(1); }

const args = process.argv.slice(2);
const command = args[0];
const showLinks = args.includes('--links');

async function slack(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${SLACK_XOXP_TOKEN}` }
  });
  return res.json();
}

// Cache de usuários e canais para resolver nomes
let userCache = {};
let channelCache = {};

async function getChannelName(channelId) {
  if (channelCache[channelId]) return channelCache[channelId];
  const res = await slack('conversations.info', { channel: channelId });
  const name = res.ok ? (res.channel.name || channelId) : channelId;
  channelCache[channelId] = name;
  return name;
}

async function getUser(userId) {
  if (userCache[userId]) return userCache[userId];
  const res = await slack('users.info', { user: userId });
  if (res.ok) {
    userCache[userId] = res.user;
    return res.user;
  }
  return null;
}

async function resolveUserName(userId) {
  const user = await getUser(userId);
  return user ? (user.profile?.display_name || user.real_name || user.name) : userId;
}

// Gera permalink para uma mensagem
// Para threads: passar threadTs para gerar link que funciona (aponta pra reply, não pai)
function makePermalink(channelId, messageTs, threadTs = null) {
  const tsClean = messageTs.replace('.', '');
  let link = `https://${WORKSPACE}.slack.com/archives/${channelId}/p${tsClean}`;
  if (threadTs && threadTs !== messageTs) {
    // Formato completo que funciona: channel= e message_ts= 
    link += `?thread_ts=${threadTs}&channel=${channelId}&message_ts=${messageTs}`;
  }
  return link;
}

async function findChannelIdByName(name) {
  const normalized = name.replace(/^#/, '').toLowerCase();
  let cursor = null;

  for (let i = 0; i < 50; i++) {
    const params = {
      types: 'public_channel,private_channel',
      limit: 1000,
      exclude_archived: true
    };
    if (cursor) params.cursor = cursor;

    const res = await slack('conversations.list', params);
    if (!res.ok) return null;

    const channel = (res.channels || []).find(ch => ch.name?.toLowerCase() === normalized);
    if (channel?.id) return channel.id;

    cursor = res.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  return null;
}

// Attachments are invisible in the text body — a chart posted as an image reads
// as an empty message. Surface name + id so `slack-cli file <id>` can fetch it.
function formatFiles(msg) {
  let out = '';
  for (const f of msg.files || []) {
    if (f.mode === 'tombstone') continue;
    const kb = f.size ? ` ${Math.round(f.size / 1024)}KB` : '';
    out += `\n    \u{1F4CE} ${f.name || f.title || 'file'} [${f.filetype || f.mimetype || '?'}${kb}] ${f.id}`;
  }
  return out;
}

async function formatMessage(msg, channelId, resolveNames = true, threadTs = null) {
  let author = msg.user || msg.username || 'unknown';
  if (resolveNames && msg.user) {
    author = await resolveUserName(msg.user);
  }
  
  const ts = new Date(parseFloat(msg.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const threadInfo = msg.reply_count ? ` 💬${msg.reply_count}` : '';
  const text = (msg.text || '').replace(/\n/g, ' ');

  let output = `[${ts}] @${author}${threadInfo}: ${text}`;

  output += formatFiles(msg);

  if (showLinks && channelId) {
    const link = makePermalink(channelId, msg.ts, threadTs);
    output += `\n    🔗 ${link}`;
  }
  
  return output;
}

// --- Rich Text Parser ---
// Converts mrkdwn-like text into Slack rich_text blocks with native bullets

function parseInlineElements(text) {
  const elements = [];
  let i = 0;
  while (i < text.length) {
    // Emoji :name:
    if (text[i] === ':') {
      const end = text.indexOf(':', i + 1);
      if (end > i + 1 && !/\s/.test(text.slice(i + 1, end)) && end - i < 40) {
        elements.push({ type: 'emoji', name: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Bold *text*
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
        elements.push({ type: 'text', text: text.slice(i + 1, end), style: { bold: true } });
        i = end + 1;
        continue;
      }
    }
    // Link <url|text>
    if (text[i] === '<') {
      const end = text.indexOf('>', i + 1);
      if (end > i + 1) {
        const content = text.slice(i + 1, end);
        const pipeIdx = content.indexOf('|');
        if (pipeIdx > -1) {
          elements.push({ type: 'link', url: content.slice(0, pipeIdx), text: content.slice(pipeIdx + 1) });
        } else {
          elements.push({ type: 'link', url: content });
        }
        i = end + 1;
        continue;
      }
    }
    // Channel reference #channel-name
    if (text[i] === '#' && (i === 0 || text[i-1] === ' ')) {
      const match = text.slice(i).match(/^#([\w-]+)/);
      if (match) {
        // Keep as text — Slack will auto-link channel names
        elements.push({ type: 'text', text: '#' + match[1] });
        i += match[0].length;
        continue;
      }
    }
    // Regular text — collect until next special char
    let end = i + 1;
    while (end < text.length && ![':', '*', '<'].includes(text[end])) {
      // Also break on # if preceded by space
      if (text[end] === '#' && text[end - 1] === ' ') break;
      end++;
    }
    const chunk = text.slice(i, end);
    if (chunk) elements.push({ type: 'text', text: chunk });
    i = end;
  }
  return elements;
}

function parseRichBlocks(input) {
  const lines = input.split('\n');
  const blocks = [];
  let pendingList = null;
  let pendingIndent = 0;

  function flushList() {
    if (pendingList) {
      blocks.push(pendingList);
      pendingList = null;
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Bullet line: "- text", "  - text", "    - text" etc
    const bulletMatch = line.match(/^(\s*)[-•◦]\s+(.+)/);
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2);
      const content = bulletMatch[2];

      // If indent changed, flush current list and start new one
      if (pendingList && indent !== pendingIndent) {
        flushList();
      }

      if (!pendingList) {
        pendingList = {
          type: 'rich_text_list',
          style: 'bullet',
          indent: indent,
          elements: []
        };
        pendingIndent = indent;
      }

      // Collect continuation lines (indented non-bullet lines after this bullet)
      let fullContent = content;
      while (li + 1 < lines.length) {
        const nextLine = lines[li + 1];
        // Continuation: indented more than bullet marker, not a bullet itself, not empty
        if (nextLine.match(/^\s+\S/) && !nextLine.match(/^\s*[-•◦]\s/) && nextLine.trim()) {
          fullContent += '\n' + nextLine.trim();
          li++;
        } else {
          break;
        }
      }

      pendingList.elements.push({
        type: 'rich_text_section',
        elements: parseInlineElements(fullContent)
      });
      continue;
    }

    // Non-bullet line
    flushList();

    // Preserve empty lines as blank sections for spacing
    if (!line.trim()) {
      blocks.push({
        type: 'rich_text_section',
        elements: [{ type: 'text', text: '\n' }]
      });
      continue;
    }

    // Regular text section
    blocks.push({
      type: 'rich_text_section',
      elements: parseInlineElements(line)
    });
  }

  flushList();

  return [{ type: 'rich_text', elements: blocks }];
}

async function main() {
  switch (command) {
    case 'channels': {
      const res = await slack('conversations.list', { 
        types: 'public_channel,private_channel', 
        limit: 200,
        exclude_archived: true 
      });
      if (!res.ok) return die('Error:', res.error);
      
      res.channels
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(ch => {
          const priv = ch.is_private ? '🔒' : '#';
          console.log(`${priv}${ch.name}\t${ch.id}`);
        });
      break;
    }
    
    case 'read': {
      const channelId = args[1];
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 20;
      
      if (!channelId) return die('Usage: slack-cli read <channel_id> [--limit N] [--links]');
      
      const res = await slack('conversations.history', { channel: channelId, limit });
      if (!res.ok) return die('Error:', res.error);
      
      const messages = res.messages.reverse();
      for (const msg of messages) {
        console.log(await formatMessage(msg, channelId));
      }
      break;
    }
    
    case 'thread': {
      const channelId = args[1];
      const threadTs = args[2];
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 50;
      
      if (!channelId || !threadTs) {
        return die('Usage: slack-cli thread <channel_id> <thread_ts> [--limit N] [--links]');
      }
      
      const res = await slack('conversations.replies', { channel: channelId, ts: threadTs, limit });
      if (!res.ok) return die('Error:', res.error);
      
      // Com --links: mostra link de TODAS as mensagens (necessário para journal)
      const messages = res.messages;
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        
        const author = msg.user ? await resolveUserName(msg.user) : (msg.username || 'unknown');
        const ts = new Date(parseFloat(msg.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');
        const threadInfo = msg.reply_count ? ` 💬${msg.reply_count}` : '';
        const text = (msg.text || '').replace(/\n/g, ' ');

        let output = `[${ts}] @${author}${threadInfo}: ${text}`;

        output += formatFiles(msg);

        // Link para todas as mensagens quando --links
        if (showLinks) {
          const link = makePermalink(channelId, msg.ts, threadTs);
          output += `\n    🔗 ${link}`;
        }
        
        console.log(output);
      }
      break;
    }
    
    case 'search': {
      const limitIdx = args.indexOf('--limit');
      const linksIdx = args.indexOf('--links');
      const endIdx = Math.min(
        limitIdx > -1 ? limitIdx : Infinity,
        linksIdx > -1 ? linksIdx : Infinity
      );
      const query = args.slice(1, endIdx === Infinity ? undefined : endIdx).join(' ');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 20;
      
      if (!query) return die('Usage: slack-cli search <query> [--limit N] [--links]');

      let collected = 0;
      let page = 1;
      while (collected < limit) {
        const count = Math.min(limit - collected, 100);
        const res = await slack('search.messages', { query, count, page });
        if (!res.ok) return die('Error:', res.error);
        const matches = res.messages?.matches || [];
        if (matches.length === 0) break;
        for (const match of matches) {
          const ch = match.channel?.name || '?';
          const chId = match.channel?.id;
          const formatted = await formatMessage(match, chId, true);
          console.log(`[#${ch}] ${formatted}`);
        }
        collected += matches.length;
        if (page >= (res.messages?.paging?.pages || 1)) break;
        page++;
      }
      break;
    }
    
    case 'permalink': {
      const channelId = args[1];
      const messageTs = args[2];
      const threadTs = args[3]; // Opcional: se for reply numa thread
      
      if (!channelId || !messageTs) {
        return die('Usage: slack-cli permalink <channel_id> <message_ts> [thread_ts]\n\nFor thread replies, pass the parent thread_ts as third arg to get working link.');
      }
      
      console.log(makePermalink(channelId, messageTs, threadTs));
      break;
    }
    
    case 'user': {
      const userId = args[1];
      if (!userId) return die('Usage: slack-cli user <user_id>');
      
      const user = await getUser(userId);
      if (!user) return die('User not found');
      
      console.log(`Name: ${user.real_name}`);
      console.log(`Display: ${user.profile?.display_name || '-'}`);
      console.log(`Handle: @${user.name}`);
      console.log(`Title: ${user.profile?.title || '-'}`);
      break;
    }
    
    case 'users': {
      const searchIdx = args.indexOf('--search');
      const search = searchIdx > -1 ? args[searchIdx + 1]?.toLowerCase() : null;
      
      const res = await slack('users.list', { limit: 500 });
      if (!res.ok) return die('Error:', res.error);
      
      let users = res.members.filter(u => !u.deleted && !u.is_bot);
      
      if (search) {
        users = users.filter(u => 
          u.real_name?.toLowerCase().includes(search) ||
          u.name?.toLowerCase().includes(search) ||
          u.profile?.display_name?.toLowerCase().includes(search)
        );
      }
      
      users.forEach(u => {
        console.log(`${u.id}\t@${u.name}\t${u.real_name || '-'}`);
      });
      break;
    }
    
    case 'dms': {
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 50;
      
      const res = await slack('conversations.list', { 
        types: 'im', 
        limit
      });
      if (!res.ok) return die('Error:', res.error);
      
      // Buscar info de cada DM em paralelo
      const dms = await Promise.all(res.channels.map(async (dm) => {
        const userName = await resolveUserName(dm.user);
        // Pegar última mensagem pra mostrar preview
        const hist = await slack('conversations.history', { channel: dm.id, limit: 1 });
        const lastMsg = hist.messages?.[0];
        const lastTs = lastMsg ? new Date(parseFloat(lastMsg.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '-';
        const preview = lastMsg?.text?.slice(0, 60).replace(/\n/g, ' ') || '';
        return { dm, userName, lastTs, preview, sortTs: lastMsg?.ts || '0' };
      }));
      
      // Ordenar por última mensagem (mais recente primeiro)
      dms.sort((a, b) => parseFloat(b.sortTs) - parseFloat(a.sortTs));
      
      for (const { dm, userName, lastTs, preview } of dms) {
        console.log(`${dm.id}\t@${userName}\t[${lastTs}] ${preview}...`);
      }
      break;
    }
    
    case 'dm': {
      const userArg = args[1];
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 20;
      
      if (!userArg) return die('Usage: slack-cli dm <dm_id|@handle> [--limit N] [--links]\n\nTip: use "slack-cli dms" to list DM channel IDs');
      
      let channelId = userArg;
      
      // Se começa com D, é um DM channel ID direto
      if (userArg.startsWith('D')) {
        channelId = userArg;
      } 
      // Se passou @handle, procurar nas DMs existentes
      else if (userArg.startsWith('@')) {
        const handle = userArg.slice(1).toLowerCase();
        
        // Listar DMs e procurar pelo usuário
        const dmsRes = await slack('conversations.list', { types: 'im', limit: 100 });
        if (!dmsRes.ok) return die('Error listing DMs:', dmsRes.error);
        
        for (const dm of dmsRes.channels) {
          const user = await getUser(dm.user);
          if (user && (
            user.name?.toLowerCase() === handle ||
            user.profile?.display_name?.toLowerCase() === handle ||
            user.real_name?.toLowerCase().includes(handle)
          )) {
            channelId = dm.id;
            break;
          }
        }
        
        if (channelId === userArg) {
          return die(`DM not found with: ${userArg}\nTip: use "slack-cli dms" to see available DMs`);
        }
      } else {
        return die('Invalid argument. Use DM channel ID (starts with D) or @handle');
      }
      
      // Ler histórico
      const res = await slack('conversations.history', { channel: channelId, limit });
      if (!res.ok) return die('Error:', res.error);
      
      const messages = res.messages.reverse();
      for (const msg of messages) {
        console.log(await formatMessage(msg, channelId));
      }
      break;
    }

    case 'reactions': {
      const emojiIdx = args.indexOf('--emoji');
      const emoji = emojiIdx > -1 ? args[emojiIdx + 1] : 'bookmark';
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 50;

      const seen = new Set();
      const results = [];
      let cursor = null;

      while (results.length < limit) {
        const params = { full: 'true', limit: 200 };
        if (cursor) params.cursor = cursor;

        const res = await slack('reactions.list', params);
        if (!res.ok) return die('Error:', res.error);

        for (const item of res.items || []) {
          if (item.type !== 'message') continue;
          const msg = item.message;
          if (seen.has(msg.ts)) continue;
          if (!msg.reactions?.some(r => r.name === emoji)) continue;
          seen.add(msg.ts);
          results.push({ channel: item.channel, message: msg });
          if (results.length >= limit) break;
        }

        cursor = res.response_metadata?.next_cursor;
        if (!cursor) break;
      }

      if (results.length === 0) {
        console.log(`No messages with :${emoji}: reaction found.`);
        break;
      }

      for (const { channel, message } of results) {
        const chName = await getChannelName(channel);
        const formatted = await formatMessage(message, channel);
        console.log(`[#${chName}] ${formatted}`);
      }
      break;
    }

    case 'send-rich': {
      const channelArg = args[1];
      const filePath = args[2];

      if (!channelArg || !filePath) {
        return die('Usage: slack-cli send-rich <channel_id|#channel_name> <file> [--thread TS]\n\nSends file content as rich text with native Slack bullets.\nFormat: Slack mrkdwn — *bold*, :emoji:, <url|text>, - bullets\n\nExamples:\n  slack-cli send-rich #self-tony-franca recap.md --links\n  slack-cli send-rich #channel recap.md --thread 1234567890.123456');
      }

      // Parse --thread TS option
      let threadTs = null;
      const threadIdx = args.indexOf('--thread');
      if (threadIdx !== -1 && args[threadIdx + 1]) {
        threadTs = args[threadIdx + 1];
      }

      let channelId = channelArg;
      if (!/^[CGD][A-Z0-9]+$/.test(channelArg)) {
        const resolved = await findChannelIdByName(channelArg);
        if (!resolved) return die(`Error: channel not found (${channelArg}).`);
        channelId = resolved;
      }

      const { readFileSync } = await import('fs');
      let content;
      try {
        content = readFileSync(filePath, 'utf-8').trim();
      } catch (e) {
        return die(`Error reading file: ${e.message}`);
      }

      const richBlocks = parseRichBlocks(`[${BOT_NAME}]\n${content}`);
      const fallbackText = `[${BOT_NAME}] ${content.slice(0, 200)}...`;

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SLACK_XOXP_TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ channel: channelId, text: fallbackText, blocks: richBlocks, ...(threadTs && { thread_ts: threadTs }) })
      });

      const body = await res.json();
      if (!body.ok) return die('Error:', body.error);

      console.log(`Sent rich message to ${channelId} at ${body.ts}`);
      if (showLinks) {
        console.log(`🔗 ${makePermalink(channelId, body.ts)}`);
      }
      break;
    }

    case 'send': {
      const channelArg = args[1];
      const text = args.slice(2).join(' ').trim();

      if (!channelArg || !text) {
        return die('Usage: slack-cli send <channel_id|#channel_name> <message>\n\nExamples:\n  slack-cli send C09HE1GB0H4 "deploy concluído"\n  slack-cli send #self-tony-franca "deploy concluído"');
      }

      let channelId = channelArg;
      if (!/^[CGD][A-Z0-9]+$/.test(channelArg)) {
        const resolved = await findChannelIdByName(channelArg);
        if (!resolved) return die(`Error: channel not found (${channelArg}).`);
        channelId = resolved;
      }

      const prefixedText = `[${BOT_NAME}] ${text}`;
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SLACK_XOXP_TOKEN}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ channel: channelId, text: prefixedText })
      });

      const body = await res.json();
      if (!body.ok) return die('Error:', body.error);

      console.log(`Sent to ${channelId} at ${body.ts}`);
      if (showLinks) {
        console.log(`🔗 ${makePermalink(channelId, body.ts)}`);
      }
      break;
    }
    
    case 'digest': {
      const channelArg = args[1];
      if (!channelArg) {
        return die('Usage: slack-cli digest <channel_id|#channel_name> [--date YYYY-MM-DD] [--links]\n\nFetches all messages from a channel for a given day, grouped by thread.\nDefaults to yesterday if --date is not provided.');
      }

      let channelId = channelArg;
      if (!/^[CGD][A-Z0-9]+$/.test(channelArg)) {
        const resolved = await findChannelIdByName(channelArg);
        if (!resolved) return die(`Error: channel not found (${channelArg}).`);
        channelId = resolved;
      }

      const dateIdx = args.indexOf('--date');
      let targetDate;
      if (dateIdx > -1 && args[dateIdx + 1]) {
        targetDate = new Date(args[dateIdx + 1] + 'T00:00:00');
      } else {
        targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - 1);
        targetDate.setHours(0, 0, 0, 0);
      }
      const dayStart = Math.floor(targetDate.getTime() / 1000);
      const dayEnd = dayStart + 86400;
      const dateStr = targetDate.toISOString().slice(0, 10);

      // Fetch all messages from the day using pagination
      let allMessages = [];
      let cursor = null;
      for (let i = 0; i < 50; i++) {
        const params = { channel: channelId, oldest: dayStart, latest: dayEnd, limit: 200, inclusive: true };
        if (cursor) params.cursor = cursor;
        const res = await slack('conversations.history', params);
        if (!res.ok) return die('Error:', res.error);
        allMessages = allMessages.concat(res.messages || []);
        cursor = res.response_metadata?.next_cursor;
        if (!cursor) break;
      }

      if (allMessages.length === 0) {
        console.log(`No messages found on ${dateStr}`);
        break;
      }

      // Separate: thread parents (have reply_count) vs standalone
      const threadParentTs = new Set();
      const standalone = [];
      for (const msg of allMessages) {
        if (msg.reply_count > 0) {
          threadParentTs.add(msg.ts);
        } else if (!msg.thread_ts || msg.thread_ts === msg.ts) {
          standalone.push(msg);
        }
        // thread replies (thread_ts !== ts) found via history are orphans from threads
        // whose parent is outside this day — group them too
        if (msg.thread_ts && msg.thread_ts !== msg.ts) {
          threadParentTs.add(msg.thread_ts);
        }
      }

      const chName = await getChannelName(channelId);
      console.log(`=== #${chName} — ${dateStr} ===\n`);

      // Fetch and display each thread
      const threadTsList = [...threadParentTs].sort();
      for (const parentTs of threadTsList) {
        const res = await slack('conversations.replies', { channel: channelId, ts: parentTs, limit: 200 });
        if (!res.ok) continue;
        const msgs = res.messages || [];
        if (msgs.length === 0) continue;

        // Filter: show parent + only replies from the target day
        const parent = msgs[0];
        const parentAuthor = parent.user ? await resolveUserName(parent.user) : (parent.username || 'unknown');
        const parentTs2 = new Date(parseFloat(parent.ts) * 1000).toISOString().slice(0, 10);
        const parentText = (parent.text || '').replace(/\n/g, ' ');
        let header = `📌 [${parentTs2}] Thread by @${parentAuthor}: ${parentText}`;
        header += `\n🆔 ${parent.ts}`;
        // Link to first reply in thread (not the parent)
        const firstReply = msgs.length > 1 ? msgs[1] : parent;
        header += `\n🔗 ${makePermalink(channelId, firstReply.ts, parent.ts)}`;
        console.log(header);

        const replies = msgs.slice(1).filter(m => {
          const msgTime = parseFloat(m.ts);
          return msgTime >= dayStart && msgTime < dayEnd;
        });

        for (const reply of replies) {
          const author = reply.user ? await resolveUserName(reply.user) : (reply.username || 'unknown');
          const ts = new Date(parseFloat(reply.ts) * 1000).toISOString().slice(0, 16).replace('T', ' ');
          const text = (reply.text || '').replace(/\n/g, ' ');
          let line = `    ↳ [${ts}] @${author}: ${text}`;
          if (showLinks) {
            line += `\n       🔗 ${makePermalink(channelId, reply.ts, parentTs)}`;
          }
          console.log(line);
        }
        if (replies.length === 0) {
          console.log('    (no replies on this day)');
        }
        console.log('');
      }

      // Display standalone messages
      const standaloneOnDay = standalone.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
      if (standaloneOnDay.length > 0) {
        console.log('💬 Standalone messages:');
        for (const msg of standaloneOnDay) {
          console.log(await formatMessage(msg, channelId));
        }
        console.log('');
      }

      console.log(`--- ${allMessages.length} messages total, ${threadTsList.length} threads, ${standaloneOnDay.length} standalone ---`);
      break;
    }

    case 'files': {
      const channelId = args[1];
      const ts = args[2];
      if (!channelId || !ts) return die('Usage: slack-cli files <channel_id> <ts>\n\nLists attachments on a message and every reply in its thread.');
      const res = await slack('conversations.replies', { channel: channelId, ts, limit: 200 });
      if (!res.ok) return die('Error:', res.error);
      let n = 0;
      for (const msg of res.messages || []) {
        for (const f of msg.files || []) {
          if (f.mode === 'tombstone') continue;
          n++;
          console.log(`${f.id}\t${f.name || f.title}\t[${f.filetype || f.mimetype}]\t${Math.round((f.size || 0) / 1024)}KB\tmsg ${msg.ts}`);
        }
      }
      if (!n) console.log('no attachments on that message or its thread');
      break;
    }

    case 'file': {
      const fileId = args[1];
      if (!fileId) return die('Usage: slack-cli file <file_id> [--out <path>]\n\nDownloads an attachment and prints the local path.\nTip: `slack-cli files <channel> <ts>` lists the ids.');
      const info = await slack('files.info', { file: fileId });
      if (!info.ok) return die('Error:', info.error);
      const f = info.file;
      const url = f.url_private_download || f.url_private;
      if (!url) return die('Error: file has no downloadable url');
      const outIdx = args.indexOf('--out');
      const out = outIdx > -1 && args[outIdx + 1]
        ? args[outIdx + 1]
        : `/tmp/slack-${fileId}-${(f.name || 'file').replace(/[^\w.\-]/g, '_')}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${SLACK_XOXP_TOKEN}` } });
      if (!res.ok) return die(`Error: HTTP ${res.status} fetching the file`);
      const buf = Buffer.from(await res.arrayBuffer());
      // An unauthorized download returns Slack's login page with status 200.
      if (buf.subarray(0, 200).toString('utf8').trimStart().toLowerCase().startsWith('<!doctype html')) {
        return die('Error: got an HTML login page instead of the file — the token is missing files:read.');
      }
      const { writeFileSync } = await import('fs');
      writeFileSync(out, buf);
      console.log(out);
      console.error(`  ${f.name}  ${f.mimetype}  ${buf.length} bytes`);
      break;
    }

    default:
      console.log(`slack-cli - Slack CLI

Commands:
  channels                              List channels
  read <channel_id> [--limit N] [--links]    Read channel messages
  thread <channel_id> <ts> [--limit N] [--links]  Read thread replies
  search <query> [--limit N] [--links]       Search messages
  digest <channel|#name> [--date YYYY-MM-DD] [--links]  Day digest grouped by thread
  permalink <channel_id> <ts> [thread_ts]    Generate permalink for message
  user <user_id>                        Get user info
  users [--search name]                 List/search users
  dms [--limit N]                       List DM conversations
  dm <user_id|@handle> [--limit N] [--links]  Read DM with someone
  send <channel_id|#channel_name> <message> [--links] Send message with [BOT_NAME] prefix
  send-rich <channel_id|#channel_name> <file> [--links] Send file as rich text (native bullets)
  reactions [--emoji EMOJI] [--limit N] [--links]  List messages you reacted to (default: bookmark)
  files <channel_id> <ts>               List attachments on a message and its thread
  file <file_id> [--out <path>]         Download an attachment, print the local path

Options:
  --links    Show permalink for each message

Examples:
  slack-cli channels
  slack-cli read C06T4V8JJGN --limit 10
  slack-cli read C06T4V8JJGN --limit 5 --links
  slack-cli thread C06T4V8JJGN 1769431483.032279 --links
  slack-cli search "from:@tony bug" --limit 5 --links
  slack-cli digest #team-dataset-management --links
  slack-cli digest C06T4V8JJGN --date 2026-04-01 --links
  slack-cli permalink C06T4V8JJGN 1769431483.032279
  slack-cli dms --limit 10
  slack-cli dm @iuri --limit 20
  slack-cli send C09HE1GB0H4 "teste de deploy" --links
  slack-cli send #self-tony-franca "teste de deploy" --links
  slack-cli reactions --links
  slack-cli reactions --emoji eyes --limit 20 --links

Note: For threads, --links shows link for ALL messages (needed for journal references).
`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
