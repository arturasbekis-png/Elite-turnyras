// Rezultatų gyvavimo ciklas: juodraštis → patvirtinimas → pataisymai su audito žurnalu.
// Tai referencinė (gryna) logika; produkcijoje tas pačias taisykles vykdo Postgres funkcijos
// (supabase/schema.sql), o ši logika naudojama testuose ir lokaliame „demo“ režime.
//
// Visos funkcijos negadina gauto dataset – grąžina naują kopiją.

import { validateResults } from './engine.js';
import { OFFICIAL_STATUS, STATUSES } from './config.js';

export class DomainError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function findTournament(dataset, id) {
  const t = dataset.tournaments.find((x) => x.id === id);
  if (!t) throw new DomainError('tournament_not_found', 'Turnyras nerastas.');
  return t;
}

function snapshot(dataset, tournamentId) {
  return dataset.participations
    .filter((p) => p.tournamentId === tournamentId)
    .map((p) => ({ id: p.id, teamName: p.teamName || null, playerIds: [...p.playerIds], position: p.position }));
}

function pushAudit(next, entry) {
  next.auditLog = next.auditLog || [];
  next.auditLog.push({ id: next.auditLog.length + 1, at: entry.at, actor: entry.actor || null, ...entry.rest });
}

function replaceParticipations(next, tournamentId, entries, nextId) {
  next.participations = next.participations.filter((p) => p.tournamentId !== tournamentId);
  entries.forEach((e) => {
    next.participations.push({
      id: e.id || nextId(),
      tournamentId,
      teamName: e.teamName || null,
      playerIds: [...(e.playerIds || [])],
      position: e.position == null || e.position === '' ? null : Number(e.position),
    });
  });
}

/** Struktūrinė apsauga, kuri galioja ir juodraščiui: ta pati žaidėjas negali būti dviejose komandose. */
function assertNoDuplicatePlayers(entries) {
  const seen = new Set();
  for (const e of entries) {
    for (const id of e.playerIds || []) {
      if (!id) continue;
      if (seen.has(id)) throw new DomainError('player_in_two_teams', 'Tas pats žaidėjas negali dalyvauti dviejose komandose tame pačiame turnyre.');
      seen.add(id);
    }
  }
}

let counter = 0;
const defaultNextId = () => `part-${++counter}`;

/** Išsaugo rezultatų juodraštį. Patvirtinto turnyro taip keisti negalima – tam yra pataisymas. */
export function saveDraft(dataset, tournamentId, entries, { status = 'draft', actor = null, now = new Date().toISOString(), nextId = defaultNextId } = {}) {
  const next = clone(dataset);
  const t = findTournament(next, tournamentId);
  if (t.status === OFFICIAL_STATUS) throw new DomainError('tournament_finalized', 'Turnyras jau patvirtintas. Naudokite rezultatų pataisymą.');
  if (!['in_progress', 'draft', 'awaiting_confirmation'].includes(status)) throw new DomainError('invalid_status', 'Netinkamas statusas.');
  assertNoDuplicatePlayers(entries);
  replaceParticipations(next, tournamentId, entries, nextId);
  t.status = status;
  pushAudit(next, { at: now, actor, rest: { action: 'save_draft', tournamentId, reason: null, before: null, after: { status: STATUSES[status], teams: entries.length } } });
  return next;
}

function assertValid(next, t) {
  const participations = next.participations.filter((p) => p.tournamentId === t.id);
  const check = validateResults({ tournament: t, participations, players: next.players });
  if (!check.valid) throw new DomainError('validation_failed', 'Rezultatų patvirtinti negalima – yra klaidų.', check.errors);
  return check;
}

/**
 * Patvirtina ir paskelbia turnyro rezultatus. Veikia lygiai vieną kartą:
 * pakartotinis kvietimas meta klaidą ir nieko nekeičia (taškai neužskaitomi dukart).
 */
export function finalizeTournament(dataset, tournamentId, { actor = null, now = new Date().toISOString(), scoringVersion = null } = {}) {
  const next = clone(dataset);
  const t = findTournament(next, tournamentId);
  if (t.status === OFFICIAL_STATUS) throw new DomainError('already_finalized', 'Šio turnyro rezultatai jau paskelbti. Taškai antrą kartą neskiriami.');
  assertValid(next, t);
  const season = (next.seasons || []).find((s) => s.id === t.seasonId);
  t.status = OFFICIAL_STATUS;
  t.revision = 1;
  t.finalizedAt = now;
  t.scoringVersion = scoringVersion || t.scoringVersion || (season && season.scoringVersion) || 'v1';
  pushAudit(next, { at: now, actor, rest: { action: 'finalize', tournamentId, reason: null, before: null, after: snapshot(next, tournamentId) } });
  return next;
}

/**
 * Pataiso jau paskelbtus rezultatus. Reikia priežasties; senas variantas išsaugomas audito žurnale.
 * Jei nauji rezultatai neteisingi, viskas lieka kaip buvo (oficialūs rezultatai nepažeidžiami).
 */
export function correctTournament(dataset, tournamentId, entries, { reason, actor = null, now = new Date().toISOString(), nextId = defaultNextId } = {}) {
  const next = clone(dataset);
  const t = findTournament(next, tournamentId);
  if (t.status !== OFFICIAL_STATUS) throw new DomainError('not_finalized', 'Pataisyti galima tik paskelbtus rezultatus.');
  if (!reason || reason.trim().length < 5) throw new DomainError('reason_required', 'Nurodykite pataisymo priežastį (bent 5 simboliai).');
  assertNoDuplicatePlayers(entries);
  const before = snapshot(next, tournamentId);
  replaceParticipations(next, tournamentId, entries, nextId);
  assertValid(next, t);
  t.revision = (t.revision || 1) + 1;
  pushAudit(next, { at: now, actor, rest: { action: 'correct', tournamentId, reason: reason.trim(), before, after: snapshot(next, tournamentId) } });
  return next;
}

/**
 * Sujungia dubliuotus žaidėjų įrašus. Istoriniai rezultatai perkeliami į pagrindinį įrašą.
 * Jei abu įrašai dalyvavo tame pačiame turnyre, sujungti saugiai neįmanoma (reikėtų
 * komandų taisymo) – operacija atmetama.
 */
export function mergePlayers(dataset, keepId, dropId, { reason = null, actor = null, now = new Date().toISOString() } = {}) {
  const next = clone(dataset);
  if (keepId === dropId) throw new DomainError('merge_same', 'Negalima sujungti žaidėjo su juo pačiu.');
  const keep = next.players.find((p) => p.id === keepId);
  const drop = next.players.find((p) => p.id === dropId);
  if (!keep || !drop) throw new DomainError('player_not_found', 'Žaidėjas nerastas.');
  if (keep.mergedInto || drop.mergedInto) throw new DomainError('already_merged', 'Vienas iš įrašų jau sujungtas su kitu.');
  const conflicts = next.tournaments.filter((t) => {
    const ids = next.participations.filter((p) => p.tournamentId === t.id).flatMap((p) => p.playerIds);
    return ids.includes(keepId) && ids.includes(dropId);
  });
  if (conflicts.length) {
    throw new DomainError('merge_conflict', 'Abu įrašai dalyvavo tame pačiame turnyre – sujungti saugiai negalima. Pirmiau pataisykite komandas.', conflicts.map((t) => t.name));
  }
  next.participations.forEach((p) => { p.playerIds = p.playerIds.map((id) => (id === dropId ? keepId : id)); });
  drop.mergedInto = keepId;
  drop.isActive = false;
  pushAudit(next, { at: now, actor, rest: { action: 'merge_players', tournamentId: null, reason, before: { id: dropId, name: drop.fullName }, after: { id: keepId, name: keep.fullName } } });
  return next;
}
