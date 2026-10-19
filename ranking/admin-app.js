// Administravimo puslapio DOM sluoksnis. Visa darbo eiga yra ranking/admin-controller.js;
// čia tik atvaizdavimas ir įvykiai. Prisijungimas ir teisių tikrinimas vyksta serveryje (Supabase Auth + RLS).

import { createClient } from './api.js';
import { RUNTIME } from './runtime-config.js';
import { createAdminController } from './admin-controller.js';
import { createMemoryBackend } from './memory-backend.js';
import { createLocalBackend } from './local-backend.js';
import { getLocalStorage, clearLocalDataset } from './local-store.js';
import { esc } from './render.js';
import { EVENT_TYPES, STATUSES, SCORING_TABLES } from './config.js';
import { formatDate } from './view.js';
import { nameParts } from './names.js';
import { OFFICIAL_STATUS } from './config.js';

const app = document.getElementById('app');
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const demo = isLocal && new URLSearchParams(location.search).has('demo');

let storage = null;
try { storage = window.sessionStorage; } catch (_) { /* privatus režimas */ }

const ui = {
  screen: 'loading', tab: 'players', loginError: '', editingPlayer: null, showMerged: false, playerQuery: '',
  newFirst: '', newLast: '', newGender: '', newTest: false, backend: null, client: null, ctl: null,
  local: false, localStorage: null,
};

const TABS = [['players', 'ŽAIDĖJAI'], ['results', 'REZULTATŲ SUVEDIMAS'], ['seasons', 'Sezonai ir turnyrai'], ['test', 'BANDYMAS'], ['audit', 'Auditas'], ['export', 'Eksportas']];
const AUDIT_LABELS = {
  save_draft: 'Išsaugotas juodraštis', finalize: 'Paskelbti rezultatai', correct: 'Pataisyti rezultatai', merge_players: 'Sujungti žaidėjai',
  set_status: 'Pakeistas statusas', upsert_season: 'Sezonas išsaugotas', upsert_tournament: 'Turnyras išsaugotas',
  create_test_season: 'Sukurtas bandomasis sezonas', delete_test_data: 'Ištrinti bandymo duomenys',
};

// ───────────────────────── Paleidimas ─────────────────────────

async function start() {
  try {
    if (demo) {
      const { demoDataset } = await import('../dev/demo-data.js');
      ui.backend = createMemoryBackend(demoDataset());
      attachController();
      ui.screen = 'app';
      await ui.ctl.load();
      return;
    }
    ui.client = createClient({ url: RUNTIME.supabaseUrl, anonKey: RUNTIME.supabaseAnonKey, storage });
    ui.backend = ui.client;
    if (!ui.client.configured()) {
      const problem = ui.client.configProblem();
      if (problem && problem.status === 'missing') { await startLocal(); return; }
      ui.screen = 'unconfigured'; render(); return; // nuostatos įrašytos, bet netinkamos – parodome priežastį
    }
    attachController();
    const session = await ui.client.restoreSession();
    if (session && await verifyAdmin()) { ui.screen = 'app'; await ui.ctl.load(); return; }
    ui.screen = 'login';
    render();
  } catch (err) {
    ui.screen = 'login';
    ui.loginError = err && err.message ? err.message : 'Nepavyko paleisti.';
    render();
  }
}

/** Supabase neprijungtas: administravimas veikia vietiniu režimu (duomenys TIK šioje naršyklėje, be prisijungimo). */
async function startLocal() {
  ui.local = true;
  ui.localStorage = getLocalStorage();
  ui.backend = createLocalBackend({ storage: ui.localStorage });
  attachController();
  ui.screen = 'app';
  await ui.ctl.load();
}

function attachController() {
  ui.ctl = createAdminController(ui.backend, { onChange: render, onAuthLost: handleAuthLost });
}

/** Sesija nebegalioja (pasibaigė / atšaukta): grąžiname į prisijungimo formą su paaiškinimu. */
function handleAuthLost() {
  if (demo) return;
  ui.screen = 'login';
  ui.loginError = 'Prisijungimo galiojimas baigėsi. Prisijunkite iš naujo. Neišsaugoti pakeitimai šiame puslapyje gali būti prarasti.';
  render();
}

async function verifyAdmin() {
  try { return await ui.backend.isAdmin(); } catch (_) { return false; }
}

// ───────────────────────── Vaizdas ─────────────────────────

const statusBadge = (status) => `<span class="status st-${esc(status)}">${esc(STATUSES[status] || status)}</span>`;
const noticeHtml = (n) => (n ? `<div class="notice ${esc(n.type)}" role="${n.type === 'error' ? 'alert' : 'status'}">${esc(n.text)}${n.details && n.details.length ? `<ul>${n.details.map((d) => `<li>${esc(d.message)}</li>`).join('')}</ul>` : ''}</div>` : '');

function render() {
  const y = window.scrollY;
  if (ui.screen === 'loading') app.innerHTML = '<div class="state state-loading"><div class="spinner"></div><p>Kraunama…</p></div>';
  else if (ui.screen === 'unconfigured') app.innerHTML = renderUnconfigured();
  else if (ui.screen === 'login') app.innerHTML = renderLogin();
  else app.innerHTML = renderApp();
  window.scrollTo({ top: y });
}

function renderUnconfigured() {
  const p = ui.client && ui.client.configProblem ? ui.client.configProblem() : null;
  const problem = p && p.status !== 'missing'
    ? `<div class="notice error" role="alert" data-setup="${esc(p.status)}"><strong>${esc(p.title)}.</strong> ${esc(p.text)}</div>`
    : '';
  return `<div class="card" id="unconfigured"><h2>Duomenų bazė dar nesukonfigūruota</h2>${problem}
    <p>Administravimas veiks, kai bus prijungta Supabase duomenų bazė. Žingsniai aprašyti faile <strong>docs/SUPABASE-DIEGIMAS.md</strong>:</p>
    <ol class="rules-list"><li>Sukurkite nemokamą Supabase projektą ir paleiskite <code>supabase/schema.sql</code>, tada <code>supabase/seed.sql</code>.</li>
    <li>Sukurkite administratoriaus paskyrą (Authentication → Users) ir suteikite jai teises paleisdami <code>supabase/make-admin.sql</code>.</li>
    <li>Į <code>ranking/runtime-config.js</code> įrašykite projekto URL ir VIEŠĄ (publishable) raktą – <strong>niekada ne privilegijuotą („secret“) raktą</strong>.</li></ol>
    <p class="muted">Kol tai nepadaryta, viešas reitingų puslapis rodo tik kalendorių ir paaiškinimą, kad reitingai dar neprijungti.</p></div>`;
}

function renderLogin() {
  return `<div class="card login"><h2>Prisijungimas</h2>
    ${ui.loginError ? `<div class="notice error" role="alert">${esc(ui.loginError)}</div>` : ''}
    <form data-form="login" novalidate>
      <label class="field"><span class="lbl">El. paštas</span><input id="login-email" type="email" autocomplete="username" required></label>
      <label class="field"><span class="lbl">Slaptažodis</span><input id="login-password" type="password" autocomplete="current-password" required></label>
      <p><button class="btn" type="submit">Prisijungti</button></p>
    </form>
    <p class="muted">Prisijungimą ir teises tikrina serveris. Slaptažodis niekur neišsaugomas.</p></div>`;
}

function renderApp() {
  const { ctl } = ui;
  const s = ctl.state;
  const email = ui.backend.getSession && ui.backend.getSession() ? ui.backend.getSession().email : '';
  const demoBanner = demo ? '<div class="demo-banner" role="note">⚠ DEMONSTRACINIS REŽIMAS – duomenys laikomi tik atmintyje ir dingsta perkrovus puslapį. Tai ne oficiali saugykla.</div>' : '';
  const localBanner = ui.local
    ? `<div class="demo-banner" role="note" id="local-banner">⚠ VIETINIS REŽIMAS – Supabase duomenų bazė neprijungta. Viskas, ką čia įvedate, saugoma TIK šioje naršyklėje (šiame įrenginyje) ir NĖRA viešai paskelbta: kiti lankytojai šių duomenų nemato. ${ui.localStorage ? 'Neišvalykite naršyklės duomenų, kitaip jie dings.' : '<strong>Ši naršyklė neleidžia saugoti duomenų – viskas dings uždarius ar perkrovus puslapį.</strong>'} Prisijungimo šiame režime nėra, todėl jis netinka bendram darbui.</div>`
    : '';
  const tabs = TABS.filter(([id]) => !(ui.local && id === 'test')).map(([id, label]) => `<button type="button" class="tab${ui.tab === id ? ' active' : ''}" data-act="tab" data-tab="${id}">${label}</button>`).join('');
  let body = '<div class="state state-loading"><div class="spinner"></div><p>Kraunama…</p></div>';
  if (s.ready) {
    body = { results: renderResults, players: renderPlayers, seasons: renderSeasons, test: renderTest, audit: renderAudit, export: renderExport }[ui.tab]();
  }
  const who = ui.local ? '<span>Vietinis režimas (be prisijungimo)</span>' : `<span>Prisijungta: <strong>${esc(email)}</strong></span>`;
  const rightButton = ui.local
    ? '<button type="button" class="btn secondary" data-act="clear-local" style="margin-left:auto">Išvalyti vietinius duomenis</button>'
    : (demo ? '' : '<button type="button" class="btn secondary" data-act="logout" style="margin-left:auto">Atsijungti</button>');
  return `${demoBanner}${localBanner}
    <div class="card toolbar"><div class="toolbar-row">${who}
      ${rightButton}</div></div>
    <nav class="tabs" role="tablist">${tabs}</nav>
    ${s.pendingDuplicate ? '' : noticeHtml(s.notice)}
    <div class="${s.busy ? 'busy' : ''}">${body}</div>`;
}

/** Žaidėjų pasirinkimas komandai. Kitose komandose jau pasirinkti žaidėjai išjungiami (apsauga nuo klaidos). */
function playerOptions(selectedId, blocked = new Set(), { testSeason = false } = {}) {
  const { dataset } = ui.ctl.state;
  const active = dataset.players.filter((p) => !p.mergedInto).sort((a, b) => a.fullName.localeCompare(b.fullName, 'lt'));
  let html = `<option value="">— pasirinkite —</option>${active.map((p) => {
    const taken = blocked.has(p.id) && p.id !== selectedId;
    // Bandomieji žaidėjai oficialiuose turnyruose neleidžiami (serveris taip pat atmeta).
    const testBlocked = p.isTest && !testSeason && p.id !== selectedId;
    return `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}${taken || testBlocked ? ' disabled' : ''}>${esc(p.fullName)}${p.isTest ? ' [BANDOMASIS]' : ''}${p.isActive ? '' : ' (neaktyvus)'}${taken ? ' – jau pasirinktas' : ''}${testBlocked ? ' – tik bandomajam sezonui' : ''}</option>`;
  }).join('')}`;
  if (selectedId && !active.some((p) => p.id === selectedId)) html += `<option value="${esc(selectedId)}" selected>⚠ sujungtas / nežinomas įrašas</option>`;
  return html;
}

// ── REZULTATŲ SUVEDIMAS ──
function renderResults() {
  const s = ui.ctl.state;
  const seasons = s.dataset.seasons;
  const inSeason = s.dataset.tournaments.filter((t) => t.seasonId === s.seasonId);
  const t = s.tournamentId ? s.dataset.tournaments.find((x) => x.id === s.tournamentId) : null;
  const picker = `<div class="card"><h2>REZULTATŲ SUVEDIMAS</h2><div class="toolbar-row">
    <label class="field"><span class="lbl">1. Sezonas</span><select data-sel="season">${seasons.map((x) => `<option value="${esc(x.id)}"${x.id === s.seasonId ? ' selected' : ''}>${esc(x.label)}${x.isTest ? ' – BANDYMAS' : ''}</option>`).join('')}</select></label>
    <label class="field grow"><span class="lbl">2. Turnyras iš kalendoriaus</span><select data-sel="tournament"><option value="">— pasirinkite turnyrą —</option>${inSeason.map((x) => `<option value="${esc(x.id)}"${x.id === s.tournamentId ? ' selected' : ''}>${esc(x.name)} · ${esc(formatDate(x.date))} · ${esc(STATUSES[x.status])}</option>`).join('')}</select></label>
  </div>${s.dataset.players.filter((p) => !p.mergedInto).length < 2 ? '<p class="muted">Pirmiausia pridėkite žaidėjus skiltyje <a href="#" data-act="tab" data-tab="players">ŽAIDĖJAI</a>.</p>' : ''}</div>`;
  if (!t) return `${picker}<div class="card"><p class="muted">Pasirinkite turnyrą, kad įvestumėte arba peržiūrėtumėte rezultatus.</p></div>`;

  const finalized = t.status === OFFICIAL_STATUS;
  const type = EVENT_TYPES[t.type];
  const tSeason = s.dataset.seasons.find((x) => x.id === t.seasonId);
  const testSeason = Boolean(tSeason && tSeason.isTest);
  const pts = ui.ctl.livePoints();
  const rows = s.entries.map((e) => {
    const blocked = ui.ctl.usedElsewhere(e.key);
    const other1 = e.playerIds[1] ? new Set([...blocked, e.playerIds[1]]) : blocked;
    const other0 = e.playerIds[0] ? new Set([...blocked, e.playerIds[0]]) : blocked;
    const cell = !pts.scored ? 'taškų nėra' : (pts.byKey.has(e.key) ? pts.byKey.get(e.key) : '–');
    return `<tr>
      <td data-label="Vieta"><input type="number" min="1" step="1" inputmode="numeric" data-entry="${esc(e.key)}" data-field="position" value="${esc(e.position)}" class="pos-input" aria-label="Galutinė vieta"></td>
      <td data-label="Žaidėjas 1"><select data-entry="${esc(e.key)}" data-field="player1" aria-label="Žaidėjas 1">${playerOptions(e.playerIds[0], other0, { testSeason })}</select></td>
      <td data-label="Žaidėjas 2"><select data-entry="${esc(e.key)}" data-field="player2" aria-label="Žaidėjas 2">${playerOptions(e.playerIds[1], other1, { testSeason })}</select></td>
      <td data-label="Taškai kiekvienam" class="pts" data-points="${esc(e.key)}">${esc(cell)}</td>
      <td><button type="button" class="btn danger" data-act="remove-team" data-key="${esc(e.key)}" aria-label="Pašalinti komandą">✕</button></td></tr>`;
  }).join('');

  const actions = finalized
    ? `<div class="field"><span class="lbl">Pataisymo priežastis (privaloma, išsaugoma audito žurnale)</span><textarea data-reason rows="2" placeholder="Pvz.: neteisingai įvesta finalo vieta">${esc(s.reason)}</textarea></div>
       <div class="actions"><button type="button" class="btn secondary" data-act="preview">Peržiūrėti taškus ir patikrinti</button><button type="button" class="btn" data-act="correct"${s.busy ? ' disabled' : ''}>Išsaugoti pataisymą</button></div>`
    : `<div class="actions">
        <button type="button" class="btn secondary" data-act="preview">Peržiūrėti taškus ir patikrinti</button>
        <button type="button" class="btn secondary" data-act="save-draft"${s.busy ? ' disabled' : ''}>Išsaugoti juodraštį</button>
        <button type="button" class="btn secondary" data-act="save-awaiting"${s.busy ? ' disabled' : ''}>Pažymėti „Laukiama patvirtinimo“</button>
        <button type="button" class="btn" data-act="finalize"${s.busy ? ' disabled' : ''}>${ui.local ? 'PATVIRTINTI (TIK ŠIOJE NARŠYKLĖJE)' : 'PASKELBTI OFICIALIUS REZULTATUS'}</button></div>
       <p class="muted">${ui.local ? 'Vietiniame režime niekas nepaskelbiama viešai. Juodraštis taškų neskiria; patvirtinti rezultatai matomi tik šioje naršyklėje.' : 'Juodraštis viešame reitinge nerodomas ir taškų neskiria. Taškai atsiranda tik po paskelbimo.'}</p>
       <div class="toolbar-row"><label class="field"><span class="lbl">Statusas</span><select data-status><option value="planned">Suplanuotas</option><option value="in_progress">Vyksta</option><option value="draft">Rezultatų juodraštis</option><option value="awaiting_confirmation">Laukiama patvirtinimo</option></select></label>
        <button type="button" class="btn secondary" data-act="set-status">Nustatyti statusą</button>
        <label class="check"><input type="checkbox" data-ties${t.allowTies ? ' checked' : ''}> Leisti pasidalintas vietas (1-2-2-4)</label></div>`;

  return `${picker}<div class="card">
    <div class="ttop"><div><h2 style="margin:0">${esc(type.emoji || '')} ${esc(t.name)}</h2><div class="tdate">${esc(formatDate(t.date))} · ${esc(type.label)}</div></div>${statusBadge(t.status)}</div>
    ${finalized ? (ui.local
      ? `<div class="notice warning" id="local-finalized">Rezultatai patvirtinti TIK šioje naršyklėje (versija ${esc(t.revision)}) – viešai NEPASKELBTI. Keitimai laikomi pataisymu ir fiksuojami audite. <a href="reitingai.html" target="_blank" rel="noopener">Atidaryti reitingų puslapį (matoma tik šioje naršyklėje)</a></div>`
      : `<div class="notice info">Rezultatai paskelbti (versija ${esc(t.revision)}). Keitimai laikomi pataisymu ir fiksuojami audite. <a href="reitingai.html${testSeason ? `#bendras?s=${esc(t.seasonId)}` : ''}" target="_blank" rel="noopener">Atidaryti viešą reitingą</a></div>`) : ''}
    ${testSeason ? `<div class="notice warning" id="test-season-note">BANDOMASIS turnyras: čia galite laisvai bandyti, rezultatai nėra oficialūs ir bus ištrinti skiltyje BANDYMAS. <a href="reitingai.html#bendras?s=${esc(t.seasonId)}" target="_blank" rel="noopener">Atidaryti bandomąjį viešą reitingą</a></div>` : ''}
    ${t.type === 'final' ? '<div class="notice info">BEACH LEAGUE FINAL taškų sistema nenustatyta – rezultatai bus paskelbti, bet į reitingus neįskaičiuojami.</div>' : ''}
    <h3>3. Komandos ir galutinės vietos</h3>
    <div class="ttable-wrap"><table class="ttable edit" id="results-table"><thead><tr><th>Vieta</th><th>Žaidėjas 1</th><th>Žaidėjas 2</th><th>Taškai kiekvienam</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">Komandų dar nėra. Spauskite „Pridėti komandą“.</td></tr>'}</tbody></table></div>
    <p><button type="button" class="btn secondary" data-act="add-team">＋ Pridėti komandą</button></p>
    ${actions}
    ${s.dirty ? '<p class="muted">Yra neišsaugotų pakeitimų.</p>' : ''}
  </div>${renderPreview()}`;
}

function renderPreview() {
  const p = ui.ctl.state.preview;
  if (!p) return '';
  const errs = p.validation.errors.length ? `<div class="notice error"><strong>Rasta klaidų:</strong><ul>${p.validation.errors.map((e) => `<li>${esc(e.message)}</li>`).join('')}</ul></div>` : '<div class="notice success">Validacija sėkminga – rezultatus galima skelbti.</div>';
  const warns = p.validation.warnings.map((w) => `<div class="notice info">${esc(w.message)}</div>`).join('');
  const table = p.validation.valid ? `<div class="ttable-wrap"><table class="ttable" id="preview-table"><thead><tr><th>Vieta</th><th>Žaidėjas 1</th><th>Žaidėjas 2</th><th>Taškai kiekvienam</th></tr></thead><tbody>${p.teams.map((tm) => `<tr><td>${esc(tm.position)}</td><td>${esc((tm.players[0] || {}).name || '—')}</td><td>${esc((tm.players[1] || {}).name || '—')}</td><td class="pts">${p.scored ? esc(tm.points) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="card"><h2>Taškų peržiūra</h2>${errs}${warns}${table}<p class="muted">Abu komandos žaidėjai gauna pilnus taškus. Tai tik peržiūra – į oficialų reitingą taškai patenka po paskelbimo.</p></div>`;
}

// ── ŽAIDĖJAI ──
function renderPlayers() {
  const s = ui.ctl.state;
  const counts = new Map();
  s.dataset.participations.forEach((p) => p.playerIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
  const list = ui.ctl.searchPlayers(ui.playerQuery, { includeMerged: ui.showMerged });
  const rows = list.map((p) => {
    if (ui.editingPlayer === p.id) {
      const n = nameParts(p);
      return `<tr><td data-label="Vardas, pavardė"><input id="edit-first" type="text" value="${esc(n.firstName)}" maxlength="60" aria-label="Vardas"> <input id="edit-last" type="text" value="${esc(n.lastName)}" maxlength="60" aria-label="Pavardė"></td>
        <td data-label="ID"><code class="pid">${esc(p.id)}</code></td>
        <td data-label="Lytis"><select id="edit-gender"><option value="">—</option><option value="M"${p.gender === 'M' ? ' selected' : ''}>V</option><option value="F"${p.gender === 'F' ? ' selected' : ''}>M</option></select></td>
        <td data-label="Statusas">${p.isActive ? 'Aktyvus' : 'Neaktyvus'}</td><td data-label="Turnyrai">${counts.get(p.id) || 0}</td>
        <td><button type="button" class="btn" data-act="save-player" data-id="${esc(p.id)}">Išsaugoti</button> <button type="button" class="btn secondary" data-act="cancel-edit">Atšaukti</button></td></tr>`;
    }
    const status = p.mergedInto ? 'Sujungtas' : (p.isActive ? 'Aktyvus' : 'Neaktyvus');
    return `<tr data-player-row="${esc(p.id)}"><td data-label="Vardas, pavardė"><strong>${esc(p.fullName)}</strong>${p.isTest ? ' <span class="status st-draft" title="Bandomasis žaidėjas – bus ištrintas su bandymo duomenimis">BANDOMASIS</span>' : ''}</td><td data-label="ID"><code class="pid">${esc(p.id)}</code></td><td data-label="Lytis">${p.gender === 'M' ? 'V' : p.gender === 'F' ? 'M' : '—'}</td><td data-label="Statusas">${status}</td><td data-label="Turnyrai">${counts.get(p.id) || 0}</td>
      <td>${p.mergedInto ? '' : `<button type="button" class="btn secondary" data-act="edit-player" data-id="${esc(p.id)}">Redaguoti</button> <button type="button" class="btn secondary" data-act="toggle-active" data-id="${esc(p.id)}" data-active="${p.isActive}">${p.isActive ? 'Deaktyvuoti' : 'Aktyvuoti'}</button>`}</td></tr>`;
  }).join('');
  const active = s.dataset.players.filter((p) => !p.mergedInto).sort((a, b) => a.fullName.localeCompare(b.fullName, 'lt'));
  const opts = active.map((p) => `<option value="${esc(p.id)}">${esc(p.fullName)} (${counts.get(p.id) || 0} turn.)</option>`).join('');
  const dup = s.pendingDuplicate;
  const dupHtml = dup ? `<div class="notice warning" role="alert"><strong>Galimas dublikatas.</strong> Panašus žaidėjas jau yra:
      <ul>${dup.similar.map((x) => `<li>${esc(x.fullName)} <code class="pid">${esc(x.id)}</code></li>`).join('')}</ul>
      <p>Jei tai kitas žmogus su tuo pačiu vardu, galite sukurti atskirą įrašą.</p>
      <p><button type="button" class="btn" data-act="force-create">Vis tiek sukurti atskirą žaidėją „${esc(dup.name.fullName)}“</button>
      <button type="button" class="btn secondary" data-act="cancel-duplicate">Atšaukti</button></p></div>` : '';
  return `<div class="card"><h2>ŽAIDĖJAI</h2>
      <form data-form="player" class="toolbar-row" novalidate>
        <label class="field grow"><span class="lbl">Vardas</span><input id="new-first" type="text" maxlength="60" autocomplete="off" value="${esc(ui.newFirst)}" required></label>
        <label class="field grow"><span class="lbl">Pavardė</span><input id="new-last" type="text" maxlength="60" autocomplete="off" value="${esc(ui.newLast)}" required></label>
        <label class="field"><span class="lbl">Lytis (neprivaloma)</span><select id="new-gender"><option value=""${ui.newGender === '' ? ' selected' : ''}>—</option><option value="M"${ui.newGender === 'M' ? ' selected' : ''}>Vyras</option><option value="F"${ui.newGender === 'F' ? ' selected' : ''}>Moteris</option></select></label>
        <button type="submit" class="btn">PRIDĖTI ŽAIDĖJĄ</button>
        <label class="check" style="flex-basis:100%"><input type="checkbox" id="new-test"${ui.newTest ? ' checked' : ''}> Bandomasis žaidėjas (tik sistemos patikrinimui; bus ištrintas skiltyje BANDYMAS)</label></form>
      ${dupHtml}
      <p class="muted">Žaidėjas išsaugomas iš karto. Prieš kuriant tikrinama, ar toks vardas jau nėra įrašytas (nepriklausomai nuo didžiųjų raidžių ir lietuviškų rašmenų). Vardo klaidas taisykite redaguodami esamą įrašą – taip ID, taškai ir istorija išlieka.</p></div>
    <div class="card"><h2>Žaidėjų sąrašas (${list.length})</h2>
      <div class="controls"><label class="field grow"><span class="lbl">Ieškoti žaidėjo</span><input type="search" id="player-search" data-player-query value="${esc(ui.playerQuery)}" placeholder="Vardas, pavardė arba ID…"></label>
      <label class="check"><input type="checkbox" data-show-merged${ui.showMerged ? ' checked' : ''}> Rodyti sujungtus</label></div>
      <div class="ttable-wrap"><table class="ttable edit" id="players-table"><thead><tr><th>Vardas, pavardė</th><th>ID</th><th>Lytis</th><th>Statusas</th><th>Turnyrai</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Žaidėjų nerasta.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Sujungti dublikatus</h2>
      <p class="muted">Visi dublikato rezultatai perkeliami į pagrindinį įrašą, taškai nesikeičia ir nedubliuojasi. Jei abu įrašai dalyvavo tame pačiame turnyre, sujungti negalima – pirmiau pataisykite komandas.</p>
      <div class="toolbar-row"><label class="field grow"><span class="lbl">Palikti (pagrindinis įrašas)</span><select id="merge-keep"><option value="">— pasirinkite —</option>${opts}</select></label>
      <label class="field grow"><span class="lbl">Sujungti (dublikatas)</span><select id="merge-drop"><option value="">— pasirinkite —</option>${opts}</select></label>
      <label class="field grow"><span class="lbl">Priežastis</span><input id="merge-reason" type="text" placeholder="Pvz.: dubliuotas įrašas"></label>
      <button type="button" class="btn" data-act="merge">Sujungti</button></div></div>`;
}

// ── Sezonai ir turnyrai ──
function renderSeasons() {
  const s = ui.ctl.state;
  const versions = Object.keys(SCORING_TABLES);
  const seasonRows = s.dataset.seasons.map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(x.label)}</td><td>${x.isTest ? 'BANDOMASIS' : x.isCurrent ? 'Dabartinis' : 'Archyvas'}</td><td>${esc(x.scoringVersion)}</td></tr>`).join('');
  const tournaments = s.dataset.tournaments.filter((t) => t.seasonId === s.seasonId);
  const tRows = tournaments.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(formatDate(t.date))}</td><td>${statusBadge(t.status)}</td><td>${t.allowTies ? 'Taip' : 'Ne'}</td></tr>`).join('');
  return `<div class="card"><h2>Sezonai</h2>
      <div class="ttable-wrap"><table class="ttable"><thead><tr><th>ID</th><th>Pavadinimas</th><th>Būsena</th><th>Taškų lentelė</th></tr></thead><tbody>${seasonRows}</tbody></table></div>
      <form data-form="season" class="toolbar-row" novalidate>
        <label class="field"><span class="lbl">ID (pvz. 2027-2028)</span><input id="season-id" type="text" required></label>
        <label class="field"><span class="lbl">Pavadinimas</span><input id="season-label" type="text" placeholder="2027–2028" required></label>
        <label class="field"><span class="lbl">Taškų lentelė</span><select id="season-scoring">${versions.map((v) => `<option>${esc(v)}</option>`).join('')}</select></label>
        <label class="check"><input id="season-current" type="checkbox"> Dabartinis sezonas</label>
        <button type="submit" class="btn">Išsaugoti sezoną</button></form></div>
    <div class="card"><h2>Turnyrai (${esc(s.seasonId)})</h2>
      <div class="ttable-wrap"><table class="ttable"><thead><tr><th>Turnyras</th><th>Data</th><th>Statusas</th><th>Lygios vietos</th></tr></thead><tbody>${tRows}</tbody></table></div>
      <h3>Naujas turnyras</h3>
      <form data-form="tournament" class="toolbar-row" novalidate>
        <label class="field"><span class="lbl">Tipas</span><select id="t-type">${Object.values(EVENT_TYPES).map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Nr.</span><input id="t-number" type="number" min="1" step="1" style="width:80px"></label>
        <label class="field"><span class="lbl">Data</span><input id="t-date" type="date" required></label>
        <label class="field"><span class="lbl">Pradžia</span><input id="t-time" type="time" value="11:00"></label>
        <label class="check"><input id="t-ties" type="checkbox"> Lygios vietos</label>
        <button type="submit" class="btn">Sukurti turnyrą</button></form>
      <p class="muted">Turnyras priskiriamas dabar pasirinktam sezonui (skiltyje „Rezultatai“). Sezono kalendoriaus renginiai jau sukurti – dublikatų nekurkite.</p></div>`;
}

// ── BANDYMAS ──
function renderTest() {
  const sum = ui.ctl.testSummary();
  const has = Boolean(sum.season);
  const anything = has || sum.players.length > 0;
  const firstTournament = sum.tournaments.find((t) => t.type === 'elite') || sum.tournaments[0];
  const li = (done, text) => `<li class="${done ? 'done' : ''}">${done ? '✔ ' : ''}${text}</li>`;
  return `<div class="card" id="test-panel"><h2>BANDYMAS – saugus sistemos patikrinimas</h2>
      <div class="notice info">Čia galite išbandyti <strong>visą kelią</strong> (prisijungimas → žaidėjai → komandos → paskelbimas → viešas reitingas) su <strong>neoficialiais</strong> duomenimis.
        Bandymas vyksta atskirame <strong>bandomajame sezone</strong>: jis nerodomas pagrindiniame reitinge, neįskaičiuojamas į istorinę statistiką, o oficialūs turnyrai ir žaidėjai nekeičiami.
        Baigę viską ištrinsite vienu mygtuku – SQL komandų vykdyti nereikia.</div>
      <h3>Dabartinė būsena</h3>
      <ul class="rules-list" id="test-status">
        ${li(has, `Bandomasis sezonas: <strong>${has ? 'sukurtas' : 'nesukurtas'}</strong>`)}
        <li>Bandomųjų žaidėjų: <strong id="test-players-count">${sum.players.length}</strong></li>
        <li>Bandomųjų turnyrų: <strong>${sum.tournaments.length}</strong> (paskelbta: <strong id="test-published-count">${sum.published.length}</strong>, komandų: <strong>${sum.teams}</strong>)</li>
      </ul>
      <h3>Kaip patikrinti</h3>
      <ol class="rules-list">
        <li><button type="button" class="btn" data-act="create-test-season"${has ? ' disabled' : ''}>1. Sukurti bandomąjį sezoną</button></li>
        <li>Skiltyje <a href="#" data-act="tab" data-tab="players">ŽAIDĖJAI</a> pridėkite bent 4 žaidėjus su pažymėta varnele „Bandomasis žaidėjas“.</li>
        <li><button type="button" class="btn secondary" data-act="open-test-tournament"${firstTournament ? '' : ' disabled'}>3. Atidaryti bandomąjį turnyrą</button> – sudėkite dvi komandas, išsaugokite juodraštį, tada paskelbkite.</li>
        <li><a href="reitingai.html#bendras?s=${esc(sum.season ? sum.season.id : 'bandymas')}" target="_blank" rel="noopener" id="test-public-link">4. Atidaryti bandomąjį viešą reitingą</a> – po paskelbimo abu komandos nariai turi turėti pilnus taškus; juodraštis viešai nematomas.</li>
      </ol>
      <h3>Bandymo pabaiga</h3>
      <p class="muted">Ištrinami <strong>tik</strong> bandomasis sezonas, jo turnyrai ir žaidėjai, pažymėti kaip bandomieji. Oficialūs sezonai, turnyrai, žaidėjai ir paskelbti rezultatai nepaliečiami. Audito žurnalas išlieka. Jei bandomasis žaidėjas kažkodėl yra oficialiame turnyre, trynimas sustabdomas ir niekas neištrinama.</p>
      <p><button type="button" class="btn danger" data-act="delete-test-data"${anything ? '' : ' disabled'}>Ištrinti VISUS bandymo duomenis</button></p>
    </div>`;
}

// ── Auditas ──
function renderAudit() {
  const rows = ui.ctl.state.audit.map((a) => `<tr><td>${esc(new Date(a.at).toLocaleString('lt-LT'))}</td><td>${esc(a.actor_email || '—')}</td><td>${esc(AUDIT_LABELS[a.action] || a.action)}</td><td>${esc(a.tournament_id || '—')}</td><td>${esc(a.reason || '')}</td>
    <td>${a.before || a.after ? `<details><summary>Rodyti</summary><pre>${esc(JSON.stringify({ prieš: a.before, po: a.after }, null, 1))}</pre></details>` : ''}</td></tr>`).join('');
  return `<div class="card"><h2>Audito žurnalas</h2><p><button type="button" class="btn secondary" data-act="load-audit">Atnaujinti</button></p>
    <div class="ttable-wrap"><table class="ttable"><thead><tr><th>Laikas</th><th>Naudotojas</th><th>Veiksmas</th><th>Turnyras</th><th>Priežastis</th><th>Pakeitimai</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">Įrašų nėra.</td></tr>'}</tbody></table></div></div>`;
}

// ── Eksportas ──
function renderExport() {
  const s = ui.ctl.state;
  return `<div class="card"><h2>CSV eksportas</h2>
    <p class="muted">Reitingų lentelės (sezonas ${esc(s.seasonId)}) sudaromos tik iš paskelbtų rezultatų. Failai su UTF-8 koduote ir „;“ skirtuku (tinka lietuviškam Excel).</p>
    <div class="actions"><button type="button" class="btn" data-act="export" data-kind="overall">Bendras reitingas</button>
    <button type="button" class="btn" data-act="export" data-kind="elite">ELITE</button>
    <button type="button" class="btn" data-act="export" data-kind="challenge">CHALLENGE</button>
    <button type="button" class="btn" data-act="export" data-kind="future">FUTURE</button></div>
    <p class="muted">Pasirinkto turnyro rezultatų eksportas – skiltyje „Rezultatai“ (mygtukas po taškų peržiūra) arba čia:</p>
    <div class="actions"><button type="button" class="btn secondary" data-act="export" data-kind="tournament"${s.tournamentId ? '' : ' disabled'}>Pasirinkto turnyro rezultatai</button></div></div>`;
}

// ───────────────────────── Įvykiai ─────────────────────────

function download({ filename, content }) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : '');

function resetNewPlayer() {
  ui.newFirst = ''; ui.newLast = ''; ui.newGender = ''; ui.newTest = false;
  render();
  const first = document.getElementById('new-first');
  if (first && first.focus) first.focus();
}

const actions = {
  tab: (el) => { ui.tab = el.dataset.tab; render(); if (ui.tab === 'audit') ui.ctl.loadAudit(); },
  'clear-local': async () => {
    if (!window.confirm('Ištrinti VISUS šioje naršyklėje išsaugotus vietinius duomenis (žaidėjus, juodraščius, patvirtintus rezultatus)?\n\nNaudokite tik jei norite pradėti iš naujo. Šio veiksmo atšaukti negalima. Joks bendras ar viešas duomuo nebus paliestas.')) return;
    clearLocalDataset(ui.localStorage);
    ui.tab = 'players'; ui.editingPlayer = null;
    await startLocal();
  },
  logout: async () => { await ui.client.signOut(); ui.screen = 'login'; ui.loginError = ''; render(); },
  'add-team': () => ui.ctl.addTeam(),
  'remove-team': (el) => ui.ctl.removeTeam(el.dataset.key),
  preview: () => ui.ctl.preview(),
  'save-draft': () => ui.ctl.saveDraft('draft'),
  'save-awaiting': () => ui.ctl.saveDraft('awaiting_confirmation'),
  finalize: async () => {
    const preview = ui.ctl.preview();
    if (!preview || !preview.validation.valid) return;
    const t = ui.ctl.state.dataset.tournaments.find((x) => x.id === ui.ctl.state.tournamentId);
    if (ui.local) {
      if (!window.confirm(`Patvirtinti „${t.name}“ rezultatus TIK šioje naršyklėje?\n\nTai NĖRA viešas paskelbimas: kiti lankytojai rezultatų nematys, kol nebus prijungta bendra duomenų bazė.`)) return;
      await ui.ctl.finalize();
      return;
    }
    if (!window.confirm(`Paskelbti „${t.name}“ rezultatus?\n\nPo paskelbimo taškai bus įskaičiuoti į oficialų reitingą. Vėliau rezultatus bus galima tik pataisyti (su priežastimi, fiksuojama audite).`)) return;
    await ui.ctl.finalize();
  },
  correct: async () => {
    if (!window.confirm('Išsaugoti pataisymą? Reitingai bus perskaičiuoti, o senas variantas liks audito žurnale.')) return;
    await ui.ctl.correct();
  },
  'set-status': () => ui.ctl.setStatus(document.querySelector('[data-status]').value),
  'edit-player': (el) => { ui.editingPlayer = el.dataset.id; render(); },
  'cancel-edit': () => { ui.editingPlayer = null; render(); },
  'save-player': async (el) => {
    const ok = await ui.ctl.updatePlayer(el.dataset.id, { firstName: val('edit-first'), lastName: val('edit-last'), gender: val('edit-gender') });
    if (ok) ui.editingPlayer = null;
    render();
  },
  'force-create': async () => {
    const dup = ui.ctl.state.pendingDuplicate;
    if (!dup) return;
    if (await ui.ctl.createPlayer(dup.input, { force: true })) resetNewPlayer();
  },
  'cancel-duplicate': () => ui.ctl.clearPendingDuplicate(),
  'toggle-active': (el) => ui.ctl.updatePlayer(el.dataset.id, { isActive: el.dataset.active !== 'true' }),
  merge: async () => {
    const keep = val('merge-keep'); const drop = val('merge-drop');
    if (!keep || !drop) { ui.ctl.state.notice = { type: 'error', text: 'Pasirinkite abu žaidėjų įrašus.', details: [] }; render(); return; }
    if (!window.confirm('Sujungti šiuos žaidėjų įrašus? Veiksmo atšaukti negalima (jis fiksuojamas audite).')) return;
    await ui.ctl.mergePlayers(keep, drop, val('merge-reason'));
  },
  'load-audit': () => ui.ctl.loadAudit(),
  'create-test-season': () => ui.ctl.createTestSeason(),
  'open-test-tournament': () => {
    const sum = ui.ctl.testSummary();
    const t = sum.tournaments.find((x) => x.type === 'elite') || sum.tournaments[0];
    if (!t) return;
    ui.ctl.selectSeason(sum.season.id);
    ui.ctl.selectTournament(t.id);
    ui.tab = 'results';
    render();
  },
  'delete-test-data': async () => {
    const sum = ui.ctl.testSummary();
    const text = `Ištrinti VISUS bandymo duomenis?\n\nBus ištrinta: bandomasis sezonas (turnyrų: ${sum.tournaments.length}, komandų: ${sum.teams}) ir ${sum.players.length} bandomųjų žaidėjų.\n\nOficialūs duomenys nebus paliesti. Šio veiksmo atšaukti negalima.`;
    if (!window.confirm(text)) return;
    await ui.ctl.deleteTestData();
  },
  export: (el) => {
    const file = ui.ctl.exportCsv(el.dataset.kind);
    if (file) download(file);
  },
};

app.addEventListener('click', (event) => {
  const el = event.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) { event.preventDefault(); actions[el.dataset.act](el); }
});

app.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target.dataset.form;
  if (form === 'login') {
    ui.loginError = '';
    try {
      await ui.client.signIn(val('login-email'), val('login-password'));
      if (!(await verifyAdmin())) {
        await ui.client.signOut();
        ui.loginError = 'Ši paskyra nėra administratoriaus. Prisijungkite administratoriaus paskyra.';
        render();
        return;
      }
      ui.screen = 'app';
      render();
      await ui.ctl.load();
    } catch (err) {
      ui.loginError = err && err.message ? err.message : 'Nepavyko prisijungti.';
      render();
    }
  } else if (form === 'player') {
    ui.newFirst = val('new-first'); ui.newLast = val('new-last'); ui.newGender = val('new-gender');
    ui.newTest = Boolean(document.getElementById('new-test') && document.getElementById('new-test').checked);
    const ok = await ui.ctl.createPlayer({ firstName: ui.newFirst, lastName: ui.newLast, gender: ui.newGender, isTest: ui.newTest });
    if (ok) resetNewPlayer();
  } else if (form === 'season') {
    await ui.ctl.upsertSeason({ id: val('season-id').trim(), label: val('season-label').trim(), isCurrent: document.getElementById('season-current').checked, scoringVersion: val('season-scoring') });
  } else if (form === 'tournament') {
    const s = ui.ctl.state;
    const type = val('t-type');
    const number = Number(val('t-number'));
    const season = s.dataset.seasons.find((x) => x.id === s.seasonId);
    const info = EVENT_TYPES[type];
    if (!val('t-date') || (type !== 'final' && !(number >= 1))) { s.notice = { type: 'error', text: 'Įveskite datą ir turnyro numerį.', details: [] }; render(); return; }
    await ui.ctl.upsertTournament({ seasonId: s.seasonId, type, number, name: type === 'final' ? info.label : `${info.label} #${number}`, date: val('t-date'), startTime: val('t-time') || '11:00', allowTies: document.getElementById('t-ties').checked });
    void season;
  }
});

function refreshPoints() {
  const pts = ui.ctl.livePoints();
  document.querySelectorAll('[data-points]').forEach((cell) => {
    const key = cell.getAttribute('data-points');
    cell.textContent = !pts.scored ? 'taškų nėra' : (pts.byKey.has(key) ? String(pts.byKey.get(key)) : '–');
  });
}

app.addEventListener('input', (event) => {
  const t = event.target;
  if (t.dataset.entry && t.dataset.field) {
    ui.ctl.updateTeam(t.dataset.entry, { [t.dataset.field]: t.value });
    if (t.dataset.field === 'position') refreshPoints();
  } else if (t.hasAttribute('data-reason')) ui.ctl.setReason(t.value);
  else if (t.id === 'new-first') ui.newFirst = t.value;
  else if (t.id === 'new-last') ui.newLast = t.value;
  else if (t.hasAttribute('data-player-query')) { ui.playerQuery = t.value; render(); const input = document.querySelector('[data-player-query]'); if (input) { input.focus(); input.setSelectionRange(t.value.length, t.value.length); } }
});

app.addEventListener('change', (event) => {
  const t = event.target;
  if (t.id === 'new-gender') { ui.newGender = t.value; return; }
  if (t.id === 'new-test') { ui.newTest = Boolean(t.checked); return; }
  if (t.dataset.entry && t.dataset.field) {
    ui.ctl.updateTeam(t.dataset.entry, { [t.dataset.field]: t.value });
    // Pasirinkus žaidėją perpiešiame lentelę, kad jau pasirinkti žaidėjai kitose komandose būtų išjungti.
    if (t.dataset.field === 'player1' || t.dataset.field === 'player2') render(); else refreshPoints();
    return;
  }
  if (t.dataset.sel === 'season') ui.ctl.selectSeason(t.value);
  else if (t.dataset.sel === 'tournament') ui.ctl.selectTournament(t.value || null);
  else if (t.hasAttribute('data-show-merged')) { ui.showMerged = t.checked; render(); }
  else if (t.hasAttribute('data-ties')) {
    const s = ui.ctl.state;
    const tour = s.dataset.tournaments.find((x) => x.id === s.tournamentId);
    ui.ctl.upsertTournament({ ...tour, allowTies: t.checked });
  }
});

start();
