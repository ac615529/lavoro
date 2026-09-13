/* Archivio Lavoro — report e idee di business.
 * Salvataggio: immediato su questo dispositivo (localStorage) e, dopo pochi secondi,
 * su un file data.json in un repository GitHub privato tramite le API di GitHub.
 * Le modifiche da più dispositivi vengono unite per elemento (vince la più recente). */
(() => {
  'use strict';

  const LS_DATA = 'archivio.data.v1';
  const LS_CFG = 'archivio.cfg.v1';
  const LS_UI = 'archivio.ui.v1';
  const SYNC_DELAY = 2000;
  const POLL_MS = 30000;

  const SECTIONS = {
    report: {
      title: 'Report',
      newTitle: 'Nuovo report',
      kindLabel: 'Tipo',
      kinds: ['Consulenza', 'Lavoro', 'Studio', 'Ricerca'],
      whoLabel: 'Cliente / progetto',
      allLabel: 'Tutti',
      empty: 'Nessun report ancora.<br>Premi “Nuovo” per scrivere il primo.',
      template: '## Obiettivo\n\n\n## Contesto\n\n\n## Analisi\n\n\n## Conclusioni\n\n\n## Prossimi passi\n\n',
    },
    idea: {
      title: 'Idee di business',
      newTitle: 'Nuova idea',
      kindLabel: 'Stato',
      kinds: ['Idea', 'In valutazione', 'In sviluppo', 'Lanciata', 'Archiviata'],
      whoLabel: 'Settore / mercato',
      allLabel: 'Tutte',
      empty: 'Nessuna idea ancora.<br>Premi “Nuovo” per annotare la prima.',
      template: '## Problema\n\n\n## Soluzione\n\n\n## Clienti target\n\n\n## Modello di ricavo\n\n\n## Concorrenti\n\n\n## Prossimi passi\n\n',
    },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    body: document.body, sync: $('sync'), syncText: document.querySelector('#sync .sync-text'),
    listTitle: $('list-title'), list: $('list'), listEmpty: $('list-empty'), search: $('search'), filters: $('filters'),
    editor: $('editor'), editorEmpty: $('editor-empty'), savedAt: $('saved-at'),
    title: $('f-title'), kind: $('f-kind'), date: $('f-date'), who: $('f-who'), tags: $('f-tags'), text: $('f-body'),
    lKind: $('l-kind'), lWho: $('l-who'),
    owner: $('c-owner'), repo: $('c-repo'), token: $('c-token'), connectResult: $('connect-result'),
    qr: $('qr'), qrImg: $('qr-img'), toast: $('toast'),
  };

  /* ---------------- Storage locale ---------------- */
  const load = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  };
  const store = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { toast('Memoria del dispositivo piena: ' + e.message); }
  };

  let data = normalizeData(load(LS_DATA, null));
  let cfg = Object.assign({ owner: '', repo: 'lavoro-dati', branch: 'main', path: 'data.json', token: '' }, load(LS_CFG, {}));
  let ui = Object.assign({ section: 'report', filter: '', currentId: null }, load(LS_UI, {}));
  if (!SECTIONS[ui.section] && ui.section !== 'settings') ui.section = 'report';

  const saveData = () => store(LS_DATA, data);
  const saveCfg = () => store(LS_CFG, cfg);
  const saveUi = () => store(LS_UI, { section: ui.section, filter: ui.filter, currentId: ui.currentId });

  /* ---------------- Modello dati ---------------- */
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
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  /* ---------------- Sincronizzazione GitHub ---------------- */
  const connected = () => Boolean(cfg.token && cfg.owner && cfg.repo);
  let syncing = false, syncAgain = false, syncTimer = null, lastError = '';

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
      // Il file non esiste ancora: verifichiamo che il repository sia raggiungibile.
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
    if (r.status === 409 || (r.status === 422 && !sha)) return false; // qualcun altro ha scritto nel frattempo
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
      renderList();
      refreshEditorIfStale();
    } catch (e) {
      lastError = e.message || String(e);
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      if (navigator.onLine !== false && !/Token|permessi|non trovato/.test(lastError)) syncAgain = true;
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(lastError ? 15000 : 400); }
    }
  }

  function hasUnsynced() {
    return el.sync.dataset.state === 'pending' || el.sync.dataset.state === 'error' || el.sync.dataset.state === 'offline';
  }

  function setStatus(state) {
    let text;
    if (!connected()) { state = 'local'; text = 'Solo su questo dispositivo'; }
    else if (state === 'ok') text = 'Sincronizzato';
    else if (state === 'pending') text = 'Salvataggio…';
    else if (state === 'offline') text = 'Offline — salvato sul dispositivo';
    else if (state === 'error') text = 'Errore: ' + lastError;
    else text = '…';
    el.sync.dataset.state = state || '';
    el.syncText.textContent = text;
    el.sync.title = text;
  }

  /* ---------------- Navigazione ---------------- */
  function go(section) {
    if (section === ui.section && section !== 'settings') { showList(); return; }
    ui.section = section;
    if (section !== 'settings') {
      ui.filter = '';
      const cur = ui.currentId && data.items[ui.currentId];
      if (!cur || cur.section !== section) ui.currentId = null;
    }
    saveUi();
    render();
    showList();
    window.scrollTo(0, 0);
  }

  function showList() {
    el.body.dataset.screen = 'list';
    if (history.state && history.state.editor) history.back();
  }

  function showEditor(push = true) {
    el.body.dataset.screen = 'editor';
    if (push && isPhone() && !(history.state && history.state.editor)) history.pushState({ editor: true }, '');
    window.scrollTo(0, 0);
  }

  const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

  window.addEventListener('popstate', () => {
    if (el.body.dataset.screen === 'editor') { el.body.dataset.screen = 'list'; renderList(); }
  });

  /* ---------------- Rendering ---------------- */
  function render() {
    el.body.dataset.section = ui.section;
    if (ui.section === 'settings') { fillSettings(); return; }
    const s = SECTIONS[ui.section];
    el.listTitle.textContent = s.title;
    renderFilters();
    renderList();
    openEditor(ui.currentId, false);
  }

  function renderFilters() {
    const s = SECTIONS[ui.section];
    el.filters.replaceChildren(...['', ...s.kinds].map((k) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = k || s.allLabel;
      b.setAttribute('aria-pressed', String(ui.filter === k));
      b.addEventListener('click', () => { ui.filter = k; saveUi(); renderFilters(); renderList(); });
      return b;
    }));
  }

  function visibleItems() {
    const q = el.search.value.trim().toLowerCase();
    return Object.values(data.items)
      .filter((it) => !it.deleted && it.section === ui.section)
      .filter((it) => !ui.filter || it.kind === ui.filter)
      .filter((it) => !q || [it.title, it.body, it.who, it.kind, it.tags.join(' ')].join('\n').toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  function relTime(ts) {
    if (!ts) return '';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'adesso';
    if (s < 3600) return `${Math.round(s / 60)} min fa`;
    const d = new Date(ts);
    if (d.toDateString() === new Date().toDateString()) return 'oggi ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  }

  function renderList() {
    if (ui.section === 'settings') return;
    const items = visibleItems();
    const s = SECTIONS[ui.section];
    el.list.replaceChildren(...items.map((it) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item';
      if (it.id === ui.currentId) b.setAttribute('aria-current', 'true');

      const top = document.createElement('div');
      top.className = 'item-top';
      const t = document.createElement('span');
      t.className = 'item-title' + (it.title.trim() ? '' : ' untitled');
      t.textContent = it.title.trim() || 'Senza titolo';
      const d = document.createElement('span');
      d.className = 'item-date';
      d.textContent = it.date ? fmtDate(it.date) : relTime(it.updatedAt);
      top.append(t, d);

      const meta = document.createElement('div');
      meta.className = 'item-meta';
      if (it.kind) meta.append(badge(it.kind, 'kind'));
      if (it.who) meta.append(badge(it.who));
      it.tags.slice(0, 3).forEach((tag) => meta.append(badge('#' + tag)));

      const ex = document.createElement('div');
      ex.className = 'item-excerpt';
      ex.textContent = excerpt(it.body);

      b.append(top);
      if (meta.childElementCount) b.append(meta);
      if (ex.textContent) b.append(ex);
      b.addEventListener('click', () => { openEditor(it.id); });
      li.append(b);
      return li;
    }));
    const total = Object.values(data.items).some((it) => !it.deleted && it.section === ui.section);
    el.listEmpty.hidden = items.length > 0;
    el.listEmpty.innerHTML = total ? 'Nessun risultato.' : s.empty;
  }

  function badge(text, cls) {
    const b = document.createElement('span');
    b.className = 'badge' + (cls ? ' ' + cls : '');
    b.textContent = text;
    return b;
  }

  function excerpt(body) {
    return body.split('\n').map((l) => l.replace(/^#+\s*/, '').trim())
      .filter((l) => l && !/^(Obiettivo|Contesto|Analisi|Conclusioni|Prossimi passi|Problema|Soluzione|Clienti target|Modello di ricavo|Concorrenti)$/.test(l))
      .join(' · ').slice(0, 220);
  }

  /* ---------------- Editor ---------------- */
  let editorLoadedAt = 0;

  function openEditor(id, navigate = true) {
    const it = id && data.items[id];
    if (!it || it.deleted || it.section !== ui.section) {
      ui.currentId = null;
      el.editor.hidden = true;
      el.editorEmpty.hidden = false;
      if (navigate) showList();
      return;
    }
    ui.currentId = id;
    saveUi();
    const s = SECTIONS[it.section];
    el.lKind.textContent = s.kindLabel;
    el.lWho.textContent = s.whoLabel;
    el.kind.replaceChildren(...s.kinds.map((k) => new Option(k, k)));
    fillEditor(it);
    el.editor.hidden = false;
    el.editorEmpty.hidden = true;
    renderList();
    if (navigate) showEditor();
  }

  function fillEditor(it) {
    el.title.value = it.title;
    el.kind.value = it.kind || SECTIONS[it.section].kinds[0];
    el.date.value = it.date;
    el.who.value = it.who;
    el.tags.value = it.tags.join(', ');
    el.text.value = it.body;
    editorLoadedAt = it.updatedAt;
    updateSavedAt(it);
    requestAnimationFrame(() => { autoGrow(el.title); autoGrow(el.text); });
  }

  function refreshEditorIfStale() {
    const it = ui.currentId && data.items[ui.currentId];
    if (!it) return;
    if (it.deleted) { toast('Questo elemento è stato eliminato da un altro dispositivo'); openEditor(null); return; }
    const typing = el.editor.contains(document.activeElement);
    if (it.updatedAt !== editorLoadedAt && !typing) fillEditor(it);
    else updateSavedAt(it);
  }

  function updateSavedAt(it) {
    el.savedAt.textContent = it.updatedAt ? 'Modificato ' + relTime(it.updatedAt) : '';
  }

  function onEdit() {
    const it = ui.currentId && data.items[ui.currentId];
    if (!it) return;
    it.title = el.title.value;
    it.kind = el.kind.value;
    it.date = el.date.value;
    it.who = el.who.value;
    it.tags = el.tags.value.split(',').map((t) => t.trim()).filter(Boolean);
    it.body = el.text.value;
    it.updatedAt = Date.now();
    editorLoadedAt = it.updatedAt;
    saveData();
    updateSavedAt(it);
    renderListSoon();
    scheduleSync();
  }

  let listTimer = null;
  function renderListSoon() { clearTimeout(listTimer); listTimer = setTimeout(renderList, 250); }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  function createItem() {
    const s = SECTIONS[ui.section];
    const now = Date.now();
    const it = normalizeItem({
      id: uid(), section: ui.section, title: '', kind: ui.filter || s.kinds[0], date: today(),
      body: s.template, createdAt: now, updatedAt: now,
    });
    data.items[it.id] = it;
    saveData();
    el.search.value = '';
    openEditor(it.id);
    el.title.focus();
    scheduleSync();
  }

  function deleteCurrent() {
    const it = ui.currentId && data.items[ui.currentId];
    if (!it) return;
    const name = it.title.trim() || 'questo elemento senza titolo';
    if (!confirm(`Eliminare “${name}”?`)) return;
    data.items[it.id] = normalizeItem({ ...it, deleted: true, updatedAt: Date.now() });
    saveData();
    openEditor(null, false);
    showList();
    renderList();
    scheduleSync(300);
    toast('Eliminato. È comunque recuperabile dalla cronologia su GitHub.');
  }

  /* ---------------- Impostazioni ---------------- */
  function fillSettings() {
    el.owner.value = cfg.owner;
    el.repo.value = cfg.repo;
    el.token.value = cfg.token;
    if (lastError && connected()) showResult(lastError, false);
  }

  function showResult(msg, ok) {
    el.connectResult.textContent = msg;
    el.connectResult.className = 'result ' + (ok ? 'ok' : 'err');
  }

  async function connect() {
    cfg.owner = el.owner.value.trim();
    cfg.repo = el.repo.value.trim();
    cfg.token = el.token.value.trim();
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
    el.qr.hidden = true;
    fillSettings();
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
    history.replaceState(null, '', location.pathname + location.search);
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
    el.qr.hidden = false;
    el.qrImg.textContent = 'Caricamento…';
    try {
      if (!window.qrcode) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js');
      const qr = window.qrcode(0, 'M');
      qr.addData(connectLink());
      qr.make();
      el.qrImg.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    } catch {
      el.qrImg.textContent = 'QR non disponibile: usa “Copia link” e aprilo sul telefono.';
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(connectLink()); toast('Link copiato'); }
    catch { prompt('Copia questo link e aprilo sul telefono:', connectLink()); }
  }

  function exportBackup() {
    const blob = new Blob([serialize(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `archivio-backup-${today()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function importBackup(file) {
    try {
      const imported = normalizeData(JSON.parse(await file.text()));
      const n = Object.values(imported.items).filter((i) => !i.deleted).length;
      if (!confirm(`Importare ${n} elementi? Verranno uniti a quelli esistenti.`)) return;
      data = merge(data, imported);
      saveData();
      scheduleSync(300);
      toast(`Importati ${n} elementi`);
    } catch (e) {
      toast('File non valido: ' + e.message);
    }
  }

  /* ---------------- Varie ---------------- */
  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3500);
  }

  /* ---------------- Eventi ---------------- */
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('btn-new').addEventListener('click', createItem);
  $('btn-back').addEventListener('click', () => { showList(); renderList(); });
  $('btn-delete').addEventListener('click', deleteCurrent);
  $('btn-connect').addEventListener('click', connect);
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-qr').addEventListener('click', showQr);
  $('btn-copy-link').addEventListener('click', copyLink);
  $('btn-export').addEventListener('click', exportBackup);
  $('f-import').addEventListener('change', (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
  el.search.addEventListener('input', renderList);

  [el.title, el.who, el.tags, el.text].forEach((f) => f.addEventListener('input', onEdit));
  [el.kind, el.date].forEach((f) => f.addEventListener('change', onEdit));
  el.title.addEventListener('input', () => autoGrow(el.title));
  el.text.addEventListener('input', () => autoGrow(el.text));
  el.title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.text.focus(); } });
  window.addEventListener('resize', () => { if (!el.editor.hidden) { autoGrow(el.title); autoGrow(el.text); } });

  // Quando si cambia app sul telefono o si chiude la scheda, invia subito le modifiche.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (hasUnsynced()) sync(); }
    else sync();
  });
  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus('offline'));
  window.addEventListener('beforeunload', (e) => {
    if (connected() && el.sync.dataset.state === 'pending') { sync(); e.preventDefault(); e.returnValue = ''; }
  });
  setInterval(() => {
    if (document.visibilityState === 'visible' && !syncing && el.sync.dataset.state !== 'pending') sync();
    const it = ui.currentId && data.items[ui.currentId];
    if (it) updateSavedAt(it);
  }, POLL_MS);

  // Aggiornamenti da un'altra scheda aperta sullo stesso dispositivo.
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_DATA) return;
    data = merge(data, normalizeData(load(LS_DATA, null)));
    renderList();
    refreshEditorIfStale();
  });

  /* ---------------- Avvio ---------------- */
  const justLinked = readConnectLink();
  if (!connected() && !cfg.owner && /\.github\.io$/.test(location.hostname)) cfg.owner = location.hostname.split('.')[0];
  if (justLinked) { ui.section = 'report'; }
  else if (!connected() && !Object.keys(data.items).length) ui.section = 'settings';
  render();
  setStatus();
  if (!isPhone() && ui.currentId) el.body.dataset.screen = 'editor';
  if (connected()) sync().then(() => { if (justLinked) toast(lastError ? 'Collegamento non riuscito: ' + lastError : 'Dispositivo collegato ✓'); });
})();
