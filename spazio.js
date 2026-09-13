/* Spazio di lavoro — giornata, liste to-do e startup (cartelle con documenti, griglie e to-do).
 *
 * I dati NON stanno in data.json: quel file lo leggono anche versioni vecchie del sito
 * (per esempio una scheda rimasta aperta sul telefono), che scarterebbero i campi nuovi.
 * Qui si usano due file separati, sincronizzati con lo stesso metodo:
 *   - agenda.json nel repository dati (lavoro-dati): appunti della giornata e liste to-do dei report;
 *   - spazio/cyber.json nel repository del progetto cyber: startup, documenti, griglie e to-do.
 * Ogni elemento si unisce per id: tra due versioni vince la più recente (updatedAt).
 * I campi che questa versione non conosce vengono conservati.
 *
 * Rotte gestite:
 *   #/giornata?d=AAAA-MM-GG        appunti del giorno
 *   #/todo  ·  #/todo/<id>         liste to-do dei report
 *   #/cyber/startup[/<id>]         startup e contenuto della cartella
 *   #/cyber/report                 documenti liberi del progetto
 *   #/cyber/todo                   liste to-do del progetto
 *   #/cyber/file/<id>              griglia o lista to-do del progetto (anche dentro una startup)
 *   I documenti si aprono nell'editor dei report: #/doc/<id>
 */
(() => {
  'use strict';

  const A = () => window.Archivio; // funzioni condivise esposte da app.js
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg><use href="#${id}"/></svg>`;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const oggiISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const spostaGiorno = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const diffGiorni = (a, b) => { const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5); };
  const maiuscola = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const dataIt = (iso, opz) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('it-IT', opz); };

  function leggiLocale(chiave) {
    try { return normalizza(JSON.parse(localStorage.getItem(chiave) || 'null')); } catch { return normalizza(null); }
  }
  function scriviLocale(chiave, dati) {
    try { localStorage.setItem(chiave, JSON.stringify(dati)); } catch (e) { if (A()) A().toast('Memoria del dispositivo piena: ' + e.message); }
  }

  /* =========================================================
     Modello dati
     ========================================================= */
  const FORMATI = { testo: 'Testo', numero: 'Numero', euro: 'Euro (€)', percentuale: 'Percentuale' };

  function normalizzaElemento(it) {
    const o = { ...it }; // i campi sconosciuti restano: una versione futura non perde dati
    o.id = String(it.id);
    o.type = String(it.type || '');
    o.parent = String(it.parent || '');
    o.title = String(it.title || '');
    o.createdAt = Number(it.createdAt) || 0;
    o.updatedAt = Number(it.updatedAt) || 0;
    if (it.deleted) return { id: o.id, type: o.type, parent: o.parent, deleted: true, createdAt: o.createdAt, updatedAt: o.updatedAt };
    delete o.deleted;
    if (o.type === 'doc') {
      o.section = 'cyberdoc';
      o.kind = String(it.kind || 'Report');
      o.date = String(it.date || '');
      o.who = String(it.who || '');
      o.tags = Array.isArray(it.tags) ? it.tags.map(String) : [];
      o.body = String(it.body || '');
    } else if (o.type === 'todo') {
      o.voci = (Array.isArray(it.voci) ? it.voci : []).filter((v) => v && v.id).map((v) => ({ ...v, id: String(v.id), testo: String(v.testo || ''), fatto: Boolean(v.fatto) }));
    } else if (o.type === 'grid') {
      o.colonne = (Array.isArray(it.colonne) ? it.colonne : []).filter((c) => c && c.id).map((c) => ({ ...c, id: String(c.id), nome: String(c.nome || ''), formato: FORMATI[c.formato] ? c.formato : 'testo' }));
      const ids = new Set(o.colonne.map((c) => c.id));
      o.righe = (Array.isArray(it.righe) ? it.righe : []).filter((r) => r && r.id).map((r) => {
        const celle = {};
        Object.keys(r.celle || {}).forEach((k) => { if (ids.has(k) && r.celle[k] !== '' && r.celle[k] != null) celle[k] = String(r.celle[k]); });
        return { ...r, id: String(r.id), celle };
      });
      o.totali = it.totali !== false;
    } else if (o.type === 'startup') {
      o.descrizione = String(it.descrizione || '');
    } else if (o.type === 'appunto') {
      o.giorno = DATA_RE.test(it.giorno || '') ? it.giorno : '';
      o.ora = /^\d{2}:\d{2}$/.test(it.ora || '') ? it.ora : '';
      o.testo = String(it.testo || '');
      o.fatto = Boolean(it.fatto);
    }
    return o;
  }

  function normalizza(d) {
    const items = {};
    const src = d && d.items && typeof d.items === 'object' ? d.items : {};
    Object.keys(src).sort().forEach((id) => { if (src[id] && src[id].id) items[id] = normalizzaElemento(src[id]); });
    return { version: 1, items };
  }

  function unisci(locale, remoto) {
    const items = {};
    const ids = new Set([...Object.keys(locale.items), ...Object.keys((remoto && remoto.items) || {})]);
    [...ids].sort().forEach((id) => {
      const a = locale.items[id];
      const b = remoto && remoto.items[id];
      items[id] = !b ? a : !a ? b : (a.updatedAt >= b.updatedAt ? a : b);
    });
    return { version: 1, items };
  }

  // Chiavi in ordine alfabetico: lo stesso contenuto produce sempre lo stesso testo.
  const ordinato = (v) => Array.isArray(v) ? v.map(ordinato)
    : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = ordinato(v[k]); return o; }, {}) : v;
  const serializza = (d) => JSON.stringify(ordinato(normalizza(d)), null, 1) + '\n';

  /* =========================================================
     Archivio sincronizzato con un file JSON su GitHub
     ========================================================= */
  function creaArchivio({ nome, chiaveLocale, repo, percorso, messaggio }) {
    const S = { nome, dati: leggiLocale(chiaveLocale), stato: '', errore: '', inCorso: false, ancora: false, timer: null };

    const salvaLocale = () => { S.dati = unisci(S.dati, leggiLocale(chiaveLocale)); scriviLocale(chiaveLocale, S.dati); };
    const salvaLocalePresto = debounce(salvaLocale, 300);

    S.vivi = (tipo) => Object.values(S.dati.items).filter((x) => !x.deleted && (!tipo || x.type === tipo));
    S.get = (id) => { const x = S.dati.items[id]; return x && !x.deleted ? x : null; };
    S.possiede = (id) => Boolean(S.get(id));

    // Registra una modifica: subito sul dispositivo, poi (dopo qualche secondo) su GitHub.
    S.metti = (x, { tocca = true, sincronizza = true } = {}) => {
      if (tocca) x.updatedAt = Math.max(Date.now(), (x.updatedAt || 0) + 1);
      S.dati.items[x.id] = x;
      salvaLocalePresto();
      if (sincronizza) S.programma();
      return x;
    };
    S.elimina = (id) => {
      const x = S.dati.items[id];
      if (!x) return;
      S.dati.items[id] = normalizzaElemento({ ...x, deleted: true, updatedAt: Math.max(Date.now(), (x.updatedAt || 0) + 1) });
      salvaLocale();
      S.programma(800);
    };
    S.salvaOra = salvaLocale;

    const collegato = () => Boolean(A() && A().connected() && repo());

    S.programma = (ritardo = 2500) => {
      clearTimeout(S.timer);
      if (!collegato()) { aggiornaStato(); return; }
      S.stato = 'pending';
      aggiornaStato();
      S.timer = setTimeout(S.sincronizza, ritardo);
    };

    async function scarica() {
      const r = await A().gh(`contents/${percorso}?ref=main&t=${Date.now()}`, {}, repo());
      if (r.status === 404) {
        const rr = await A().gh('', {}, repo());
        if (!rr.ok) throw await A().httpError(rr, repo());
        return { dati: null, sha: null };
      }
      if (!r.ok) throw await A().httpError(r, repo());
      const j = await r.json();
      let b64 = j.content;
      if (!b64 && j.sha) {
        const rb = await A().gh(`git/blobs/${j.sha}`, {}, repo());
        if (!rb.ok) throw await A().httpError(rb, repo());
        b64 = (await rb.json()).content;
      }
      let parsed;
      try { parsed = JSON.parse(A().fromB64(b64 || '')); } catch { parsed = { items: {} }; }
      return { dati: normalizza(parsed), sha: j.sha };
    }

    async function carica(testo, sha) {
      const body = { message: `${messaggio} ${new Date().toLocaleString('it-IT')}`, content: A().toB64(testo), branch: 'main' };
      if (sha) body.sha = sha;
      const r = await A().gh(`contents/${percorso}`, { method: 'PUT', body: JSON.stringify(body) }, repo());
      if (r.status === 409 || (r.status === 422 && !sha)) return false;
      if (!r.ok) throw await A().httpError(r, repo());
      return true;
    }

    S.sincronizza = async () => {
      clearTimeout(S.timer);
      if (!collegato()) { S.stato = ''; aggiornaStato(); return; }
      if (S.inCorso) { S.ancora = true; return; }
      S.inCorso = true;
      salvaLocale();
      const prima = serializza(S.dati);
      try {
        let fatto = false;
        for (let tentativo = 0; tentativo < 5 && !fatto; tentativo++) {
          const remoto = await scarica();
          S.dati = unisci(S.dati, remoto.dati);
          salvaLocale();
          const testo = serializza(S.dati);
          if (remoto.dati && serializza(remoto.dati) === testo) { fatto = true; break; }
          fatto = await carica(testo, remoto.sha);
        }
        if (!fatto) throw new Error('Troppe modifiche contemporanee, riprovo tra poco');
        S.errore = '';
        S.stato = 'ok';
        if (serializza(S.dati) !== prima) arrivateNovita();
      } catch (e) {
        S.errore = e.message || String(e);
        S.stato = navigator.onLine === false ? 'offline' : 'error';
        if (navigator.onLine !== false && !/Token|permessi|non trovato/.test(S.errore)) S.ancora = true;
      } finally {
        S.inCorso = false;
        aggiornaStato();
        if (S.ancora) { S.ancora = false; S.programma(S.errore ? 15000 : 400); }
      }
    };

    S.ricaricaDaLocale = () => { S.dati = unisci(S.dati, leggiLocale(chiaveLocale)); };
    S.chiaveLocale = chiaveLocale;
    return S;
  }

  const agenda = creaArchivio({
    nome: 'agenda', chiaveLocale: 'archivio.agenda.v1', percorso: 'agenda.json', messaggio: 'Agenda:',
    repo: () => A() && A().cfg().repo,
  });
  const cyber = creaArchivio({
    nome: 'cyber', chiaveLocale: 'archivio.spaziocyber.v1', percorso: 'spazio/cyber.json', messaggio: 'Spazio cyber:',
    repo: () => A() && (A().cfg().cyberRepo || 'progetto-cyber'),
  });
  const ARCHIVI = { agenda, cyber };
  const archivioDi = (id) => (agenda.possiede(id) ? agenda : cyber.possiede(id) ? cyber : null);

  function aggiornaStato() { if (A() && A().aggiornaStato) A().aggiornaStato(); }

  // Stato complessivo (per l'indicatore di sincronizzazione del sito).
  function statoSync() {
    const stati = [agenda, cyber].map((s) => s.stato);
    const errore = [agenda, cyber].find((s) => s.stato === 'error');
    if (errore) return { stato: 'error', errore: `${errore === agenda ? 'Agenda' : 'Spazio cyber'}: ${errore.errore}` };
    if (stati.includes('offline')) return { stato: 'offline' };
    if (stati.includes('pending')) return { stato: 'pending' };
    return { stato: '' };
  }

  // Dopo una sincronizzazione con novità: ridisegna, ma mai sotto le dita di chi sta scrivendo.
  function arrivateNovita() {
    if (!A()) return;
    A().refreshWriterIfStale();
    const attivo = document.activeElement;
    if (attivo && attivo.closest && attivo.closest('.main') && /INPUT|TEXTAREA|SELECT/.test(attivo.tagName)) return;
    A().renderSoon();
  }

  /* =========================================================
     Menu contestuale (usa gli stili e lo sfondo dei menu del sito)
     ========================================================= */
  let vociMenu = [];
  function apriMenu(anchor, titolo, voci, html) {
    const m = $('sp-menu');
    vociMenu = voci;
    m.innerHTML = `${titolo ? `<p class="menu-title">${esc(titolo)}</p>` : ''}${html || ''}${voci.map((v, i) => v === '-' ? '<hr>'
      : `<button type="button" class="menu-item${v.pericolo ? ' danger' : ''}${v.attiva ? ' on' : ''}" data-sp-voce="${i}">${v.icona ? icon(v.icona) : '<span class="sp-menu-dot"></span>'}<span>${esc(v.label)}</span>${v.attiva ? '<b class="sp-check">✓</b>' : ''}</button>`).join('')}`;
    A().openMenu('sp-menu', anchor);
  }

  /* =========================================================
     Giornata
     ========================================================= */
  const ordinaAppunti = (a, b) => (a.ora && b.ora ? a.ora.localeCompare(b.ora) : a.ora ? -1 : b.ora ? 1 : 0) || a.createdAt - b.createdAt;

  function nomeGiorno(iso) {
    const n = diffGiorni(oggiISO(), iso);
    if (n === 0) return 'Oggi';
    if (n === 1) return 'Domani';
    if (n === -1) return 'Ieri';
    return maiuscola(dataIt(iso, { weekday: 'long' }));
  }

  function nuovoAppunto(giorno, testo, ora) {
    const t = String(testo || '').trim();
    if (!t) return null;
    const now = Date.now();
    return agenda.metti(normalizzaElemento({ id: uid(), type: 'appunto', giorno, ora: ora || '', testo: t, fatto: false, createdAt: now, updatedAt: now }));
  }

  function rigaAppunto(a, { conData = false, porta = false } = {}) {
    return `<li class="gi-item${a.fatto ? ' done' : ''}">
      <label class="sp-check-box"><input type="checkbox" data-gi-fatto="${esc(a.id)}" ${a.fatto ? 'checked' : ''} aria-label="Fatto"></label>
      <input type="time" class="gi-ora${a.ora ? '' : ' vuota'}" value="${esc(a.ora)}" data-gi-ora="${esc(a.id)}" aria-label="Ora">
      <input class="gi-testo" value="${esc(a.testo)}" data-gi-testo="${esc(a.id)}" autocomplete="off" enterkeyhint="done" aria-label="Appunto">
      ${conData ? `<span class="gi-quando">${esc(dataIt(a.giorno, { day: 'numeric', month: 'short' }).replace('.', ''))}</span>` : ''}
      ${porta ? `<button type="button" class="btn small" data-gi-porta="${esc(a.id)}">A oggi</button>` : ''}
      <button type="button" class="icon-btn" data-gi-menu="${esc(a.id)}" aria-label="Altre azioni">${icon('i-more')}</button>
    </li>`;
  }

  function renderGiornata(view) {
    const box = $('gi-content');
    const oggi = oggiISO();
    const giorno = DATA_RE.test(view.params.get('d') || '') ? view.params.get('d') : oggi;
    const delGiorno = agenda.vivi('appunto').filter((a) => a.giorno === giorno).sort(ordinaAppunti);
    const aperti = delGiorno.filter((a) => !a.fatto);
    const fatti = delGiorno.filter((a) => a.fatto);
    const arretrati = giorno === oggi ? agenda.vivi('appunto').filter((a) => !a.fatto && a.giorno && a.giorno < oggi).sort((a, b) => a.giorno.localeCompare(b.giorno) || ordinaAppunti(a, b)) : [];
    const n = diffGiorni(oggi, giorno);
    const vai = (d) => `#/giornata?d=${d}`;
    const focusPrima = document.activeElement && document.activeElement.id === 'gi-nuovo';

    box.innerHTML = `
      <div class="gi-nav">
        <a class="icon-btn" href="${vai(spostaGiorno(giorno, -1))}" aria-label="Giorno precedente">${icon('i-back')}</a>
        <div class="segmented">
          <a href="${vai(spostaGiorno(oggi, -1))}" aria-pressed="${n === -1}">Ieri</a>
          <a href="${vai(oggi)}" aria-pressed="${n === 0}">Oggi</a>
          <a href="${vai(spostaGiorno(oggi, 1))}" aria-pressed="${n === 1}">Domani</a>
        </div>
        <a class="icon-btn gi-next" href="${vai(spostaGiorno(giorno, 1))}" aria-label="Giorno successivo">${icon('i-back')}</a>
        <label class="gi-picker" title="Scegli un giorno">${icon('i-calendar')}<input type="date" id="gi-picker" value="${giorno}" aria-label="Scegli un giorno"></label>
      </div>

      <section class="gi-card">
        <header class="gi-head">
          <div>
            <p class="gi-data">${esc(maiuscola(dataIt(giorno, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))}</p>
            <h2>${esc(nomeGiorno(giorno))}</h2>
          </div>
          ${delGiorno.length ? `<div class="gi-count"><b>${fatti.length}</b>/${delGiorno.length}<span>fatti</span></div>` : ''}
        </header>
        <form class="gi-add" id="gi-add" data-giorno="${giorno}">
          <input type="time" name="ora" class="gi-ora vuota" aria-label="Ora (facoltativa)">
          <input name="testo" id="gi-nuovo" placeholder="Scrivi un appunto veloce e premi Invio" autocomplete="off" enterkeyhint="send">
          <button class="btn primary" type="submit" aria-label="Aggiungi">${icon('i-plus')}<span class="hide-phone">Aggiungi</span></button>
        </form>
        ${aperti.length ? `<ul class="gi-list">${aperti.map((a) => rigaAppunto(a)).join('')}</ul>`
          : `<p class="gi-empty">${fatti.length ? 'Tutto fatto. ✓' : n > 0 ? 'Niente ancora in programma: butta giù le prime cose da fare.' : 'Nessun appunto per questo giorno.'}</p>`}
        ${fatti.length ? `<details class="gi-fatti"${aperti.length ? '' : ' open'}><summary>Fatti <span>${fatti.length}</span></summary><ul class="gi-list">${fatti.map((a) => rigaAppunto(a)).join('')}</ul></details>` : ''}
      </section>

      ${arretrati.length ? `
        <section class="gi-card gi-old">
          <header class="gi-head small">
            <h3>${icon('i-alert')}Rimasti aperti dai giorni scorsi <span>${arretrati.length}</span></h3>
            <button type="button" class="btn small" data-gi-porta-tutti>Porta tutti a oggi</button>
          </header>
          <ul class="gi-list">${arretrati.map((a) => rigaAppunto(a, { conData: true, porta: true })).join('')}</ul>
        </section>` : ''}

      <p class="gi-bot">${icon('i-bell')}<span>Ogni sera alle 21 il bot Telegram ti manda gli appunti di domani e quelli rimasti aperti.</span></p>`;

    if (focusPrima || view.params.get('nuovo') === '1') {
      const inp = $('gi-nuovo');
      if (inp) inp.focus();
      if (view.params.get('nuovo') === '1') history.replaceState(null, '', vai(giorno));
    }
  }

  function renderHome(box) {
    if (!box) return;
    const oggi = oggiISO();
    const tutti = agenda.vivi('appunto').filter((a) => a.giorno === oggi).sort(ordinaAppunti);
    const aperti = tutti.filter((a) => !a.fatto);
    const arretrati = agenda.vivi('appunto').filter((a) => !a.fatto && a.giorno && a.giorno < oggi).length;
    const focus = document.activeElement && document.activeElement.id === 'home-gi-nuovo';
    box.innerHTML = `
      <form class="gi-add compact" id="home-gi-add" data-giorno="${oggi}">
        <input name="testo" id="home-gi-nuovo" placeholder="Appunto veloce per oggi…" autocomplete="off" enterkeyhint="send">
        <button class="icon-btn" type="submit" aria-label="Aggiungi">${icon('i-plus')}</button>
      </form>
      ${aperti.length ? `<ul class="gi-list compact">${aperti.slice(0, 6).map((a) => `
        <li class="gi-item">
          <label class="sp-check-box"><input type="checkbox" data-gi-fatto="${esc(a.id)}" aria-label="Fatto"></label>
          ${a.ora ? `<span class="gi-ora-txt">${esc(a.ora)}</span>` : ''}
          <span class="gi-testo-txt">${esc(a.testo)}</span>
        </li>`).join('')}</ul>` : `<p class="panel-empty">${tutti.length ? 'Tutto fatto per oggi. ✓' : 'Niente in programma per oggi.'}</p>`}
      ${aperti.length > 6 || arretrati ? `<p class="gi-more">${aperti.length > 6 ? `<a href="#/giornata">+${aperti.length - 6} altri</a>` : ''}${arretrati ? `<a href="#/giornata" class="danger-text">${arretrati} ${arretrati === 1 ? 'rimasto aperto' : 'rimasti aperti'} dai giorni scorsi</a>` : ''}</p>` : ''}`;
    if (focus) $('home-gi-nuovo').focus();
  }

  /* =========================================================
     Liste to-do
     ========================================================= */
  const avanzamento = (x) => { const tot = x.voci.length; const f = x.voci.filter((v) => v.fatto).length; return { tot, f, perc: tot ? Math.round((f / tot) * 100) : 0 }; };

  function nuovaLista(arch, parent, titolo) {
    const now = Date.now();
    return arch.metti(normalizzaElemento({ id: uid(), type: 'todo', parent: parent || '', title: titolo || '', voci: [], createdAt: now, updatedAt: now }), { tocca: false });
  }

  function hrefFile(arch, x) {
    if (x.type === 'doc') return `#/doc/${encodeURIComponent(x.id)}`;
    return arch === agenda ? `#/todo/${encodeURIComponent(x.id)}` : `#/cyber/file/${encodeURIComponent(x.id)}`;
  }

  function cardLista(arch, x) {
    const p = avanzamento(x);
    const aperte = x.voci.filter((v) => !v.fatto);
    const title = x.title.trim();
    return `<a class="td-card" href="${hrefFile(arch, x)}">
      <div class="td-card-top"><span class="cat-label" style="--cat:var(--accent)"><i></i>To-do</span><span class="doc-date">${esc(A().relTime(x.updatedAt))}</span></div>
      <h3 class="${title ? '' : 'untitled'}">${esc(title || 'Senza titolo')}</h3>
      <ul class="td-preview">${aperte.slice(0, 4).map((v) => `<li>${esc(v.testo || '…')}</li>`).join('') || `<li class="muted">${p.tot ? 'Tutto completato ✓' : 'Lista vuota'}</li>`}</ul>
      <div class="td-card-foot"><div class="td-bar"><span style="width:${p.perc}%"></span></div><span>${p.f}/${p.tot}</span></div>
    </a>`;
  }

  function elencoListe(box, arch, parent) {
    const liste = arch.vivi('todo').filter((x) => x.parent === (parent || '')).sort((a, b) => b.updatedAt - a.updatedAt);
    box.innerHTML = liste.length
      ? `<div class="td-grid">${liste.map((x) => cardLista(arch, x)).join('')}</div>`
      : `<div class="empty-state"><span class="quick-icon">${icon('i-check')}</span><h3>Nessuna lista to-do</h3><p>Crea una lista per le cose da fare: le spunti mentre le completi.</p>
         <button class="btn primary" type="button" data-td-nuova="${arch.nome}" data-parent="${esc(parent || '')}">${icon('i-plus')}Nuova lista</button></div>`;
  }

  let corrente = null; // { arch, id } del file aperto nella pagina (lista o griglia)

  function vociTodo(x, fatte) {
    return x.voci.filter((v) => v.fatto === fatte).map((v) => `
      <li class="td-item${v.fatto ? ' done' : ''}">
        <label class="sp-check-box"><input type="checkbox" data-td-fatto="${esc(v.id)}" ${v.fatto ? 'checked' : ''} aria-label="Completata"></label>
        <textarea class="td-testo" rows="1" data-td-testo="${esc(v.id)}" enterkeyhint="next" aria-label="Voce">${esc(v.testo)}</textarea>
        <button type="button" class="icon-btn" data-td-elimina="${esc(v.id)}" aria-label="Elimina voce">${icon('i-x')}</button>
      </li>`).join('');
  }

  function renderListaTodo(box, arch, x, indietro) {
    corrente = { arch, id: x.id };
    const p = avanzamento(x);
    const fatte = x.voci.filter((v) => v.fatto).length;
    box.innerHTML = `
      <a class="cy-back" href="${indietro.href}">${icon('i-back')}${esc(indietro.label)}</a>
      <article class="sp-sheet td-sheet">
        <header class="sp-sheet-head">
          <div class="sp-sheet-top">
            <span class="cat-label" style="--cat:var(--accent)"><i></i>Lista to-do</span>
            <button type="button" class="icon-btn" data-sp-file-menu aria-label="Altre azioni">${icon('i-more')}</button>
          </div>
          <textarea class="sp-title" rows="1" data-sp-titolo placeholder="Titolo della lista">${esc(x.title)}</textarea>
          <div class="td-progress"><div class="td-bar"><span style="width:${p.perc}%"></span></div><span id="td-conta">${p.f} di ${p.tot} completate</span></div>
        </header>
        <ul class="td-list" id="td-aperte">${vociTodo(x, false)}</ul>
        <form class="td-add" id="td-add">
          <span class="td-plus">${icon('i-plus')}</span>
          <input id="td-nuova" placeholder="Aggiungi una voce e premi Invio" autocomplete="off" enterkeyhint="send">
        </form>
        ${fatte ? `<details class="td-fatte" open><summary>Completate <span>${fatte}</span></summary><ul class="td-list">${vociTodo(x, true)}</ul></details>` : ''}
      </article>`;
    box.querySelectorAll('textarea').forEach(cresci);
    if (!x.title && !x.voci.length && x.createdAt === x.updatedAt) box.querySelector('[data-sp-titolo]').focus();
  }

  const cresci = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

  function aggiornaContaTodo(x) {
    const p = avanzamento(x);
    const c = $('td-conta');
    if (c) { c.textContent = `${p.f} di ${p.tot} completate`; c.previousElementSibling.firstElementChild.style.width = p.perc + '%'; }
  }

  /* Vista #/todo (liste dei report) */
  function renderTodoView(view) {
    const box = $('td-content');
    $('td-head-actions').hidden = Boolean(view.id);
    if (view.id) {
      const x = agenda.get(view.id);
      if (!x || x.type !== 'todo') { location.replace('#/todo'); return; }
      $('td-title').textContent = 'Lista to-do';
      renderListaTodo(box, agenda, x, { href: '#/todo', label: 'Liste to-do' });
      return;
    }
    corrente = null;
    $('td-title').textContent = 'Liste to-do';
    elencoListe(box, agenda, '');
  }

  /* =========================================================
     Griglie (prezzi, costi, numeri) con formule
     ========================================================= */
  class ErroreCella { constructor(codice) { this.codice = codice; } }
  const lettera = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const indiceLettera = (s) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

  // "1.234,50" · "1234.5" · "€ 12" · "10%" → numero; stringa vuota → null; testo → NaN
  function leggiNumero(s) {
    let t = String(s ?? '').trim();
    if (!t) return null;
    let perc = false;
    t = t.replace(/€|\beur(o)?\b/gi, '').replace(/\s/g, '');
    if (t.endsWith('%')) { perc = true; t = t.slice(0, -1); }
    if (!/^[-+]?(\d[\d.,]*|[.,]\d+)$/.test(t)) return NaN;
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    if (!Number.isFinite(n)) return NaN;
    return perc ? n / 100 : n;
  }

  function tokenizza(s) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const resto = s.slice(i);
      let m;
      if (/^\s/.test(resto)) { i++; continue; }
      if (/^#RIF/i.test(resto)) throw new ErroreCella('#RIF');
      if ((m = resto.match(/^([A-Za-z][A-Za-z0-9.]*)\s*\(/))) { out.push({ t: 'fn', v: m[1].toUpperCase() }); i += m[0].length; continue; }
      if ((m = resto.match(/^\$?([A-Za-z]{1,3})\$?(\d+)/))) { out.push({ t: 'ref', c: indiceLettera(m[1]), r: Number(m[2]) - 1 }); i += m[0].length; continue; }
      if ((m = resto.match(/^\d+(?:[.,]\d+)?|^[.,]\d+/))) { out.push({ t: 'num', v: Number(m[0].replace(',', '.')) }); i += m[0].length; continue; }
      if ('+-*/^%();:,'.includes(resto[0])) { out.push({ t: 'op', v: resto[0] }); i++; continue; }
      throw new ErroreCella('#ERR');
    }
    return out;
  }

  const FUNZIONI = {
    SOMMA: (args) => args.flat().reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0),
    MEDIA: (args) => { const n = args.flat().filter((v) => typeof v === 'number'); if (!n.length) throw new ErroreCella('#DIV/0'); return n.reduce((s, v) => s + v, 0) / n.length; },
    MIN: (args) => { const n = args.flat().filter((v) => typeof v === 'number'); return n.length ? Math.min(...n) : 0; },
    MAX: (args) => { const n = args.flat().filter((v) => typeof v === 'number'); return n.length ? Math.max(...n) : 0; },
    CONTA: (args) => args.flat().filter((v) => typeof v === 'number').length,
    ARROTONDA: (args) => { const x = num(args[0] && args[0][0]); const d = Math.round(num(args[1] ? args[1][0] : 0)); const f = 10 ** d; return Math.round(x * f) / f; },
    ASS: (args) => Math.abs(num(args[0] && args[0][0])),
  };
  Object.assign(FUNZIONI, { SUM: FUNZIONI.SOMMA, AVERAGE: FUNZIONI.MEDIA, COUNT: FUNZIONI.CONTA, ROUND: FUNZIONI.ARROTONDA, ABS: FUNZIONI.ASS });

  function num(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    const n = leggiNumero(v);
    if (n === null) return 0;
    if (Number.isNaN(n)) throw new ErroreCella('#VALORE');
    return n;
  }

  // Calcola tutte le celle di una griglia (con cache e controllo dei riferimenti circolari).
  function calcolatore(g) {
    const cache = new Map();
    const inCorso = new Set();

    function valore(r, c) {
      if (r < 0 || c < 0 || r >= g.righe.length || c >= g.colonne.length) throw new ErroreCella('#RIF');
      const k = r + ':' + c;
      if (cache.has(k)) { const v = cache.get(k); if (v instanceof ErroreCella) throw v; return v; }
      if (inCorso.has(k)) throw new ErroreCella('#CICLO');
      inCorso.add(k);
      let v;
      try {
        const col = g.colonne[c];
        const raw = g.righe[r].celle[col.id] || '';
        if (raw.startsWith('=')) v = formula(raw.slice(1));
        else {
          const n = leggiNumero(raw);
          v = n === null ? null : Number.isNaN(n) ? raw : (col.formato === 'percentuale' && !raw.includes('%') ? n / 100 : n);
        }
      } catch (e) {
        v = e instanceof ErroreCella ? e : new ErroreCella('#ERR');
      }
      inCorso.delete(k);
      cache.set(k, v);
      if (v instanceof ErroreCella) throw v;
      return v;
    }

    function formula(testo) {
      const tk = tokenizza(testo);
      let p = 0;
      let letti = 0; // celle non vuote lette: se zero, il risultato resta vuoto invece di "0"
      let riferimenti = 0;
      const op = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
      const cella = (r, c) => { riferimenti++; const v = valore(r, c); if (v !== null) letti++; return v; };
      const intervallo = (a, b) => {
        const out = [];
        for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) out.push(cella(r, c));
        return out;
      };
      function espr() {
        let v = termine();
        while (op('+') || op('-')) { const o = tk[p++].v; const b = termine(); v = o === '+' ? num(v) + num(b) : num(v) - num(b); }
        return v;
      }
      function termine() {
        let v = potenza();
        while (op('*') || op('/')) {
          const o = tk[p++].v; const b = potenza();
          if (o === '*') v = num(v) * num(b);
          else { const d = num(b); if (d === 0) throw new ErroreCella('#DIV/0'); v = num(v) / d; }
        }
        return v;
      }
      function potenza() { const v = unario(); if (op('^')) { p++; return num(v) ** num(potenza()); } return v; }
      function unario() { if (op('-')) { p++; return -num(unario()); } if (op('+')) { p++; return num(unario()); } return postfisso(); }
      function postfisso() { let v = primario(); while (op('%')) { p++; v = num(v) / 100; } return v; }
      function primario() {
        const k = tk[p++];
        if (!k) throw new ErroreCella('#ERR');
        if (k.t === 'num') return k.v;
        if (k.t === 'ref') { if (op(':')) throw new ErroreCella('#ERR'); return cella(k.r, k.c); }
        if (k.t === 'op' && k.v === '(') { const v = espr(); if (!op(')')) throw new ErroreCella('#ERR'); p++; return v; }
        if (k.t === 'fn') {
          const f = FUNZIONI[k.v];
          if (!f) throw new ErroreCella('#NOME');
          const args = [];
          if (op(')')) { p++; return f(args); }
          for (;;) {
            if (tk[p] && tk[p].t === 'ref' && tk[p + 1] && tk[p + 1].t === 'op' && tk[p + 1].v === ':') {
              const a = tk[p]; const b = tk[p + 2];
              if (!b || b.t !== 'ref') throw new ErroreCella('#ERR');
              p += 3;
              args.push(intervallo(a, b));
            } else {
              args.push([espr()]);
            }
            if (op(';') || op(',')) { p++; continue; }
            if (op(')')) { p++; break; }
            throw new ErroreCella('#ERR');
          }
          return f(args);
        }
        throw new ErroreCella('#ERR');
      }
      const v = espr();
      if (p < tk.length) throw new ErroreCella('#ERR');
      if (riferimenti && !letti && v === 0) return null;
      return typeof v === 'number' && !Number.isFinite(v) ? new ErroreCella('#DIV/0') : v;
    }

    return (r, c) => { try { return valore(r, c); } catch (e) { return e instanceof ErroreCella ? e : new ErroreCella('#ERR'); } };
  }

  function mostraValore(v, col, raw) {
    if (v instanceof ErroreCella) return v.codice;
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (col.formato === 'testo' && !String(raw).startsWith('=')) return raw;
    if (col.formato === 'euro') return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
    if (col.formato === 'percentuale') return (v * 100).toLocaleString('it-IT', { maximumFractionDigits: 2 }) + '%';
    return v.toLocaleString('it-IT', { maximumFractionDigits: col.formato === 'testo' ? 6 : 2 });
  }

  // Riferimenti dopo l'inserimento (delta +1) o l'eliminazione (delta -1) di una riga o colonna.
  function spostaRiferimenti(raw, asse, indice, delta) {
    if (!raw || !raw.startsWith('=')) return raw;
    const sposta = (n) => (n >= indice ? n + delta : n);
    const re = /(^|[^A-Za-z0-9$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?(?![A-Za-z0-9(])/g;
    return raw.replace(re, (tutto, pre, d1, l1, d2, n1, d3, l2, d4, n2) => {
      const a = { c: indiceLettera(l1), r: Number(n1) - 1 };
      const scrivi = (x, da, db) => `${da}${lettera(x.c)}${db}${x.r + 1}`;
      const campo = asse === 'riga' ? 'r' : 'c';
      if (!l2) {
        if (delta < 0 && a[campo] === indice) return pre + '#RIF';
        a[campo] = delta < 0 ? (a[campo] > indice ? a[campo] - 1 : a[campo]) : sposta(a[campo]);
        return pre + scrivi(a, d1, d2);
      }
      const b = { c: indiceLettera(l2), r: Number(n2) - 1 };
      if (delta > 0) { a[campo] = sposta(a[campo]); b[campo] = sposta(b[campo]); }
      else {
        const lo = Math.min(a[campo], b[campo]); const hi = Math.max(a[campo], b[campo]);
        if (lo === indice && hi === indice) return pre + '#RIF';
        a[campo] = lo > indice ? lo - 1 : lo;
        b[campo] = hi >= indice ? hi - 1 : hi;
      }
      return pre + scrivi(a, d1, d2) + ':' + scrivi(b, d3, d4);
    });
  }

  // Copia una formula alla riga sotto spostando i riferimenti relativi (come il "trascina giù").
  function copiaFormulaGiu(raw, righe) {
    return raw.replace(/(^|[^A-Za-z0-9$])(\$?[A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9(])/g, (t, pre, col, dollaro, n) => pre + col + dollaro + (dollaro ? n : Number(n) + righe));
  }

  const MODELLI = {
    vuota: { nome: 'Griglia vuota', desc: 'Colonne e righe libere', colonne: [['', 'testo'], ['', 'testo'], ['', 'testo'], ['', 'testo']], righe: 12 },
    costi: { nome: 'Costi', desc: 'Voce, costo mensile, mesi e totale', colonne: [['Voce', 'testo'], ['Categoria', 'testo'], ['Costo mensile', 'euro'], ['Mesi', 'numero'], ['Totale', 'euro']], formule: { 4: (n) => `=C${n}*D${n}` }, righe: 12 },
    prezzi: { nome: 'Listino prezzi', desc: 'Costo, ricarico, prezzo e margine', colonne: [['Prodotto / servizio', 'testo'], ['Costo', 'euro'], ['Ricarico', 'percentuale'], ['Prezzo', 'euro'], ['Margine', 'euro']], formule: { 3: (n) => `=B${n}*(1+C${n})`, 4: (n) => `=D${n}-B${n}` }, righe: 10 },
    ricavi: { nome: 'Previsione ricavi', desc: 'Clienti × prezzo, costi e utile', colonne: [['Periodo', 'testo'], ['Clienti', 'numero'], ['Prezzo medio', 'euro'], ['Ricavi', 'euro'], ['Costi', 'euro'], ['Utile', 'euro']], formule: { 3: (n) => `=B${n}*C${n}`, 5: (n) => `=D${n}-E${n}` }, righe: 12 },
  };

  function nuovaGriglia(arch, parent, modello) {
    const m = MODELLI[modello] || MODELLI.vuota;
    const colonne = m.colonne.map(([nome, formato]) => ({ id: uid() + Math.random().toString(36).slice(2, 5), nome, formato }));
    const righe = Array.from({ length: m.righe }, (_, i) => {
      const celle = {};
      Object.entries(m.formule || {}).forEach(([c, f]) => { celle[colonne[c].id] = f(i + 1); });
      return { id: uid() + i, celle };
    });
    const now = Date.now();
    return arch.metti(normalizzaElemento({ id: uid(), type: 'grid', parent: parent || '', title: modello && modello !== 'vuota' ? m.nome : '', colonne, righe, totali: true, createdAt: now, updatedAt: now }), { tocca: false });
  }

  const numerica = (col) => col.formato === 'numero' || col.formato === 'euro';

  function renderGriglia(box, arch, x, indietro) {
    corrente = { arch, id: x.id };
    const calc = calcolatore(x);
    const intestazioni = x.colonne.map((c, ci) => `
      <th class="f-${c.formato}" style="${c.larghezza ? `width:${Number(c.larghezza)}px` : ''}">
        <div class="gr-colhead">
          <span class="gr-letter">${lettera(ci)}</span>
          <input class="gr-colname" value="${esc(c.nome)}" data-gr-nome="${ci}" placeholder="Colonna ${lettera(ci)}" autocomplete="off" aria-label="Nome colonna ${lettera(ci)}">
          <button type="button" class="gr-menu-btn" data-gr-colmenu="${ci}" aria-label="Opzioni colonna ${lettera(ci)}">${icon('i-chevron')}</button>
        </div>
        <span class="gr-format">${esc(FORMATI[c.formato])}</span>
      </th>`).join('');
    const righe = x.righe.map((r, ri) => `
      <tr>
        <th class="gr-rownum"><button type="button" data-gr-rigamenu="${ri}" aria-label="Opzioni riga ${ri + 1}">${ri + 1}</button></th>
        ${x.colonne.map((c, ci) => {
          const raw = r.celle[c.id] || '';
          const v = calc(ri, ci);
          return `<td class="f-${c.formato}${raw.startsWith('=') ? ' formula' : ''}${v instanceof ErroreCella ? ' err' : ''}"><input class="gr-cell" data-r="${ri}" data-c="${ci}" value="${esc(mostraValore(v, c, raw))}" autocomplete="off" spellcheck="false" enterkeyhint="next"></td>`;
        }).join('')}
      </tr>`).join('');
    box.innerHTML = `
      <a class="cy-back" href="${indietro.href}">${icon('i-back')}${esc(indietro.label)}</a>
      <article class="sp-sheet gr-sheet">
        <header class="sp-sheet-head">
          <div class="sp-sheet-top">
            <span class="cat-label" style="--cat:var(--c-lavoro)"><i></i>Griglia</span>
            <button type="button" class="icon-btn" data-sp-file-menu aria-label="Altre azioni">${icon('i-more')}</button>
          </div>
          <textarea class="sp-title" rows="1" data-sp-titolo placeholder="Titolo della griglia">${esc(x.title)}</textarea>
          <div class="gr-tools">
            <button type="button" class="btn small" data-gr="riga">${icon('i-plus')}Riga</button>
            <button type="button" class="btn small" data-gr="colonna">${icon('i-plus')}Colonna</button>
            <button type="button" class="btn small" data-gr="totali" aria-pressed="${x.totali}">${x.totali ? '✓ ' : ''}Totali</button>
            <button type="button" class="btn small" data-gr="csv">${icon('i-download')}CSV</button>
            <button type="button" class="btn small ghost" data-gr="aiuto">Come si usano le formule</button>
          </div>
          <div class="gr-help" id="gr-help" hidden>
            <p>In ogni cella scrivi testo o numeri (<b>1.250,50</b>, <b>12 €</b>, <b>22%</b>). Per un calcolo inizia con <b>=</b>:</p>
            <ul>
              <li><code>=B2*C2</code> moltiplica due celle · <code>=D2-B2</code> · <code>=B2*(1+C2)</code></li>
              <li><code>=SOMMA(D1:D12)</code> · <code>=MEDIA(B1:B12)</code> · <code>=MIN(…)</code> · <code>=MAX(…)</code> · <code>=CONTA(…)</code> · <code>=ARROTONDA(B2;2)</code></li>
            </ul>
            <p>Il formato della colonna (menu ▾ accanto al nome) decide come si vedono i numeri: testo, numero, euro o percentuale. Con “+ Riga” le formule della riga sopra vengono copiate. Puoi incollare direttamente righe copiate da Excel.</p>
          </div>
        </header>
        <div class="gr-scroll">
          <table class="gr-table">
            <thead><tr><th class="gr-corner"></th>${intestazioni}</tr></thead>
            <tbody>${righe}</tbody>
            ${x.totali ? `<tfoot><tr><th class="gr-rownum">Tot</th>${x.colonne.map((c, ci) => `<td class="f-${c.formato}" data-gr-tot="${ci}"></td>`).join('')}</tr></tfoot>` : ''}
          </table>
        </div>
        <p class="gr-foot">${x.righe.length} righe · ${x.colonne.length} colonne · si salva da sola mentre scrivi</p>
      </article>`;
    box.querySelectorAll('textarea').forEach(cresci);
    aggiornaTotali(x, calc);
    if (!x.title && x.createdAt === x.updatedAt) box.querySelector('[data-sp-titolo]').focus();
  }

  function aggiornaTotali(x, calc) {
    if (!x.totali) return;
    x.colonne.forEach((c, ci) => {
      const td = document.querySelector(`[data-gr-tot="${ci}"]`);
      if (!td) return;
      if (!numerica(c)) { td.textContent = ''; return; }
      let somma = 0, ci_ = 0;
      x.righe.forEach((_, ri) => { const v = calc(ri, ci); if (typeof v === 'number') { somma += v; ci_++; } });
      td.textContent = ci_ ? mostraValore(somma, c, '') : '';
    });
  }

  // Ricalcola i valori mostrati senza ridisegnare la tabella (così il cursore resta dov'è).
  function ricalcolaGriglia(x) {
    const calc = calcolatore(x);
    document.querySelectorAll('.gr-cell').forEach((inp) => {
      const r = Number(inp.dataset.r), c = Number(inp.dataset.c);
      const col = x.colonne[c], riga = x.righe[r];
      if (!col || !riga) return;
      const raw = riga.celle[col.id] || '';
      const v = calc(r, c);
      const td = inp.parentElement;
      td.classList.toggle('formula', raw.startsWith('='));
      td.classList.toggle('err', v instanceof ErroreCella);
      if (inp !== document.activeElement) inp.value = mostraValore(v, col, raw);
    });
    aggiornaTotali(x, calc);
  }

  function aggiungiRiga(x, dopo) {
    const indice = dopo === undefined ? x.righe.length : dopo + 1;
    const sopra = x.righe[indice - 1];
    const celle = {};
    if (sopra) {
      // Copia le formule "di riga" (quelle che guardano la propria riga, es. =C5*D5)
      x.colonne.forEach((c) => {
        const raw = sopra.celle[c.id] || '';
        if (raw.startsWith('=') && new RegExp(`[A-Za-z]\\$?${indice}(?!\\d)`).test(raw)) celle[c.id] = copiaFormulaGiu(raw, 1);
      });
    }
    if (indice < x.righe.length) x.righe.forEach((r) => Object.keys(r.celle).forEach((k) => { r.celle[k] = spostaRiferimenti(r.celle[k], 'riga', indice, 1); }));
    x.righe.splice(indice, 0, { id: uid(), celle });
    return indice;
  }

  function eliminaRiga(x, indice) {
    x.righe.splice(indice, 1);
    x.righe.forEach((r) => Object.keys(r.celle).forEach((k) => { r.celle[k] = spostaRiferimenti(r.celle[k], 'riga', indice, -1); }));
    if (!x.righe.length) x.righe.push({ id: uid(), celle: {} });
  }

  function aggiungiColonna(x, indice, formato) {
    x.righe.forEach((r) => Object.keys(r.celle).forEach((k) => { r.celle[k] = spostaRiferimenti(r.celle[k], 'colonna', indice, 1); }));
    x.colonne.splice(indice, 0, { id: uid() + Math.random().toString(36).slice(2, 5), nome: '', formato: formato || 'testo' });
  }

  function eliminaColonna(x, indice) {
    const id = x.colonne[indice].id;
    x.colonne.splice(indice, 1);
    x.righe.forEach((r) => { delete r.celle[id]; Object.keys(r.celle).forEach((k) => { r.celle[k] = spostaRiferimenti(r.celle[k], 'colonna', indice, -1); }); });
    if (!x.colonne.length) x.colonne.push({ id: uid(), nome: '', formato: 'testo' });
  }

  function esportaCsv(x) {
    const calc = calcolatore(x);
    const campo = (s) => /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const righe = [x.colonne.map((c, i) => campo(c.nome || lettera(i))).join(';')];
    x.righe.forEach((r, ri) => {
      const valori = x.colonne.map((c, ci) => {
        const v = calc(ri, ci);
        if (v instanceof ErroreCella) return v.codice;
        if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6).replace('.', ',');
        return campo(v == null ? '' : String(v));
      });
      if (valori.some(Boolean)) righe.push(valori.join(';'));
    });
    const nome = (x.title.trim() || 'griglia').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'griglia';
    A().download(new Blob(['﻿' + righe.join('\r\n')], { type: 'text/csv;charset=utf-8' }), nome + '.csv');
  }

  /* =========================================================
     Startup (cartelle)
     ========================================================= */
  const TIPI = {
    doc: { label: 'Documento', icona: 'i-doc', colore: '--c-consulenza' },
    grid: { label: 'Griglia', icona: 'i-grid', colore: '--c-lavoro' },
    todo: { label: 'To-do', icona: 'i-check', colore: '--c-studio' },
  };
  const COLORI_STARTUP = ['--c-consulenza', '--c-lavoro', '--c-studio', '--c-ricerca', '--s-lanciata'];
  const coloreStartup = (x) => COLORI_STARTUP[[...x.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % COLORI_STARTUP.length];
  const figli = (id) => cyber.vivi().filter((f) => f.parent === id && TIPI[f.type]);

  function descriviFile(f) {
    if (f.type === 'grid') return `${f.righe.filter((r) => Object.keys(r.celle).length).length} righe compilate`;
    if (f.type === 'todo') { const p = avanzamento(f); return `${p.f}/${p.tot} completate`; }
    const w = A().info(f).words;
    return `${w.toLocaleString('it-IT')} ${w === 1 ? 'parola' : 'parole'}`;
  }

  function renderStartupElenco(box) {
    corrente = null;
    const startup = cyber.vivi('startup').sort((a, b) => b.updatedAt - a.updatedAt);
    box.innerHTML = `
      <div class="sp-bar">
        <p class="sp-bar-text">Ogni startup è una cartella: dentro crei documenti, griglie per prezzi e costi, liste to-do.</p>
        <button type="button" class="btn primary" data-st-nuova>${icon('i-plus')}Nuova startup</button>
      </div>
      ${startup.length ? `<div class="st-grid">${startup.map((s) => {
        const f = figli(s.id);
        const conta = Object.keys(TIPI).map((t) => { const n = f.filter((x) => x.type === t).length; return n ? `${n} ${t === 'doc' ? (n === 1 ? 'documento' : 'documenti') : t === 'grid' ? (n === 1 ? 'griglia' : 'griglie') : 'to-do'}` : ''; }).filter(Boolean).join(' · ');
        const ultimo = Math.max(s.updatedAt, ...f.map((x) => x.updatedAt));
        return `<a class="st-card" href="#/cyber/startup/${encodeURIComponent(s.id)}" style="--cat:var(${coloreStartup(s)})">
          <span class="st-folder">${icon('i-folder')}</span>
          <h3 class="${s.title.trim() ? '' : 'untitled'}">${esc(s.title.trim() || 'Senza nome')}</h3>
          <p>${esc(s.descrizione || '')}</p>
          <div class="st-foot"><span>${conta || 'Cartella vuota'}</span><span>${esc(A().relTime(ultimo))}</span></div>
        </a>`;
      }).join('')}</div>` : `
        <div class="empty-state">
          <span class="quick-icon">${icon('i-folder')}</span>
          <h3>Nessuna startup ancora</h3>
          <p>Crea una cartella per ogni startup e inizia a buttare giù prezzi, costi e idee.</p>
          <button type="button" class="btn primary" data-st-nuova>${icon('i-plus')}Crea la prima startup</button>
        </div>`}`;
  }

  function renderStartup(box, s) {
    corrente = null;
    const files = figli(s.id).sort((a, b) => b.updatedAt - a.updatedAt);
    const nuovo = s.createdAt === s.updatedAt && !s.title;
    box.innerHTML = `
      <a class="cy-back" href="#/cyber/startup">${icon('i-back')}Startup</a>
      <header class="st-head" style="--cat:var(${coloreStartup(s)})">
        <span class="st-folder big">${icon('i-folder')}</span>
        <div class="st-head-main">
          <input class="st-name" value="${esc(s.title)}" data-st-campo="title" placeholder="Nome della startup" autocomplete="off">
          <input class="st-desc" value="${esc(s.descrizione)}" data-st-campo="descrizione" placeholder="Una riga: cosa fa e per chi" autocomplete="off">
        </div>
        <button type="button" class="icon-btn" data-st-menu aria-label="Opzioni startup">${icon('i-more')}</button>
      </header>
      <div class="st-new">
        ${Object.entries(TIPI).map(([t, d]) => `
          <button type="button" class="st-new-btn" data-sp-nuovo="${t}" data-parent="${esc(s.id)}" style="--cat:var(${d.colore})">
            <span class="row-icon">${icon(d.icona)}</span>
            <span><strong>Nuov${t === 'grid' ? 'a griglia' : t === 'doc' ? 'o documento' : 'a to-do'}</strong><small>${t === 'doc' ? 'Scrivi liberamente' : t === 'grid' ? 'Prezzi, costi, numeri' : 'Cose da fare'}</small></span>
          </button>`).join('')}
      </div>
      <section class="st-files">
        <h2>File <span>${files.length}</span></h2>
        ${files.length ? `<ul class="cy-list">${files.map((f) => `
          <li class="st-row" style="--cat:var(${TIPI[f.type].colore})">
            <a href="${hrefFile(cyber, f)}">
              <span class="row-icon">${icon(TIPI[f.type].icona)}</span>
              <span class="row-main">
                <span class="row-title ${f.title.trim() ? '' : 'untitled'}">${esc(f.title.trim() || 'Senza titolo')}</span>
                <span class="row-meta">${TIPI[f.type].label} · ${esc(descriviFile(f))} · ${esc(A().relTime(f.updatedAt))}</span>
              </span>
            </a>
            <button type="button" class="icon-btn" data-st-file-menu="${esc(f.id)}" aria-label="Opzioni file">${icon('i-more')}</button>
          </li>`).join('')}</ul>` : '<p class="panel-empty">La cartella è vuota: crea il primo file con i pulsanti qui sopra.</p>'}
      </section>`;
    if (nuovo) box.querySelector('.st-name').focus();
  }

  /* Report liberi del progetto */
  function renderCyberReport(box) {
    corrente = null;
    const docs = cyber.vivi('doc').filter((d) => !d.parent).sort((a, b) => b.updatedAt - a.updatedAt);
    box.innerHTML = `
      <div class="sp-bar">
        <p class="sp-bar-text">Report e appunti liberi sul progetto: nessuno schema, scrivi quello che vuoi.</p>
        <button type="button" class="btn primary" data-sp-nuovo="doc" data-parent="">${icon('i-plus')}Nuovo report</button>
      </div>
      ${docs.length ? `<div class="doc-grid">${docs.map((it) => {
        const inf = A().info(it);
        const title = it.title.trim();
        return `<a class="doc-card" href="#/doc/${encodeURIComponent(it.id)}" style="--cat:var(--c-ricerca)">
          <div class="doc-card-top"><span class="cat-label"><i></i>${esc(it.kind)}</span><span class="doc-date">${esc(A().fmtDate(it.date))}</span></div>
          <h3 class="${title ? '' : 'untitled'}">${esc(title || 'Senza titolo')}</h3>
          <p class="doc-excerpt">${esc(inf.excerpt || 'Nessun testo ancora.')}</p>
          <div class="doc-foot"><span class="who">${esc(it.who || '—')}</span><span>${inf.words.toLocaleString('it-IT')} parole</span></div>
        </a>`;
      }).join('')}</div>` : `
        <div class="empty-state">
          <span class="quick-icon">${icon('i-doc')}</span>
          <h3>Nessun report ancora</h3>
          <p>Pagina bianca, a mano libera: il testo si salva da solo mentre scrivi.</p>
          <button type="button" class="btn primary" data-sp-nuovo="doc" data-parent="">${icon('i-plus')}Scrivi il primo report</button>
        </div>`}`;
  }

  function renderCyberTodo(box) {
    corrente = null;
    box.innerHTML = `<div class="sp-bar"><p class="sp-bar-text">Le cose da fare per il progetto.</p><button type="button" class="btn primary" data-td-nuova="cyber" data-parent="">${icon('i-plus')}Nuova lista</button></div><div id="cy-todo-box"></div>`;
    elencoListe($('cy-todo-box'), cyber, '');
  }

  // Punto d'ingresso dalla sezione cyber: parti = ['cyber', 'startup'|'report'|'todo'|'file', id]
  function renderCyber(parti, box) {
    const sotto = parti[1];
    const id = parti[2] || '';
    if (sotto === 'startup' && id) {
      const s = cyber.get(id);
      if (!s || s.type !== 'startup') { location.replace('#/cyber/startup'); return; }
      renderStartup(box, s);
    } else if (sotto === 'startup') renderStartupElenco(box);
    else if (sotto === 'report') renderCyberReport(box);
    else if (sotto === 'todo') renderCyberTodo(box);
    else if (sotto === 'file') {
      const f = cyber.get(id);
      if (!f || (f.type !== 'grid' && f.type !== 'todo')) { location.replace('#/cyber/startup'); return; }
      const padre = f.parent && cyber.get(f.parent);
      const indietro = padre ? { href: `#/cyber/startup/${encodeURIComponent(padre.id)}`, label: padre.title.trim() || 'Startup' }
        : { href: f.type === 'todo' ? '#/cyber/todo' : '#/cyber/startup', label: f.type === 'todo' ? 'To-do' : 'Startup' };
      if (f.type === 'grid') renderGriglia(box, cyber, f, indietro); else renderListaTodo(box, cyber, f, indietro);
    }
  }

  // Quale scheda della sezione cyber evidenziare
  function schedaCyber(parti) {
    if (parti[1] !== 'file') return parti[1];
    const f = cyber.get(parti[2] || '');
    return f && f.parent ? 'startup' : f && f.type === 'todo' ? 'todo' : 'startup';
  }

  /* =========================================================
     Creazione
     ========================================================= */
  function creaFile(tipo, parent, anchor) {
    if (tipo === 'doc') {
      const now = Date.now();
      const d = cyber.metti(normalizzaElemento({ id: uid(), type: 'doc', parent: parent || '', title: '', kind: 'Report', date: oggiISO(), body: '', createdAt: now, updatedAt: now }), { tocca: false, sincronizza: false });
      A().apriDocumento(d.id);
    } else if (tipo === 'todo') {
      const l = nuovaLista(cyber, parent);
      location.hash = `#/cyber/file/${encodeURIComponent(l.id)}`;
    } else if (tipo === 'grid') {
      apriMenu(anchor, 'Nuova griglia', Object.entries(MODELLI).map(([k, m]) => ({
        label: `${m.nome} — ${m.desc}`, icona: 'i-grid',
        azione: () => { const g = nuovaGriglia(cyber, parent, k); location.hash = `#/cyber/file/${encodeURIComponent(g.id)}`; },
      })));
    }
  }

  function nuovaStartup() {
    const now = Date.now();
    const s = cyber.metti(normalizzaElemento({ id: uid(), type: 'startup', title: '', descrizione: '', createdAt: now, updatedAt: now }), { tocca: false });
    location.hash = `#/cyber/startup/${encodeURIComponent(s.id)}`;
  }

  /* =========================================================
     Integrazione con l'editor dei documenti (app.js)
     ========================================================= */
  const doc = (id) => { const x = cyber.get(id); return x && x.type === 'doc' ? x : null; };

  function indietroDoc(it) {
    if (it.parent && cyber.get(it.parent)) return `#/cyber/startup/${encodeURIComponent(it.parent)}`;
    return '#/cyber/report';
  }
  function etichettaDoc(it) {
    const p = it.parent && cyber.get(it.parent);
    return p ? (p.title.trim() || 'Startup') : 'Progetto cyber';
  }
  function duplicaDoc(it) {
    const now = Date.now();
    const copia = cyber.metti(normalizzaElemento({ ...it, id: uid(), title: (it.title || 'Senza titolo') + ' (copia)', createdAt: now, updatedAt: now + 1 }), { tocca: false });
    return copia.id;
  }

  function contatori() {
    const oggi = oggiISO();
    return {
      giornata: agenda.vivi('appunto').filter((a) => a.giorno === oggi && !a.fatto).length || '',
      todo: agenda.vivi('todo').length || '',
    };
  }

  /* =========================================================
     Eventi
     ========================================================= */
  function correnteElemento() {
    if (!corrente) return null;
    const x = corrente.arch.get(corrente.id);
    return x || null;
  }

  function vaiAppunto(id) { const a = agenda.get(id); return a && a.type === 'appunto' ? a : null; }

  function menuAppunto(anchor, a) {
    const oggi = oggiISO();
    const domani = spostaGiorno(oggi, 1);
    const voci = [];
    if (a.giorno !== oggi) voci.push({ label: 'Sposta a oggi', icona: 'i-arrow', azione: () => { a.giorno = oggi; agenda.metti(a); A().renderSoon(); } });
    if (a.giorno !== domani) voci.push({ label: 'Sposta a domani', icona: 'i-arrow', azione: () => { a.giorno = domani; agenda.metti(a); A().renderSoon(); A().toast('Spostato a domani'); } });
    voci.push({ label: 'Sposta al giorno dopo', icona: 'i-calendar', azione: () => { a.giorno = spostaGiorno(a.giorno || oggi, 1); agenda.metti(a); A().renderSoon(); } });
    voci.push('-', { label: 'Elimina', icona: 'i-trash', pericolo: true, azione: () => { agenda.elimina(a.id); A().renderSoon(); } });
    apriMenu(anchor, a.testo.slice(0, 40), voci);
  }

  function menuFile(anchor, arch, f, dopoElimina) {
    const voci = [
      { label: 'Rinomina', icona: 'i-doc', azione: () => { const t = prompt('Nuovo nome', f.title); if (t !== null) { f.title = t.trim(); arch.metti(f); A().renderSoon(); } } },
      { label: 'Duplica', icona: 'i-copy', azione: () => {
        const now = Date.now();
        const copia = arch.metti(normalizzaElemento({ ...JSON.parse(JSON.stringify(f)), id: uid(), title: (f.title || 'Senza titolo') + ' (copia)', createdAt: now, updatedAt: now + 1 }), { tocca: false });
        A().toast('Duplicato');
        if (dopoElimina) location.hash = hrefFile(arch, copia); else A().renderSoon();
      } },
    ];
    if (arch === cyber) {
      const altre = cyber.vivi('startup').filter((s) => s.id !== f.parent);
      if (altre.length || f.parent) voci.push({ label: 'Sposta in un’altra cartella…', icona: 'i-folder', azione: () => menuSposta(anchor, f) });
    }
    voci.push('-', { label: 'Elimina', icona: 'i-trash', pericolo: true, azione: () => {
      if (!confirm(`Eliminare “${f.title.trim() || 'Senza titolo'}”? Resta recuperabile dalla cronologia su GitHub.`)) return;
      arch.elimina(f.id);
      A().toast('Eliminato');
      if (dopoElimina) location.hash = dopoElimina; else A().renderSoon();
    } });
    apriMenu(anchor, f.title.trim() || TIPI[f.type].label, voci);
  }

  function menuSposta(anchor, f) {
    const voci = cyber.vivi('startup').filter((s) => s.id !== f.parent).sort((a, b) => a.title.localeCompare(b.title, 'it'))
      .map((s) => ({ label: s.title.trim() || 'Senza nome', icona: 'i-folder', azione: () => { f.parent = s.id; cyber.metti(f); A().toast(`Spostato in “${s.title.trim() || 'Senza nome'}”`); A().renderSoon(); } }));
    if (f.parent && f.type !== 'grid') voci.push({ label: f.type === 'doc' ? 'Fuori dalle cartelle (Report)' : 'Fuori dalle cartelle (To-do)', icona: 'i-arrow', azione: () => { f.parent = ''; cyber.metti(f); A().renderSoon(); } });
    setTimeout(() => apriMenu(anchor, 'Sposta in', voci), 0);
  }

  function setup() {
    const menu = $('sp-menu');
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sp-voce]');
      if (!b) return;
      const v = vociMenu[Number(b.dataset.spVoce)];
      A().closeMenus();
      if (v && v.azione) v.azione();
    });

    const main = document.querySelector('.main');

    main.addEventListener('click', (e) => {
      const t = e.target;
      let el;
      if ((el = t.closest('[data-gi-menu]'))) { const a = vaiAppunto(el.dataset.giMenu); if (a) menuAppunto(el, a); return; }
      if ((el = t.closest('[data-gi-porta]'))) { const a = vaiAppunto(el.dataset.giPorta); if (a) { a.giorno = oggiISO(); agenda.metti(a); A().renderSoon(); } return; }
      if (t.closest('[data-gi-porta-tutti]')) {
        const oggi = oggiISO();
        agenda.vivi('appunto').filter((a) => !a.fatto && a.giorno && a.giorno < oggi).forEach((a) => { a.giorno = oggi; agenda.metti(a); });
        A().renderSoon();
        return;
      }
      if ((el = t.closest('[data-td-nuova]'))) {
        const arch = ARCHIVI[el.dataset.tdNuova];
        const l = nuovaLista(arch, el.dataset.parent);
        location.hash = hrefFile(arch, l);
        return;
      }
      if ((el = t.closest('[data-td-elimina]'))) {
        const x = correnteElemento();
        if (!x) return;
        x.voci = x.voci.filter((v) => v.id !== el.dataset.tdElimina);
        corrente.arch.metti(x);
        A().renderSoon();
        return;
      }
      if (t.closest('[data-sp-file-menu]')) {
        const x = correnteElemento();
        if (!x) return;
        const back = corrente.arch === agenda ? '#/todo' : x.parent ? `#/cyber/startup/${encodeURIComponent(x.parent)}` : x.type === 'todo' ? '#/cyber/todo' : '#/cyber/startup';
        menuFile(t.closest('[data-sp-file-menu]'), corrente.arch, x, back);
        return;
      }
      if (t.closest('[data-st-nuova]')) { nuovaStartup(); return; }
      if ((el = t.closest('[data-sp-nuovo]'))) { creaFile(el.dataset.spNuovo, el.dataset.parent, el); return; }
      if ((el = t.closest('[data-st-file-menu]'))) { const f = cyber.get(el.dataset.stFileMenu); if (f) menuFile(el, cyber, f); return; }
      if ((el = t.closest('[data-st-menu]'))) {
        const id = location.hash.split('/')[3];
        const s = cyber.get(decodeURIComponent(id || ''));
        if (!s) return;
        apriMenu(el, s.title.trim() || 'Startup', [{ label: 'Elimina startup e tutti i suoi file', icona: 'i-trash', pericolo: true, azione: () => {
          const f = figli(s.id);
          if (!confirm(`Eliminare “${s.title.trim() || 'Senza nome'}”${f.length ? ` e i suoi ${f.length} file` : ''}? Resta recuperabile dalla cronologia su GitHub.`)) return;
          f.forEach((x) => cyber.elimina(x.id));
          cyber.elimina(s.id);
          location.hash = '#/cyber/startup';
          A().toast('Startup eliminata');
        } }]);
        return;
      }
      // Griglia
      if ((el = t.closest('[data-gr]'))) {
        const x = correnteElemento();
        if (!x || x.type !== 'grid') return;
        const az = el.dataset.gr;
        if (az === 'riga') { const i = aggiungiRiga(x); corrente.arch.metti(x); A().renderSoon(); setTimeout(() => focusCella(i, 0), 260); }
        else if (az === 'colonna') { aggiungiColonna(x, x.colonne.length); corrente.arch.metti(x); A().renderSoon(); setTimeout(() => { const n = document.querySelector(`[data-gr-nome="${x.colonne.length - 1}"]`); if (n) n.focus(); }, 260); }
        else if (az === 'totali') { x.totali = !x.totali; corrente.arch.metti(x); A().renderSoon(); }
        else if (az === 'csv') esportaCsv(x);
        else if (az === 'aiuto') { const h = $('gr-help'); h.hidden = !h.hidden; }
        return;
      }
      if ((el = t.closest('[data-gr-colmenu]'))) {
        const x = correnteElemento();
        if (!x) return;
        const ci = Number(el.dataset.grColmenu);
        const col = x.colonne[ci];
        const salva = () => { corrente.arch.metti(x); A().renderSoon(); };
        apriMenu(el, `Colonna ${lettera(ci)}${col.nome ? ' · ' + col.nome : ''}`, [
          ...Object.entries(FORMATI).map(([k, l]) => ({ label: l, attiva: col.formato === k, azione: () => { col.formato = k; salva(); } })),
          '-',
          { label: 'Inserisci colonna a sinistra', icona: 'i-plus', azione: () => { aggiungiColonna(x, ci); salva(); } },
          { label: 'Inserisci colonna a destra', icona: 'i-plus', azione: () => { aggiungiColonna(x, ci + 1); salva(); } },
          '-',
          { label: 'Elimina colonna', icona: 'i-trash', pericolo: true, azione: () => { if (confirm(`Eliminare la colonna ${lettera(ci)}${col.nome ? ` (${col.nome})` : ''} e i suoi valori?`)) { eliminaColonna(x, ci); salva(); } } },
        ]);
        return;
      }
      if ((el = t.closest('[data-gr-rigamenu]'))) {
        const x = correnteElemento();
        if (!x) return;
        const ri = Number(el.dataset.grRigamenu);
        const salva = () => { corrente.arch.metti(x); A().renderSoon(); };
        apriMenu(el, `Riga ${ri + 1}`, [
          { label: 'Inserisci riga sopra', icona: 'i-plus', azione: () => { aggiungiRiga(x, ri - 1); salva(); } },
          { label: 'Inserisci riga sotto', icona: 'i-plus', azione: () => { aggiungiRiga(x, ri); salva(); } },
          '-',
          { label: 'Elimina riga', icona: 'i-trash', pericolo: true, azione: () => { eliminaRiga(x, ri); salva(); } },
        ]);
      }
    });

    main.addEventListener('submit', (e) => {
      const f = e.target;
      if (f.id === 'gi-add' || f.id === 'home-gi-add') {
        e.preventDefault();
        const inp = f.querySelector('[name="testo"]');
        const ora = f.querySelector('[name="ora"]');
        if (nuovoAppunto(f.dataset.giorno, inp.value, ora ? ora.value : '')) {
          inp.value = '';
          if (ora) { ora.value = ''; ora.classList.add('vuota'); }
          inp.focus();
          A().renderSoon();
        }
      } else if (f.id === 'td-add') {
        e.preventDefault();
        const x = correnteElemento();
        const inp = $('td-nuova');
        if (!x || !inp.value.trim()) return;
        x.voci.push({ id: uid(), testo: inp.value.trim(), fatto: false });
        corrente.arch.metti(x);
        const lista = $('td-aperte');
        lista.insertAdjacentHTML('beforeend', vociTodo({ voci: [x.voci[x.voci.length - 1]] }, false));
        cresci(lista.lastElementChild.querySelector('textarea'));
        inp.value = '';
        inp.focus();
        aggiornaContaTodo(x);
      }
    });

    main.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.giFatto) { const a = vaiAppunto(t.dataset.giFatto); if (a) { a.fatto = t.checked; agenda.metti(a); setTimeout(() => A().renderSoon(), 250); } return; }
      if (t.dataset.giOra !== undefined && t.matches('[data-gi-ora]')) { const a = vaiAppunto(t.dataset.giOra); if (a) { a.ora = t.value; agenda.metti(a); A().renderSoon(); } return; }
      if (t.matches('[data-gi-testo]')) {
        const a = vaiAppunto(t.dataset.giTesto);
        if (!a) return;
        if (!t.value.trim()) { agenda.elimina(a.id); A().renderSoon(); return; }
        a.testo = t.value.trim(); agenda.metti(a);
        return;
      }
      if (t.id === 'gi-picker' && DATA_RE.test(t.value)) { location.hash = `#/giornata?d=${t.value}`; return; }
      if (t.matches('.gi-add .gi-ora')) { t.classList.toggle('vuota', !t.value); return; }
      if (t.dataset.tdFatto) {
        const x = correnteElemento();
        const v = x && x.voci.find((y) => y.id === t.dataset.tdFatto);
        if (!v) return;
        v.fatto = t.checked;
        corrente.arch.metti(x);
        t.closest('.td-item').classList.toggle('done', v.fatto);
        aggiornaContaTodo(x);
        setTimeout(() => A().renderSoon(), 350);
      }
    });

    main.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('[data-sp-titolo]')) {
        const x = correnteElemento();
        if (!x) return;
        x.title = t.value.replace(/\n/g, ' ');
        cresci(t);
        corrente.arch.metti(x);
        return;
      }
      if (t.matches('[data-td-testo]')) {
        const x = correnteElemento();
        const v = x && x.voci.find((y) => y.id === t.dataset.tdTesto);
        if (!v) return;
        v.testo = t.value.replace(/\n/g, ' ');
        cresci(t);
        corrente.arch.metti(x);
        return;
      }
      if (t.matches('[data-st-campo]')) {
        const s = cyber.get(decodeURIComponent(location.hash.split('/')[3] || ''));
        if (!s) return;
        s[t.dataset.stCampo] = t.value;
        cyber.metti(s);
        return;
      }
      if (t.matches('[data-gr-nome]')) {
        const x = correnteElemento();
        if (!x) return;
        const col = x.colonne[Number(t.dataset.grNome)];
        if (col) { col.nome = t.value; corrente.arch.metti(x); }
        return;
      }
      if (t.matches('.gr-cell')) {
        const x = correnteElemento();
        if (!x) return;
        const riga = x.righe[Number(t.dataset.r)], col = x.colonne[Number(t.dataset.c)];
        if (!riga || !col) return;
        if (t.value === '') delete riga.celle[col.id]; else riga.celle[col.id] = t.value;
        corrente.arch.metti(x);
        ricalcolaPresto();
      }
    });

    const ricalcolaPresto = debounce(() => { const x = correnteElemento(); if (x && x.type === 'grid') ricalcolaGriglia(x); }, 350);

    // Celle: in modifica si vede la formula/il valore scritto, fuori il valore formattato.
    main.addEventListener('focusin', (e) => {
      const t = e.target;
      if (!t.matches('.gr-cell')) return;
      const x = correnteElemento();
      const riga = x && x.righe[Number(t.dataset.r)], col = x && x.colonne[Number(t.dataset.c)];
      if (!riga || !col) return;
      t.value = riga.celle[col.id] || '';
      t.closest('tr').classList.add('attiva');
      if (!A().isPhone()) t.select();
    });
    main.addEventListener('focusout', (e) => {
      const t = e.target;
      if (t.matches('.gr-cell')) {
        t.closest('tr').classList.remove('attiva');
        const x = correnteElemento();
        if (x && x.type === 'grid') setTimeout(() => ricalcolaGriglia(x), 0);
      }
      if (t.matches('[data-st-campo], [data-sp-titolo], [data-gr-nome]')) A().renderNavSoon();
    });

    main.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.matches('[data-gi-testo]') && e.key === 'Enter') { e.preventDefault(); t.blur(); return; }
      if (t.matches('[data-sp-titolo]') && e.key === 'Enter') {
        e.preventDefault();
        const next = document.querySelector('#td-nuova, .gr-cell');
        if (next) next.focus();
        return;
      }
      if (t.matches('[data-td-testo]')) {
        const x = correnteElemento();
        if (!x) return;
        const i = x.voci.findIndex((y) => y.id === t.dataset.tdTesto);
        if (e.key === 'Enter') {
          e.preventDefault();
          const nuova = { id: uid(), testo: '', fatto: false };
          x.voci.splice(i + 1, 0, nuova);
          corrente.arch.metti(x);
          t.closest('.td-item').insertAdjacentHTML('afterend', vociTodo({ voci: [nuova] }, false));
          t.closest('.td-item').nextElementSibling.querySelector('textarea').focus();
          aggiornaContaTodo(x);
        } else if (e.key === 'Backspace' && !t.value) {
          e.preventDefault();
          const li = t.closest('.td-item');
          const prima = li.previousElementSibling && li.previousElementSibling.querySelector('textarea');
          x.voci.splice(i, 1);
          corrente.arch.metti(x);
          li.remove();
          if (prima) { prima.focus(); prima.setSelectionRange(prima.value.length, prima.value.length); } else $('td-nuova').focus();
          aggiornaContaTodo(x);
        }
        return;
      }
      if (t.matches('.gr-cell')) {
        const r = Number(t.dataset.r), c = Number(t.dataset.c);
        const x = correnteElemento();
        if (!x) return;
        if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.altKey)) {
          e.preventDefault();
          if (r + 1 >= x.righe.length && e.key === 'Enter') { aggiungiRiga(x); corrente.arch.metti(x); A().renderView(); }
          focusCella(r + 1, c);
        } else if (e.key === 'ArrowUp') { e.preventDefault(); focusCella(r - 1, c); }
        else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length && t.selectionEnd === t.value.length) { e.preventDefault(); focusCella(r, c + 1); }
        else if (e.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) { e.preventDefault(); focusCella(r, c - 1); }
        else if (e.key === 'Escape') { t.blur(); }
      }
    });

    // Incolla da Excel/Fogli: le celle copiate si distribuiscono nella griglia.
    main.addEventListener('paste', (e) => {
      const t = e.target;
      if (!t.matches('.gr-cell')) return;
      const testo = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(testo.replace(/\r?\n$/, ''))) return;
      e.preventDefault();
      const x = correnteElemento();
      if (!x) return;
      const r0 = Number(t.dataset.r), c0 = Number(t.dataset.c);
      const righe = testo.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
      righe.forEach((valori, dr) => {
        while (r0 + dr >= x.righe.length) x.righe.push({ id: uid(), celle: {} });
        valori.forEach((v, dc) => {
          while (c0 + dc >= x.colonne.length) aggiungiColonna(x, x.colonne.length);
          const col = x.colonne[c0 + dc];
          const val = v.trim();
          if (val) x.righe[r0 + dr].celle[col.id] = val; else delete x.righe[r0 + dr].celle[col.id];
        });
      });
      corrente.arch.metti(x);
      t.blur();
      A().renderView();
      A().toast(`Incollate ${righe.length} ${righe.length === 1 ? 'riga' : 'righe'}`);
    });

    // Sincronizzazione: al ritorno sulla scheda, prima di chiudere e ogni 30 secondi.
    document.addEventListener('visibilitychange', () => {
      [agenda, cyber].forEach((s) => {
        if (document.visibilityState === 'hidden') { s.salvaOra(); if (s.stato === 'pending' || s.stato === 'error') s.sincronizza(); }
        else s.sincronizza();
      });
    });
    window.addEventListener('pagehide', () => { agenda.salvaOra(); cyber.salvaOra(); });
    window.addEventListener('online', () => { agenda.sincronizza(); cyber.sincronizza(); });
    window.addEventListener('storage', (e) => {
      const s = [agenda, cyber].find((x) => x.chiaveLocale === e.key);
      if (!s) return;
      s.ricaricaDaLocale();
      arrivateNovita();
    });
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      [agenda, cyber].forEach((s) => { if (!s.inCorso && s.stato !== 'pending') s.sincronizza(); });
    }, 30000);
  }

  function focusCella(r, c) {
    const inp = document.querySelector(`.gr-cell[data-r="${r}"][data-c="${c}"]`);
    if (inp) { inp.focus(); inp.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }

  function avvia() {
    if (!A().connected()) return;
    agenda.sincronizza();
    cyber.sincronizza();
  }

  function haModifichePendenti() { return [agenda, cyber].some((s) => s.stato === 'pending'); }

  window.Spazio = {
    setup, avvia, statoSync, haModifichePendenti,
    sincronizza: () => { agenda.sincronizza(); cyber.sincronizza(); },
    renderGiornata, renderTodoView, renderCyber, schedaCyber, renderHome, contatori,
    doc, possiede: (id) => Boolean(doc(id)),
    salvata: (it) => cyber.metti(it, { tocca: false }),
    elimina: (id) => cyber.elimina(id),
    duplicaDoc, indietroDoc, etichettaDoc,
    nuovaListaReport: () => { const l = nuovaLista(agenda, ''); location.hash = hrefFile(agenda, l); },
    // per i test
    _interni: { leggiNumero, calcolatore, spostaRiferimenti, copiaFormulaGiu, normalizza, unisci, serializza, mostraValore, archivioDi },
  };
})();
