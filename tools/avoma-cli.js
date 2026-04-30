#!/usr/bin/env node
const AVOMA_API_KEY = process.env.AVOMA_API_KEY;

if (!AVOMA_API_KEY) { console.error('Missing AVOMA_API_KEY env var'); process.exit(1); }

const BASE = 'https://api.avoma.com';
const args = process.argv.slice(2);
const command = args[0];
const showJson = args.includes('--json');

function flag(name) {
  const idx = args.indexOf(name);
  return idx > -1 ? args[idx + 1] : null;
}

function dateToIso(d, endOfDay = false) {
  // Accept YYYY-MM-DD or full ISO. Default endOfDay adds T23:59:59Z, else T00:00:00Z.
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return endOfDay ? `${d}T23:59:59Z` : `${d}T00:00:00Z`;
  }
  return d;
}

function defaultFromTo() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from_date: from.toISOString().slice(0, 19) + 'Z',
    to_date: to.toISOString().slice(0, 19) + 'Z'
  };
}

async function avoma(path, params = {}) {
  const url = path.startsWith('http')
    ? new URL(path)
    : new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${AVOMA_API_KEY}`,
      'Accept': 'application/json'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function paginate(path, params = {}, max = Infinity) {
  let collected = [];
  let nextUrl = null;
  let firstParams = params;
  let count = null;

  while (collected.length < max) {
    const res = nextUrl
      ? await avoma(nextUrl)
      : await avoma(path, firstParams);
    firstParams = {};
    if (count === null && typeof res.count === 'number') count = res.count;
    const items = res.results || [];
    collected = collected.concat(items);
    if (!res.next || items.length === 0) break;
    nextUrl = res.next;
  }
  return { results: collected.slice(0, max), count };
}

function fmtDate(s) {
  if (!s) return '-';
  return new Date(s).toISOString().slice(0, 16).replace('T', ' ');
}

function fmtDur(seconds) {
  if (!seconds && seconds !== 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function attendees(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '-';
  return arr.map(a => a.email || a.name || '?').slice(0, 3).join(',') + (arr.length > 3 ? `,+${arr.length - 3}` : '');
}

function help() {
  console.log(`avoma-cli - Avoma API CLI

Commands:
  meetings [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--all] [--internal true|false] [--call true|false]
  meeting <uuid>
  meeting-insights <uuid>
  meeting-drop <uuid>                              POST drop meeting
  transcription <meeting_uuid>                     Transcription for a meeting
  transcriptions [--from] [--to] [--limit N] [--all]
  recording <meeting_uuid>                         Audio/video URLs (signed, expiring)
  notes [--from] [--to] [--limit N] [--all] [--format json|html|markdown]
  notes-meeting <meeting_uuid> [--format json|html|markdown]
  calls [--from] [--to] [--direction inbound|outbound]
  call <external_id>
  users
  user <uuid>
  templates [--limit N] [--all]
  scorecards [--limit N] [--all]
  scorecard-evals [--from] [--to] [--limit N] [--all]
  smart-categories
  meeting-types
  meeting-outcomes
  snippets [--from] [--to] [--limit N] [--all]
  segments --meeting <uuid>
  sentiments --meeting <uuid>
  engagement [--from] [--to]
  engagement-summary [--from] [--to]
  raw <method> <path> [--data JSON]                Escape hatch — raw API call

Common options:
  --json     Print raw JSON instead of pretty table
  --from     Start date (YYYY-MM-DD or ISO). Default: 7 days ago
  --to       End date (YYYY-MM-DD or ISO). Default: now
  --limit N  Page size (max varies per endpoint)
  --all      Follow pagination until exhausted

Examples:
  avoma-cli meetings --from 2026-04-01 --to 2026-04-30 --limit 50
  avoma-cli meeting <uuid>
  avoma-cli transcription <meeting_uuid>
  avoma-cli notes-meeting <meeting_uuid> --format markdown
  avoma-cli recording <meeting_uuid>
  avoma-cli raw GET /v1/meetings/?page_size=5&from_date=2026-04-01T00:00:00Z&to_date=2026-04-30T00:00:00Z
`);
}

async function main() {
  switch (command) {
    case 'meetings': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date,
        page_size: flag('--limit') || 50,
        is_internal: flag('--internal'),
        is_call: flag('--call')
      };
      const max = args.includes('--all') ? Infinity : parseInt(params.page_size);
      const { results, count } = await paginate('/v1/meetings/', params, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} meetings`);
      for (const m of results) {
        console.log(`${m.uuid}\t${fmtDate(m.start_at)}\t${fmtDur(m.duration)}\t${(m.subject||'-').slice(0,60)}\t${attendees(m.attendees)}`);
      }
      break;
    }

    case 'meeting': {
      const uuid = args[1];
      if (!uuid) return console.error('Usage: avoma-cli meeting <uuid>');
      const m = await avoma(`/v1/meetings/${uuid}/`);
      if (showJson) return console.log(JSON.stringify(m, null, 2));
      console.log(`UUID:      ${m.uuid}`);
      console.log(`Subject:   ${m.subject || '-'}`);
      console.log(`Start:     ${fmtDate(m.start_at)}`);
      console.log(`End:       ${fmtDate(m.end_at)}`);
      console.log(`Duration:  ${fmtDur(m.duration)}`);
      console.log(`State:     ${m.state || '-'}`);
      console.log(`Type:      ${m.meeting_type?.label || '-'}`);
      console.log(`Outcome:   ${m.outcome?.label || '-'}`);
      console.log(`Organizer: ${m.organizer_email || '-'}`);
      console.log(`Attendees:`);
      (m.attendees || []).forEach(a => console.log(`  - ${a.email || '?'} (${a.name || '-'})`));
      if (m.url) console.log(`Avoma URL: ${m.url}`);
      break;
    }

    case 'meeting-insights': {
      const uuid = args[1];
      if (!uuid) return console.error('Usage: avoma-cli meeting-insights <uuid>');
      const data = await avoma(`/v1/meetings/${uuid}/insights/`);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case 'meeting-drop': {
      const uuid = args[1];
      if (!uuid) return console.error('Usage: avoma-cli meeting-drop <uuid>');
      const url = new URL(BASE + `/v1/meetings/${uuid}/drop/`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AVOMA_API_KEY}`, 'Accept': 'application/json' }
      });
      const body = await res.text();
      console.log(`HTTP ${res.status}`);
      console.log(body);
      break;
    }

    case 'transcription': {
      const meetingUuid = args[1];
      if (!meetingUuid) return console.error('Usage: avoma-cli transcription <meeting_uuid>');
      const data = await avoma('/v1/transcriptions/', { meeting_uuid: meetingUuid });
      if (showJson) return console.log(JSON.stringify(data, null, 2));
      const t = Array.isArray(data) ? data[0] : (data.results?.[0] || data);
      if (!t || !t.transcript) {
        console.log(JSON.stringify(data, null, 2));
        break;
      }
      const speakers = new Map((t.speakers || []).map(s => [s.id, s.name || s.email || `Speaker ${s.id}`]));
      let lastSpeaker = null;
      for (const seg of (t.transcript || [])) {
        const who = speakers.get(seg.speaker_id) || `Speaker ${seg.speaker_id ?? '?'}`;
        const ts = Array.isArray(seg.timestamps) ? seg.timestamps[0] : seg.timestamp;
        const t0 = ts != null ? `[${Math.floor(ts/60)}:${String(Math.floor(ts%60)).padStart(2,'0')}]` : '';
        if (who !== lastSpeaker) {
          console.log(`\n${t0} ${who}:`);
          lastSpeaker = who;
        }
        console.log(`  ${seg.transcript || ''}`);
      }
      break;
    }

    case 'transcriptions': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date,
        page_size: flag('--limit') || 50
      };
      const max = args.includes('--all') ? Infinity : parseInt(params.page_size);
      const { results, count } = await paginate('/v1/transcriptions/', params, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} transcriptions`);
      for (const t of results) {
        console.log(`${t.uuid}\t${t.meeting_uuid || '-'}\t${(t.transcript?.length ?? 0)} segments`);
      }
      break;
    }

    case 'recording': {
      const meetingUuid = args[1];
      if (!meetingUuid) return console.error('Usage: avoma-cli recording <meeting_uuid>');
      const r = await avoma('/v1/recordings/', { meeting_uuid: meetingUuid });
      if (showJson) return console.log(JSON.stringify(r, null, 2));
      console.log(`UUID:       ${r.uuid || '-'}`);
      console.log(`Meeting:    ${r.meeting_uuid || '-'}`);
      console.log(`Valid till: ${fmtDate(r.valid_till)}`);
      console.log(`Audio URL:  ${r.audio_url || '-'}`);
      console.log(`Video URL:  ${r.video_url || '-'}`);
      if (r.message) console.log(`Message:    ${r.message}`);
      break;
    }

    case 'notes': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date,
        page_size: flag('--limit') || 20,
        output_format: flag('--format') || 'json'
      };
      const max = args.includes('--all') ? Infinity : parseInt(params.page_size);
      const { results, count } = await paginate('/v1/notes/', params, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} notes`);
      for (const n of results) {
        console.log(`${n.uuid || '-'}\t${n.meeting_uuid || '-'}\t${(n.title || n.subject || '-').slice(0,60)}`);
      }
      break;
    }

    case 'notes-meeting': {
      const meetingUuid = args[1];
      if (!meetingUuid) return console.error('Usage: avoma-cli notes-meeting <meeting_uuid> [--format json|html|markdown]');
      const format = flag('--format') || 'markdown';
      const data = await avoma('/v1/notes/', {
        meeting_uuid: meetingUuid,
        output_format: format,
        from_date: '2000-01-01T00:00:00Z',
        to_date: new Date().toISOString().slice(0, 19) + 'Z'
      });
      if (showJson) return console.log(JSON.stringify(data, null, 2));
      const note = data.results?.[0];
      if (!note) return console.log('(no notes)');
      console.log(note.notes || note.content || JSON.stringify(note, null, 2));
      break;
    }

    case 'calls': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date,
        direction: flag('--direction')
      };
      const data = await avoma('/v1/calls/', params);
      const results = data.results || [];
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${data.count ?? '?'} calls`);
      for (const c of results) {
        console.log(`${c.external_id}\t${fmtDate(c.start_at)}\t${c.direction || '-'}\t${c.answered ? 'ans' : 'noans'}\t${(c.subject || '-').slice(0,60)}`);
      }
      break;
    }

    case 'call': {
      const id = args[1];
      if (!id) return console.error('Usage: avoma-cli call <external_id>');
      const c = await avoma(`/v1/calls/${id}/`);
      console.log(JSON.stringify(c, null, 2));
      break;
    }

    case 'users': {
      const data = await avoma('/v1/users/');
      const list = Array.isArray(data) ? data : (data.results || []);
      if (showJson) return console.log(JSON.stringify(list, null, 2));
      for (const u of list) {
        const email = u.user?.email || '-';
        const name = [u.user?.first_name, u.user?.last_name].filter(Boolean).join(' ') || '-';
        const role = u.role?.name || u.role?.display_name || '-';
        console.log(`${u.uuid || u.user?.uuid || '-'}\t${email}\t${name}\t${role}\t${u.status || '-'}`);
      }
      break;
    }

    case 'user': {
      const uuid = args[1];
      if (!uuid) return console.error('Usage: avoma-cli user <uuid>');
      const u = await avoma(`/v1/users/${uuid}/`);
      console.log(JSON.stringify(u, null, 2));
      break;
    }

    case 'templates': {
      const max = args.includes('--all') ? Infinity : parseInt(flag('--limit') || 50);
      const { results, count } = await paginate('/v1/template/', { page_size: flag('--limit') || 50 }, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} templates`);
      for (const t of results) {
        console.log(`${t.uuid}\t${t.name || '-'}`);
      }
      break;
    }

    case 'scorecards': {
      const max = args.includes('--all') ? Infinity : parseInt(flag('--limit') || 50);
      const { results, count } = await paginate('/v1/scorecards/', { page_size: flag('--limit') || 50 }, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} scorecards`);
      for (const s of results) {
        console.log(`${s.uuid}\t${s.name || '-'}`);
      }
      break;
    }

    case 'scorecard-evals': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date,
        page_size: flag('--limit') || 50
      };
      const max = args.includes('--all') ? Infinity : parseInt(params.page_size);
      const { results, count } = await paginate('/v1/scorecard_evaluations/', params, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} scorecard evaluations`);
      for (const s of results) {
        console.log(`${s.uuid}\t${s.meeting_uuid || '-'}\t${s.score ?? '-'}`);
      }
      break;
    }

    case 'smart-categories': {
      const data = await avoma('/v1/smart_categories/');
      const list = data.results || data;
      console.log(JSON.stringify(list, null, 2));
      break;
    }

    case 'meeting-types': {
      const data = await avoma('/v1/meeting_type/');
      const list = data.results || data;
      if (showJson) return console.log(JSON.stringify(list, null, 2));
      for (const t of list) console.log(`${t.uuid}\t${t.label || t.name || '-'}`);
      break;
    }

    case 'meeting-outcomes': {
      const data = await avoma('/v1/meeting_outcome/');
      const list = data.results || data;
      if (showJson) return console.log(JSON.stringify(list, null, 2));
      for (const o of list) console.log(`${o.uuid}\t${o.label || o.name || '-'}`);
      break;
    }

    case 'snippets': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date,
        page_size: flag('--limit') || 50
      };
      const max = args.includes('--all') ? Infinity : parseInt(params.page_size);
      const { results, count } = await paginate('/v1/snippets/', params, max);
      if (showJson) return console.log(JSON.stringify(results, null, 2));
      console.log(`# ${results.length} of ${count ?? '?'} snippets`);
      for (const s of results) {
        console.log(`${s.uuid}\t${(s.title || '-').slice(0,80)}`);
      }
      break;
    }

    case 'segments': {
      const meetingUuid = flag('--meeting');
      if (!meetingUuid) return console.error('Usage: avoma-cli segments --meeting <uuid>');
      const data = await avoma('/v1/meeting_segments/', { meeting_uuid: meetingUuid });
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case 'sentiments': {
      const meetingUuid = flag('--meeting');
      if (!meetingUuid) return console.error('Usage: avoma-cli sentiments --meeting <uuid>');
      const data = await avoma('/v1/meeting_sentiments/', { meeting_uuid: meetingUuid });
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case 'engagement': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date
      };
      const data = await avoma('/v1/engagement/', params);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case 'engagement-summary': {
      const { from_date, to_date } = defaultFromTo();
      const params = {
        from_date: flag('--from') ? dateToIso(flag('--from')) : from_date,
        to_date: flag('--to') ? dateToIso(flag('--to'), true) : to_date
      };
      const data = await avoma('/v1/engagement/summary/', params);
      console.log(JSON.stringify(data, null, 2));
      break;
    }

    case 'raw': {
      const method = (args[1] || 'GET').toUpperCase();
      const path = args[2];
      if (!path) return console.error('Usage: avoma-cli raw <METHOD> <path> [--data JSON]');
      const dataIdx = args.indexOf('--data');
      const body = dataIdx > -1 ? args[dataIdx + 1] : null;

      const url = path.startsWith('http') ? path : (BASE + path);
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${AVOMA_API_KEY}`,
          'Accept': 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body || undefined
      });
      const text = await res.text();
      console.error(`HTTP ${res.status} ${res.statusText}`);
      try { console.log(JSON.stringify(JSON.parse(text), null, 2)); }
      catch { console.log(text); }
      break;
    }

    default:
      help();
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
