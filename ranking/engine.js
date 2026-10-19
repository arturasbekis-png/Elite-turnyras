// Vienintelis deterministinis reitingų skaičiavimo variklis.
// Gryni (be šalutinio poveikio) funkcijų rinkiniai: veikia naršyklėje ir Node testuose.
//
// Duomenų rinkinys (dataset), su kuriuo dirba variklis:
// {
//   seasons:        [{ id, label, isCurrent, scoringVersion }],
//   players:        [{ id, fullName, gender?, isActive, mergedInto? }],
//   tournaments:    [{ id, seasonId, type, number, name, date, status, allowTies, scoringVersion? }],
//   participations: [{ id, tournamentId, teamName?, playerIds: [a, b], position }],
// }
// Oficialų reitingą veikia TIK turnyrai, kurių status === 'finalized'.

import {
  RANKED_CATEGORIES, EVENT_TYPES, SCORING_TABLES, DEFAULT_SCORING_VERSION,
  OFFICIAL_STATUS, MIN_TEAMS_TO_FINALIZE,
} from './config.js';

const collator = new Intl.Collator('lt');

// ───────────────────────── Taškai ─────────────────────────

/** Grąžina taškų juostas (bands) renginio tipui arba null, jei to tipo taškai nenustatyti. */
export function scoringTableFor(eventType, version = DEFAULT_SCORING_VERSION, tables = SCORING_TABLES) {
  const type = EVENT_TYPES[eventType];
  if (!type || !type.scoringKey) return null;
  const set = tables[version];
  if (!set) throw new Error(`Nežinoma taškų lentelės versija: ${version}`);
  return set.tables[type.scoringKey] || null;
}

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Taškai už galutinę komandos vietą. Kiekvienas poros žaidėjas gauna VISUS šiuos taškus. */
export function pointsForPosition(bands, position) {
  if (!Number.isInteger(position) || position < 1) {
    throw new RangeError(`Netinkama vieta: ${position}`);
  }
  const band = bands.find((b) => position >= b.from && (b.to == null || position <= b.to));
  if (!band) throw new RangeError(`Vietai ${position} taškų lentelėje nėra eilutės`);
  return band.points;
}

/**
 * Taškai komandai, pasidalinusiai vietą. Jei vietą dalijasi `size` komandų, jos užima vietas
 * position … position+size-1, o KIEKVIENA komanda gauna šių vietų taškų VIDURKĮ
 * (pvz. ELITE 5–6: (22+20)/2 = 21; CHALLENGE 5–8: (18+16+14+12)/4 = 15).
 * Kai vietos nedalijamos (size = 1), grąžinami įprasti taškai. Rezultatas apvalinamas iki 2 skaitmenų po kablelio.
 * Kiekvienas poros narys vis tiek gauna VISUS šiuos taškus.
 */
export function sharedPlacePoints(bands, position, size = 1) {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`Netinkamas dalijančių vietą komandų skaičius: ${size}`);
  let sum = 0;
  for (let i = 0; i < size; i++) sum += pointsForPosition(bands, position + i);
  return round2(sum / size);
}

/**
 * Kiek komandų dalijasi kiekvieną vietą: Map(vieta → komandų skaičius). Ignoruoja netinkamas vietas.
 * Jei įrašas nurodo `groupSize` (pvz. šaltinyje parašyta „5–8“, t. y. 4 komandos, nors žinomos tik 3), grupės dydis
 * yra didesnis iš žinomų komandų ir deklaruoto dydžio – taškai nepriklauso nuo to, kad viena komanda dar nesuvesta.
 */
export function positionCounts(list) {
  const counts = new Map();
  for (const p of list || []) {
    if (Number.isInteger(p.position) && p.position >= 1) counts.set(p.position, (counts.get(p.position) || 0) + 1);
  }
  for (const p of list || []) {
    if (Number.isInteger(p.position) && p.position >= 1 && Number.isInteger(p.groupSize) && p.groupSize > (counts.get(p.position) || 0)) {
      counts.set(p.position, p.groupSize);
    }
  }
  return counts;
}

/**
 * Nepilnos pasidalintų vietų grupės: deklaruotas grupės dydis didesnis už žinomų komandų skaičių.
 * Grąžina [{ position, declared, known, missing }]. Trūkstamos komandos NIEKADA nekuriamos.
 */
export function incompleteGroups(list) {
  const known = new Map();
  const declared = new Map();
  for (const p of list || []) {
    if (!(Number.isInteger(p.position) && p.position >= 1)) continue;
    known.set(p.position, (known.get(p.position) || 0) + 1);
    if (Number.isInteger(p.groupSize)) declared.set(p.position, Math.max(declared.get(p.position) || 0, p.groupSize));
  }
  return [...declared.entries()]
    .filter(([position, size]) => size > known.get(position))
    .map(([position, size]) => ({ position, declared: size, known: known.get(position), missing: size - known.get(position) }))
    .sort((a, b) => a.position - b.position);
}

/** Taškai vienai komandai, atsižvelgiant į tai, kiek komandų dalijasi jos vietą tame pačiame turnyre. */
export function pointsForEntry(bands, position, counts) {
  return sharedPlacePoints(bands, position, (counts && counts.get(position)) || 1);
}

function versionFor(dataset, tournament) {
  if (tournament.scoringVersion) return tournament.scoringVersion;
  const season = (dataset.seasons || []).find((s) => s.id === tournament.seasonId);
  return (season && season.scoringVersion) || DEFAULT_SCORING_VERSION;
}

/** Taškų peržiūra prieš paskelbimą: kiek taškų gaus kiekviena komanda ir žaidėjas. */
export function previewPoints({ tournament, participations, scoringVersion, tables = SCORING_TABLES }) {
  const bands = scoringTableFor(tournament.type, scoringVersion || tournament.scoringVersion || DEFAULT_SCORING_VERSION, tables);
  const counts = positionCounts(participations);
  const rows = (participations || []).map((p) => ({
    participationId: p.id,
    playerIds: p.playerIds,
    position: p.position,
    points: bands && Number.isInteger(p.position) && p.position >= 1 ? pointsForEntry(bands, p.position, counts) : 0,
  }));
  return { scored: Boolean(bands), rows };
}

// ───────────────────────── Validacija ─────────────────────────

function teamLabel(p, index) {
  return p.teamName ? `„${p.teamName}“` : `komanda Nr. ${index + 1}`;
}

/**
 * Tikrina, ar rezultatus galima patvirtinti.
 * input: { tournament: {type, allowTies}, participations: [...], players?: [...] }
 * Grąžina { valid, errors: [{code, message, ...}], warnings: [...] }.
 */
export function validateResults({ tournament, participations, players }) {
  const errors = [];
  const warnings = [];
  const add = (code, message, extra = {}) => errors.push({ code, message, ...extra });
  const list = participations || [];
  const known = players ? new Map(players.map((p) => [p.id, p])) : null;
  const nameOf = (id) => (known && known.get(id) ? known.get(id).fullName : String(id));

  if (list.length < MIN_TEAMS_TO_FINALIZE) {
    add('too_few_teams', `Turnyre turi būti bent ${MIN_TEAMS_TO_FINALIZE} komandos.`);
  }

  const seenParticipation = new Set();
  const seenPlayer = new Map();
  const seenPair = new Set();

  list.forEach((p, i) => {
    const label = teamLabel(p, i);
    if (p.id != null) {
      if (seenParticipation.has(p.id)) add('duplicate_team', `Komanda ${label} įrašyta du kartus.`, { participationId: p.id });
      seenParticipation.add(p.id);
    }
    const ids = Array.isArray(p.playerIds) ? p.playerIds : [];
    if (ids.length !== 2 || ids.some((id) => !id)) {
      add('team_needs_two_players', `Komanda ${label}: turi būti pasirinkti du žaidėjai.`, { participationId: p.id });
      return;
    }
    if (ids[0] === ids[1]) {
      add('same_player_twice', `Komanda ${label}: tas pats žaidėjas pasirinktas du kartus.`, { participationId: p.id });
      return;
    }
    const pairKey = [...ids].sort().join('|');
    if (seenPair.has(pairKey)) add('duplicate_team', `Ta pati komanda (${ids.map(nameOf).join(' ir ')}) įrašyta du kartus.`, { participationId: p.id });
    seenPair.add(pairKey);

    ids.forEach((id) => {
      if (known) {
        const pl = known.get(id);
        if (!pl) add('unknown_player', `Komanda ${label}: žaidėjo įrašas nerastas.`, { participationId: p.id, playerId: id });
        else if (pl.mergedInto) add('merged_player', `Žaidėjas ${pl.fullName} sujungtas su kitu įrašu – pasirinkite pagrindinį įrašą.`, { participationId: p.id, playerId: id });
      }
      if (seenPlayer.has(id)) {
        add('player_in_two_teams', `Žaidėjas ${nameOf(id)} įrašytas į kelias komandas tame pačiame turnyre.`, { participationId: p.id, playerId: id });
      } else {
        seenPlayer.set(id, i);
      }
    });
  });

  // Vietos
  let positionsOk = true;
  list.forEach((p, i) => {
    const label = teamLabel(p, i);
    if (p.position == null || p.position === '') {
      positionsOk = false;
      add('missing_position', `Komanda ${label}: nenurodyta galutinė vieta.`, { participationId: p.id });
    } else if (!Number.isInteger(p.position) || p.position < 1) {
      positionsOk = false;
      add('invalid_position', `Komanda ${label}: vieta turi būti sveikasis skaičius nuo 1.`, { participationId: p.id });
    } else if (p.position > list.length) {
      positionsOk = false;
      add('position_out_of_range', `Komanda ${label}: vieta ${p.position} didesnė nei komandų skaičius (${list.length}).`, { participationId: p.id });
    }
  });

  if (positionsOk && list.length > 0) {
    if (!tournament || !tournament.allowTies) {
      const counts = new Map();
      list.forEach((p) => counts.set(p.position, (counts.get(p.position) || 0) + 1));
      [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => a[0] - b[0]).forEach(([pos]) => {
        add('duplicate_position', `Kelios komandos turi tą pačią ${pos} vietą. Šiam turnyrui lygios vietos neleidžiamos.`, { position: pos });
      });
    } else {
      // „1-2-2-4“ taisyklė: vieta = 1 + kiek komandų turi griežtai geresnę vietą.
      list.forEach((p, i) => {
        const expected = 1 + list.filter((q) => q.position < p.position).length;
        if (p.position !== expected) {
          add('invalid_tie_positions', `Komanda ${teamLabel(p, i)}: pasidalinus vietą kita vieta praleidžiama – čia turėtų būti ${expected}, o nurodyta ${p.position}.`, { participationId: p.id });
        }
      });
    }
  }

  list.forEach((p, i) => {
    if (p.groupSize == null) return;
    const same = list.filter((q) => q.position === p.position).length;
    if (!Number.isInteger(p.groupSize) || p.groupSize < same || p.groupSize < 2) {
      add('invalid_group_size', `Komanda ${teamLabel(p, i)}: nurodytas netinkamas pasidalintos vietos grupės dydis (${p.groupSize}).`, { participationId: p.id });
    }
  });

  if (tournament && !scoringTableFor(tournament.type)) {
    warnings.push({ code: 'unscored_event', message: 'Šio renginio taškų sistema dar nenustatyta – rezultatai bus paskelbti, bet į reitingus neįskaičiuojami.' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ───────────────────────── Rezultatų sudarymas ─────────────────────────

/** Sujungtų žaidėjų ID išsprendimas (mergedInto grandinė su apsauga nuo ciklų). */
export function makeResolver(players) {
  const byId = new Map((players || []).map((p) => [p.id, p]));
  return function resolve(id) {
    let current = id;
    const seen = new Set();
    while (byId.has(current) && byId.get(current).mergedInto && !seen.has(current)) {
      seen.add(current);
      current = byId.get(current).mergedInto;
    }
    return current;
  };
}

/**
 * Visi žaidėjų turnyrų rezultatai (po vieną įrašą žaidėjui už turnyrą).
 * Tik patvirtinti turnyrai. `counted` = ar taškai įskaičiuojami į reitingus.
 * Jei duomenyse vis dėlto yra pasikartojimų, žaidėjas to paties turnyro taškų negauna dukart
 * – pasikartojimas aprašomas `anomalies`.
 */
export function buildPlayerResults(dataset, { seasonId } = {}) {
  const resolve = makeResolver(dataset.players);
  const results = [];
  const anomalies = [];
  const tournaments = (dataset.tournaments || [])
    .filter((t) => t.status === OFFICIAL_STATUS && (seasonId == null || t.seasonId === seasonId));

  for (const t of tournaments) {
    const bands = scoringTableFor(t.type, versionFor(dataset, t));
    const type = EVENT_TYPES[t.type];
    const parts = (dataset.participations || [])
      .filter((p) => p.tournamentId === t.id)
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const seen = new Set();
    const counts = positionCounts(parts);
    for (const p of parts) {
      if (!Number.isInteger(p.position) || p.position < 1) continue;
      const points = bands ? pointsForEntry(bands, p.position, counts) : 0;
      const ids = (p.playerIds || []).map(resolve);
      for (const playerId of ids) {
        if (seen.has(playerId)) {
          anomalies.push({ code: 'duplicate_player_in_tournament', tournamentId: t.id, playerId, participationId: p.id });
          continue;
        }
        seen.add(playerId);
        results.push({
          playerId,
          tournamentId: t.id,
          tournamentName: t.name,
          seasonId: t.seasonId,
          date: t.date,
          type: t.type,
          category: type ? type.category : null,
          participationId: p.id,
          teamName: p.teamName || null,
          partnerIds: ids.filter((x) => x !== playerId),
          position: p.position,
          points,
          counted: Boolean(bands && type && type.category),
        });
      }
    }
  }
  return { results, anomalies };
}

function emptyAgg(playerId) {
  const perCat = () => ({ points: 0, played: 0, wins: 0, seconds: 0, results: [] });
  return {
    playerId,
    points: 0,
    played: 0,
    totalWins: 0,
    eliteWins: 0,
    eliteSeconds: 0,
    categories: { elite: perCat(), challenge: perCat(), future: perCat() },
    results: [],
  };
}

function aggregate(results) {
  const map = new Map();
  for (const r of results) {
    if (!map.has(r.playerId)) map.set(r.playerId, emptyAgg(r.playerId));
    const a = map.get(r.playerId);
    a.results.push(r);
    if (!r.counted) continue;
    const c = a.categories[r.category];
    a.points = round2(a.points + r.points);
    a.played += 1;
    c.points = round2(c.points + r.points);
    c.played += 1;
    c.results.push(r);
    if (r.position === 1) { a.totalWins += 1; c.wins += 1; }
    if (r.position === 2) c.seconds += 1;
  }
  for (const a of map.values()) {
    a.eliteWins = a.categories.elite.wins;
    a.eliteSeconds = a.categories.elite.seconds;
    a.results.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.tournamentId).localeCompare(String(y.tournamentId))));
    for (const c of Object.values(a.categories)) {
      c.results.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.tournamentId).localeCompare(String(y.tournamentId))));
    }
  }
  return map;
}

/**
 * Rūšiuoja pagal raktų sąrašą (visi mažėjimo tvarka) ir priskiria vietas.
 * Žaidėjai, kurių visi raktai vienodi, gauna TĄ PAČIĄ vietą (1-2-2-4). Vardas naudojamas tik
 * eilės tvarkai rodyti tarp lygių žaidėjų – jis niekada nekeičia vietos.
 */
export function rankRows(rows, keyFn, nameFn) {
  const keyed = rows.map((row) => ({ row, key: keyFn(row) }));
  const cmp = (a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
    }
    return 0;
  };
  keyed.sort((a, b) => cmp(a, b) || collator.compare(nameFn(a.row), nameFn(b.row)) || String(a.row.playerId).localeCompare(String(b.row.playerId)));
  let position = 0;
  const ranked = keyed.map((entry, index) => {
    if (index === 0 || cmp(keyed[index - 1], entry) !== 0) position = index + 1;
    return { ...entry.row, position };
  });
  const sizes = new Map();
  ranked.forEach((r) => sizes.set(r.position, (sizes.get(r.position) || 0) + 1));
  return ranked.map((r) => ({ ...r, tied: sizes.get(r.position) > 1 }));
}

const playerIndex = (players) => new Map((players || []).map((p) => [p.id, p]));

function overallRows(aggs, players) {
  const idx = playerIndex(players);
  const rows = [...aggs.values()].filter((a) => a.played > 0).map((a) => {
    const p = idx.get(a.playerId) || {};
    return {
      playerId: a.playerId,
      name: p.fullName || '—',
      gender: p.gender || null,
      points: a.points,
      played: {
        elite: a.categories.elite.played,
        challenge: a.categories.challenge.played,
        future: a.categories.future.played,
        total: a.played,
      },
      wins: a.totalWins,
      eliteWins: a.eliteWins,
      eliteSeconds: a.eliteSeconds,
      categoryPoints: {
        elite: a.categories.elite.points,
        challenge: a.categories.challenge.points,
        future: a.categories.future.points,
      },
      results: a.results,
    };
  });
  // 1) ELITE pergalės 2) visos pergalės 3) ELITE antros vietos 4) sužaisti turnyrai 5) ta pati vieta
  return rankRows(rows, (r) => [r.points, r.eliteWins, r.wins, r.eliteSeconds, r.played.total], (r) => r.name);
}

function categoryRows(aggs, players, category) {
  const idx = playerIndex(players);
  const rows = [...aggs.values()].filter((a) => a.categories[category].played > 0).map((a) => {
    const c = a.categories[category];
    const p = idx.get(a.playerId) || {};
    return {
      playerId: a.playerId,
      name: p.fullName || '—',
      gender: p.gender || null,
      points: c.points,
      played: c.played,
      wins: c.wins,
      seconds: c.seconds,
      results: c.results,
    };
  });
  // 1) pergalės kategorijoje 2) antros vietos kategorijoje 3) sužaisti turnyrai 4) ta pati vieta
  return rankRows(rows, (r) => [r.points, r.wins, r.seconds, r.played], (r) => r.name);
}

/**
 * Pagrindinė funkcija: visi sezono reitingai iš VIENO oficialių rezultatų šaltinio.
 * Grąžina { overall, categories: {elite, challenge, future}, results, anomalies, movementAvailable }.
 */
export function computeRankings(dataset, { seasonId } = {}) {
  const { results, anomalies } = buildPlayerResults(dataset, { seasonId });
  const aggs = aggregate(results);
  const overall = overallRows(aggs, dataset.players);
  const categories = {};
  for (const cat of RANKED_CATEGORIES) categories[cat] = categoryRows(aggs, dataset.players, cat);

  const movement = computeMovement(dataset, seasonId, overall);
  const withMovement = overall.map((r) => ({
    ...r,
    movement: movement ? (movement.has(r.playerId) ? movement.get(r.playerId) : 'new') : null,
  }));
  return { overall: withMovement, categories, results, anomalies, movementAvailable: Boolean(movement) };
}

/**
 * Judėjimas: palyginama dabartinė lentelė su lentele be PASKUTINIO patvirtinto turnyro
 * (pagal datą). Teigiama reikšmė = pakilo. Be istorinių duomenų (mažiau nei 2 turnyrai) – null.
 */
function computeMovement(dataset, seasonId, currentOverall) {
  const counted = (dataset.tournaments || [])
    .filter((t) => t.status === OFFICIAL_STATUS && (seasonId == null || t.seasonId === seasonId) && scoringTableFor(t.type, versionFor(dataset, t)))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id))));
  if (counted.length < 2) return null;
  const latest = counted[counted.length - 1];
  const previousDataset = { ...dataset, tournaments: dataset.tournaments.filter((t) => t.id !== latest.id) };
  const prev = buildPlayerResults(previousDataset, { seasonId });
  const prevOverall = overallRows(aggregate(prev.results), dataset.players);
  const prevPos = new Map(prevOverall.map((r) => [r.playerId, r.position]));
  const movement = new Map();
  for (const row of currentOverall) {
    if (prevPos.has(row.playerId)) movement.set(row.playerId, prevPos.get(row.playerId) - row.position);
  }
  return movement;
}

// ───────────────────────── Turnyro vaizdas ─────────────────────────

/** Turnyro rezultatai ir jų poveikis reitingams (naudojama „Turnyrų rezultatai“ skiltyje). */
export function tournamentView(dataset, tournamentId) {
  const t = (dataset.tournaments || []).find((x) => x.id === tournamentId);
  if (!t) return null;
  const idx = playerIndex(dataset.players);
  const type = EVENT_TYPES[t.type];
  const bands = scoringTableFor(t.type, versionFor(dataset, t));
  const official = t.status === OFFICIAL_STATUS;
  const parts = official ? (dataset.participations || []).filter((p) => p.tournamentId === t.id) : [];
  const counts = positionCounts(parts);
  const teams = parts
    .map((p) => ({
      participationId: p.id,
      teamName: p.teamName || null,
      position: p.position,
      players: (p.playerIds || []).map((id) => ({ id, name: (idx.get(id) || {}).fullName || '—' })),
      points: bands && Number.isInteger(p.position) && p.position >= 1 ? pointsForEntry(bands, p.position, counts) : 0,
    }))
    .sort((a, b) => a.position - b.position || collator.compare(a.players.map((x) => x.name).join(), b.players.map((x) => x.name).join()));
  return {
    tournament: t,
    official,
    scored: Boolean(bands),
    teamCount: teams.length,
    teams,
    incomplete: official ? incompleteGroups(parts) : [],
    affects: official && bands && type && type.category ? ['overall', type.category] : [],
  };
}

// ───────────────────────── Visų sezonų statistika ─────────────────────────

/**
 * Istorinė (visų sezonų) statistika. Tai NE sezono reitingas: taškai sumuojami per visus sezonus
 * pagal tas pačias taisykles ir rodomi atskirai nuo dabartinio sezono lentelės.
 */
export function computeAllTime(dataset) {
  // Bandomieji sezonai (bandymo režimas) į istorinę statistiką niekada neįtraukiami.
  const testSeasons = new Set((dataset.seasons || []).filter((s) => s.isTest).map((s) => s.id));
  if (testSeasons.size) {
    const keep = (dataset.tournaments || []).filter((t) => !testSeasons.has(t.seasonId));
    const ids = new Set(keep.map((t) => t.id));
    dataset = { ...dataset, tournaments: keep, participations: (dataset.participations || []).filter((p) => ids.has(p.tournamentId)) };
  }
  const { results } = buildPlayerResults(dataset, {});
  const aggs = aggregate(results);
  const rows = overallRows(aggs, dataset.players);
  const seasonsBy = new Map();
  for (const r of results.filter((x) => x.counted)) {
    if (!seasonsBy.has(r.playerId)) seasonsBy.set(r.playerId, new Set());
    seasonsBy.get(r.playerId).add(r.seasonId);
  }
  return rows.map((r) => ({ ...r, seasons: (seasonsBy.get(r.playerId) || new Set()).size }));
}
