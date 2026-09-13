/* Archivio Lavoro — report e idee di business.
 * Salvataggio: immediato su questo dispositivo (localStorage) e, dopo pochi secondi,
 * su data.json in un repository GitHub privato tramite le API di GitHub.
 * Le modifiche da più dispositivi vengono unite per elemento (vince la più recente). */
(() => {
  'use strict';

  /* =========================================================
     Costanti
     ========================================================= */
  const LS_DATA = 'archivio.data.v1';
  const LS_CFG = 'archivio.cfg.v1';
  const LS_UI = 'archivio.ui.v2';
  const LS_PREFS = 'archivio.prefs.v1';
  const SYNC_DELAY = 2000;
  const POLL_MS = 30000;
  const VIEWS = ['home', 'report', 'idee', 'impostazioni'];

  const COLORS = {
    Consulenza: '--c-consulenza', Lavoro: '--c-lavoro', Studio: '--c-studio', Ricerca: '--c-ricerca',
    Idea: '--s-idea', 'In valutazione': '--s-valutazione', 'In sviluppo': '--s-sviluppo', Lanciata: '--s-lanciata', Archiviata: '--s-archiviata',
  };
  const colorOf = (kind) => `var(${COLORS[kind] || '--muted'})`;

  const SECTIONS = {
    report: {
      label: 'Report', route: '#/report', icon: 'i-doc',
      kinds: ['Consulenza', 'Lavoro', 'Studio', 'Ricerca'],
      kindLabel: 'Tipo', whoLabel: 'Cliente / progetto',
      template: '<h2>Obiettivo</h2><p><br></p><h2>Contesto</h2><p><br></p><h2>Analisi</h2><p><br></p><h2>Conclusioni</h2><p><br></p><h2>Prossimi passi</h2><p><br></p>',
    },
    idea: {
      label: 'Idee di business', route: '#/idee', icon: 'i-bulb',
      kinds: ['Idea', 'In valutazione', 'In sviluppo', 'Lanciata', 'Archiviata'],
      kindLabel: 'Stato', whoLabel: 'Settore / mercato',
      template: '<h2>Problema</h2><p><br></p><h2>Soluzione</h2><p><br></p><h2>Clienti target</h2><p><br></p><h2>Modello di ricavo</h2><p><br></p><h2>Concorrenti</h2><p><br></p><h2>Prossimi passi</h2><ol><li data-list="unchecked"><br></li></ol>',
    },
  };

  /* =========================================================
     Utilità
     ========================================================= */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg><use href="#${id}"/></svg>`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const isPhone = () => window.matchMedia('(max-width: 820px)').matches;
  const num = (n) => n.toLocaleString('it-IT');
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const load = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  const store = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('Memoria del dispositivo piena: ' + e.message); }
  };

  function fmtDate(iso, long) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('it-IT', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function relTime(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'adesso';
    if (s < 3600) return `${Math.round(s / 60)} min fa`;
    const d = new Date(ts);
    const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === new Date().toDateString()) return 'oggi alle ' + time;
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'ieri alle ' + time;
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }

  /* =========================================================
     Stato
     ========================================================= */
  let data = normalizeData(load(LS_DATA, null));
  let cfg = Object.assign({ owner: '', repo: 'lavoro-dati', branch: 'main', path: 'data.json', token: '' }, load(LS_CFG, {}));
  const ui = Object.assign({ reportSort: 'updated', boardTab: 'Idea' }, load(LS_UI, {}));
  const prefs = Object.assign({ theme: 'auto', font: 'serif', size: 'm', width: 'narrow' }, load(LS_PREFS, {}));

  // Prima di scrivere unisce ciò che c'è già in memoria locale (altre schede aperte),
  // così una scheda rimasta indietro non cancella le modifiche più recenti.
  const saveData = () => { data = merge(data, normalizeData(load(LS_DATA, null))); store(LS_DATA, data); };
  const saveDataSoon = debounce(saveData, 400);
  const saveCfg = () => store(LS_CFG, cfg);
  const saveUi = () => store(LS_UI, ui);
  const savePrefs = () => store(LS_PREFS, prefs);

  /* =========================================================
     Modello dati
     ========================================================= */
  function normalizeItem(it) {
    const out = {
      id: String(it.id),
      section: it.section === 'idea' ? 'idea' : 'report',
      title: String(it.title || ''),
      kind: String(it.kind || ''),
      date: String(it.date || ''),
      who: String(it.who || ''),
      tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
      body: String(it.body || ''),
      createdAt: Number(it.createdAt) || 0,
      updatedAt: Number(it.updatedAt) || 0,
    };
    if (it.deleted) { out.deleted = true; out.title = ''; out.body = ''; out.who = ''; out.tags = []; }
    return out;
  }

  function normalizeData(d) {
    const items = {};
    const src = d && d.items && typeof d.items === 'object' ? d.items : {};
    Object.keys(src).sort().forEach((id) => { if (src[id] && src[id].id) items[id] = normalizeItem(src[id]); });
    return { version: 1, items };
  }

  function merge(local, remote) {
    const items = {};
    const ids = new Set([...Object.keys(local.items), ...Object.keys((remote && remote.items) || {})]);
    [...ids].sort().forEach((id) => {
      const a = local.items[id];
      const b = remote && remote.items[id];
      items[id] = !b ? a : !a ? b : (a.updatedAt >= b.updatedAt ? a : b);
    });
    return { version: 1, items };
  }

  const serialize = (d) => JSON.stringify(normalizeData(d), null, 1);
  const alive = (section) => Object.values(data.items).filter((it) => !it.deleted && (!section || it.section === section));

  // I primi report erano testo semplice: li converto in HTML per l'editor.
  function toHtml(body) {
    if (!body) return '';
    if (/^\s*</.test(body)) return body;
    return body.split('\n').map((l) => {
      const h = l.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;
      const li = l.match(/^\s*[-*]\s+(.*)$/);
      if (li) return `<ol><li data-list="bullet">${esc(li[1])}</li></ol>`;
      return l.trim() ? `<p>${esc(l)}</p>` : '<p><br></p>';
    }).join('');
  }

  // Testo, estratto e numero di parole di un documento (con cache).
  const infoCache = new Map();
  function info(it) {
    const c = infoCache.get(it.id);
    if (c && c.u === it.updatedAt) return c;
    const html = toHtml(it.body).replace(/<\/(p|h[1-6]|li|blockquote)>/gi, '$& ').replace(/<br\s*\/?>/gi, ' ');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    const excerpt = [...doc.body.querySelectorAll('p, li, blockquote')].map((n) => n.textContent.trim()).filter(Boolean).join(' ').slice(0, 280);
    const out = { u: it.updatedAt, text, excerpt, words: text ? text.split(' ').length : 0 };
    infoCache.set(it.id, out);
    return out;
  }

  /* =========================================================
     Sincronizzazione GitHub
     ========================================================= */
  const connected = () => Boolean(cfg.token && cfg.owner && cfg.repo);
  let syncing = false, syncAgain = false, syncTimer = null, lastError = '', syncState = '';

  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function gh(path, opts = {}) {
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path ? '/' + path : ''}`;
    return fetch(url, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }

  async function httpError(r) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* vuoto */ }
    if (r.status === 401) return new Error('Token non valido o scaduto');
    if (r.status === 403) return new Error('Il token non ha i permessi di scrittura (Contents: Read and write)');
    if (r.status === 404) return new Error('Repository non trovato, oppure il token non ha accesso a questo repository');
    return new Error(`GitHub ${r.status}${msg ? ': ' + msg : ''}`);
  }

  async function fetchRemote() {
    const r = await gh(`contents/${cfg.path}?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`);
    if (r.status === 404) {
      const repo = await gh('');
      if (!repo.ok) throw await httpError(repo);
      return { data: null, sha: null };
    }
    if (!r.ok) throw await httpError(r);
    const j = await r.json();
    let b64 = j.content;
    if (!b64 && j.sha) { // file oltre 1 MB: si legge come blob
      const rb = await gh(`git/blobs/${j.sha}`);
      if (!rb.ok) throw await httpError(rb);
      b64 = (await rb.json()).content;
    }
    let parsed;
    try { parsed = JSON.parse(fromB64(b64 || '')); } catch { parsed = { items: {} }; }
    return { data: normalizeData(parsed), sha: j.sha };
  }

  async function putRemote(text, sha) {
    const body = { message: `Aggiornamento archivio ${new Date().toLocaleString('it-IT')}`, content: toB64(text), branch: cfg.branch };
    if (sha) body.sha = sha;
    const r = await gh(`contents/${cfg.path}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 || (r.status === 422 && !sha)) return false;
    if (!r.ok) throw await httpError(r);
    return true;
  }

  function scheduleSync(delay = SYNC_DELAY) {
    clearTimeout(syncTimer);
    if (!connected()) { setStatus(); return; }
    setStatus('pending');
    syncTimer = setTimeout(sync, delay);
  }

  async function sync() {
    clearTimeout(syncTimer);
    if (!connected()) { setStatus(); return; }
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    saveData();
    try {
      let done = false;
      for (let attempt = 0; attempt < 5 && !done; attempt++) {
        const remote = await fetchRemote();
        data = merge(data, remote.data);
        saveData();
        const text = serialize(data);
        if (remote.data && serialize(remote.data) === text) { done = true; break; }
        done = await putRemote(text, remote.sha);
      }
      if (!done) throw new Error('Troppe modifiche contemporanee, riprovo tra poco');
      lastError = '';
      setStatus('ok');
      renderSoon();
      refreshWriterIfStale();
    } catch (e) {
      lastError = e.message || String(e);
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      if (navigator.onLine !== false && !/Token|permessi|non trovato/.test(lastError)) syncAgain = true;
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(lastError ? 15000 : 400); }
    }
  }

  function setStatus(state) {
    let text;
    if (!connected()) { state = 'local'; text = 'Solo su questo dispositivo'; }
    else if (state === 'ok') text = 'Sincronizzato';
    else if (state === 'pending') text = 'Salvataggio…';
    else if (state === 'offline') text = 'Offline · salvato qui';
    else if (state === 'error') text = 'Errore di sincronizzazione';
    else text = 'Connessione…';
    syncState = state || '';
    document.querySelectorAll('[data-sync]').forEach((n) => {
      n.dataset.state = syncState;
      n.querySelector('span').textContent = text;
      n.title = state === 'error' ? lastError : text;
    });
    document.querySelectorAll('[data-sync-detail]').forEach((n) => {
      n.dataset.state = syncState;
      n.innerHTML = `<i></i><span>${esc(state === 'error' ? 'Errore: ' + lastError : text)}</span>`;
    });
  }

  /* =========================================================
     Navigazione (hash)
     ========================================================= */
  let prevRoute = null, writerFromApp = false;

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs = ''] = raw.split('?');
    const [name, id] = path.split('/');
    return { name: name || 'home', id: id ? decodeURIComponent(id) : '', params: new URLSearchParams(qs) };
  }

  function route() {
    const r = parseHash();
    if (r.name === 'doc') {
      const it = data.items[r.id];
      if (!it || it.deleted) { location.replace('#/home'); return; }
      writerFromApp = Boolean(prevRoute && prevRoute.name !== 'doc');
      openWriter(it);
    } else {
      if (!VIEWS.includes(r.name)) { location.replace('#/home'); return; }
      if (!el.writer.hidden) closeWriterUI();
      showView(r);
    }
    prevRoute = r;
  }

  let currentView = null;
  function showView(r) {
    const changed = !currentView || currentView.name !== r.name;
    currentView = r;
    VIEWS.forEach((v) => { $('view-' + v).hidden = v !== r.name; });
    renderNav();
    renderView();
    if (changed) window.scrollTo(0, 0);
  }

  function renderNav() {
    const name = currentView ? currentView.name : '';
    const cat = currentView ? currentView.params.get('cat') || '' : '';
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name && !(a.closest('.side-nav') && name === 'report' && cat)));
    const counts = {};
    alive('report').forEach((it) => { counts[it.kind] = (counts[it.kind] || 0) + 1; });
    $('side-cats').innerHTML = SECTIONS.report.kinds.map((k) =>
      `<a href="#/report?cat=${encodeURIComponent(k)}" class="${name === 'report' && cat === k ? 'active' : ''}" style="--cat:${colorOf(k)}"><i></i><span>${k}</span><em>${counts[k] || ''}</em></a>`).join('');
    document.querySelectorAll('[data-count]').forEach((n) => { n.textContent = alive(n.dataset.count).length || ''; });
  }

  function renderView() {
    if (!currentView || !el.writer.hidden) return;
    ({ home: renderHome, report: renderReports, idee: renderIdeas, impostazioni: renderSettings })[currentView.name]();
  }

  const renderSoon = debounce(() => { renderNav(); renderView(); }, 200);

  /* =========================================================
     Home
     ========================================================= */
  function rowLink(it) {
    const s = SECTIONS[it.section];
    const title = it.title.trim();
    return `<a class="row-link" href="#/doc/${encodeURIComponent(it.id)}" style="--cat:${colorOf(it.kind)}">
      <span class="row-icon">${icon(s.icon)}</span>
      <span class="row-main">
        <span class="row-title ${title ? '' : 'untitled'}">${esc(title || 'Senza titolo')}</span>
        <span class="row-meta">${esc(it.kind)}${it.who ? ' · ' + esc(it.who) : ''} · ${relTime(it.updatedAt)}</span>
      </span>
      <svg class="chev"><use href="#i-arrow"/></svg>
    </a>`;
  }

  function renderHome() {
    const now = new Date();
    const d = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    $('home-date').textContent = d.charAt(0).toUpperCase() + d.slice(1);
    const h = now.getHours();
    $('home-greeting').textContent = h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
    $('home-connect').hidden = connected();

    const reports = alive('report');
    const ideas = alive('idea');
    const all = [...reports, ...ideas];
    const words = all.reduce((sum, it) => sum + info(it).words, 0);
    const week = all.filter((it) => it.updatedAt > Date.now() - 7 * 864e5).length;
    $('home-stats').innerHTML = [
      [reports.length, reports.length === 1 ? 'Report' : 'Report'],
      [ideas.filter((i) => i.kind !== 'Archiviata').length, 'Idee attive'],
      [num(words), 'Parole scritte'],
      [week, 'Modificati in 7 giorni'],
    ].map(([n, l]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');

    const recent = all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
    $('home-recent').innerHTML = recent.length ? recent.map(rowLink).join('')
      : '<p class="panel-empty">Ancora nessun documento. Inizia dal tuo primo report.</p>';

    let moving = ideas.filter((i) => i.kind === 'In valutazione' || i.kind === 'In sviluppo');
    if (!moving.length) moving = ideas.filter((i) => i.kind !== 'Archiviata');
    moving = moving.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    $('home-ideas').innerHTML = moving.length ? moving.map(rowLink).join('')
      : '<p class="panel-empty">Nessuna idea per ora. Quando ti viene in mente qualcosa, annotala subito.</p>';
  }

  /* =========================================================
     Report
     ========================================================= */
  const matches = (it, q) => !q || [it.title, info(it).text, it.who, it.kind, it.tags.join(' ')].join(' ').toLowerCase().includes(q);

  function renderReports() {
    const cat = currentView.params.get('cat') || '';
    const reports = alive('report');
    const counts = {};
    reports.forEach((it) => { counts[it.kind] = (counts[it.kind] || 0) + 1; });
    $('report-cats').innerHTML = ['', ...SECTIONS.report.kinds].map((k) =>
      `<button data-cat="${esc(k)}" aria-pressed="${cat === k}" style="--dot:${colorOf(k)}">${k ? '<i></i>' : ''}${k || 'Tutti'}<span class="n">${k ? counts[k] || 0 : reports.length}</span></button>`).join('');
    $('report-sort').value = ui.reportSort;
    renderReportGrid();
  }

  function renderReportGrid() {
    const cat = currentView.params.get('cat') || '';
    const q = $('report-search').value.trim().toLowerCase();
    const all = alive('report');
    const list = all.filter((it) => (!cat || it.kind === cat) && matches(it, q));
    const sorters = {
      updated: (a, b) => b.updatedAt - a.updatedAt,
      date: (a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt,
      title: (a, b) => (a.title || '￿').localeCompare(b.title || '￿', 'it'),
    };
    list.sort(sorters[ui.reportSort] || sorters.updated);

    const grid = $('report-grid');
    if (!all.length) {
      grid.innerHTML = `<div class="empty-state">
        <span class="quick-icon">${icon('i-doc')}</span>
        <h3>Il tuo archivio è vuoto</h3>
        <p>Scrivi qui i report di consulenza, lavoro, studio e ricerca. Si salvano da soli mentre scrivi.</p>
        <button class="btn primary" data-action="new" data-section="report" data-kind="${esc(cat)}">${icon('i-plus')}Scrivi il primo report</button>
      </div>`;
      return;
    }
    if (!list.length) {
      grid.innerHTML = `<div class="empty-state"><h3>Nessun risultato</h3><p>${q ? 'Prova con altre parole.' : 'Non ci sono ancora report in questa categoria.'}</p>
        ${q ? '' : `<button class="btn primary" data-action="new" data-section="report" data-kind="${esc(cat)}">${icon('i-plus')}Nuovo report ${esc(cat.toLowerCase())}</button>`}</div>`;
      return;
    }
    grid.innerHTML = list.map((it) => {
      const inf = info(it);
      const title = it.title.trim();
      return `<a class="doc-card" href="#/doc/${encodeURIComponent(it.id)}" style="--cat:${colorOf(it.kind)}">
        <div class="doc-card-top"><span class="cat-label"><i></i>${esc(it.kind)}</span><span class="doc-date">${esc(fmtDate(it.date))}</span></div>
        <h3 class="${title ? '' : 'untitled'}">${esc(title || 'Senza titolo')}</h3>
        <p class="doc-excerpt">${esc(inf.excerpt || 'Nessun testo ancora.')}</p>
        ${it.tags.length ? `<div class="tags">${it.tags.slice(0, 3).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="doc-foot"><span class="who">${esc(it.who || '—')}</span><span>${num(inf.words)} parole</span></div>
      </a>`;
    }).join('');
  }

  /* =========================================================
     Idee (bacheca)
     ========================================================= */
  function renderIdeas() {
    const q = $('idea-search').value.trim().toLowerCase();
    const ideas = alive('idea').filter((it) => matches(it, q)).sort((a, b) => b.updatedAt - a.updatedAt);
    const kinds = SECTIONS.idea.kinds;
    if (!kinds.includes(ui.boardTab)) ui.boardTab = kinds[0];
    const by = Object.fromEntries(kinds.map((k) => [k, []]));
    ideas.forEach((it) => (by[it.kind] || by[kinds[0]]).push(it));

    $('board-tabs').innerHTML = `<div class="segmented">${kinds.map((k) =>
      `<button data-tab="${esc(k)}" aria-pressed="${ui.boardTab === k}" style="--dot:${colorOf(k)}"><i></i>${k}<span class="n">${by[k].length}</span></button>`).join('')}</div>`;

    $('idea-board').innerHTML = kinds.map((k) => `
      <section class="column ${ui.boardTab === k ? 'current' : ''}" data-status="${esc(k)}" style="--dot:${colorOf(k)}">
        <header class="column-head"><i></i>${k}<span class="n">${by[k].length}</span>
          <button class="icon-btn" data-action="new" data-section="idea" data-kind="${esc(k)}" title="Nuova idea in “${esc(k)}”">${icon('i-plus')}</button>
        </header>
        <div class="column-body">
          ${by[k].map((it) => {
            const inf = info(it);
            const title = it.title.trim();
            return `<a class="idea-card" href="#/doc/${encodeURIComponent(it.id)}" draggable="true" data-id="${esc(it.id)}">
              <h3 class="${title ? '' : 'untitled'}">${esc(title || 'Senza titolo')}</h3>
              ${inf.excerpt ? `<p>${esc(inf.excerpt)}</p>` : ''}
              <div class="idea-foot">${it.who ? `<span class="sector">${esc(it.who)}</span>` : ''}${it.tags.slice(0, 2).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}<span>${relTime(it.updatedAt)}</span></div>
            </a>`;
          }).join('') || `<div class="column-empty">${q ? 'Nessun risultato' : 'Trascina qui un’idea'}</div>`}
        </div>
      </section>`).join('');
  }

  function setupBoardDnd() {
    const board = $('idea-board');
    board.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.idea-card');
      if (!card) return;
      e.dataTransfer.setData('text/plain', card.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    board.addEventListener('dragend', () => {
      board.querySelectorAll('.dragging, .drag-over').forEach((n) => n.classList.remove('dragging', 'drag-over'));
    });
    board.addEventListener('dragover', (e) => {
      const col = e.target.closest('.column');
      if (!col) return;
      e.preventDefault();
      board.querySelectorAll('.drag-over').forEach((n) => n !== col && n.classList.remove('drag-over'));
      col.classList.add('drag-over');
    });
    board.addEventListener('drop', (e) => {
      const col = e.target.closest('.column');
      if (!col) return;
      e.preventDefault();
      const it = data.items[e.dataTransfer.getData('text/plain')];
      if (it && it.kind !== col.dataset.status) {
        it.kind = col.dataset.status;
        it.updatedAt = Date.now();
        saveData();
        scheduleSync();
        toast(`Spostata in “${it.kind}”`);
      }
      renderIdeas();
      renderNav();
    });
  }

  /* =========================================================
     Impostazioni
     ========================================================= */
  function renderSettings() {
    if (document.activeElement && document.activeElement.closest('#view-impostazioni .form')) return;
    $('c-owner').value = cfg.owner;
    $('c-repo').value = cfg.repo;
    $('c-token').value = cfg.token;
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === prefs.theme)));
    setStatus(syncState);
  }

  function showResult(msg, ok) {
    const n = $('connect-result');
    n.textContent = msg;
    n.className = 'result ' + (ok ? 'ok' : 'err');
  }

  async function connect() {
    cfg.owner = $('c-owner').value.trim();
    cfg.repo = $('c-repo').value.trim();
    cfg.token = $('c-token').value.trim();
    if (!connected()) { showResult('Compila utente, repository e token.', false); return; }
    saveCfg();
    showResult('Verifica in corso…', true);
    await sync();
    if (lastError) showResult(lastError, false);
    else showResult('Collegato. I contenuti ora si sincronizzano in automatico.', true);
  }

  function disconnect() {
    if (!confirm('Scollegare questo dispositivo? I contenuti restano su GitHub e sugli altri dispositivi.')) return;
    cfg.token = '';
    saveCfg();
    $('qr').hidden = true;
    renderSettings();
    showResult('Dispositivo scollegato.', true);
    setStatus();
  }

  function connectLink() {
    const payload = btoa(JSON.stringify({ o: cfg.owner, r: cfg.repo, b: cfg.branch, p: cfg.path, t: cfg.token }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.origin + location.pathname + '#collega=' + payload;
  }

  function readConnectLink() {
    const m = location.hash.match(/^#collega=([\w-]+)$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search + '#/home');
    try {
      const j = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!j.t || !j.o || !j.r) return false;
      cfg = { owner: j.o, repo: j.r, branch: j.b || 'main', path: j.p || 'data.json', token: j.t };
      saveCfg();
      return true;
    } catch { return false; }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.append(s);
    });
  }

  async function showQr() {
    if (!connected()) { showResult('Prima collega questo dispositivo.', false); return; }
    const box = $('qr-img');
    $('qr').hidden = false;
    box.textContent = 'Caricamento…';
    try {
      if (!window.qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
      const qr = window.qrcode(0, 'M');
      qr.addData(connectLink());
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch {
      box.textContent = 'QR non disponibile: usa “Copia link”.';
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(connectLink()); toast('Link copiato'); }
    catch { prompt('Copia questo link e aprilo sul telefono:', connectLink()); }
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  async function importBackup(file) {
    try {
      const imported = normalizeData(JSON.parse(await file.text()));
      const n = Object.values(imported.items).filter((i) => !i.deleted).length;
      if (!confirm(`Importare ${n} elementi? Verranno uniti a quelli esistenti.`)) return;
      data = merge(data, imported);
      saveData();
      scheduleSync(300);
      renderSoon();
      toast(`Importati ${n} elementi`);
    } catch (e) {
      toast('File non valido: ' + e.message);
    }
  }

  /* =========================================================
     Editor
     ========================================================= */
  let quill = null, openId = null, loadedAt = 0, lastInputAt = 0, focusTitleOnOpen = false;
  const cur = () => (openId && data.items[openId]) || null;

  function ensureQuill() {
    if (quill) return quill;
    const Q = window.Quill;
    const Inline = Q.import('blots/inline');
    class MarkBlot extends Inline {}
    MarkBlot.blotName = 'mark';
    MarkBlot.tagName = 'MARK';
    Q.register(MarkBlot, true);
    const BlockEmbed = Q.import('blots/block/embed');
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName = 'HR';
    Q.register(DividerBlot, true);

    quill = new Q('#w-editor', {
      placeholder: 'Inizia a scrivere…',
      modules: {
        toolbar: { container: '#w-toolbar', handlers: { link: editLink, divider: insertDivider } },
        history: { delay: 800, maxStack: 500, userOnly: true },
        keyboard: {
          bindings: {
            // Scorciatoie stile Markdown: "# ", "## ", "### ", "> " e "---" + Invio
            mdHeading: {
              key: ' ', collapsed: true, format: { 'code-block': false, list: false, blockquote: false },
              prefix: /^(#{1,3}|>)$/,
              handler(range, ctx) {
                const p = ctx.prefix, start = range.index - p.length;
                quill.deleteText(start, p.length, 'user');
                if (p === '>') quill.formatLine(start, 1, 'blockquote', true, 'user');
                else quill.formatLine(start, 1, 'header', p.length, 'user');
                quill.setSelection(start, 0, 'silent');
                return false;
              },
            },
            mdDivider: {
              key: 'Enter', collapsed: true, prefix: /^(---|\*\*\*)$/,
              handler(range, ctx) {
                const start = range.index - ctx.prefix.length;
                quill.deleteText(start, ctx.prefix.length, 'user');
                quill.insertEmbed(start, 'divider', true, 'user');
                quill.setSelection(start + 1, 0, 'user');
                return false;
              },
            },
            linkShortcut: { key: 'k', shortKey: true, handler() { editLink(); return false; } },
          },
        },
      },
    });

    quill.on('text-change', (delta, old, source) => { if (source !== 'silent') onBodyChange(); });
    // Senza cursore nel testo la barra svuota il menu stile: mostro "Testo" invece di un campo vuoto.
    const headerSelect = $('w-toolbar').querySelector('.ql-header');
    quill.on('editor-change', () => { if (headerSelect.selectedIndex < 0) headerSelect.selectedIndex = 0; });
    quill.root.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank', 'noopener');
    });
    quill.root.setAttribute('spellcheck', 'true');
    quill.root.setAttribute('lang', 'it');
    // I pulsanti della barra non devono togliere il cursore dal testo.
    $('w-toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    return quill;
  }

  function editLink() {
    const range = quill.getSelection(true);
    if (!range) return;
    const current = quill.getFormat(range).link;
    const url = prompt(current ? 'Modifica il link (vuoto per rimuoverlo)' : 'Indirizzo del link', current || 'https://');
    if (url === null) return;
    const clean = url.trim();
    if (!clean || clean === 'https://') { quill.format('link', false, 'user'); return; }
    const href = /^(https?:|mailto:|tel:)/i.test(clean) ? clean : 'https://' + clean;
    if (!range.length && !current) {
      quill.insertText(range.index, clean, { link: href }, 'user');
      quill.setSelection(range.index + clean.length, 0, 'user');
    } else {
      quill.format('link', href, 'user');
    }
  }

  function insertDivider() {
    const range = quill.getSelection(true);
    const idx = range ? range.index : quill.getLength() - 1;
    quill.insertEmbed(idx, 'divider', true, 'user');
    quill.setSelection(idx + 1, 0, 'user');
  }

  function openWriter(it) {
    ensureQuill();
    const same = openId === it.id && !el.writer.hidden;
    openId = it.id;
    if (el.writer.hidden) {
      el.writer.hidden = false;
      document.body.classList.add('writing');
      el.writer.classList.toggle('panel-open', !isPhone() && prefs.panel === true);
    }
    if (!same) loadIntoEditor(it);
    requestAnimationFrame(() => {
      autoGrow(el.wTitle);
      if (focusTitleOnOpen) { el.wTitle.focus(); focusTitleOnOpen = false; }
    });
  }

  function loadIntoEditor(it, keepScroll) {
    const s = SECTIONS[it.section];
    const scroll = el.wScroll.scrollTop;
    el.wTitle.value = it.title;
    quill.setContents(quill.clipboard.convert({ html: toHtml(it.body) }), 'silent');
    if (!keepScroll) { quill.history.clear(); el.wScroll.scrollTop = 0; } else el.wScroll.scrollTop = scroll;
    loadedAt = it.updatedAt;
    $('w-section').textContent = s.label;
    $('p-kind-label').textContent = s.kindLabel;
    $('p-who-label').textContent = s.whoLabel;
    $('p-kind').innerHTML = s.kinds.map((k) => `<option>${esc(k)}</option>`).join('');
    $('p-kind').value = it.kind || s.kinds[0];
    $('p-date').value = it.date;
    $('p-who').value = it.who;
    renderTags(it);
    updateChrome(it);
    updateStats();
    updateOutline();
    autoGrow(el.wTitle);
  }

  function updateChrome(it) {
    const title = it.title.trim();
    $('w-crumb-title').textContent = title || 'Senza titolo';
    document.title = (title || 'Senza titolo') + ' · Archivio';
    const parts = [`<span class="cat-label" style="--cat:${colorOf(it.kind)}"><i></i>${esc(it.kind)}</span>`];
    if (it.date) parts.push(`<span>${esc(fmtDate(it.date, true))}</span>`);
    if (it.who) parts.push(`<span>${esc(it.who)}</span>`);
    $('w-meta').innerHTML = parts.join('<span class="dotsep">·</span>');
  }

  function updateStats() {
    const it = cur();
    if (!it || !quill) return;
    const text = quill.getText().trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.replace(/\n/g, '').length;
    const minutes = Math.max(1, Math.round(words / 200));
    el.wStatus.textContent = `${num(words)} parole · ${num(chars)} caratteri · ${minutes} min di lettura`;
    const created = it.createdAt ? new Date(it.createdAt).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    $('p-stats').innerHTML = `<dt>Parole</dt><dd>${num(words)}</dd><dt>Caratteri</dt><dd>${num(chars)}</dd><dt>Lettura</dt><dd>${minutes} min</dd><dt>Creato</dt><dd>${created}</dd><dt>Modificato</dt><dd>${relTime(it.updatedAt)}</dd>`;
  }

  function updateOutline() {
    if (!quill) return;
    const heads = [...quill.root.querySelectorAll('h1, h2, h3')].filter((h) => h.textContent.trim());
    const box = $('p-outline');
    box.innerHTML = heads.length ? heads.map((h, i) => `<button type="button" class="l${h.tagName[1]}" data-outline="${i}">${esc(h.textContent.trim())}</button>`).join('')
      : '<p class="outline-empty">Aggiungi dei titoli per vedere qui la struttura del documento.</p>';
    box.onclick = (e) => {
      const b = e.target.closest('[data-outline]');
      if (!b) return;
      const h = heads[Number(b.dataset.outline)];
      if (isPhone()) togglePanel(false);
      if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
  const updateSideSoon = debounce(() => { updateStats(); updateOutline(); }, 500);

  function touch(it) {
    lastInputAt = Date.now();
    it.updatedAt = lastInputAt;
    loadedAt = it.updatedAt;
    saveDataSoon();
    scheduleSync();
  }

  function onBodyChange() {
    const it = cur();
    if (!it) return;
    it.body = quill.getLength() <= 1 ? '' : quill.root.innerHTML;
    touch(it);
    updateSideSoon();
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function refreshWriterIfStale() {
    const it = cur();
    if (!it || el.writer.hidden) return;
    if (it.deleted) { toast('Questo documento è stato eliminato da un altro dispositivo'); closeWriter(); return; }
    if (it.updatedAt !== loadedAt && Date.now() - lastInputAt > 4000) {
      const sel = quill.getSelection();
      const titleFocused = document.activeElement === el.wTitle;
      loadIntoEditor(it, true);
      if (sel) quill.setSelection(Math.min(sel.index, quill.getLength() - 1), 0, 'silent');
      if (titleFocused) el.wTitle.focus();
    } else {
      updateStats();
    }
  }

  function closeWriter() {
    if (writerFromApp && history.length > 1) history.back();
    else {
      const it = cur();
      location.hash = it && it.section === 'idea' ? '#/idee' : '#/report';
    }
  }

  function closeWriterUI() {
    const it = cur();
    // Un documento appena creato e mai toccato non resta in archivio.
    if (it && !it.deleted && it.createdAt === it.updatedAt) {
      data.items[it.id] = normalizeItem({ ...it, deleted: true, updatedAt: Date.now() });
    }
    saveData();
    if (syncState === 'pending') sync();
    closeMenus();
    el.writer.hidden = true;
    el.writer.classList.remove('focus');
    if (isPhone()) el.writer.classList.remove('panel-open');
    document.body.classList.remove('writing');
    document.title = 'Archivio Lavoro';
    openId = null;
  }

  function createItem(section, kind) {
    const s = SECTIONS[section];
    const now = Date.now();
    const it = normalizeItem({
      id: uid(), section, title: '', kind: s.kinds.includes(kind) ? kind : s.kinds[0],
      date: today(), body: s.template, createdAt: now, updatedAt: now,
    });
    data.items[it.id] = it;
    saveData();
    focusTitleOnOpen = true;
    location.hash = '#/doc/' + encodeURIComponent(it.id);
  }

  function duplicateCurrent() {
    const it = cur();
    if (!it) return;
    const now = Date.now();
    const copy = normalizeItem({ ...it, id: uid(), title: (it.title || 'Senza titolo') + ' (copia)', createdAt: now, updatedAt: now + 1 });
    data.items[copy.id] = copy;
    saveData();
    scheduleSync();
    location.replace('#/doc/' + encodeURIComponent(copy.id));
    toast('Documento duplicato');
  }

  function deleteCurrent() {
    const it = cur();
    if (!it) return;
    if (!confirm(`Eliminare “${it.title.trim() || 'Senza titolo'}”?`)) return;
    const section = it.section;
    data.items[it.id] = normalizeItem({ ...it, deleted: true, updatedAt: Date.now() });
    saveData();
    scheduleSync(300);
    location.replace(SECTIONS[section].route);
    toast('Eliminato. È recuperabile dalla cronologia su GitHub.');
  }

  function togglePanel(force) {
    const open = typeof force === 'boolean' ? force : !el.writer.classList.contains('panel-open');
    el.writer.classList.toggle('panel-open', open);
    if (!isPhone()) { prefs.panel = open; savePrefs(); }
    if (open) { updateStats(); updateOutline(); }
  }

  /* Tag */
  function renderTags(it) {
    const box = $('p-tags');
    box.querySelectorAll('.tag-chip').forEach((n) => n.remove());
    const input = $('p-tag-new');
    it.tags.forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.innerHTML = `${esc(t)}<button type="button" data-tag-remove="${i}" aria-label="Rimuovi ${esc(t)}">${icon('i-x')}</button>`;
      box.insertBefore(chip, input);
    });
  }

  function addTag(value) {
    const it = cur();
    const t = value.trim().replace(/^#/, '');
    if (!it || !t || it.tags.includes(t)) return;
    it.tags.push(t);
    touch(it);
    renderTags(it);
  }

  /* Esportazione */
  const fileName = (it) => (it.title.trim() || 'documento').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documento';

  function exportWord() {
    const it = cur();
    if (!it) return;
    const meta = [it.kind, it.date && fmtDate(it.date, true), it.who].filter(Boolean).map(esc).join(' · ');
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(it.title || 'Documento')}</title>
<style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.5;color:#1d1f1e}h1{font-size:24pt;margin:0 0 4pt}h2{font-size:16pt;color:#1f4e46;margin:16pt 0 4pt}h3{font-size:13pt;margin:12pt 0 3pt}.meta{color:#6b6f6c;font-size:10pt;margin:0 0 18pt}blockquote{border-left:3px solid #1f4e46;margin-left:0;padding-left:10pt;color:#3d413f;font-style:italic}mark{background:#d6efe7}a{color:#1f4e46}</style></head>
<body><h1>${esc(it.title || 'Senza titolo')}</h1><p class="meta">${meta}</p>${quill.getSemanticHTML()}</body></html>`;
    download(new Blob(['﻿', html], { type: 'application/msword' }), fileName(it) + '.doc');
  }

  function exportPdf() {
    const it = cur();
    if (!it) return;
    const prev = document.title;
    document.title = it.title.trim() || 'Documento';
    autoGrow(el.wTitle);
    setTimeout(() => { window.print(); document.title = prev; }, 50);
  }

  /* Preferenze di scrittura e tema */
  function applyPrefs() {
    if (prefs.theme === 'light' || prefs.theme === 'dark') document.documentElement.dataset.theme = prefs.theme;
    else delete document.documentElement.dataset.theme;
    el.writer.dataset.font = prefs.font;
    el.writer.dataset.size = prefs.size;
    el.writer.dataset.width = prefs.width;
    document.querySelectorAll('[data-pref]').forEach((g) => g.querySelectorAll('[data-val]').forEach((b) => b.setAttribute('aria-pressed', String(prefs[g.dataset.pref] === b.dataset.val))));
    document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === prefs.theme)));
    if (!el.writer.hidden) requestAnimationFrame(() => autoGrow(el.wTitle));
  }

  /* =========================================================
     Menu, toast
     ========================================================= */
  function openMenu(id, anchor) {
    closeMenus();
    const m = $(id);
    m.hidden = false;
    el.scrim.hidden = false;
    if (isPhone() || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, h = m.offsetHeight;
    let left = r.left + w > innerWidth - 12 ? r.right - w : r.left;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 6);
    m.style.left = Math.max(12, left) + 'px';
    m.style.top = top + 'px';
  }

  function closeMenus() {
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true; });
    el.scrim.hidden = true;
    if (isPhone()) el.writer.classList.remove('panel-open');
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  /* =========================================================
     Eventi
     ========================================================= */
  const el = {
    writer: $('writer'), wTitle: $('w-title'), wScroll: $('w-scroll'), wStatus: $('w-status'),
    scrim: $('scrim'), toast: $('toast'),
  };

  document.addEventListener('click', (e) => {
    const cat = e.target.closest('[data-cat]');
    if (cat) { const k = cat.dataset.cat; location.hash = k ? '#/report?cat=' + encodeURIComponent(k) : '#/report'; return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { ui.boardTab = tab.dataset.tab; saveUi(); renderIdeas(); return; }
    const themeBtn = e.target.closest('[data-theme-set]');
    if (themeBtn) { prefs.theme = themeBtn.dataset.themeSet; savePrefs(); applyPrefs(); return; }
    const prefBtn = e.target.closest('[data-pref] [data-val]');
    if (prefBtn) { prefs[prefBtn.closest('[data-pref]').dataset.pref] = prefBtn.dataset.val; savePrefs(); applyPrefs(); return; }
    const tagRm = e.target.closest('[data-tag-remove]');
    if (tagRm) { const it = cur(); if (it) { it.tags.splice(Number(tagRm.dataset.tagRemove), 1); touch(it); renderTags(it); } return; }

    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    const actions = {
      'new-menu': () => openMenu('menu-new', a),
      new: () => { closeMenus(); createItem(a.dataset.section, a.dataset.kind); },
      'close-writer': closeWriter,
      'typo-menu': () => openMenu('menu-typo', a),
      'more-menu': () => openMenu('menu-more', a),
      panel: () => { closeMenus(); togglePanel(); },
      focus: () => { el.writer.classList.toggle('focus'); if (el.writer.classList.contains('focus')) toast('Modalità concentrazione · Esc per uscire'); },
      undo: () => quill && quill.history.undo(),
      redo: () => quill && quill.history.redo(),
      'export-pdf': () => { closeMenus(); exportPdf(); },
      'export-word': () => { closeMenus(); exportWord(); },
      duplicate: () => { closeMenus(); duplicateCurrent(); },
      delete: () => { closeMenus(); deleteCurrent(); },
      connect, disconnect, qr: showQr, 'copy-link': copyLink,
      'export-backup': () => download(new Blob([serialize(data)], { type: 'application/json' }), `archivio-backup-${today()}.json`),
    };
    if (actions[act]) { e.preventDefault(); actions[act](); }
  });

  el.scrim.addEventListener('click', closeMenus);
  // Sul telefono il pannello dettagli è un foglio: si chiude toccando fuori.
  el.writer.addEventListener('pointerdown', (e) => {
    if (isPhone() && el.writer.classList.contains('panel-open') && !e.target.closest('.w-panel, [data-action="panel"]')) {
      e.preventDefault();
      togglePanel(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!el.scrim.hidden) closeMenus();
      else if (el.writer.classList.contains('focus')) el.writer.classList.remove('focus');
      else if (el.writer.classList.contains('panel-open') && isPhone()) togglePanel(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveData();
      if (connected()) sync().then(() => toast(lastError ? 'Salvato sul dispositivo · ' + lastError : 'Salvato e sincronizzato'));
      else toast('Salvato sul dispositivo');
    }
  });

  $('report-search').addEventListener('input', renderReportGrid);
  $('report-sort').addEventListener('change', (e) => { ui.reportSort = e.target.value; saveUi(); renderReportGrid(); });
  $('idea-search').addEventListener('input', renderIdeas);
  $('f-import').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  setupBoardDnd();

  // Titolo
  el.wTitle.addEventListener('input', () => {
    const it = cur();
    if (!it) return;
    it.title = el.wTitle.value.replace(/\n/g, ' ');
    autoGrow(el.wTitle);
    updateChrome(it);
    touch(it);
  });
  el.wTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); quill.focus(); quill.setSelection(0, 0, 'user'); }
  });

  // Dettagli
  $('p-kind').addEventListener('change', (e) => { const it = cur(); if (it) { it.kind = e.target.value; touch(it); updateChrome(it); } });
  $('p-date').addEventListener('change', (e) => { const it = cur(); if (it) { it.date = e.target.value; touch(it); updateChrome(it); } });
  $('p-who').addEventListener('input', (e) => { const it = cur(); if (it) { it.who = e.target.value; touch(it); updateChrome(it); } });
  const tagInput = $('p-tag-new');
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); tagInput.value = ''; }
    else if (e.key === 'Backspace' && !tagInput.value) { const it = cur(); if (it && it.tags.length) { it.tags.pop(); touch(it); renderTags(it); } }
  });
  tagInput.addEventListener('input', () => { if (tagInput.value.includes(',')) { tagInput.value.split(',').forEach(addTag); tagInput.value = ''; } });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; } });

  window.addEventListener('resize', () => { if (!el.writer.hidden) autoGrow(el.wTitle); });
  window.addEventListener('hashchange', route);

  // Quando si cambia app sul telefono o si chiude la scheda, invia subito le modifiche.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { saveData(); if (syncState === 'pending' || syncState === 'error') sync(); }
    else sync();
  });
  window.addEventListener('pagehide', saveData);
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus('offline'));
  window.addEventListener('beforeunload', (e) => {
    saveData();
    if (connected() && syncState === 'pending') { sync(); e.preventDefault(); e.returnValue = ''; }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && !syncing && syncState !== 'pending') sync();
    if (!el.writer.hidden) updateStats();
  }, POLL_MS);

  // Aggiornamenti da un'altra scheda aperta sullo stesso dispositivo.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_DATA) return;
    data = merge(data, normalizeData(load(LS_DATA, null)));
    renderSoon();
    refreshWriterIfStale();
  });

  /* =========================================================
     Avvio
     ========================================================= */
  const justLinked = readConnectLink();
  if (!connected() && !cfg.owner && /\.github\.io$/.test(location.hostname)) cfg.owner = location.hostname.split('.')[0];
  applyPrefs();
  setStatus();
  if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/home');
  route();
  if (connected()) {
    sync().then(() => { if (justLinked) toast(lastError ? 'Collegamento non riuscito: ' + lastError : 'Dispositivo collegato ✓'); });
  }
})();
