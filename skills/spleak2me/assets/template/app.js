(function () {
  'use strict';
  var DOC = window.DOC || { meta: {}, sections: [] };
  var AUDIO = window.AUDIO || {};                 // { nodeId: "audio/nodeId.mp3" }, written by gen-audio.js
  var META = DOC.meta || {};
  var UI = META.ui || {};
  // UI labels — override any of these via DOC.meta.ui to match the content language.
  function T(k, def) { return UI[k] != null ? UI[k] : def; }

  var LS_KEY = 'spleak2me:' + (META.id || META.title || 'doc');
  var understood = load();
  var current = null;      // active L1 id
  var playing = null;      // active Audio element
  var audios = [];         // every Audio created, for global speed control

  var RATES = [1, 1.2, 1.5, 2];
  var rate = loadRate();
  function loadRate() {
    var r = parseFloat(localStorage.getItem(LS_KEY + ':rate'));
    return RATES.indexOf(r) >= 0 ? r : 1;
  }
  function rateLabel(r) { return (String(r).indexOf('.') < 0 ? r : r) + '×'; }
  function applyRate() {
    audios.forEach(function (a) { a.playbackRate = rate; });
    document.querySelectorAll('.aud .speed').forEach(function (b) { b.textContent = rateLabel(rate); });
    try { localStorage.setItem(LS_KEY + ':rate', String(rate)); } catch (e) {}
  }
  function cycleRate() {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    applyRate();
  }

  function load() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
    catch (e) { return new Set(); }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(understood))); } catch (e) {}
  }

  // flatten checkable nodes (L1 + L2)
  var allIds = [];
  DOC.sections.forEach(function (s) {
    allIds.push(s.id);
    (s.children || []).forEach(function (c) { allIds.push(c.id); });
  });

  function sectionDone(s) {
    var ids = [s.id].concat((s.children || []).map(function (c) { return c.id; }));
    var d = ids.filter(function (i) { return understood.has(i); }).length;
    return { done: d, total: ids.length };
  }

  function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hl(code, lang) {
    var t = esc(code);
    if (lang === 'json') {
      t = t.replace(/&quot;/g, '"')
        .replace(/"([^"]+)"(\s*:)/g, '<span class="k">"$1"</span>$2')
        .replace(/:\s*"([^"]*)"/g, ': <span class="s">"$1"</span>')
        .replace(/\b(\d+)\b/g, '<span class="n">$1</span>');
    }
    return t;
  }

  var PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  function fmt(s) { s = Math.max(0, s | 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function makePlayer(id) {
    var wrap = document.createElement('div'); wrap.className = 'aud';
    var btn = document.createElement('button'); btn.className = 'play'; btn.type = 'button';
    btn.innerHTML = PLAY; btn.setAttribute('aria-label', 'play explanation');
    var seek = document.createElement('div'); seek.className = 'seek';
    var fill = document.createElement('i'); seek.appendChild(fill);
    var time = document.createElement('div'); time.className = 'time'; time.textContent = '0:00';
    var lbl = document.createElement('div'); lbl.className = 'lbl'; lbl.textContent = T('whyItMatters', '🎧 why it matters');
    var speed = document.createElement('button'); speed.className = 'speed'; speed.type = 'button';
    speed.textContent = rateLabel(rate); speed.setAttribute('aria-label', T('speedLabel', 'playback speed'));
    speed.addEventListener('click', function (e) { e.stopPropagation(); cycleRate(); });
    wrap.appendChild(btn); wrap.appendChild(lbl); wrap.appendChild(seek); wrap.appendChild(time); wrap.appendChild(speed);

    var audio = null;
    function ensure() {
      if (audio) return audio;
      audio = new Audio(AUDIO[id]); audio.preload = 'none';
      audio.playbackRate = rate; audios.push(audio);
      audio.addEventListener('timeupdate', function () {
        if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
        time.textContent = fmt(audio.duration ? audio.duration - audio.currentTime : 0);
      });
      audio.addEventListener('ended', function () { btn.innerHTML = PLAY; fill.style.width = '0'; time.textContent = fmt(audio.duration || 0); });
      audio.addEventListener('loadedmetadata', function () { time.textContent = fmt(audio.duration); });
      return audio;
    }
    btn.addEventListener('click', function () {
      var a = ensure();
      if (a.paused) {
        if (playing && playing !== a) playing.pause();
        a.play(); btn.innerHTML = PAUSE; playing = a;
        document.querySelectorAll('.aud .play').forEach(function (b) { if (b !== btn) b.innerHTML = PLAY; });
      } else { a.pause(); btn.innerHTML = PLAY; }
    });
    seek.addEventListener('click', function (e) {
      var a = ensure(); if (!a.duration) return;
      var r = seek.getBoundingClientRect();
      a.currentTime = (e.clientX - r.left) / r.width * a.duration;
    });
    return wrap;
  }

  function makeChk(id) {
    var b = document.createElement('button'); b.className = 'chk'; b.type = 'button';
    function render() { b.innerHTML = '<span class="mk">' + (understood.has(id) ? '✓' : '') + '</span>' + (understood.has(id) ? T('gotIt', 'got it') : T('gotItQ', 'got it?')); }
    render();
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (understood.has(id)) understood.delete(id); else understood.add(id);
      save(); render();
      var card = b.closest('.card'); if (card) card.classList.toggle('done', understood.has(id));
      updateProgress(); renderList();
    });
    return b;
  }

  function makeCard(node, isL1) {
    var card = document.createElement('div'); card.className = 'card' + (isL1 ? ' l1card' : '');
    if (understood.has(node.id)) card.classList.add('done');
    var h = document.createElement('h3');
    h.textContent = isL1 ? T('bigPicture', '🧭 The big picture') : node.title;
    h.appendChild(makeChk(node.id));
    card.appendChild(h);
    var html = isL1 ? node.overview : node.body;
    if (html) {
      var body = document.createElement('div'); body.className = 'body'; body.innerHTML = html;
      card.appendChild(body);
    }
    if (node.narration && AUDIO[node.id]) card.appendChild(makePlayer(node.id));
    if (node.detail) {
      var d = document.createElement('details'); d.className = 'more';
      var sum = document.createElement('summary'); sum.textContent = node.detail.lang === 'json' ? T('viewJson', 'view JSON') : T('viewDetail', 'view detail');
      var pre = document.createElement('pre'); pre.innerHTML = hl(node.detail.code, node.detail.lang);
      d.appendChild(sum); d.appendChild(pre); card.appendChild(d);
    }
    return card;
  }

  function renderDetail(s) {
    var empty = document.getElementById('detail-empty');
    var body = document.getElementById('detail-body');
    empty.hidden = true; body.hidden = false; body.innerHTML = '';

    var head = document.createElement('div'); head.className = 'detail-head';
    var back = document.createElement('button'); back.className = 'back'; back.type = 'button';
    back.innerHTML = T('back', '← all sections'); back.addEventListener('click', closeDetail);
    head.appendChild(back);
    var k = document.createElement('div'); k.className = 'kick'; k.textContent = s.kicker || ''; head.appendChild(k);
    var h2 = document.createElement('h2'); h2.textContent = s.title; head.appendChild(h2);
    if (s.tagline) { var tg = document.createElement('div'); tg.className = 'tag'; tg.textContent = s.tagline; head.appendChild(tg); }
    body.appendChild(head);

    if (s.overview) body.appendChild(makeCard(s, true));
    (s.children || []).forEach(function (c) { body.appendChild(makeCard(c, false)); });

    document.querySelector('.detail').classList.add('show');
    document.getElementById('list').classList.add('hide');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeDetail() {
    document.querySelector('.detail').classList.remove('show');
    document.getElementById('list').classList.remove('hide');
    if (playing) { playing.pause(); playing = null; }
  }

  function selectSection(id) {
    if (playing) { playing.pause(); playing = null; }
    current = id;
    renderDetail(DOC.sections.find(function (x) { return x.id === id; }));
    renderList();
  }

  function renderList() {
    var list = document.getElementById('list'); list.innerHTML = '';
    DOC.sections.forEach(function (s) {
      var st = sectionDone(s);
      var b = document.createElement('button'); b.className = 'l1' + (current === s.id ? ' active' : '');
      b.innerHTML =
        '<div class="kick">' + (s.kicker || '') + '</div>' +
        '<h2>' + s.title + '</h2>' +
        '<div class="tag">' + (s.tagline || '') + '</div>' +
        '<div class="l1-foot">' +
          '<span class="dot' + (st.done === st.total ? ' done' : '') + '"></span>' +
          '<span class="barmini"><i style="width:' + (st.done / st.total * 100) + '%"></i></span>' +
          '<span class="cnt">' + st.done + '/' + st.total + '</span>' +
        '</div>';
      b.addEventListener('click', function () { selectSection(s.id); });
      list.appendChild(b);
    });
  }

  function updateProgress() {
    var done = allIds.filter(function (i) { return understood.has(i); }).length;
    document.getElementById('progress-fill').style.width = (done / allIds.length * 100) + '%';
    document.getElementById('progress-count').textContent = done + '/' + allIds.length;
  }

  // init
  if (META.lang) document.documentElement.setAttribute('lang', META.lang);
  document.title = META.title || 'spleak2me';
  document.getElementById('doc-title').textContent = META.title || '';
  document.getElementById('doc-sub').textContent = META.subtitle || '';
  document.getElementById('doc-intro').textContent = META.intro || '';
  document.getElementById('doc-eyebrow').textContent = T('eyebrow', 'Guided reading · top-down');
  document.getElementById('doc-hint').textContent = T('hint', '← Pick a section to start. Each card has a short 🎧 audio explainer — an aid, not a reading of the text.');
  document.getElementById('lbl-understood').textContent = T('understood', 'understood');
  document.getElementById('reset').textContent = T('reset', 'reset');
  if (META.source) { var src = document.getElementById('doc-src'); src.href = META.source; src.hidden = false; src.textContent = T('sourceLabel', 'source ↗'); }
  document.getElementById('reset').addEventListener('click', function () {
    if (!confirm(T('resetConfirm', 'Reset all reading progress?'))) return;
    understood = new Set(); save(); updateProgress(); renderList();
    document.querySelectorAll('.card.done').forEach(function (c) { c.classList.remove('done'); });
    if (current) selectSection(current);
  });

  renderList(); updateProgress();
})();
