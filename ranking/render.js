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

/** Žaidėjo turnyrų suvestinė (išskleidžiama po eilute). */
export function renderPlayerDetail(row, playersById) {
  const results = row.results || [];
  if (!results.length) return '<p class="muted">Šis žaidėjas dar neturi patvirtintų rezultatų.</p>';
  const body = results.map((r) => {
    const partners = r.partnerIds.map((id) => (playersById.get(id) || {}).fullName || '—').join(', ');
    const info = typeInfo(r.type);
    return `<tr>
      <td data-label="Turnyras"><span class="tag ${typeClass(r.type)}">${esc(info.emoji || '')} ${esc(r.tournamentName)}</span></td>
      <td data-label="Data">${esc(formatDate(r.date))}</td>
      <td data-label="Vieta">${esc(r.position)}</td>
      <td data-label="Partneris">${esc(partners || '—')}</td>
      <td data-label="Taškai" class="pts">${r.counted ? esc(r.points) : '<span title="Šio renginio taškų sistema dar nenustatyta">–</span>'}</td>
    </tr>`;
  }).join('');
  const counted = results.filter((r) => r.counted);
  const sum = Math.round(counted.reduce((s, r) => s + r.points, 0) * 100) / 100;
  return `<div class="dwrap"><table class="dtable"><thead><tr><th>Turnyras</th><th>Data</th><th>Vieta</th><th>Partneris</th><th>Taškai</th></tr></thead><tbody>${body}</tbody>
    <tfoot><tr><td colspan="4">Taškų suma (${counted.length} įskaitomi turnyrai)</td><td class="pts">${esc(sum)}</td></tr></tfoot></table></div>`;
}

// ───────────────────────── Reitingų lentelės ─────────────────────────

function listWrap(inner, head) {
  return `<div class="rtable" role="list">${head}<ol class="rlist">${inner}</ol></div>`;
}

export function renderOverall({ rows, expanded = new Set(), playersById = new Map(), movementAvailable = false }) {
  const head = `<div class="rhead rgrid overall" aria-hidden="true"><span>Vieta</span><span>Žaidėjas</span><span class="r">Taškai</span>
    <span class="r cat-elite">ELITE</span><span class="r cat-challenge">CHALLENGE</span><span class="r cat-future">FUTURE</span><span class="r">Viso</span><span class="r">🥇</span><span class="r">Judėjimas</span></div>`;
  const items = rows.map((row) => {
    const open = expanded.has(row.playerId);
    return `<li class="rrow${open ? ' open' : ''}">
      <button type="button" class="rmain rgrid overall" data-toggle="${esc(row.playerId)}" aria-expanded="${open}">
        ${posCell(row)}
        <span class="rname"><span class="n">${esc(row.name)}</span></span>
        <span class="rpts"><b>${esc(row.points)}</b><small>tšk.</small></span>
        <span class="rstats">
          <span class="rstat cat-elite" data-label="ELITE">${esc(row.played.elite)}</span>
          <span class="rstat cat-challenge" data-label="CHALLENGE">${esc(row.played.challenge)}</span>
          <span class="rstat cat-future" data-label="FUTURE">${esc(row.played.future)}</span>
          <span class="rstat" data-label="Viso turnyrų">${esc(row.played.total)}</span>
          <span class="rstat" data-label="🥇 Pirmos vietos">${esc(row.wins)}</span>
          ${movementCell(row, movementAvailable)}
        </span>
      </button>
      <div class="rdetail"${open ? '' : ' hidden'}>${open ? renderPlayerDetail(row, playersById) : ''}</div>
    </li>`;
  }).join('');
  return listWrap(items, head);
}

export function renderCategory({ category, rows, expanded = new Set(), playersById = new Map() }) {
  const info = CATEGORIES[category];
  const head = `<div class="rhead rgrid cat" aria-hidden="true"><span>Vieta</span><span>Žaidėjas</span><span class="r">Taškai</span><span class="r">Turnyrai</span><span class="r">Pergalės</span></div>`;
  const items = rows.map((row) => {
    const open = expanded.has(`${category}:${row.playerId}`);
    const chips = row.results.map((r) => chip(r)).join('');
    return `<li class="rrow${open ? ' open' : ''}">
      <button type="button" class="rmain rgrid cat" data-toggle="${esc(category)}:${esc(row.playerId)}" aria-expanded="${open}">
        ${posCell(row)}
        <span class="rname"><span class="n">${esc(row.name)}</span><span class="chips" aria-label="Taškai pagal turnyrus">${chips}</span></span>
        <span class="rpts"><b>${esc(row.points)}</b><small>tšk.</small></span>
        <span class="rstats">
          <span class="rstat" data-label="Turnyrai">${esc(row.played)}</span>
          <span class="rstat" data-label="Pergalės">${esc(row.wins)}</span>
        </span>
      </button>
      <div class="rdetail"${open ? '' : ' hidden'}>${open ? renderPlayerDetail({ results: row.results }, playersById) : ''}</div>
    </li>`;
  }).join('');
  return `<div class="cat-banner ${typeClass(category)}">${esc(info.emoji)} ${esc(info.label)} reitingas · skaičiuojami tik ${esc(info.label)} turnyrų taškai</div>${listWrap(items, head)}`;
}

/** Žaidėjų paieškos / rūšiavimo juosta. */
export function renderControls({ query = '', sort = 'points', gender = '', showGender = false, total = 0, shown = 0 }) {
  const opt = (value, label) => `<option value="${value}"${sort === value ? ' selected' : ''}>${label}</option>`;
  return `<div class="controls">
    <label class="field grow"><span class="sr">Ieškoti žaidėjo</span><input type="search" data-control="query" value="${esc(query)}" placeholder="Ieškoti žaidėjo pagal vardą…" autocomplete="off"></label>
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
      <div class="tmeta"><span>Komandų: <b>${teams == null ? '—' : esc(teams)}</b></span>${note}${t.revision > 1 ? `<span class="muted">Pataisyta (v${esc(t.revision)})</span>` : ''}</div>
      <a class="btn" href="#turnyrai/${encodeURIComponent(t.id)}${seasonId ? `?s=${encodeURIComponent(seasonId)}` : ''}">${t.status === 'finalized' ? 'Pilni rezultatai' : 'Informacija'}</a>
    </article>`;
  }).join('')}</div>`;
}

const AFFECT_TEXT = {
  overall: 'BENDRAS REITINGAS',
  elite: 'ELITE reitingas',
  challenge: 'CHALLENGE reitingas',
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
        <td data-label="Komanda">${team.teamName ? `<div class="team">${esc(team.teamName)}</div>` : ''}${team.players.map((p) => `<div>${esc(p.name)}</div>`).join('')}</td>
        <td data-label="Taškai kiekvienam žaidėjui" class="pts">${view.scored ? esc(team.points) : '–'}</td>
      </tr>`;
    }).join('');
    const affects = view.affects.length
      ? `Šio turnyro taškai įskaičiuojami į: <strong>${view.affects.map((a) => esc(AFFECT_TEXT[a])).join('</strong> ir <strong>')}</strong>. Abu poros žaidėjai gauna visus nurodytus taškus.`
      : 'Šio renginio taškų sistema dar nenustatyta, todėl rezultatai į jokį reitingą neįskaičiuojami.';
    body = `<div class="impact">${affects}</div>
      <p class="muted">Komandų: ${esc(view.teamCount)}${t.revision > 1 ? ` · Rezultatai pataisyti (versija ${esc(t.revision)})` : ''}</p>
      <div class="ttable-wrap"><table class="ttable"><thead><tr><th>Vieta</th><th>Komanda</th><th>Taškai kiekvienam žaidėjui</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
      <li><strong>Reitingas individualus.</strong> Taškai skiriami kiekvienam žaidėjui pagal jo komandos galutinę oficialią vietą turnyre. Abu poros žaidėjai gauna visus taškus – jie nedalijami per pusę.</li>
      <li><strong>Partnerių keitimas.</strong> Pakeitus partnerį anksčiau uždirbti taškai nedingsta ir neperkeliami: kiekvienas žaidėjas pasilieka taškus iš turnyrų, kuriuose pats žaidė.</li>
      <li><strong>Tik patvirtinti rezultatai.</strong> Į oficialų reitingą įskaitomi tik paskelbti (patvirtinti) turnyrų rezultatai. Juodraščiai ir nepatvirtinti rezultatai taškų neduoda.</li>
      <li><strong>Bendras ir kategorijų reitingai.</strong> BENDRAS REITINGAS = ELITE + CHALLENGE + FUTURE taškų suma pasirinktame sezone. ELITE, CHALLENGE ir FUTURE reitingai skaičiuojami atskirai, tik pagal savo kategorijos turnyrus. Skirtingų sezonų taškai nesumuojami.</li>
      <li><strong>Taškų lentelė</strong> (taškai kiekvienam žaidėjui už komandos galutinę vietą):
        <div class="ptable-wrap">${renderPointsTable(version)}</div></li>
      <li><strong>BEACH LEAGUE FINAL.</strong> Taškų sistema šiam renginiui dar nepatvirtinta, todėl jo rezultatai į reitingus kol kas neįskaičiuojami.</li>
      <li><strong>Lygūs taškai bendrame reitinge.</strong> Vieta nustatoma pagal: 1) daugiau pirmų vietų ELITE turnyruose; 2) daugiau pirmų vietų iš viso (ELITE, CHALLENGE ir FUTURE); 3) daugiau antrų vietų ELITE turnyruose; 4) daugiau sužaistų patvirtintų turnyrų. Jei vis tiek lygu, žaidėjai dalijasi ta pačia vieta (pažymėta „=“). Vardas ar pavardė vietos nenulemia.</li>
      <li><strong>Lygūs taškai kategorijų reitinguose.</strong> 1) daugiau pirmų vietų tos kategorijos turnyruose; 2) daugiau antrų vietų tos kategorijos turnyruose; 3) daugiau sužaistų tos kategorijos turnyrų; toliau – ta pati vieta.</li>
      <li><strong>Pasidalintos vietos turnyre.</strong> Pagal nutylėjimą kiekviena komanda užima atskirą vietą. Jei organizatoriai turnyrui leidžia pasidalintas vietas, pasidalinusios komandos užima visas tos grupės vietas ir kiekviena gauna jų taškų vidurkį (pvz. ELITE 5–6 vietos: (22 + 20) / 2 = 21; CHALLENGE 5–8 vietos: (18 + 16 + 14 + 12) / 4 = 15), o kita vieta praleidžiama (pvz. 1, 2, 2, 4). Abu poros nariai gauna visus šiuos taškus. Vietoms 9–12 ir 13–16 taškai vienodi, todėl joms vietų dalytis nebūtina.</li>
      <li><strong>Pataisymai.</strong> Jei paskelbtame rezultate randama klaida, jis pataisomas, visi reitingai perskaičiuojami automatiškai, o pakeitimas ir jo priežastis išsaugomi audito žurnale.</li>
      <li><strong>Judėjimas.</strong> Rodo vietos pokytį, palyginus su lentele prieš paskutinį patvirtintą turnyrą. Kol patvirtintas tik vienas turnyras, judėjimas nerodomas.</li>
    </ol>
  </section>`;
}

/** Visų sezonų statistika – atskira nuo sezono reitingo, su aiškiomis taisyklėmis. */
export function renderAllTime(rows) {
  if (!rows.length) return '';
  const top = rows.slice(0, 20).map((r) => `<tr><td>${esc(r.position)}${r.tied ? '=' : ''}</td><td>${esc(r.name)}</td><td class="pts">${esc(r.points)}</td><td>${esc(r.played.total)}</td><td>${esc(r.wins)}</td><td>${esc(r.seasons)}</td></tr>`).join('');
  return `<section class="card alltime" aria-labelledby="alltime-title">
    <h2 id="alltime-title">Visų sezonų statistika</h2>
    <p class="muted">Tai ne sezono reitingas, o istorinė statistika: sumuojami visų sezonų patvirtintų ELITE, CHALLENGE ir FUTURE turnyrų taškai pagal tas pačias taisykles. Lygūs taškai sprendžiami taip pat kaip bendrame reitinge.</p>
    <div class="ttable-wrap"><table class="ttable"><thead><tr><th>Vieta</th><th>Žaidėjas</th><th>Taškai</th><th>Turnyrai</th><th>Pergalės</th><th>Sezonai</th></tr></thead><tbody>${top}</tbody></table></div>
  </section>`;
}
