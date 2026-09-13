/* Progetto cyber — sezione del sito.
 *
 * I dati stanno nel repository privato "progetto-cyber" e si leggono con il token.
 * Le regole di riservatezza e il formato delle conversazioni NON sono copiati qui:
 * vengono caricati dal repository (scripts/regole-riservatezza.mjs e
 * scripts/formato-conversazione.mjs), così sito, script e hook usano le stesse regole.
 *
 * Rotte:
 *   #/cyber                                  → conversazioni (il cruscotto arriverà al passo 2)
 *   #/cyber/conversazioni                    → elenco
 *   #/cyber/conversazioni/nuova              → registrazione guidata
 *   #/cyber/conversazioni/<file>             → dettaglio
 *   #/cyber/conversazioni/<file>/modifica    → modifica guidata
 */
(() => {
  'use strict';

  const A = () => window.Archivio; // funzioni condivise esposte da app.js
  const $ = (id) => document.getElementById(id);
  const LS_CACHE = 'cyber.cache.v1';
  const LS_BOZZA = 'cyber.bozza.v1';
  const LS_FILTRO = 'cyber.filtro.v1';

  const stato = {
    moduli: null,        // { regole, formato }
    albero: null,        // [{ path, sha, size }]
    conversazioni: [],   // [{ path, sha, dati }]
    assunzioni: [],
    caricatoIl: 0,
    caricamento: null,
    errore: '',
  };

  const repo = () => A().cfg().cyberRepo || 'progetto-cyber';
  const leggiCache = () => A().load(LS_CACHE, { blob: {}, moduli: {} });
  const scriviCache = (c) => A().store(LS_CACHE, c);

  /* ------------------------------ Dati ------------------------------ */

  async function api(percorso, opzioni) {
    const r = await A().gh(percorso, opzioni, repo());
    if (!r.ok && !(opzioni && opzioni.okStatus && opzioni.okStatus.includes(r.status))) throw await A().httpError(r, repo());
    return r;
  }

  // Legge un file del repository conoscendone lo sha, usando la cache del dispositivo.
  async function blob(sha, cache) {
    if (cache.blob[sha] !== undefined) return cache.blob[sha];
    const r = await api(`git/blobs/${sha}`);
    const testo = A().fromB64((await r.json()).content || '');
    cache.blob[sha] = testo;
    return testo;
  }

  async function importaModulo(codice) {
    const url = URL.createObjectURL(new Blob([codice], { type: 'text/javascript' }));
    try { return await import(url); } finally { URL.revokeObjectURL(url); }
  }

  // Restituisce true solo se ha scaricato dati nuovi (serve a non ridisegnare a vuoto).
  async function carica(forza) {
    if (!A().connected()) return false;
    if (stato.caricamento) return stato.caricamento;
    if (!forza && stato.albero && Date.now() - stato.caricatoIl < 60000) return false;
    // Dopo un errore non si riprova a raffica: si aspetta 30 secondi (o un aggiornamento esplicito).
    if (!forza && stato.errore && Date.now() - (stato.erroreIl || 0) < 30000) return false;
    stato.caricamento = (async () => {
      const cache = leggiCache();
      try {
        const r = await api(`git/trees/main?recursive=1&t=${Date.now()}`);
        const albero = (await r.json()).tree.filter((e) => e.type === 'blob');
        const sha = (p) => (albero.find((e) => e.path === p) || {}).sha;

        // Moduli condivisi (regole e formato)
        const mod = {};
        for (const [nome, p] of [['regole', 'scripts/regole-riservatezza.mjs'], ['formato', 'scripts/formato-conversazione.mjs']]) {
          const s = sha(p);
          if (!s) throw new Error(`manca ${p} nel repository`);
          mod[nome] = await importaModulo(await blob(s, cache));
          cache.moduli[nome] = s;
        }

        const sa = sha('assunzioni.json');
        const assunzioni = sa ? (JSON.parse(await blob(sa, cache)).assunzioni || []) : [];

        const voci = albero.filter((e) => /^conversazioni\/[^/]+\.md$/.test(e.path) && !/README\.md$/.test(e.path));
        const conversazioni = [];
        // Scarica in parallelo (a gruppi) solo i file non ancora in cache
        for (let i = 0; i < voci.length; i += 6) {
          const gruppo = await Promise.all(voci.slice(i, i + 6).map(async (v) => {
            try { return { path: v.path, sha: v.sha, dati: mod.formato.analizza(await blob(v.sha, cache)) }; }
            catch (e) { return { path: v.path, sha: v.sha, errore: e.message }; }
          }));
          conversazioni.push(...gruppo);
        }

        // La cache tiene solo i file ancora presenti
        const vivi = new Set([...albero.map((e) => e.sha)]);
        Object.keys(cache.blob).forEach((k) => { if (!vivi.has(k)) delete cache.blob[k]; });
        scriviCache(cache);

        Object.assign(stato, { moduli: mod, albero, assunzioni, conversazioni, caricatoIl: Date.now(), errore: '' });
        return true;
      } catch (e) {
        stato.errore = e.message || String(e);
        stato.erroreIl = Date.now();
        // Senza rete: si lavora con quanto già in cache
        if (!stato.moduli && cache.moduli.regole && cache.blob[cache.moduli.regole]) {
          try {
            stato.moduli = { regole: await importaModulo(cache.blob[cache.moduli.regole]), formato: await importaModulo(cache.blob[cache.moduli.formato]) };
          } catch { /* niente */ }
        }
        return true;
      } finally {
        stato.caricamento = null;
      }
    })();
    return stato.caricamento;
  }

  async function salvaFile(path, testo, messaggio, shaPrecedente) {
    const body = { message: messaggio, content: A().toB64(testo), branch: 'main' };
    if (shaPrecedente) body.sha = shaPrecedente;
    const r = await A().gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify(body) }, repo());
    if (!r.ok) throw await A().httpError(r, repo());
    return (await r.json()).content.sha;
  }

  async function eliminaFile(path, sha, messaggio) {
    const r = await A().gh(`contents/${path}`, { method: 'DELETE', body: JSON.stringify({ message: messaggio, sha, branch: 'main' }) }, repo());
    if (!r.ok) throw await A().httpError(r, repo());
  }

  /* ---------------------------- Utilità ---------------------------- */

  const esc = (s) => A().esc(s);
  const icon = (id) => A().icon(id);
  const oggi = () => A().today();
  const slug = (path) => path.replace(/^conversazioni\//, '').replace(/\.md$/, '');
  const dataBreve = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', ''); };
  const meseLungo = (ym) => { const [y, m] = ym.split('-').map(Number); const s = new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); };
  const valide = () => stato.conversazioni.filter((c) => c.dati).sort((a, b) => b.dati.data.localeCompare(a.dati.data) || b.path.localeCompare(a.path));

  function giorniFa(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - n));
    return dt.toISOString().slice(0, 10);
  }

  /* --------------------------- Rendering --------------------------- */

  const SCHEDE = [
    ['startup', 'Startup', 'i-folder'],
    ['report', 'Report', 'i-doc'],
    ['todo', 'To-do', 'i-check'],
    ['conversazioni', 'Conversazioni', 'i-users'],
  ];

  function render(view) {
    const box = $('cy-content');
    const parti = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').map(decodeURIComponent);
    // parti: ['cyber', 'conversazioni', <file>|'nuova', 'modifica']  ·  ['cyber', 'startup'|'report'|'todo'|'file', <id>]
    if (parti.length === 1 || !parti[1]) { location.replace('#/cyber/startup'); return; }

    // Startup, report liberi e to-do stanno in spazio.js
    const scheda = parti[1] === 'conversazioni' ? 'conversazioni' : window.Spazio.schedaCyber(parti);
    $('cy-tabs').innerHTML = SCHEDE.map(([k, l, i]) => `<a href="#/cyber/${k}" aria-pressed="${scheda === k}">${icon(i)}${l}</a>`).join('');
    $('cy-title').textContent = (SCHEDE.find((s) => s[0] === scheda) || SCHEDE[0])[1];
    if (parti[1] !== 'conversazioni') {
      if (!['startup', 'report', 'todo', 'file'].includes(parti[1])) { location.replace('#/cyber/startup'); return; }
      chiudiGuida();
      window.Spazio.renderCyber(parti, box);
      return;
    }

    if (!A().connected()) {
      box.innerHTML = `<div class="connect-banner"><svg><use href="#i-shield"/></svg>
        <div><strong>I dati del progetto sono nel repository privato</strong><span>Collega questo dispositivo con il token (deve includere progetto-cyber).</span></div>
        <a class="btn" href="#/impostazioni">Collega</a></div>`;
      return;
    }

    const sotto = parti[2];
    if (sotto === 'nuova' || parti[3] === 'modifica') {
      apriGuida(sotto === 'nuova' ? null : `conversazioni/${sotto}.md`);
    } else {
      chiudiGuida();
    }

    if (!stato.albero) {
      box.innerHTML = stato.errore
        ? `<div class="empty-state"><span class="quick-icon">${icon('i-alert')}</span><h3>Progetto non disponibile</h3><p>${esc(stato.errore)}</p><a class="btn" href="#/impostazioni">Controlla le impostazioni</a></div>`
        : '<div class="ev-loading"><span></span><span></span></div>';
      carica().then((nuovi) => { if (nuovi && location.hash.startsWith('#/cyber')) render(view); });
      return;
    }
    carica().then((nuovi) => { if (nuovi && location.hash.startsWith('#/cyber')) render(view); });

    if (sotto && sotto !== 'nuova') renderDettaglio(box, `conversazioni/${sotto}.md`);
    else renderElenco(box);
  }

  function renderElenco(box) {
    const tutte = valide();
    const mese = oggi().slice(0, 7);
    const delMese = tutte.filter((c) => c.dati.data.startsWith(mese)).length;
    const ultime4 = tutte.filter((c) => c.dati.data >= giorniFa(oggi(), 27)).length;
    const filtro = A().load(LS_FILTRO, '');
    const settori = [...new Set(tutte.map((c) => c.dati.settore))].sort((a, b) => a.localeCompare(b, 'it'));
    const elenco = tutte.filter((c) => !filtro || c.dati.settore === filtro);
    const rotte = stato.conversazioni.filter((c) => c.errore);
    const idAss = Object.fromEntries(stato.assunzioni.map((a) => [a.id, a]));

    // Raggruppa per mese
    const gruppi = [];
    for (const c of elenco) {
      const k = c.dati.data.slice(0, 7);
      if (!gruppi.length || gruppi[gruppi.length - 1].k !== k) gruppi.push({ k, voci: [] });
      gruppi[gruppi.length - 1].voci.push(c);
    }

    box.innerHTML = `
      <div class="cy-counter">
        <div class="cy-counter-main">
          <b>${delMese}</b>
          <span>${delMese === 1 ? 'conversazione' : 'conversazioni'} a ${esc(meseLungo(mese).split(' ')[0].toLowerCase())}</span>
        </div>
        <dl class="cy-counter-side">
          <div><dt>Ultime 4 settimane</dt><dd>${ultime4}</dd></div>
          <div><dt>Totale</dt><dd>${tutte.length}</dd></div>
          <div><dt>Verso il business plan</dt><dd>${Math.min(tutte.length, 15)}/15</dd></div>
        </dl>
        <a class="btn primary cy-new" href="#/cyber/conversazioni/nuova">${icon('i-plus')}Nuova conversazione</a>
      </div>

      ${rotte.length ? `<p class="cy-warn">${icon('i-alert')} ${rotte.length} file non leggibili: ${rotte.map((c) => esc(c.path)).join(', ')}</p>` : ''}
      ${stato.errore ? `<p class="cy-warn">${icon('i-alert')} Dati non aggiornati: ${esc(stato.errore)}</p>` : ''}

      ${tutte.length ? `
        <div class="cy-toolbar">
          <select class="select" id="cy-settore" aria-label="Settore">
            <option value="">Tutti i settori (${tutte.length})</option>
            ${settori.map((s) => `<option value="${esc(s)}" ${s === filtro ? 'selected' : ''}>${esc(s)} (${tutte.filter((c) => c.dati.settore === s).length})</option>`).join('')}
          </select>
        </div>
        ${gruppi.map((g) => `
          <section class="cy-month">
            <h2>${esc(meseLungo(g.k))} <span>${g.voci.length}</span></h2>
            <ul class="cy-list">
              ${g.voci.map((c) => `
                <li><a class="cy-row" href="#/cyber/conversazioni/${encodeURIComponent(slug(c.path))}">
                  <span class="cy-date">${esc(dataBreve(c.dati.data))}</span>
                  <span class="cy-main">
                    <span class="cy-who"><b>${esc(c.dati.iniziali)}</b> · ${esc(c.dati.settore)} · ${esc(c.dati.dimensione)} · ${esc(c.dati.provincia)}${c.dati.ricontattabile ? ` <span class="cy-recall" title="Ricontattabile">${icon('i-phone')}</span>` : ''}</span>
                    <span class="cy-quote">${esc(c.dati.cosa_ha_detto.replace(/\s+/g, ' ').slice(0, 160))}${c.dati.cosa_ha_detto.length > 160 ? '…' : ''}</span>
                    ${c.dati.assunzioni.length ? `<span class="cy-tags">${c.dati.assunzioni.map((a) => `<span class="cy-tag ${a.esito}" title="${esc((idAss[a.id] || {}).testo || '')}">${a.esito === 'conferma' ? '✓' : '✗'} ${esc(a.id)}</span>`).join('')}</span>` : ''}
                  </span>
                </a></li>`).join('')}
            </ul>
          </section>`).join('')}
      ` : `
        <div class="empty-state">
          <span class="quick-icon">${icon('i-users')}</span>
          <h3>Nessuna conversazione ancora</h3>
          <p>La prima conversazione vera vale più di qualsiasi documento. Dopo il prossimo appuntamento, due minuti qui.</p>
        </div>`}
    `;
    const sel = $('cy-settore');
    if (sel) sel.onchange = () => { A().store(LS_FILTRO, sel.value); renderElenco(box); };
  }

  function renderDettaglio(box, path) {
    const c = stato.conversazioni.find((x) => x.path === path);
    if (!c) { box.innerHTML = `<p class="cy-warn">Conversazione non trovata.</p><a class="btn" href="#/cyber/conversazioni">Torna all'elenco</a>`; return; }
    if (!c.dati) { box.innerHTML = `<p class="cy-warn">${icon('i-alert')} File non leggibile: ${esc(c.errore)}</p><a class="btn" href="#/cyber/conversazioni">Torna all'elenco</a>`; return; }
    const d = c.dati;
    const idAss = Object.fromEntries(stato.assunzioni.map((a) => [a.id, a]));
    const lunga = (iso) => { const [y, m, g] = iso.split('-').map(Number); return new Date(y, m - 1, g).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
    box.innerHTML = `
      <a class="cy-back" href="#/cyber/conversazioni">${icon('i-back')}Conversazioni</a>
      <article class="cy-detail">
        <header>
          <p class="cy-detail-date">${esc(lunga(d.data))}</p>
          <h2><b>${esc(d.iniziali)}</b> · ${esc(d.settore)}</h2>
          <p class="cy-detail-meta">${esc(d.dimensione)} · provincia ${esc(d.provincia)} · ${esc(d.come_e_nata)} · ${d.ricontattabile ? 'ricontattabile' : 'non ricontattabile'}</p>
        </header>
        <section><h3>Cosa ha detto</h3><blockquote>${esc(d.cosa_ha_detto)}</blockquote></section>
        ${d.sorpresa ? `<section><h3>Cosa mi ha sorpreso</h3><p class="cy-pre">${esc(d.sorpresa)}</p></section>` : ''}
        <section><h3>Assunzioni</h3>
          ${d.assunzioni.length ? `<ul class="cy-ass">${d.assunzioni.map((a) => `<li class="${a.esito}"><span class="cy-tag ${a.esito}">${a.esito === 'conferma' ? '✓ conferma' : '✗ smentisce'}</span> ${esc((idAss[a.id] || { testo: a.id }).testo)}</li>`).join('')}</ul>` : '<p class="muted">Nessuna assunzione collegata.</p>'}
        </section>
        <footer class="cy-actions">
          <a class="btn" href="#/cyber/conversazioni/${encodeURIComponent(slug(path))}/modifica">Modifica</a>
          <button class="btn ghost danger-text" type="button" data-cy-elimina="${esc(path)}">${icon('i-trash')}Elimina</button>
        </footer>
      </article>`;
    box.querySelector('[data-cy-elimina]').onclick = async () => {
      if (!confirm(`Eliminare la conversazione del ${dataBreve(d.data)} con ${d.iniziali}? Resterà solo nella cronologia di GitHub.`)) return;
      try {
        await eliminaFile(path, c.sha, `Elimina conversazione del ${d.data} (dal sito)`);
        stato.conversazioni = stato.conversazioni.filter((x) => x.path !== path);
        A().toast('Conversazione eliminata');
        location.hash = '#/cyber/conversazioni';
        carica(true);
      } catch (e) {
        A().toast('Non eliminata: ' + e.message);
      }
    };
  }

  /* ------------------------ Registrazione guidata ------------------------ */

  let guida = null; // { passo, dati, path, sha, avvisoVisto }

  function passi() {
    const F = stato.moduli.formato;
    const settori = [...new Set([...valide().map((c) => c.dati.settore), ...F.SETTORI_SUGGERITI])];
    return [
      { id: 'data', titolo: 'Quando avete parlato?', tipo: 'data' },
      { id: 'iniziali', titolo: 'Iniziali della persona', aiuto: 'Solo le iniziali, per esempio M.R. Mai il nome.', tipo: 'iniziali' },
      { id: 'settore', titolo: 'Settore', tipo: 'libera', opzioni: settori.slice(0, 14), controlla: true },
      { id: 'dimensione', titolo: "Quante persone lavorano nell'azienda?", tipo: 'scelta', opzioni: F.DIMENSIONI },
      { id: 'provincia', titolo: 'Provincia', tipo: 'scelta', opzioni: F.PROVINCE },
      { id: 'come_e_nata', titolo: 'Come è nata la conversazione?', tipo: 'libera', opzioni: F.ORIGINI_SUGGERITE, controlla: true },
      { id: 'cosa_ha_detto', titolo: 'Cosa ha detto, con le sue parole', aiuto: 'Frasi testuali, anche imperfette. Niente nomi, contatti o cifre riferibili a lui.', tipo: 'testo', controlla: true },
      { id: 'sorpresa', titolo: 'Cosa ti ha sorpreso?', aiuto: 'Facoltativo.', tipo: 'testo', facoltativo: true, controlla: true },
      { id: 'assunzioni', titolo: 'Conferma o smentisce qualche assunzione?', aiuto: 'Tocca per scegliere: conferma, smentisce, nessuna.', tipo: 'assunzioni' },
      { id: 'ricontattabile', titolo: 'È ricontattabile?', tipo: 'scelta', opzioni: ['Sì', 'No'] },
      { id: 'riepilogo', titolo: 'Controlla e salva', tipo: 'riepilogo' },
    ];
  }

  function apriGuida(path) {
    if (!stato.moduli) return; // arriverà dopo il caricamento
    const el = $('cy-wizard');
    const chiave = path || 'nuova';
    if (!guida || guida.chiave !== chiave) {
      const bozza = A().load(LS_BOZZA, null);
      if (bozza && bozza.chiave === chiave) {
        guida = bozza;
      } else if (path) {
        const c = stato.conversazioni.find((x) => x.path === path);
        if (!c || !c.dati) { A().toast('Conversazione non trovata'); location.replace('#/cyber/conversazioni'); return; }
        guida = { chiave, passo: 0, dati: JSON.parse(JSON.stringify(c.dati)), path, sha: c.sha };
      } else {
        guida = { chiave, passo: 0, dati: { data: oggi(), provincia: 'BA', assunzioni: [], sorpresa: '' } };
      }
    }
    el.hidden = false;
    document.body.classList.add('writing');
    disegnaPasso();
  }

  function chiudiGuida() {
    const el = $('cy-wizard');
    if (!el || el.hidden) return;
    el.hidden = true;
    document.body.classList.remove('writing');
  }

  const salvaBozza = () => { if (guida) A().store(LS_BOZZA, guida); };
  const scartaBozza = () => { A().store(LS_BOZZA, null); guida = null; };

  function disegnaPasso(messaggio) {
    const el = $('cy-wizard');
    const P = passi();
    const p = P[guida.passo];
    const d = guida.dati;
    const val = d[p.id];
    let campo = '';

    if (p.tipo === 'data') {
      campo = `<input class="cy-input" type="date" id="cy-campo" value="${esc(val || oggi())}" max="${oggi()}">`;
    } else if (p.tipo === 'iniziali') {
      campo = `<input class="cy-input cy-initials" id="cy-campo" value="${esc(val || '')}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="M.R." maxlength="8" enterkeyhint="next">`;
    } else if (p.tipo === 'scelta') {
      const attuale = p.id === 'ricontattabile' ? (val === true ? 'Sì' : val === false ? 'No' : '') : val;
      campo = `<div class="cy-choices">${p.opzioni.map((o) => `<button type="button" class="cy-choice ${o === attuale ? 'on' : ''}" data-cy-scelta="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    } else if (p.tipo === 'libera') {
      campo = `<div class="cy-chips">${p.opzioni.map((o) => `<button type="button" class="cy-chip ${o === val ? 'on' : ''}" data-cy-chip="${esc(o)}">${esc(o)}</button>`).join('')}</div>
        <input class="cy-input" id="cy-campo" value="${esc(val || '')}" placeholder="…oppure scrivi" autocomplete="off" enterkeyhint="next">`;
    } else if (p.tipo === 'testo') {
      campo = `<textarea class="cy-input cy-text" id="cy-campo" rows="7" placeholder="${p.facoltativo ? 'Facoltativo' : ''}">${esc(val || '')}</textarea>`;
    } else if (p.tipo === 'assunzioni') {
      campo = stato.assunzioni.length ? `<ul class="cy-ass-pick">${stato.assunzioni.map((a) => {
        const scelta = (d.assunzioni.find((x) => x.id === a.id) || {}).esito || '';
        return `<li><p><span class="cy-grav ${esc(a.gravita)}">${esc(a.gravita)}</span> ${esc(a.testo)}</p>
          <div class="segmented small">
            <button type="button" data-cy-ass="${esc(a.id)}" data-val="" aria-pressed="${!scelta}">—</button>
            <button type="button" data-cy-ass="${esc(a.id)}" data-val="conferma" aria-pressed="${scelta === 'conferma'}">Conferma</button>
            <button type="button" data-cy-ass="${esc(a.id)}" data-val="smentisce" aria-pressed="${scelta === 'smentisce'}">Smentisce</button>
          </div></li>`;
      }).join('')}</ul>` : '<p class="muted">Nessuna assunzione in assunzioni.json.</p>';
    } else if (p.tipo === 'riepilogo') {
      const F = stato.moduli.formato;
      const errori = F.valida(d, stato.assunzioni.map((a) => a.id));
      campo = `<div class="cy-summary"><pre>${esc(F.serializza(d))}</pre></div>
        ${errori.length ? `<div class="cy-msg err">${icon('i-alert')}<div><b>Da correggere:</b><br>${errori.map(esc).join('<br>')}</div></div>` : ''}`;
    }

    const ultimo = guida.passo === P.length - 1;
    el.innerHTML = `
      <header class="cy-w-top">
        <button class="icon-btn" type="button" data-cy-azione="esci" aria-label="Chiudi">${icon('i-x')}</button>
        <div class="cy-progress"><span style="width:${Math.round(((guida.passo + 1) / P.length) * 100)}%"></span></div>
        <span class="cy-step">${guida.passo + 1}/${P.length}</span>
      </header>
      <form class="cy-w-body" id="cy-form" novalidate>
        <p class="eyebrow">${guida.path ? 'Modifica conversazione' : 'Nuova conversazione'}</p>
        <h2>${esc(p.titolo)}</h2>
        ${p.aiuto ? `<p class="cy-help">${esc(p.aiuto)}</p>` : ''}
        ${campo}
        <div id="cy-msg">${messaggio || ''}</div>
      </form>
      <footer class="cy-w-foot">
        <button class="btn" type="button" data-cy-azione="indietro" ${guida.passo === 0 ? 'disabled' : ''}>${icon('i-back')}Indietro</button>
        <button class="btn primary" type="button" data-cy-azione="${ultimo ? 'salva' : 'avanti'}" id="cy-avanti">${ultimo ? 'Salva conversazione' : 'Avanti'}</button>
      </footer>`;

    const campoEl = $('cy-campo');
    if (campoEl && !A().isPhone()) campoEl.focus();
    else if (campoEl && p.tipo !== 'testo') campoEl.focus();
    if (campoEl && campoEl.tagName === 'INPUT') {
      campoEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); avanti(); } });
    }
    if (campoEl && campoEl.tagName === 'TEXTAREA') {
      campoEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); avanti(); } });
    }
  }

  function leggiCampo() {
    const p = passi()[guida.passo];
    const campo = $('cy-campo');
    if (!campo) return;
    if (p.tipo === 'iniziali') guida.dati.iniziali = stato.moduli.formato.normalizzaIniziali(campo.value) || campo.value.trim();
    else guida.dati[p.id] = p.tipo === 'testo' ? campo.value.replace(/\s+$/, '') : campo.value.trim();
    salvaBozza();
  }

  function messaggio(tipo, titolo, voci) {
    return `<div class="cy-msg ${tipo}">${icon('i-alert')}<div><b>${esc(titolo)}</b>${voci.length ? '<br>' + voci.map((v) => esc(`${v.etichetta} (${v.valore})`)).join('<br>') : ''}</div></div>`;
  }

  function avanti() {
    const P = passi();
    const p = P[guida.passo];
    leggiCampo();
    const d = guida.dati;
    const v = d[p.id];

    // Controlli del passo
    if (p.tipo === 'data' && !/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return disegnaPasso(messaggio('err', 'Scegli una data.', []));
    if (p.tipo === 'iniziali' && !stato.moduli.formato.normalizzaIniziali(v)) return disegnaPasso(messaggio('err', 'Solo 2 o 3 lettere: le iniziali, mai il nome.', []));
    if ((p.tipo === 'scelta' || p.tipo === 'libera' || p.tipo === 'testo') && !p.facoltativo && (v === undefined || v === null || v === '')) {
      return disegnaPasso(messaggio('err', 'Serve una risposta per andare avanti.', []));
    }
    if (p.controlla && v) {
      const { blocchi, avvisi } = stato.moduli.regole.controllaTesto(v);
      if (blocchi.length) {
        guida.avvisoVisto = null;
        return disegnaPasso(messaggio('err', 'Dato vietato: riscrivi senza contatti né codici identificativi.', blocchi));
      }
      const firma = `${p.id}:${avvisi.map((a) => a.valore).join('|')}`;
      if (avvisi.length && guida.avvisoVisto !== firma) {
        guida.avvisoVisto = firma;
        return disegnaPasso(messaggio('warn', 'Rileggi: potrebbe far riconoscere la persona. Premi di nuovo Avanti per tenere così.', avvisi));
      }
    }
    guida.avvisoVisto = null;
    guida.passo = Math.min(P.length - 1, guida.passo + 1);
    salvaBozza();
    disegnaPasso();
    $('cy-wizard').scrollTop = 0;
  }

  async function salva() {
    const F = stato.moduli.formato;
    const R = stato.moduli.regole;
    const d = guida.dati;
    const errori = F.valida(d, stato.assunzioni.map((a) => a.id));
    const { blocchi } = R.controllaTesto(F.testiDaControllare(d));
    if (errori.length || blocchi.length) { disegnaPasso(messaggio('err', 'Non posso salvare:', [...errori.map((e) => ({ etichetta: e, valore: '' })), ...blocchi])); return; }

    const btn = $('cy-avanti');
    btn.disabled = true;
    btn.textContent = 'Salvataggio…';
    try {
      const esistenti = stato.albero.map((e) => e.path);
      const testo = F.serializza(d);
      const msg = `Conversazione del ${d.data} (${d.settore}) dal sito`;
      let nuovoPath;
      if (guida.path && F.nomeCoerente(guida.path, d)) {
        nuovoPath = guida.path;
        await salvaFile(nuovoPath, testo, msg.replace('Conversazione', 'Modifica conversazione'), guida.sha);
      } else {
        nuovoPath = F.nomeFile(d, esistenti);
        await salvaFile(nuovoPath, testo, msg);
        // Data o iniziali cambiate: il file vecchio ha il nome sbagliato e va tolto
        if (guida.path) await eliminaFile(guida.path, guida.sha, `Rinomina conversazione del ${d.data} (dal sito)`);
      }
      scartaBozza();
      A().toast('Conversazione salvata ✓');
      await carica(true);
      location.hash = `#/cyber/conversazioni/${encodeURIComponent(slug(nuovoPath))}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Riprova a salvare';
      disegnaPasso(messaggio('err', `Non salvata: ${e.message}. La bozza resta su questo dispositivo.`, []));
    }
  }

  function setup() {
    const el = $('cy-wizard');
    el.addEventListener('click', (e) => {
      const az = e.target.closest('[data-cy-azione]');
      if (az) {
        const a = az.dataset.cyAzione;
        if (a === 'avanti') avanti();
        else if (a === 'salva') salva();
        else if (a === 'indietro') { leggiCampo(); guida.passo = Math.max(0, guida.passo - 1); salvaBozza(); disegnaPasso(); }
        else if (a === 'esci') {
          leggiCampo();
          const vuota = !guida.path && !guida.dati.iniziali && !guida.dati.cosa_ha_detto;
          if (vuota) scartaBozza();
          else if (!confirm('Chiudere? La bozza resta salvata su questo dispositivo e la ritrovi riaprendo.')) return;
          const indietro = guida && guida.path ? `#/cyber/conversazioni/${encodeURIComponent(slug(guida.path))}` : '#/cyber/conversazioni';
          if (!vuota) guida = null; // la bozza resta in memoria locale
          location.hash = indietro;
        }
        return;
      }
      const scelta = e.target.closest('[data-cy-scelta]');
      if (scelta) {
        const p = passi()[guida.passo];
        guida.dati[p.id] = p.id === 'ricontattabile' ? scelta.dataset.cyScelta === 'Sì' : scelta.dataset.cyScelta;
        salvaBozza();
        avanti();
        return;
      }
      const chip = e.target.closest('[data-cy-chip]');
      if (chip) { $('cy-campo').value = chip.dataset.cyChip; leggiCampo(); avanti(); return; }
      const ass = e.target.closest('[data-cy-ass]');
      if (ass) {
        const lista = guida.dati.assunzioni.filter((x) => x.id !== ass.dataset.cyAss);
        if (ass.dataset.val) lista.push({ id: ass.dataset.cyAss, esito: ass.dataset.val });
        const ordine = stato.assunzioni.map((a) => a.id);
        guida.dati.assunzioni = lista.sort((a, b) => ordine.indexOf(a.id) - ordine.indexOf(b.id));
        salvaBozza();
        disegnaPasso();
      }
    });
    el.addEventListener('submit', (e) => e.preventDefault());
  }

  // Conteggio per il menu laterale (conversazioni del mese)
  function contatore() {
    if (!stato.albero) return '';
    const mese = oggi().slice(0, 7);
    return valide().filter((c) => c.dati.data.startsWith(mese)).length || '';
  }

  window.Cyber = { render, setup, carica, contatore, chiudi: chiudiGuida, reset: () => { Object.assign(stato, { moduli: null, albero: null, conversazioni: [], assunzioni: [], caricatoIl: 0, errore: '' }); } };
})();
