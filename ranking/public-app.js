// Viešo reitingų puslapio logika: duomenų įkėlimas, maršrutai, būsenos, įvykiai.
// Visi skaičiavimai daromi ranking/engine.js; šis failas tik jungia duomenis su vaizdu.

import { createClient } from './api.js';
import { RUNTIME } from './runtime-config.js';
import { computeRankings, computeAllTime, tournamentView } from './engine.js';
import { applyView, hasGenderData, withCalendar, pickDefaultSeason, parseRoute, buildRoute } from './view.js';
import * as R from './render.js';

const app = document.getElementById('app');
const client = createClient({ url: RUNTIME.supabaseUrl, anonKey: RUNTIME.supabaseAnonKey });
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const demoRequested = isLocal && new URLSearchParams(location.search).has('demo');

const state = {
  status: 'loading', error: '', data: null, demo: false,
  seasonId: null, tab: 'bendras', tournamentId: null,
  query: '', sort: 'points', gender: '', tournamentFilter: 'all',
  expanded: new Set(), rankings: null, rankingsFor: null, playersById: new Map(),
};

const TAB_LABELS = [
  ['bendras', 'BENDRAS REITINGAS'], ['elite', '🟣 ELITE'], ['challenge', '🔵 CHALLENGE'],
  ['future', '🟢 FUTURE'], ['turnyrai', 'TURNYRŲ REZULTATAI'],
];

async function load() {
  state.status = 'loading';
  render();
  try {
    let raw;
    if (demoRequested) {
      const mod = await import('../dev/demo-data.js');
      raw = mod.demoDataset();
      state.demo = true;
    } else if (client.configured()) {
      raw = await client.fetchPublicData();
    } else {
      console.info('[ELITE reitingai] Duomenų bazė nesukonfigūruota (ranking/runtime-config.js) – rodomas tik kalendorius.');
      raw = { seasons: [], tournaments: [], players: [], participations: [] };
    }
    state.data = withCalendar(raw);
    state.generatedAt = raw.generatedAt || null;
    state.playersById = new Map(state.data.players.map((p) => [p.id, p]));
    state.rankingsFor = null;
    state.status = 'ready';
  } catch (err) {
    state.status = 'error';
    state.error = err && err.message ? err.message : 'Nežinoma klaida.';
  }
  applyRoute();
}

function defaultSeason() {
  return state.data ? pickDefaultSeason(state.data.seasons) : null;
}

function applyRoute() {
  const route = parseRoute(location.hash);
  state.tab = route.tab;
  state.tournamentId = route.tournamentId;
  if (state.data) {
    // Ne numatytasis sezonas kodojamas hash dalyje (?s=...); be jo rodomas dabartinis sezonas.
    const known = route.seasonId && state.data.seasons.some((s) => s.id === route.seasonId);
    state.seasonId = known ? route.seasonId : defaultSeason();
  }
  render();
}

function navigate(partial) {
  const next = buildRoute({ tab: state.tab, tournamentId: null, seasonId: state.seasonId, ...partial }, defaultSeason());
  if (location.hash === next) applyRoute(); else location.hash = next;
}

function rankings() {
  if (state.rankingsFor !== state.seasonId || !state.rankings) {
    state.rankings = computeRankings(state.data, { seasonId: state.seasonId });
    state.rankingsFor = state.seasonId;
    state.expanded = new Set();
  }
  return state.rankings;
}

// ───────────────────────── Vaizdas ─────────────────────────

function render() {
  if (state.status === 'loading') { app.innerHTML = R.renderLoading(); return; }
  if (state.status === 'error') { app.innerHTML = R.renderError(state.error); return; }

  const seasons = state.data.seasons;
  const seasonSelect = `<label class="field"><span class="lbl">Sezonas</span>
    <select data-control="season">${seasons.map((s) => `<option value="${R.esc(s.id)}"${s.id === state.seasonId ? ' selected' : ''}>${R.esc(s.label)}${s.isCurrent ? ' (dabartinis)' : ' (archyvas)'}</option>`).join('')}</select></label>`;
  const updated = state.generatedAt ? `Atnaujinta: ${new Date(state.generatedAt).toLocaleString('lt-LT', { dateStyle: 'medium', timeStyle: 'short' })}` : '';
  const tabs = TAB_LABELS.map(([id, label]) => `<a role="tab" class="tab${state.tab === id ? ' active' : ''}" aria-selected="${state.tab === id}" href="${buildRoute({ tab: id, seasonId: state.seasonId }, defaultSeason())}">${label}</a>`).join('');
  const demoBanner = state.demo ? '<div class="demo-banner" role="note">⚠ DEMONSTRACINIAI DUOMENYS – tai ne oficialūs rezultatai (rodoma tik lokaliai kūrimo tikslais).</div>' : '';

  app.innerHTML = `${demoBanner}
    <section class="card toolbar"><div class="toolbar-row">${seasonSelect}<span class="meta">${R.esc(updated)}</span></div></section>
    <nav class="tabs" role="tablist" aria-label="Reitingų skiltys">${tabs}</nav>
    <section class="panel" id="panel" role="tabpanel"></section>
    ${R.renderRules(seasonScoringVersion())}
    <div id="alltime"></div>`;
  renderPanel();
  const all = computeAllTime(state.data);
  document.getElementById('alltime').innerHTML = R.renderAllTime(all);
}

function seasonScoringVersion() {
  const season = state.data.seasons.find((s) => s.id === state.seasonId);
  return (season && season.scoringVersion) || 'v1';
}

function renderPanel() {
  const panel = document.getElementById('panel');
  if (!panel) return;
  if (state.tab === 'turnyrai') { renderTournaments(panel); return; }

  const r = rankings();
  const isOverall = state.tab === 'bendras';
  const rows = isOverall ? r.overall : r.categories[state.tab];
  const label = isOverall ? 'Bendras reitingas' : state.tab.toUpperCase();
  if (!r.overall.length) {
    panel.innerHTML = `<div class="card">${R.renderEmpty(...R.EMPTY_OFFICIAL)}</div>`;
    return;
  }
  panel.innerHTML = `<div class="card list-card"><h2 class="sr">${R.esc(label)}</h2>
    <div id="controls"></div><div id="list"></div></div>`;
  document.getElementById('controls').innerHTML = R.renderControls({
    query: state.query, sort: state.sort, gender: state.gender, showGender: hasGenderData(r.overall), total: rows.length, shown: rows.length,
  });
  updateList();
}

function updateList() {
  const list = document.getElementById('list');
  if (!list) return;
  const r = rankings();
  const isOverall = state.tab === 'bendras';
  const all = isOverall ? r.overall : r.categories[state.tab];
  const rows = applyView(all, { query: state.query, sort: state.sort, gender: state.gender });
  const count = document.querySelector('.controls .count');
  if (count) count.textContent = `${rows.length} iš ${all.length}`;
  if (!all.length) {
    list.innerHTML = R.renderEmpty('Šioje kategorijoje oficialių rezultatų dar nėra');
  } else if (!rows.length) {
    list.innerHTML = R.renderEmpty('Žaidėjų nerasta', 'Pakeiskite paieškos frazę arba filtrus.');
  } else if (isOverall) {
    list.innerHTML = R.renderOverall({ rows, expanded: state.expanded, playersById: state.playersById, movementAvailable: r.movementAvailable });
  } else {
    list.innerHTML = R.renderCategory({ category: state.tab, rows, expanded: state.expanded, playersById: state.playersById });
  }
}

function renderTournaments(panel) {
  const data = state.data;
  if (state.tournamentId) {
    const t = data.tournaments.find((x) => x.id === state.tournamentId);
    if (!t) { panel.innerHTML = `<div class="card">${R.renderEmpty('Turnyras nerastas')}</div>`; return; }
    const view = tournamentView(data, t.id);
    panel.innerHTML = `<div class="card">${R.renderTournamentDetail({ view, backHref: buildRoute({ tab: 'turnyrai', seasonId: state.seasonId }, defaultSeason()) })}</div>`;
    window.scrollTo({ top: 0 });
    return;
  }
  panel.innerHTML = `<div class="card"><div id="tfilters"></div><div id="tlist"></div></div>`;
  updateTournamentList();
}

function updateTournamentList() {
  const filters = document.getElementById('tfilters');
  const list = document.getElementById('tlist');
  if (!filters || !list) return;
  const data = state.data;
  const inSeason = data.tournaments.filter((t) => t.seasonId === state.seasonId);
  const counts = new Map();
  data.participations.forEach((p) => counts.set(p.tournamentId, (counts.get(p.tournamentId) || 0) + 1));
  filters.innerHTML = R.renderTournamentFilters(state.tournamentFilter);
  list.innerHTML = R.renderTournamentList({ tournaments: inSeason, teamCounts: counts, seasonId: state.seasonId === defaultSeason() ? null : state.seasonId, filter: state.tournamentFilter });
}

// ───────────────────────── Įvykiai ─────────────────────────

app.addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-toggle]');
  if (toggle) {
    const id = toggle.dataset.toggle;
    if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
    updateList();
    return;
  }
  if (event.target.closest('[data-action="retry"]')) { load(); return; }
  const tf = event.target.closest('[data-tfilter]');
  if (tf) { state.tournamentFilter = tf.dataset.tfilter; updateTournamentList(); }
});

app.addEventListener('input', (event) => {
  if (event.target.matches('[data-control="query"]')) { state.query = event.target.value; updateList(); }
});

app.addEventListener('change', (event) => {
  const control = event.target.dataset && event.target.dataset.control;
  if (control === 'sort') { state.sort = event.target.value; updateList(); }
  else if (control === 'gender') { state.gender = event.target.value; updateList(); }
  else if (control === 'season') { state.seasonId = event.target.value; navigate({ seasonId: state.seasonId, tournamentId: null }); }
});

window.addEventListener('hashchange', () => { if (state.status === 'ready') applyRoute(); });

load();
