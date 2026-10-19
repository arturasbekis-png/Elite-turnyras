// Administravimo puslapio DOM sluoksnis. Visa darbo eiga yra ranking/admin-controller.js;
// čia tik atvaizdavimas ir įvykiai. Prisijungimas ir teisių tikrinimas vyksta serveryje (Supabase Auth + RLS).

import { createClient } from './api.js';
import { RUNTIME } from './runtime-config.js';
import { createAdminController } from './admin-controller.js';
import { createMemoryBackend } from './memory-backend.js';
import { esc } from './render.js';
import { EVENT_TYPES, STATUSES, SCORING_TABLES } from './config.js';
import { formatDate } from './view.js';
import { OFFICIAL_STATUS } from './config.js';

const app = document.getElementById('app');
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const demo = isLocal && new URLSearchParams(location.search).has('demo');

let storage = null;
try { storage = window.sessionStorage; } catch (_) { /* privatus režimas */ }

const ui = { screen: 'loading', tab: 'results', loginError: '', editingPlayer: null, showMerged: false, playerQuery: '', backend: null, client: null, ctl: null };

const TABS = [['results', 'Rezultatai'], ['players', 'Žaidėjai'], ['seasons', 'Sezonai ir turnyrai'], ['audit', 'Auditas'], ['export', 'Eksportas']];
const AUDIT_LABELS = {
  save_draft: 'Išsaugotas juodraštis', finalize: 'Paskelbti rezultatai', correct: 'Pataisyti rezultatai', merge_players: 'Sujungti žaidėjai',
  set_status: 'Pakeistas statusas', upsert_season: 'Sezonas išsaugotas', upsert_tournament: 'Turnyras išsaugotas',
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
    if (!ui.client.configured()) { ui.screen = 'unconfigured'; render(); return; }
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

function attachController() {
  ui.ctl = createAdminController(ui.backend, { onChange: render });
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
  return `<div class="card"><h2>Duomenų bazė dar nesukonfigūruota</h2>
    <p>Administravimas veiks, kai bus prijungta Supabase duomenų bazė. Žingsniai aprašyti faile <strong>docs/RANKING.md</strong> (skyrius „Diegimas“):</p>
    <ol class="rules-list"><li>Sukurkite nemokamą Supabase projektą ir paleiskite <code>supabase/schema.sql</code>, tada <code>supabase/seed.sql</code>.</li>
    <li>Sukurkite administratoriaus paskyrą (Authentication → Users) ir įrašykite ją į lentelę <code>admins</code>.</li>
    <li>Į <code>ranking/runtime-config.js</code> įrašykite projekto URL ir viešą „anon“ raktą.</li></ol>
    <p class="muted">Kol tai nepadaryta, viešas reitingų puslapis rodo tik kalendorių ir tuščią reitingą.</p></div>`;
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
  const tabs = TABS.map(([id, label]) => `<button type="button" class="tab${ui.tab === id ? ' active' : ''}" data-act="tab" data-tab="${id}">${label}</button>`).join('');
  let body = '<div class="state state-loading"><div class="spinner"></div><p>Kraunama…</p></div>';
  if (s.ready) {
    body = { results: renderResults, players: renderPlayers, seasons: renderSeasons, audit: renderAudit, export: renderExport }[ui.tab]();
  }
  return `${demoBanner}
    <div class="card toolbar"><div class="toolbar-row"><span>Prisijungta: <strong>${esc(email)}</strong></span>
      ${demo ? '' : '<button type="button" class="btn secondary" data-act="logout" style="margin-left:auto">Atsijungti</button>'}</div></div>
    <nav class="tabs" role="tablist">${tabs}</nav>
    ${noticeHtml(s.notice)}
    <div class="${s.busy ? 'busy' : ''}">${body}</div>`;
}

function playerOptions(selectedId) {
  const { dataset } = ui.ctl.state;
  const active = dataset.players.filter((p) => !p.mergedInto).sort((a, b) => a.fullName.localeCompare(b.fullName, 'lt'));
  let html = `<option value="">— pasirinkite —</option>${active.map((p) => `<option value="${esc(p.id)}"${p.id === selectedId ? ' selected' : ''}>${esc(p.fullName)}${p.isActive ? '' : ' (neaktyvus)'}</option>`).join('')}`;
  if (selectedId && !active.some((p) => p.id === selectedId)) html += `<option value="${esc(selectedId)}" selected>⚠ sujungtas / nežinomas įrašas</option>`;
  return html;
}

// ── Rezultatai ──
function renderResults() {
  const s = ui.ctl.state;
  const seasons = s.dataset.seasons;
  const inSeason = s.dataset.tournaments.filter((t) => t.seasonId === s.seasonId);
  const t = s.tournamentId ? s.dataset.tournaments.find((x) => x.id === s.tournamentId) : null;
  const picker = `<div class="card"><div class="toolbar-row">
    <label class="field"><span class="lbl">Sezonas</span><select data-sel="season">${seasons.map((x) => `<option value="${esc(x.id)}"${x.id === s.seasonId ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
    <label class="field grow"><span class="lbl">Turnyras</span><select data-sel="tournament"><option value="">— pasirinkite turnyrą —</option>${inSeason.map((x) => `<option value="${esc(x.id)}"${x.id === s.tournamentId ? ' selected' : ''}>${esc(x.name)} · ${esc(formatDate(x.date))} · ${esc(STATUSES[x.status])}</option>`).join('')}</select></label>
  </div></div>`;
  if (!t) return `${picker}<div class="card"><p class="muted">Pasirinkite turnyrą, kad įvestumėte arba peržiūrėtumėte rezultatus.</p></div>`;

  const finalized = t.status === OFFICIAL_STATUS;
  const type = EVENT_TYPES[t.type];
  const rows = s.entries.map((e, i) => `<tr>
      <td data-label="Nr.">${i + 1}</td>
      <td data-label="Komandos pavadinimas"><input type="text" data-entry="${esc(e.key)}" data-field="teamName" value="${esc(e.teamName)}" placeholder="neprivalomas" maxlength="80"></td>
      <td data-label="Žaidėjas 1"><select data-entry="${esc(e.key)}" data-field="player1">${playerOptions(e.playerIds[0])}</select></td>
      <td data-label="Žaidėjas 2"><select data-entry="${esc(e.key)}" data-field="player2">${playerOptions(e.playerIds[1])}</select></td>
      <td data-label="Vieta"><input type="number" min="1" step="1" inputmode="numeric" data-entry="${esc(e.key)}" data-field="position" value="${esc(e.position)}" class="pos-input"></td>
      <td><button type="button" class="btn danger" data-act="remove-team" data-key="${esc(e.key)}" aria-label="Pašalinti komandą">✕</button></td></tr>`).join('');

  const actions = finalized
    ? `<div class="field"><span class="lbl">Pataisymo priežastis (privaloma, išsaugoma audito žurnale)</span><textarea data-reason rows="2" placeholder="Pvz.: neteisingai įvesta finalo vieta">${esc(s.reason)}</textarea></div>
       <div class="actions"><button type="button" class="btn secondary" data-act="preview">Peržiūrėti taškus</button><button type="button" class="btn" data-act="correct"${s.busy ? ' disabled' : ''}>Išsaugoti pataisymą</button></div>`
    : `<div class="actions">
        <button type="button" class="btn secondary" data-act="preview">Peržiūrėti taškus</button>
        <button type="button" class="btn secondary" data-act="save-draft"${s.busy ? ' disabled' : ''}>Išsaugoti juodraštį</button>
        <button type="button" class="btn secondary" data-act="save-awaiting"${s.busy ? ' disabled' : ''}>Pažymėti „Laukiama patvirtinimo“</button>
        <button type="button" class="btn" data-act="finalize"${s.busy ? ' disabled' : ''}>Patvirtinti ir paskelbti</button></div>
       <div class="toolbar-row"><label class="field"><span class="lbl">Statusas</span><select data-status><option value="planned">Suplanuotas</option><option value="in_progress">Vyksta</option><option value="draft">Rezultatų juodraštis</option><option value="awaiting_confirmation">Laukiama patvirtinimo</option></select></label>
        <button type="button" class="btn secondary" data-act="set-status">Nustatyti statusą</button>
        <label class="check"><input type="checkbox" data-ties${t.allowTies ? ' checked' : ''}> Leisti pasidalintas vietas (1-2-2-4)</label></div>`;

  return `${picker}<div class="card">
    <div class="ttop"><div><h2 style="margin:0">${esc(type.emoji || '')} ${esc(t.name)}</h2><div class="tdate">${esc(formatDate(t.date))} · ${esc(type.label)}</div></div>${statusBadge(t.status)}</div>
    ${finalized ? `<div class="notice info">Rezultatai paskelbti (versija ${esc(t.revision)}). Keitimai laikomi pataisymu ir fiksuojami audite.</div>` : ''}
    ${t.type === 'final' ? '<div class="notice info">BEACH LEAGUE FINAL taškų sistema nenustatyta – rezultatai bus paskelbti, bet į reitingus neįskaičiuojami.</div>' : ''}
    <div class="ttable-wrap"><table class="ttable edit"><thead><tr><th>Nr.</th><th>Komanda</th><th>Žaidėjas 1</th><th>Žaidėjas 2</th><th>Vieta</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="muted">Komandų dar nėra.</td></tr>'}</tbody></table></div>
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
  const table = p.validation.valid ? `<div class="ttable-wrap"><table class="ttable"><thead><tr><th>Vieta</th><th>Komanda</th><th>Taškai kiekvienam žaidėjui</th></tr></thead><tbody>${p.teams.map((tm) => `<tr><td>${esc(tm.position)}</td><td>${tm.teamName ? `<div class="team">${esc(tm.teamName)}</div>` : ''}${tm.players.map((pl) => `<div>${esc(pl.name)}</div>`).join('')}</td><td class="pts">${p.scored ? esc(tm.points) : '–'}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="card"><h2>Taškų peržiūra</h2>${errs}${warns}${table}<p class="muted">Tai tik peržiūra – į oficialų reitingą taškai patenka tik po paskelbimo.</p></div>`;
}

// ── Žaidėjai ──
function renderPlayers() {
  const s = ui.ctl.state;
  const counts = new Map();
  s.dataset.participations.forEach((p) => p.playerIds.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
  const q = ui.playerQuery.trim().toLowerCase();
  const list = s.dataset.players
    .filter((p) => (ui.showMerged || !p.mergedInto) && (!q || p.fullName.toLowerCase().includes(q)))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'lt'));
  const rows = list.map((p) => {
    if (ui.editingPlayer === p.id) {
      return `<tr><td data-label="Vardas"><input id="edit-name" type="text" value="${esc(p.fullName)}" maxlength="100"></td>
        <td data-label="Lytis"><select id="edit-gender"><option value="">—</option><option value="M"${p.gender === 'M' ? ' selected' : ''}>V</option><option value="F"${p.gender === 'F' ? ' selected' : ''}>M</option></select></td>
        <td data-label="Statusas">${p.isActive ? 'Aktyvus' : 'Neaktyvus'}</td><td data-label="Turnyrai">${counts.get(p.id) || 0}</td>
        <td><button type="button" class="btn" data-act="save-player" data-id="${esc(p.id)}">Išsaugoti</button> <button type="button" class="btn secondary" data-act="cancel-edit">Atšaukti</button></td></tr>`;
    }
    const status = p.mergedInto ? 'Sujungtas' : (p.isActive ? 'Aktyvus' : 'Neaktyvus');
    return `<tr><td data-label="Vardas">${esc(p.fullName)}</td><td data-label="Lytis">${p.gender === 'M' ? 'V' : p.gender === 'F' ? 'M' : '—'}</td><td data-label="Statusas">${status}</td><td data-label="Turnyrai">${counts.get(p.id) || 0}</td>
      <td>${p.mergedInto ? '' : `<button type="button" class="btn secondary" data-act="edit-player" data-id="${esc(p.id)}">Redaguoti</button> <button type="button" class="btn secondary" data-act="toggle-active" data-id="${esc(p.id)}" data-active="${p.isActive}">${p.isActive ? 'Deaktyvuoti' : 'Aktyvuoti'}</button>`}</td></tr>`;
  }).join('');
  const active = s.dataset.players.filter((p) => !p.mergedInto).sort((a, b) => a.fullName.localeCompare(b.fullName, 'lt'));
  const opts = active.map((p) => `<option value="${esc(p.id)}">${esc(p.fullName)} (${counts.get(p.id) || 0} turn.)</option>`).join('');
  return `<div class="card"><h2>Naujas žaidėjas</h2>
      <form data-form="player" class="toolbar-row" novalidate>
        <label class="field grow"><span class="lbl">Vardas ir pavardė</span><input id="new-name" type="text" maxlength="100" required></label>
        <label class="field"><span class="lbl">Lytis</span><select id="new-gender"><option value="">—</option><option value="M">Vyras</option><option value="F">Moteris</option></select></label>
        <button type="submit" class="btn">Sukurti</button></form>
      <p class="muted">Prieš kuriant tikrinama, ar toks vardas jau nėra įrašytas. Vardo klaidas taisykite redaguodami esamą įrašą – taip taškai ir istorija išlieka.</p></div>
    <div class="card"><h2>Žaidėjai (${list.length})</h2>
      <div class="controls"><label class="field grow"><span class="sr">Paieška</span><input type="search" data-player-query value="${esc(ui.playerQuery)}" placeholder="Ieškoti pagal vardą…"></label>
      <label class="check"><input type="checkbox" data-show-merged${ui.showMerged ? ' checked' : ''}> Rodyti sujungtus</label></div>
      <div class="ttable-wrap"><table class="ttable edit"><thead><tr><th>Vardas</th><th>Lytis</th><th>Statusas</th><th>Turnyrai</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">Žaidėjų nėra.</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Sujungti dublikatus</h2>
      <p class="muted">Visi dublikato rezultatai perkeliami į pagrindinį įrašą, taškai nesikeičia. Jei abu įrašai dalyvavo tame pačiame turnyre, sujungti negalima – pirmiau pataisykite komandas.</p>
      <div class="toolbar-row"><label class="field grow"><span class="lbl">Palikti (pagrindinis įrašas)</span><select id="merge-keep"><option value="">— pasirinkite —</option>${opts}</select></label>
      <label class="field grow"><span class="lbl">Sujungti (dublikatas)</span><select id="merge-drop"><option value="">— pasirinkite —</option>${opts}</select></label>
      <label class="field grow"><span class="lbl">Priežastis</span><input id="merge-reason" type="text" placeholder="Pvz.: dubliuotas įrašas"></label>
      <button type="button" class="btn" data-act="merge">Sujungti</button></div></div>`;
}

// ── Sezonai ir turnyrai ──
function renderSeasons() {
  const s = ui.ctl.state;
  const versions = Object.keys(SCORING_TABLES);
  const seasonRows = s.dataset.seasons.map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(x.label)}</td><td>${x.isCurrent ? 'Dabartinis' : 'Archyvas'}</td><td>${esc(x.scoringVersion)}</td></tr>`).join('');
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

const actions = {
  tab: (el) => { ui.tab = el.dataset.tab; render(); if (ui.tab === 'audit') ui.ctl.loadAudit(); },
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
    const ok = await ui.ctl.updatePlayer(el.dataset.id, { fullName: val('edit-name'), gender: val('edit-gender') });
    if (ok) ui.editingPlayer = null;
    render();
  },
  'toggle-active': (el) => ui.ctl.updatePlayer(el.dataset.id, { isActive: el.dataset.active !== 'true' }),
  merge: async () => {
    const keep = val('merge-keep'); const drop = val('merge-drop');
    if (!keep || !drop) { ui.ctl.state.notice = { type: 'error', text: 'Pasirinkite abu žaidėjų įrašus.', details: [] }; render(); return; }
    if (!window.confirm('Sujungti šiuos žaidėjų įrašus? Veiksmo atšaukti negalima (jis fiksuojamas audite).')) return;
    await ui.ctl.mergePlayers(keep, drop, val('merge-reason'));
  },
  'load-audit': () => ui.ctl.loadAudit(),
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
    const ok = await ui.ctl.createPlayer({ fullName: val('new-name'), gender: val('new-gender') });
    if (!ok && ui.ctl.state.notice && ui.ctl.state.notice.type === 'info' && window.confirm(`${ui.ctl.state.notice.text}\n\nVis tiek sukurti naują įrašą?`)) {
      await ui.ctl.createPlayer({ fullName: val('new-name'), gender: val('new-gender') }, { force: true });
    }
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

app.addEventListener('input', (event) => {
  const t = event.target;
  if (t.dataset.entry && t.dataset.field) ui.ctl.updateTeam(t.dataset.entry, { [t.dataset.field]: t.value });
  else if (t.hasAttribute('data-reason')) ui.ctl.setReason(t.value);
  else if (t.hasAttribute('data-player-query')) { ui.playerQuery = t.value; render(); const input = document.querySelector('[data-player-query]'); if (input) { input.focus(); input.setSelectionRange(t.value.length, t.value.length); } }
});

app.addEventListener('change', (event) => {
  const t = event.target;
  if (t.dataset.entry && t.dataset.field) { ui.ctl.updateTeam(t.dataset.entry, { [t.dataset.field]: t.value }); return; }
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
