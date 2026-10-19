// Gryni HTML generatoriai viešam reitingų puslapiui. Visas dinamiškas tekstas pasprendžiamas per esc().
// Nėra DOM priklausomybių, todėl funkcijas galima testuoti Node aplinkoje.

import { CATEGORIES, EVENT_TYPES, STATUSES, SCORING_TABLES, DEFAULT_SCORING_VERSION, RANKED_CATEGORIES } from './config.js';
import { formatDate, shortName } from './view.js';

export const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const typeInfo = (type) => CATEGORIES[type] || EVENT_TYPES[type] || { label: String(type).toUpperCase(), emoji: '' };
const typeClass = (type) => `type-${esc(type)}`;

// ───────────────────────── Būsenos ─────────────────────────

export const renderLoading = () => '<div class="state state-loading" role="status"><div class="spinner" aria-hidden="true"></div><p>Kraunami reitingai…</p></div>';

export const renderError = (message) => `<div class="state state-error" role="alert"><p><strong>Nepavyko įkelti reitingų.</strong></p><p>${esc(message)}</p><button type="button" class="btn" data-action="retry">Bandyti dar kartą</button></div>`;

export const renderEmpty = (title, text) => `<div class="state state-empty"><p><strong>${esc(title)}</strong></p>${text ? `<p>${esc(text)}</p>` : ''}</div>`;

export const EMPTY_OFFICIAL = ['Oficialių rezultatų dar nėra', 'Reitingas atsiras, kai organizatoriai paskelbs pirmojo turnyro rezultatus. Juodraščiai ir nepatvirtinti rezultatai į reitingą neįskaičiuojami.'];

export const UNCONFIGURED = ['Reitingai dar neprijungti', 'Reitingų duomenų bazė dar nesukonfigūruota, todėl oficialių rezultatų parodyti negalime. Kalendorių (skiltis „Turnyrų rezultatai“) ir taisykles galite peržiūrėti.'];

/** Pastabos apie duomenų pilnumą (statinio rezultatų failo režimas). */
export function renderDataNotices({ incomplete = [], limitedNames = 0 } = {}) {
  const groupText = (g) => `${g.position}–${g.position + g.declared - 1} vietų grupėje žinomos ${g.known} iš ${g.declared} porų (trūksta ${g.missing})`;
  const parts = incomplete.map((x) => `<li><strong>${esc(x.name)}:</strong> ${x.groups.map(groupText).map(esc).join('; ')}. Trūkstama pora nekuriama ir nepridedama; likusių porų taškai skaičiuojami pagal visą grupę ir nepasikeis, kai ji bus patvirtinta.</li>`);
  if (limitedNames) parts.push(`<li>${esc(limitedNames)} žaidėjų nurodyti tik vardu arba vardu ir pavardės inicialu – pilni vardai nepatvirtinti. Vienodi vardai skirtinguose turnyruose laikomi tuo pačiu žaidėju.</li>`);
  return `<div class="notice info" role="note" id="static-info"><strong>Oficialūs paskelbti rezultatai</strong> (bendras duomenų failas) – visi lankytojai mato tuos pačius duomenis. Vietiniai administravimo juodraščiai čia nerodomi.</div>${parts.length ? `<div class="notice warning" role="note" id="incomplete-notice"><strong>Duomenys nepilni.</strong><ul>${parts.join('')}</ul></div>` : ''}`;
}

/** Nuostatų problema: tuščia konfigūracija – paprastas pranešimas; neteisingos / privilegijuotos reikšmės – konkreti priežastis. */
export function renderSetupProblem(problem) {
  if (!problem || problem.status === 'missing') return renderEmpty(...UNCONFIGURED);
  return `<div class="state state-error" role="alert" data-setup="${esc(problem.status)}"><p><strong>${esc(problem.title)}</strong></p><p>${esc(problem.text)}</p><p class="muted">Ši žinutė skirta svetainės savininkui; lankytojams reitingai bus rodomi, kai nuostatos bus pataisytos.</p></div>`;
}

// ───────────────────────── Bendri elementai ─────────────────────────

function posCell(row) {
  const medal = MEDALS[row.position];
  const tie = row.tied ? '<span class="tie" aria-hidden="true">=</span><span class="sr">lygi vieta</span>' : '';
  return `<span class="rpos${medal ? ` medal-${row.position}` : ''}">${medal ? `<span class="medal" aria-hidden="true">${medal}</span>` : ''}<span class="num">${esc(row.position)}${tie}</span></span>`;
}

function movementCell(row, available) {
  if (!available || row.movement == null) return '<span class="rmove none" data-label="Judėjimas">—</span>';
  if (row.movement === 'new') return '<span class="rmove new" data-label="Judėjimas" title="Naujas lentelėje">NAUJAS</span>';
  if (row.movement > 0) return `<span class="rmove up" data-label="Judėjimas" title="Pakilo ${row.movement} vietomis">▲ ${row.movement}</span>`;
  if (row.movement < 0) return `<span class="rmove down" data-label="Judėjimas" title="Nukrito ${-row.movement} vietomis">▼ ${-row.movement}</span>`;
  return '<span class="rmove same" data-label="Judėjimas" title="Vieta nepasikeitė">•</span>';
}

const chip = (result, withPoints = true) => `<span class="chip ${typeClass(result.type)}" title="${esc(result.tournamentName)}">${esc(shortNameFromResult(result))}${withPoints ? ` <b>${result.counted ? esc(result.points) : '–'}</b>` : ''}</span>`;

function shortNameFromResult(result) {
  const m = /#(\d+)/.exec(result.tournamentName || '');
  return shortName({ type: result.type, number: m ? Number(m[1]) : null });
}

/** Poros turnyrų suvestinė (išskleidžiama po eilute): kiekvienas turnyras, vieta ir poros taškai. */
export function renderPairDetail(row) {
  const results = row.results || [];
  if (!results.length) return '<p class="muted">Ši pora dar neturi patvirtintų rezultatų.</p>';
  const body = results.map((r) => {
    const info = typeInfo(r.type);
    return `<tr>
      <td data-label="Turnyras"><span class="tag ${typeClass(r.type)}">${esc(info.emoji || '')} ${esc(r.tournamentName)}</span></td>
      <td data-label="Data">${esc(formatDate(r.date))}</td>
      <td data-label="Vieta">${esc(r.position)}</td>
      <td data-label="Taškai porai" class="pts">${esc(r.points)}</td>
    </tr>`;
  }).join('');
  return `<div class="dwrap"><table class="dtable"><thead><tr><th>Turnyras</th><th>Data</th><th>Vieta</th><th>Taškai porai</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td colspan="3">Poros taškų suma (${results.length} turnyrai)</td><td class="pts">${esc(row.points)}</td></tr></tfoot></table></div>`;
}

// ───────────────────────── Reitingų lentelės ─────────────────────────

function listWrap(inner, head) {
  return `<div class="rtable" role="list">${head}<ol class="rlist">${inner}</ol></div>`;
}

/**
 * Porų reitingo lentelė vienai kategorijai (ELITE arba CHALLENGE). Eilutė = viena pora (abu žaidėjai kartu).
 * Judėjimo stulpelis rodomas tik kai yra su kuo lyginti (bent du tos kategorijos turnyrai).
 */
export function renderPairs({ category, rows, expanded = new Set(), movementAvailable = false }) {
  const info = CATEGORIES[category];
  const mv = movementAvailable ? '' : ' nomove';
  const head = `<div class="rhead rgrid pair${mv}" aria-hidden="true"><span>Vieta</span><span>Pora</span><span class="r">Taškai</span><span class="r">Turnyrai</span><span class="r">Pergalės</span>${movementAvailable ? '<span class="r">Judėjimas</span>' : ''}</div>`;
  const items = rows.map((row) => {
    const key = `${category}:${row.pairKey}`;
    const open = expanded.has(key);
    const chips = row.results.map((r) => chip(r)).join('');
    const players = row.names.map((n) => `<span class="n">${esc(n)}</span>`).join('');
    return `<li class="rrow pair-row${open ? ' open' : ''}" data-pair="${esc(row.pairKey)}">
      <button type="button" class="rmain rgrid pair${mv}" data-toggle="${esc(key)}" aria-expanded="${open}">
        ${posCell(row)}
        <span class="rname"><span class="pair-names">${players}</span><span class="chips" aria-label="Taškai pagal turnyrus">${chips}</span></span>
        <span class="rpts"><b>${esc(row.points)}</b><small>tšk.</small></span>
        <span class="rstats">
          <span class="rstat" data-label="Turnyrai">${esc(row.played)}</span>
          <span class="rstat" data-label="Pergalės">${esc(row.wins)}</span>
          ${movementAvailable ? movementCell(row, true) : ''}
        </span>
      </button>
      <div class="rdetail"${open ? '' : ' hidden'}>${open ? renderPairDetail(row) : ''}</div>
    </li>`;
  }).join('');
  return `<div class="cat-banner ${typeClass(category)}">${esc(info.emoji)} ${esc(info.label)} porų reitingas · skaičiuojami tik ${esc(info.label)} turnyrų taškai</div>${listWrap(items, head)}`;
}

/** Žaidėjų paieškos / rūšiavimo juosta. */
export function renderControls({ query = '', sort = 'points', gender = '', showGender = false, total = 0, shown = 0 }) {
  const opt = (value, label) => `<option value="${value}"${sort === value ? ' selected' : ''}>${label}</option>`;
  return `<div class="controls">
    <label class="field grow"><span class="sr">Ieškoti poros</span><input type="search" data-control="query" value="${esc(query)}" placeholder="Ieškoti poros pagal žaidėjo vardą…" autocomplete="off"></label>
    <label class="field"><span class="lbl">Rūšiuoti</span><select data-control="sort">${opt('points', 'Pagal taškus')}${opt('name', 'Pagal vardą')}${opt('played', 'Pagal turnyrų skaičių')}</select></label>
    ${showGender ? `<label class="field"><span class="lbl">Kategorija</span><select data-control="gender"><option value="">Visi</option><option value="M"${gender === 'M' ? ' selected' : ''}>Vyrai</option><option value="F"${gender === 'F' ? ' selected' : ''}>Moterys</option></select></label>` : ''}
    <span class="count" aria-live="polite">${esc(shown)} iš ${esc(total)}</span>
  </div>`;
}

// ───────────────────────── Turnyrai ─────────────────────────

function statusBadge(status) {
  return `<span class="status st-${esc(status)}">${esc(STATUSES[status] || status)}</span>`;
}

export function renderTournamentFilters(active) {
  const items = [['all', 'VISI'], ['elite', '🟣 ELITE'], ['challenge', '🔵 CHALLENGE'], ['future', '🟢 FUTURE'], ['final', '🏆 FINAL']];
  return `<div class="filters">${items.map(([value, label]) => `<button type="button" class="filter${active === value ? ' active' : ''}" data-tfilter="${value}">${label}</button>`).join('')}</div>`;
}

export function renderTournamentList({ tournaments, teamCounts, seasonId, filter = 'all' }) {
  const list = tournaments.filter((t) => filter === 'all' || t.type === filter);
  if (!list.length) return renderEmpty('Šiame sezone turnyrų nėra');
  return `<div class="tlist">${list.map((t) => {
    const info = typeInfo(t.type);
    const teams = t.status === 'finalized' ? (teamCounts.get(t.id) || 0) : null;
    const note = t.type === 'final' ? '<span class="muted">Taškų sistema nenustatyta</span>' : '';
    return `<article class="tcard ${typeClass(t.type)}">
      <div class="ttop"><div><div class="tname">${esc(info.emoji || '')} ${esc(t.name)}</div>
      <div class="tdate">${esc(formatDate(t.date))}${t.startTime ? ` · <strong>${esc(t.startTime)}</strong>` : ''}</div></div>${statusBadge(t.status)}</div>
      <div class="tmeta"><span>Porų: <b>${teams == null ? '—' : esc(teams)}</b></span>${note}${t.revision > 1 ? `<span class="muted">Pataisyta (v${esc(t.revision)})</span>` : ''}</div>
      <a class="btn" href="#turnyrai/${encodeURIComponent(t.id)}${seasonId ? `?s=${encodeURIComponent(seasonId)}` : ''}">${t.status === 'finalized' ? 'Pilni rezultatai' : 'Informacija'}</a>
    </article>`;
  }).join('')}</div>`;
}

const AFFECT_TEXT = {
  elite: 'ELITE porų reitingas',
  challenge: 'CHALLENGE porų reitingas',
  future: 'FUTURE reitingas',
};

export function renderTournamentDetail({ view, backHref }) {
  const t = view.tournament;
  const info = typeInfo(t.type);
  let body;
  if (!view.official) {
    body = renderEmpty('Rezultatai dar nepaskelbti', 'Oficialūs rezultatai bus rodomi po organizatorių patvirtinimo.');
  } else {
    const rows = view.teams.map((team, i) => {
      const prev = view.teams[i - 1];
      const shared = view.teams.some((x, j) => j !== i && x.position === team.position);
      const hide = prev && prev.position === team.position ? ' same' : '';
      return `<tr class="${MEDALS[team.position] ? `medal-${team.position}` : ''}${hide}">
        <td data-label="Vieta"><span class="pos">${MEDALS[team.position] ? `<span aria-hidden="true">${MEDALS[team.position]}</span> ` : ''}${esc(team.position)}${shared ? '=' : ''}</span></td>
        <td data-label="Pora">${team.teamName ? `<div class="team">${esc(team.teamName)}</div>` : ''}${team.players.map((p) => `<div>${esc(p.name)}</div>`).join('')}</td>
        <td data-label="Taškai porai" class="pts">${view.scored ? esc(team.points) : '–'}</td>
      </tr>`;
    }).join('');
    const affects = view.affects.length
      ? `Šio turnyro taškai įskaičiuojami į: <strong>${view.affects.map((a) => esc(AFFECT_TEXT[a])).join('</strong> ir <strong>')}</strong>. Taškai skiriami porai vieną kartą (nedubliuojami).`
      : 'Šio renginio taškų sistema dar nenustatyta, todėl rezultatai į jokį reitingą neįskaičiuojami.';
    body = `<div class="impact">${affects}</div>
      <p class="muted">Porų: ${esc(view.teamCount)}${t.revision > 1 ? ` · Rezultatai pataisyti (versija ${esc(t.revision)})` : ''}</p>
      ${(view.incomplete || []).map((g) => `<div class="notice warning" data-incomplete="${esc(g.position)}">Nepilni duomenys: ${esc(g.position)}–${esc(g.position + g.declared - 1)} vietų grupėje žinomos ${esc(g.known)} iš ${esc(g.declared)} porų (trūksta ${esc(g.missing)}). Trūkstama pora nekuriama; taškai (po ${esc((view.teams.find((x) => x.position === g.position) || {}).points)} porai) skaičiuojami pagal visą grupę.</div>`).join('')}
      <div class="ttable-wrap"><table class="ttable"><thead><tr><th>Vieta</th><th>Pora</th><th>Taškai porai</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  return `<a class="back" href="${esc(backHref)}">← Visi turnyrai</a>
    <article class="tdetail ${typeClass(t.type)}">
      <div class="ttop"><div><h2>${esc(info.emoji || '')} ${esc(t.name)}</h2><div class="tdate">${esc(formatDate(t.date))}${t.startTime ? ` · ${esc(t.startTime)}` : ''}</div></div>${statusBadge(t.status)}</div>
      ${body}
    </article>`;
}

// ───────────────────────── Taisyklės ─────────────────────────

function bandLabel(band) {
  if (band.to == null) return `${band.from} ir žemiau (dalyvavimas)`;
  return band.from === band.to ? String(band.from) : `${band.from}–${band.to}`;
}

export function renderPointsTable(version = DEFAULT_SCORING_VERSION, tables = SCORING_TABLES) {
  const set = tables[version].tables;
  const reference = set.elite;
  const rows = reference.map((band, i) => `<tr><td>${esc(bandLabel(band))}</td>${RANKED_CATEGORIES.map((c) => `<td class="pts">${esc(set[c][i].points)}</td>`).join('')}</tr>`).join('');
  return `<table class="ptable"><thead><tr><th>Galutinė vieta</th>${RANKED_CATEGORIES.map((c) => `<th class="${typeClass(c)}">${esc(CATEGORIES[c].label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderRules(version = DEFAULT_SCORING_VERSION) {
  return `<section class="card rules" id="taisykles" aria-labelledby="rules-title">
    <h2 id="rules-title">Reitingavimo taisyklės</h2>
    <ol class="rules-list">
      <li><strong>Reitingas porų, ne atskirų žaidėjų.</strong> Kiekviena lentelės eilutė yra viena pora (abu žaidėjai kartu). Poros taškai skiriami vieną kartą ir nedubliuojami, atskirų žaidėjų įrašų nėra.</li>
      <li><strong>Partnerių keitimas.</strong> Žaidėjas su kitu partneriu sudaro kitą porą: skirtingų porų taškai niekada nesumuojami ir neperkeliami.</li>
      <li><strong>Du atskiri reitingai.</strong> ELITE porų reitingą sudaro tik ELITE turnyrų taškai, CHALLENGE porų reitingą – tik CHALLENGE turnyrų taškai. Bendro reitingo nėra, kategorijų taškai nesumuojami. Kiekvienoje kategorijoje poros taškai kaupiami per sezono turnyrus.</li>
      <li><strong>Tik patvirtinti rezultatai.</strong> Į oficialų reitingą įskaitomi tik paskelbti (patvirtinti) turnyrų rezultatai. Juodraščiai ir nepatvirtinti rezultatai taškų neduoda.</li>
      <li><strong>Taškų lentelė</strong> (taškai porai už galutinę vietą turnyre):
        <div class="ptable-wrap">${renderPointsTable(version)}</div></li>
      <li><strong>BEACH LEAGUE FINAL.</strong> Taškų sistema šiam renginiui dar nepatvirtinta, todėl jo rezultatai į reitingus kol kas neįskaičiuojami.</li>
      <li><strong>Lygūs taškai.</strong> Vieta nustatoma pagal: 1) daugiau pirmų vietų; 2) daugiau antrų vietų; 3) daugiau sužaistų patvirtintų turnyrų. Jei vis tiek lygu, poros dalijasi ta pačia vieta (pažymėta „=“). Vardas ar pavardė vietos nenulemia.</li>
      <li><strong>Pasidalintos vietos turnyre.</strong> Pagal nutylėjimą kiekviena pora užima atskirą vietą. Jei organizatoriai turnyrui leidžia pasidalintas vietas, pasidalinusios poros užima visas tos grupės vietas ir kiekviena gauna jų taškų vidurkį (pvz. ELITE 5–6 vietos: (22 + 20) / 2 = 21; CHALLENGE 5–8 vietos: (18 + 16 + 14 + 12) / 4 = 15), o kita vieta praleidžiama (pvz. 1, 2, 2, 4). Vietoms 9–12 ir 13–16 taškai vienodi, todėl joms vietų dalytis nebūtina.</li>
      <li><strong>Pataisymai.</strong> Jei paskelbtame rezultate randama klaida, jis pataisomas ir reitingai perskaičiuojami iš to paties šaltinio – taškai niekada nesidubliuoja.</li>
      <li><strong>Judėjimas (▲/▼).</strong> Rodo vietos pokytį, palyginus su lentele prieš paskutinį tos kategorijos turnyrą. Kol kategorijoje yra tik vienas patvirtintas turnyras, judėjimas nerodomas.</li>
    </ol>
  </section>`;
}
