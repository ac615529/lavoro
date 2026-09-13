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
  const VIEWS = ['home', 'report', 'idee', 'eventi', 'cyber', 'impostazioni'];

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
  let cfg = Object.assign({ owner: '', repo: 'lavoro-dati', eventsRepo: 'radar-eventi', cyberRepo: 'progetto-cyber', branch: 'main', path: 'data.json', token: '' }, load(LS_CFG, {}));
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

  function gh(path, opts = {}, repo = cfg.repo) {
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(repo)}${path ? '/' + path : ''}`;
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

  async function httpError(r, repo = cfg.repo) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* vuoto */ }
    if (r.status === 401) return new Error('Token non valido o scaduto');
    if (r.status === 403) return new Error('Il token non ha i permessi di scrittura (Contents: Read and write)');
    if (r.status === 404) return new Error(`Repository «${repo}» non trovato, oppure il token non ha accesso a questo repository`);
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
    closeMenus();
    const r = parseHash();
    if (r.name !== 'cyber' && window.Cyber) window.Cyber.chiudi();
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
    $('count-eventi').textContent = evUpcoming().length || '';
    if (window.Cyber) $('count-cyber').textContent = window.Cyber.contatore();
  }

  function renderView() {
    if (!currentView || !el.writer.hidden) return;
    ({ home: renderHome, report: renderReports, idee: renderIdeas, eventi: renderEventiView, cyber: () => window.Cyber.render(currentView), impostazioni: renderSettings })[currentView.name]();
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

    renderHomeEvents();

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
    $('c-events-repo').value = cfg.eventsRepo;
    $('c-cyber-repo').value = cfg.cyberRepo;
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
    cfg.eventsRepo = $('c-events-repo').value.trim() || 'radar-eventi';
    cfg.cyberRepo = $('c-cyber-repo').value.trim() || 'progetto-cyber';
    cfg.token = $('c-token').value.trim();
    if (!connected()) { showResult('Compila utente, repository e token.', false); return; }
    saveCfg();
    showResult('Verifica in corso…', true);
    await sync();
    if (lastError) showResult(lastError, false);
    else showResult('Collegato. I contenuti ora si sincronizzano in automatico.', true);
    await fetchEventi(true);
    if (!lastError && ev.error) showResult('Report e idee collegati. Eventi: ' + ev.error, false);
    window.Cyber.reset();
    await window.Cyber.carica(true);
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
    const payload = btoa(JSON.stringify({ o: cfg.owner, r: cfg.repo, e: cfg.eventsRepo, y: cfg.cyberRepo, b: cfg.branch, p: cfg.path, t: cfg.token }))
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
      cfg = { owner: j.o, repo: j.r, eventsRepo: j.e || 'radar-eventi', cyberRepo: j.y || 'progetto-cyber', branch: j.b || 'main', path: j.p || 'data.json', token: j.t };
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
     Radar Eventi
     I dati stanno in data/eventi.json nel repository privato degli eventi.
     La pagina li legge con il token; stato, contatti e follow-up si
     modificano da qui e vengono salvati con un commit su quel file.
     ========================================================= */
  const LS_EVENTI = 'archivio.eventi.v1';
  const EV_PATH = 'data/eventi.json';
  const EV_CAT = {
    finanza: { label: 'Finanza', color: '--c-lavoro' },
    cyber: { label: 'Cyber', color: '--c-ricerca' },
    networking_locale: { label: 'Networking locale', color: '--c-consulenza' },
    fiera: { label: 'Fiera', color: '--c-studio' },
    formazione: { label: 'Formazione', color: '--s-idea' },
  };
  const EV_PRIO = { alta: 'Priorità alta', media: 'Priorità media', bassa: 'Priorità bassa' };
  const EV_STATO = { da_valutare: 'Da valutare', iscritto: 'Iscritto', fatto: 'Fatto', saltato: 'Saltato' };

  const ev = Object.assign({ doc: null, sha: null, fetchedAt: 0 }, load(LS_EVENTI, {}), { error: '' });
  const evOpen = new Set();
  let evLoading = false;
  const evFilter = Object.assign({ cat: '', prio: '', stato: '' }, load('archivio.evfiltri.v1', {}));
  const eventsRepo = () => cfg.eventsRepo || 'radar-eventi';

  // Differenza in giorni tra due date AAAA-MM-GG (b - a), senza problemi di fuso orario.
  function giorni(a, b) {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
  }
  const dataIt = (iso, opts) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('it-IT', opts); };
  const meseBreve = (iso) => dataIt(iso, { month: 'short' }).replace('.', '');

  const evList = () => (ev.doc && Array.isArray(ev.doc.eventi) ? ev.doc.eventi : []);
  const evPassato = (e) => e.data_fine < today();
  function evUpcoming() {
    return evList().filter((e) => !evPassato(e) && e.stato !== 'saltato').sort((a, b) => a.data_inizio.localeCompare(b.data_inizio));
  }

  async function leggiContenuto(j, repo) {
    let b64 = j.content;
    if (!b64 && j.sha) {
      const rb = await gh(`git/blobs/${j.sha}`, {}, repo);
      if (!rb.ok) throw await httpError(rb, repo);
      b64 = (await rb.json()).content;
    }
    return fromB64(b64 || '');
  }

  async function scaricaEventi() {
    const repo = eventsRepo();
    const r = await gh(`contents/${EV_PATH}?ref=main&t=${Date.now()}`, {}, repo);
    if (!r.ok) throw await httpError(r, repo);
    const j = await r.json();
    return { doc: JSON.parse(await leggiContenuto(j, repo)), sha: j.sha };
  }

  async function fetchEventi(force) {
    if (!connected() || evLoading) { if (currentView && currentView.name === 'eventi') renderEventi(); return; }
    if (!force && ev.doc && Date.now() - ev.fetchedAt < 60000) return;
    evLoading = true;
    if (currentView && currentView.name === 'eventi') renderEventi();
    try {
      const { doc, sha } = await scaricaEventi();
      Object.assign(ev, { doc, sha, fetchedAt: Date.now(), error: '' });
      store(LS_EVENTI, { doc, sha, fetchedAt: ev.fetchedAt });
    } catch (e) {
      ev.error = e.message || String(e);
    } finally {
      evLoading = false;
      renderNav();
      if (currentView && currentView.name === 'eventi') renderEventi();
      if (currentView && currentView.name === 'home') renderHomeEvents();
    }
  }

  function renderEventiView() {
    renderEventi();
    fetchEventi();
  }

  // Salva una modifica: subito in pagina, poi su GitHub rileggendo l'ultima versione
  // del file (così non si sovrascrivono modifiche arrivate nel frattempo).
  let evCoda = Promise.resolve();
  function patchEvento(id, modifica, descrizione) {
    const locale = evList().find((e) => e.id === id);
    if (!locale) return;
    modifica(locale);
    store(LS_EVENTI, { doc: ev.doc, sha: ev.sha, fetchedAt: ev.fetchedAt });
    renderEventi();
    evCoda = evCoda.then(async () => {
      const repo = eventsRepo();
      for (let tentativo = 0; tentativo < 4; tentativo++) {
        const { doc, sha } = await scaricaEventi();
        const target = (doc.eventi || []).find((e) => e.id === id);
        if (!target) throw new Error('evento non più presente nel repository');
        modifica(target);
        const body = {
          message: `${descrizione}: ${id} (dal sito)`,
          content: toB64(JSON.stringify(doc, null, 2) + '\n'),
          sha, branch: 'main',
        };
        const r = await gh(`contents/${EV_PATH}`, { method: 'PUT', body: JSON.stringify(body) }, repo);
        if (r.status === 409) continue;
        if (!r.ok) throw await httpError(r, repo);
        const pj = await r.json();
        Object.assign(ev, { doc, sha: pj.content.sha, fetchedAt: Date.now(), error: '' });
        store(LS_EVENTI, { doc, sha: ev.sha, fetchedAt: ev.fetchedAt });
        renderEventi();
        return;
      }
      throw new Error('troppe modifiche contemporanee, riprova');
    }).catch((e) => {
      toast('Modifica non salvata: ' + e.message);
      fetchEventi(true);
    });
  }

  /* Rendering */
  function evCountdown(e) {
    const t = today();
    if (e.data_inizio <= t && t <= e.data_fine) return { txt: 'In corso', cls: 'now' };
    const n = giorni(t, e.data_inizio);
    if (n === 0) return { txt: 'Oggi', cls: 'now' };
    if (n === 1) return { txt: 'Domani', cls: 'soon' };
    return { txt: `Tra ${n} giorni`, cls: n <= 30 ? 'soon' : '' };
  }

  function evScadenza(e) {
    if (!e.scadenza_iscrizione || evPassato(e) || ['iscritto', 'fatto', 'saltato'].includes(e.stato)) return '';
    const n = giorni(today(), e.scadenza_iscrizione);
    if (n < 0) return '<span class="ev-badge muted">Iscrizioni chiuse</span>';
    if (n > 7) return '';
    const quando = n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`;
    return `<span class="ev-badge danger">${icon('i-alert')}Iscrizioni chiudono ${quando}</span>`;
  }

  function evDateBlock(e) {
    const a = e.data_inizio, b = e.data_fine;
    const dayA = Number(a.slice(8)), dayB = Number(b.slice(8));
    if (a === b) return `<b>${dayA}</b><span>${meseBreve(a)}</span><small>${dataIt(a, { weekday: 'short' }).replace('.', '')}</small>`;
    if (a.slice(0, 7) === b.slice(0, 7)) return `<b>${dayA}–${dayB}</b><span>${meseBreve(a)}</span><small>${giorni(a, b) + 1} giorni</small>`;
    return `<b>${dayA}</b><span>${meseBreve(a)} → ${dayB} ${meseBreve(b)}</span><small>${giorni(a, b) + 1} giorni</small>`;
  }

  function evQuando(e) {
    const orario = e.orario_inizio + (e.orario_fine ? '–' + e.orario_fine : '');
    const giornoLungo = (iso) => dataIt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const stessoMese = e.data_inizio.slice(0, 7) === e.data_fine.slice(0, 7);
    const date = e.data_inizio === e.data_fine ? giornoLungo(e.data_inizio)
      : stessoMese ? `dal ${Number(e.data_inizio.slice(8))} al ${dataIt(e.data_fine, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `dal ${dataIt(e.data_inizio, { day: 'numeric', month: 'long' })} al ${dataIt(e.data_fine, { day: 'numeric', month: 'long', year: 'numeric' })}`;
    return `${date} · ${orario}`;
  }

  // Accetta solo link http/https: i dati possono arrivare anche dalla scoperta automatica.
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? esc(u) : '#');

  const linkContatto = (c) => {
    const v = c.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `<a href="mailto:${esc(v)}">${esc(v)}</a>`;
    if (/^\+?[\d\s().-]{6,}$/.test(v)) return `<a href="tel:${esc(v.replace(/[^\d+]/g, ''))}">${esc(v)}</a>`;
    if (/^https?:\/\//.test(v)) return `<a href="${safeUrl(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, ''))}</a>`;
    return esc(v);
  };

  function evCard(e) {
    const cat = EV_CAT[e.categoria] || { label: e.categoria, color: '--muted' };
    const passato = evPassato(e);
    const open = evOpen.has(e.id);
    const cd = passato ? null : evCountdown(e);
    const fatti = e.follow_up.filter((f) => f.fatto).length;
    const id = esc(e.id);
    const incerti = JSON.stringify(e).includes('DA VERIFICARE');

    const head = `
      <button class="ev-head" type="button" data-ev-toggle="${id}" aria-expanded="${open}">
        <span class="ev-date">${evDateBlock(e)}</span>
        <span class="ev-main">
          <span class="ev-top">
            <span class="cat-label"><i></i>${esc(cat.label)}</span>
            <span class="ev-prio ${esc(e.priorita)}">${esc(EV_PRIO[e.priorita] || e.priorita)}</span>
          </span>
          <span class="ev-name">${esc(e.nome)}</span>
          <span class="ev-meta">${icon('i-pin')}${esc(e.citta)} <span class="dotsep">·</span> ${esc(e.orario_inizio)}${e.orario_fine ? '–' + esc(e.orario_fine) : ''} <span class="dotsep">·</span> ${esc(e.costo)}</span>
          <span class="ev-badges">
            ${cd ? `<span class="ev-badge count ${cd.cls}">${icon('i-clock')}${cd.txt}</span>` : ''}
            <span class="ev-badge stato s-${esc(e.stato)}">${esc(EV_STATO[e.stato] || e.stato)}</span>
            ${evScadenza(e)}
            ${passato ? `<span class="ev-badge muted">${e.contatti_raccolti.length} contatti · follow-up ${fatti}/${e.follow_up.length}</span>` : ''}
            ${incerti ? '<span class="ev-badge warn">Dati da verificare</span>' : ''}
          </span>
        </span>
        <svg class="ev-chevron"><use href="#i-chevron"/></svg>
      </button>`;

    if (!open) return `<article class="ev-card${passato ? ' past' : ''}" style="--cat:var(${cat.color})">${head}</article>`;

    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.luogo + ', ' + e.indirizzo)}`;
    const body = `
      <div class="ev-body">
        <div class="ev-actions">
          <a class="btn" href="${safeUrl(e.link_ufficiale)}" target="_blank" rel="noopener">${icon('i-external')}Sito ufficiale</a>
          ${e.link_iscrizione ? `<a class="btn primary" href="${safeUrl(e.link_iscrizione)}" target="_blank" rel="noopener">${icon('i-external')}${passato ? 'Pagina iscrizione' : 'Iscriviti / biglietti'}</a>` : ''}
          <a class="btn" href="${maps}" target="_blank" rel="noopener">${icon('i-pin')}Mappa</a>
        </div>

        <dl class="ev-facts">
          <dt>Quando</dt><dd>${esc(evQuando(e))}</dd>
          <dt>Dove</dt><dd><strong>${esc(e.luogo)}</strong><br>${esc(e.indirizzo)}</dd>
          <dt>Come arrivare</dt><dd>${esc(e.come_arrivare)}</dd>
          <dt>Costo</dt><dd>${esc(e.costo)}</dd>
          <dt>Iscrizione</dt><dd>${e.scadenza_iscrizione ? 'Entro ' + esc(dataIt(e.scadenza_iscrizione, { weekday: 'long', day: 'numeric', month: 'long' })) : 'Nessuna scadenza indicata'}</dd>
          <dt>Organizzatore</dt><dd>${esc(e.organizzatore)}</dd>
        </dl>

        <div class="ev-why"><h4>Perché ci vado</h4><p>${esc(e.perche_ci_vado)}</p></div>

        <div class="ev-cols">
          <div><h4>${icon('i-users')}Chi incontrare</h4><ul class="ev-list">${e.chi_incontrare.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div><h4>${icon('i-arrow')}Opportunità successive</h4><ul class="ev-list">${e.opportunita_successive.map((x) => `<li>${esc(x)}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
        </div>

        <div class="ev-work">
          <div class="ev-work-row">
            <h4>Stato</h4>
            <div class="segmented small">${Object.entries(EV_STATO).map(([k, v]) => `<button type="button" data-ev-stato="${id}" data-val="${k}" aria-pressed="${e.stato === k}">${v}</button>`).join('')}</div>
          </div>

          <div class="ev-work-block">
            <h4>Contatti raccolti <span class="n">${e.contatti_raccolti.length}</span></h4>
            <ul class="ev-contacts">${e.contatti_raccolti.map((c, i) => `
              <li>
                <div><strong>${esc(c.nome)}</strong>${[c.ruolo, c.azienda].filter(Boolean).length ? ` <span class="muted">· ${esc([c.ruolo, c.azienda].filter(Boolean).join(', '))}</span>` : ''}
                  ${c.contatto ? `<div class="ev-contact-link">${linkContatto(c.contatto)}</div>` : ''}
                  ${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</div>
                <button class="icon-btn" type="button" data-ev-del-contatto="${id}" data-i="${i}" aria-label="Rimuovi contatto">${icon('i-trash')}</button>
              </li>`).join('') || '<li class="ev-empty">Nessun contatto ancora.</li>'}
            </ul>
            <details class="ev-add">
              <summary>${icon('i-plus')}Aggiungi contatto</summary>
              <form class="ev-form" data-ev-add-contatto="${id}">
                <input name="nome" placeholder="Nome e cognome *" required autocomplete="off">
                <input name="ruolo" placeholder="Ruolo (es. commercialista)" autocomplete="off">
                <input name="azienda" placeholder="Studio / azienda" autocomplete="off">
                <input name="contatto" placeholder="Telefono, email o LinkedIn" autocomplete="off">
                <input name="note" class="wide" placeholder="Note: di cosa avete parlato" autocomplete="off">
                <button class="btn primary" type="submit">Salva contatto</button>
              </form>
            </details>
          </div>

          <div class="ev-work-block">
            <h4>Follow-up <span class="n">${fatti}/${e.follow_up.length}</span></h4>
            <ul class="ev-followups">${e.follow_up.map((f, i) => `
              <li class="${f.fatto ? 'done' : ''}">
                <label><input type="checkbox" data-ev-fu="${id}" data-i="${i}" ${f.fatto ? 'checked' : ''}>
                  <span>${esc(f.cosa)}${f.chi ? ` <span class="muted">· ${esc(f.chi)}</span>` : ''}${f.entro ? ` <span class="ev-due ${!f.fatto && f.entro < today() ? 'late' : ''}">entro ${esc(dataIt(f.entro, { day: 'numeric', month: 'short' }))}</span>` : ''}</span>
                </label>
                <button class="icon-btn" type="button" data-ev-del-fu="${id}" data-i="${i}" aria-label="Rimuovi follow-up">${icon('i-trash')}</button>
              </li>`).join('') || '<li class="ev-empty">Nessun follow-up ancora.</li>'}
            </ul>
            <details class="ev-add">
              <summary>${icon('i-plus')}Aggiungi follow-up</summary>
              <form class="ev-form" data-ev-add-fu="${id}">
                <input name="cosa" class="wide" placeholder="Cosa fare (es. mandare mail di ringraziamento) *" required autocomplete="off">
                <input name="chi" placeholder="A chi" autocomplete="off">
                <input name="entro" type="date" aria-label="Entro il">
                <button class="btn primary" type="submit">Salva follow-up</button>
              </form>
            </details>
          </div>
        </div>
      </div>`;
    return `<article class="ev-card open${passato ? ' past' : ''}" style="--cat:var(${cat.color})">${head}${body}</article>`;
  }

  function renderEventi() {
    const box = $('ev-content');
    const conn = connected();
    $('ev-connect').hidden = conn || Boolean(ev.doc);
    $('ev-refresh').hidden = !conn;
    $('ev-ics').hidden = !conn;
    $('ev-refresh').classList.toggle('loading', evLoading);

    const tutti = evList();
    const counts = {};
    tutti.forEach((e) => { counts[e.categoria] = (counts[e.categoria] || 0) + 1; });
    $('ev-cats').innerHTML = ['', ...Object.keys(EV_CAT)].map((k) =>
      `<button type="button" data-ev-cat="${k}" aria-pressed="${evFilter.cat === k}" style="--dot:var(${k ? EV_CAT[k].color : '--muted'})">${k ? '<i></i>' : ''}${k ? EV_CAT[k].label : 'Tutte'}<span class="n">${k ? counts[k] || 0 : tutti.length}</span></button>`).join('');
    $('ev-prio').value = evFilter.prio;
    $('ev-stato').value = evFilter.stato;
    $('ev-filters').hidden = !ev.doc;

    if (!ev.doc) {
      $('ev-summary').textContent = '';
      box.innerHTML = !conn ? ''
        : evLoading ? '<div class="ev-loading"><span></span><span></span><span></span></div>'
        : `<div class="empty-state"><span class="quick-icon">${icon('i-alert')}</span><h3>Eventi non disponibili</h3><p>${esc(ev.error || 'Impossibile leggere gli eventi.')}</p><a class="btn" href="#/impostazioni">Controlla le impostazioni</a></div>`;
      return;
    }

    const t = today();
    const futuri = evUpcoming();
    const daIscrivere = futuri.filter((e) => evScadenza(e).includes('danger')).length;
    $('ev-summary').innerHTML = `${futuri.length} ${futuri.length === 1 ? 'evento in arrivo' : 'eventi in arrivo'}${daIscrivere ? ` · <b class="danger-text">${daIscrivere} con iscrizione in scadenza</b>` : ''}${ev.error ? ` · <span class="danger-text">non aggiornato: ${esc(ev.error)}</span>` : ''}`;

    const filtrati = tutti.filter((e) => (!evFilter.cat || e.categoria === evFilter.cat) && (!evFilter.prio || e.priorita === evFilter.prio) && (!evFilter.stato || e.stato === evFilter.stato));
    const prossimi = filtrati.filter((e) => !evPassato(e)).sort((a, b) => a.data_inizio.localeCompare(b.data_inizio) || a.nome.localeCompare(b.nome));
    const passati = filtrati.filter(evPassato).sort((a, b) => b.data_inizio.localeCompare(a.data_inizio));
    const entro30 = prossimi.filter((e) => giorni(t, e.data_inizio) <= 30);
    const dopo = prossimi.filter((e) => giorni(t, e.data_inizio) > 30);

    // Raggruppa gli eventi successivi per mese
    const mesi = [];
    dopo.forEach((e) => {
      const key = e.data_inizio.slice(0, 7);
      let g = mesi.find((m) => m.key === key);
      if (!g) { g = { key, label: dataIt(e.data_inizio, { month: 'long', year: 'numeric' }), items: [] }; mesi.push(g); }
      g.items.push(e);
    });

    let html = `
      <section class="ev-group soon">
        <header class="ev-group-head"><h2>Prossimi 30 giorni</h2><span class="n">${entro30.length}</span></header>
        ${entro30.map(evCard).join('') || '<p class="ev-empty">Nessun evento nei prossimi 30 giorni con questi filtri.</p>'}
      </section>`;
    html += mesi.map((m) => `
      <section class="ev-group">
        <header class="ev-group-head"><h2>${esc(m.label.charAt(0).toUpperCase() + m.label.slice(1))}</h2><span class="n">${m.items.length}</span></header>
        ${m.items.map(evCard).join('')}
      </section>`).join('');
    if (!prossimi.length && !passati.length) html += '<p class="ev-empty">Nessun evento corrisponde ai filtri.</p>';
    html += `
      <details class="ev-archive" ${passati.length ? '' : 'hidden'} ${evOpen.has('__archivio') ? 'open' : ''}>
        <summary><h2>Archivio</h2><span class="n">${passati.length} ${passati.length === 1 ? 'evento passato' : 'eventi passati'}</span><svg class="ev-chevron"><use href="#i-chevron"/></svg></summary>
        ${passati.map(evCard).join('')}
      </details>`;
    box.innerHTML = html;
  }

  // Scarica il calendario generato dalla build (branch "generati" del repository privato).
  // Nessun indirizzo pubblico: il file passa solo attraverso il token.
  async function scaricaCalendario() {
    if (!connected()) { toast('Collega prima questo dispositivo nelle Impostazioni'); return; }
    const btn = $('ev-ics');
    btn.classList.add('loading');
    btn.disabled = true;
    try {
      const repo = eventsRepo();
      const leggi = async (file) => {
        const r = await gh(`contents/${file}?ref=generati&t=${Date.now()}`, {}, repo);
        if (r.status === 404) throw new Error('calendario non ancora generato: controlla il workflow Build su GitHub');
        if (!r.ok) throw await httpError(r, repo);
        return leggiContenuto(await r.json(), repo);
      };
      const [ics, info] = await Promise.all([leggi('eventi.ics'), leggi('build.json').catch(() => '{}')]);
      const meta = JSON.parse(info || '{}');
      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (ios) {
        // Su iPhone Safari apre direttamente la schermata "Aggiungi tutto" del Calendario.
        location.href = URL.createObjectURL(blob);
      } else {
        download(blob, 'radar-eventi.ics');
      }
      const quando = meta.generato_il ? new Date(meta.generato_il).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      toast(`Calendario scaricato${meta.eventi_nel_calendario != null ? ` · ${meta.eventi_nel_calendario} eventi` : ''}${quando ? ` · aggiornato il ${quando}` : ''}`);
    } catch (e) {
      toast('Calendario non disponibile: ' + e.message);
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  function renderHomeEvents() {
    const panel = $('home-events-panel');
    const list = evUpcoming().filter((e) => giorni(today(), e.data_inizio) <= 45).slice(0, 4);
    panel.hidden = !list.length;
    $('home-events').innerHTML = list.map((e) => {
      const cat = EV_CAT[e.categoria] || { color: '--muted' };
      const cd = evCountdown(e);
      return `<a class="row-link" href="#/eventi" data-ev-open="${esc(e.id)}" style="--cat:var(${cat.color})">
        <span class="row-icon ev-mini">${evDateBlock(e).replace(/<small>.*?<\/small>/, '')}</span>
        <span class="row-main">
          <span class="row-title">${esc(e.nome)}</span>
          <span class="row-meta">${esc(e.citta)} · ${cd.txt}${evScadenza(e) ? ' · <b class="danger-text">iscrizione in scadenza</b>' : ''}</span>
        </span>
        <svg class="chev"><use href="#i-arrow"/></svg>
      </a>`;
    }).join('');
  }

  function setupEventi() {
    const view = $('view-eventi');
    view.addEventListener('click', (e) => {
      const tog = e.target.closest('[data-ev-toggle]');
      if (tog) {
        const id = tog.dataset.evToggle;
        if (evOpen.has(id)) evOpen.delete(id); else evOpen.add(id);
        renderEventi();
        if (evOpen.has(id)) {
          const card = view.querySelector(`[data-ev-toggle="${CSS.escape(id)}"]`);
          if (card && card.getBoundingClientRect().top < 60) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        return;
      }
      const cat = e.target.closest('[data-ev-cat]');
      if (cat) { evFilter.cat = cat.dataset.evCat; store('archivio.evfiltri.v1', evFilter); renderEventi(); return; }
      const st = e.target.closest('[data-ev-stato]');
      if (st) {
        const val = st.dataset.val;
        patchEvento(st.dataset.evStato, (x) => { x.stato = val; }, `Stato ${EV_STATO[val].toLowerCase()}`);
        return;
      }
      const delC = e.target.closest('[data-ev-del-contatto]');
      if (delC) {
        const x = evList().find((y) => y.id === delC.dataset.evDelContatto);
        const c = x && x.contatti_raccolti[Number(delC.dataset.i)];
        if (!c || !confirm(`Rimuovere il contatto “${c.nome}”?`)) return;
        const snap = JSON.stringify(c);
        patchEvento(x.id, (y) => { const i = y.contatti_raccolti.findIndex((z) => JSON.stringify(z) === snap); if (i >= 0) y.contatti_raccolti.splice(i, 1); }, 'Contatto rimosso');
        return;
      }
      const delF = e.target.closest('[data-ev-del-fu]');
      if (delF) {
        const x = evList().find((y) => y.id === delF.dataset.evDelFu);
        const f = x && x.follow_up[Number(delF.dataset.i)];
        if (!f || !confirm(`Rimuovere il follow-up “${f.cosa}”?`)) return;
        const snap = JSON.stringify(f);
        patchEvento(x.id, (y) => { const i = y.follow_up.findIndex((z) => JSON.stringify(z) === snap); if (i >= 0) y.follow_up.splice(i, 1); }, 'Follow-up rimosso');
      }
    });
    view.addEventListener('change', (e) => {
      if (e.target.id === 'ev-prio' || e.target.id === 'ev-stato') {
        evFilter[e.target.id === 'ev-prio' ? 'prio' : 'stato'] = e.target.value;
        store('archivio.evfiltri.v1', evFilter);
        renderEventi();
        return;
      }
      const fu = e.target.closest('[data-ev-fu]');
      if (fu) {
        const x = evList().find((y) => y.id === fu.dataset.evFu);
        const f = x && x.follow_up[Number(fu.dataset.i)];
        if (!f) return;
        const snap = JSON.stringify({ ...f, fatto: undefined });
        const val = fu.checked;
        patchEvento(x.id, (y) => { const z = y.follow_up.find((w) => JSON.stringify({ ...w, fatto: undefined }) === snap); if (z) z.fatto = val; }, val ? 'Follow-up fatto' : 'Follow-up riaperto');
      }
    });
    view.addEventListener('submit', (e) => {
      const form = e.target;
      e.preventDefault();
      const v = Object.fromEntries([...new FormData(form)].map(([k, val]) => [k, String(val).trim()]));
      if (form.dataset.evAddContatto) {
        if (!v.nome) return;
        const c = { nome: v.nome };
        ['ruolo', 'azienda', 'contatto', 'note'].forEach((k) => { if (v[k]) c[k] = v[k]; });
        patchEvento(form.dataset.evAddContatto, (y) => { y.contatti_raccolti.push({ ...c }); }, 'Nuovo contatto');
        toast('Contatto salvato');
      } else if (form.dataset.evAddFu) {
        if (!v.cosa) return;
        const f = { cosa: v.cosa, chi: v.chi || '', entro: v.entro || null, fatto: false };
        if (!f.chi) delete f.chi;
        patchEvento(form.dataset.evAddFu, (y) => { y.follow_up.push({ ...f }); }, 'Nuovo follow-up');
        toast('Follow-up salvato');
      }
    });
    view.addEventListener('toggle', (e) => {
      if (!e.target.classList || !e.target.classList.contains('ev-archive')) return;
      if (e.target.open) evOpen.add('__archivio'); else evOpen.delete('__archivio');
    }, true);
    // Dalla Home: apre direttamente la scheda dell'evento
    $('home-events').addEventListener('click', (e) => {
      const a = e.target.closest('[data-ev-open]');
      if (a) evOpen.add(a.dataset.evOpen);
    });
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
      'ev-refresh': () => fetchEventi(true),
      'ev-ics': scaricaCalendario,
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
  setupEventi();
  window.Cyber.setup();

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
     Funzioni condivise con cyber.js
     ========================================================= */
  window.Archivio = {
    gh, httpError, fromB64, toB64, esc, icon, toast, load, store, isPhone, today,
    connected, cfg: () => cfg,
  };

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
    fetchEventi();
    window.Cyber.carica().then(() => renderNav());
  }
})();
