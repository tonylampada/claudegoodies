#!/usr/bin/env -S node --no-warnings
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) { console.error('Missing TELEGRAM_BOT_TOKEN env var'); process.exit(1); }

const args = process.argv.slice(2);
const command = args[0];

const API = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method, params = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return res.json();
}

async function tgForm(method, formData) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    body: formData
  });
  return res.json();
}

function formatMessage(msg) {
  const from = msg.from ? `@${msg.from.username || msg.from.first_name}` : '?';
  const chat = msg.chat.title || msg.chat.username || msg.chat.id;
  const date = new Date(msg.date * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const text = msg.text || msg.caption || '[media]';
  return `[${date}] ${from} in ${chat} (chat_id: ${msg.chat.id}): ${text}`;
}

async function main() {
  switch (command) {
    case 'me': {
      const res = await tg('getMe');
      if (!res.ok) { console.error('Error:', res.description); process.exit(1); }
      const bot = res.result;
      console.log(`ID: ${bot.id}`);
      console.log(`Name: ${bot.first_name}`);
      console.log(`Username: @${bot.username}`);
      break;
    }

    case 'updates': {
      const limitIdx = args.indexOf('--limit');
      const limit = limitIdx > -1 ? parseInt(args[limitIdx + 1]) : 20;

      const res = await tg('getUpdates', { limit, allowed_updates: ['message'] });
      if (!res.ok) { console.error('Error:', res.description); process.exit(1); }

      const updates = res.result;
      if (updates.length === 0) {
        console.log('No recent updates.');
        break;
      }

      for (const u of updates) {
        if (u.message) console.log(formatMessage(u.message));
      }
      break;
    }

    case 'send': {
      const chatId = args[1];
      const text = args.slice(2).join(' ').trim();

      if (!chatId || !text) {
        return console.error('Usage: telegram-cli send <chat_id> <message>');
      }

      const res = await tg('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      });
      if (!res.ok) { console.error('Error:', res.description); process.exit(1); }
      console.log(`Sent to ${chatId} at ${new Date(res.result.date * 1000).toISOString()}`);
      break;
    }

    case 'send-html': {
      const chatId = args[1];
      const text = args.slice(2).join(' ').trim();

      if (!chatId || !text) {
        return console.error('Usage: telegram-cli send-html <chat_id> <message>');
      }

      const res = await tg('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      });
      if (!res.ok) { console.error('Error:', res.description); process.exit(1); }
      console.log(`Sent to ${chatId} at ${new Date(res.result.date * 1000).toISOString()}`);
      break;
    }

    case 'send-file': {
      const chatId = args[1];
      const filePath = args[2];
      const caption = args.slice(3).join(' ').trim() || undefined;

      if (!chatId || !filePath) {
        return console.error('Usage: telegram-cli send-file <chat_id> <file_path> [caption]');
      }

      const { createReadStream, statSync } = await import('fs');
      const { basename } = await import('path');

      try {
        statSync(filePath);
      } catch {
        return console.error(`File not found: ${filePath}`);
      }

      const { FormData, File } = await import('node:buffer').then(() => globalThis).catch(() => ({}));
      const { readFileSync } = await import('fs');

      const fileName = basename(filePath);
      const fileData = readFileSync(filePath);
      const ext = fileName.split('.').pop()?.toLowerCase();
      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
      const isVoice = ['ogg', 'oga'].includes(ext);
      const isAudio = ['mp3', 'wav', 'flac', 'm4a'].includes(ext);

      const formData = new FormData();
      formData.append('chat_id', chatId);

      const blob = new Blob([fileData]);
      const method = isImage ? 'sendPhoto' : isVoice ? 'sendVoice' : isAudio ? 'sendAudio' : 'sendDocument';
      const field = isImage ? 'photo' : isVoice ? 'voice' : isAudio ? 'audio' : 'document';
      formData.append(field, blob, fileName);
      if (caption) formData.append('caption', caption);

      const res = await tgForm(method, formData);
      if (!res.ok) { console.error('Error:', res.description); process.exit(1); }
      console.log(`Sent ${fileName} to ${chatId}`);
      break;
    }

    default:
      console.log(`telegram-cli - Telegram Bot CLI

Commands:
  me                                    Bot info
  updates [--limit N]                   Recent messages received (discover chat IDs)
  send <chat_id> <message>              Send message (Markdown)
  send-html <chat_id> <message>         Send message (HTML)
  send-file <chat_id> <file> [caption]  Send file/photo

Environment:
  TELEGRAM_BOT_TOKEN    Bot token (required)

Examples:
  telegram-cli me
  telegram-cli updates
  telegram-cli updates --limit 5
  telegram-cli send 123456789 "Hello world"
  telegram-cli send 123456789 "*bold* and _italic_"
  telegram-cli send-html 123456789 "<b>bold</b> and <i>italic</i>"
  telegram-cli send-file 123456789 ./report.pdf "Here's the report"
  telegram-cli send-file 123456789 ./screenshot.png
`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
