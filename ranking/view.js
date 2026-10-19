// Grynos pagalbinės funkcijos viešam reitingų vaizdui (paieška, rūšiavimas, duomenų sujungimas).
// Jos NEPERSKAIČIUOJA taškų ir nekeičia oficialių vietų – tik pasirenka, ką ir kokia tvarka rodyti.

import { SEASON_EVENTS } from './events.js';
import { DEFAULT_SEASONS } from './config.js';

const collator = new Intl.Collator('lt');

/** Paieškai: be diakritikų ir didžiųjų raidžių („zilvinas“ randa „Žilvinas“). */
export const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const playedOf = (row) => (typeof row.played === 'number' ? row.played : row.played.total);

/**
 * Taiko paiešką, lyties filtrą ir rūšiavimą rodymui. Oficiali `position` reikšmė nekeičiama.
 * sort: 'points' (oficiali tvarka) | 'name' | 'played'
 */
export function applyView(rows, { query = '', sort = 'points', gender = '' } = {}) {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  let out = rows.filter((r) => {
    if (gender && r.gender !== gender) return false;
    const name = fold(r.name);
    return tokens.every((t) => name.includes(t));
  });
  if (sort === 'name') out = [...out].sort((a, b) => collator.compare(a.name, b.name));
  else if (sort === 'played') out = [...out].sort((a, b) => playedOf(b) - playedOf(a) || b.points - a.points || collator.compare(a.name, b.name));
  return out;
}

/** Ar yra bent vienas žaidėjas su nurodyta lytimi (kad filtras būtų rodomas tik kai naudingas). */
export function hasGenderData(rows) {
  return new Set(rows.map((r) => r.gender).filter(Boolean)).size > 0;
}

/**
 * Sujungia kalendoriaus renginius (ranking/events.js) su duomenų bazės turnyrais.
 * DB įrašas visada laimi; kalendoriaus renginiai, kurių DB dar neturi, rodomi kaip „Suplanuotas“.
 */
export function mergeTournaments(dbTournaments = [], staticEvents = SEASON_EVENTS) {
  const byId = new Map(dbTournaments.map((t) => [t.id, t]));
  const merged = [...dbTournaments];
  for (const e of staticEvents) {
    if (!byId.has(e.id)) merged.push({ ...e });
  }
  return merged.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id))));
}

export function mergeSeasons(dbSeasons = [], defaults = DEFAULT_SEASONS) {
  const byId = new Map(dbSeasons.map((s) => [s.id, s]));
  const merged = [...dbSeasons];
  for (const s of defaults) {
    if (!byId.has(s.id)) merged.push({ ...s, isCurrent: dbSeasons.some((x) => x.isCurrent) ? false : s.isCurrent });
  }
  return merged.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

/** Pradžioje rodomas dabartinis sezonas. */
export function pickDefaultSeason(seasons) {
  return (seasons.find((s) => s.isCurrent) || seasons[0] || { id: null }).id;
}

/** Viešo vaizdo duomenų rinkinys: DB duomenys + kalendorius (be jokių išgalvotų rezultatų). */
export function withCalendar(dataset) {
  return { ...dataset, seasons: mergeSeasons(dataset.seasons), tournaments: mergeTournaments(dataset.tournaments) };
}

const MONTHS = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];

/** '2026-10-11' → '2026 m. spalio 11 d.' */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${m[1]} m. ${MONTHS[Number(m[2]) - 1]} ${Number(m[3])} d.`;
}

/** Trumpas turnyro žymėjimas lentelių „chip“ elementams: 'ELITE #1' → 'E1', 'CHALLENGE #3' → 'C3'. */
export function shortName(tournament) {
  const letter = { elite: 'E', challenge: 'C', future: 'F', final: 'FIN' }[tournament.type] || '?';
  return tournament.number == null ? letter : `${letter}${tournament.number}`;
}

/** Hash maršrutas: '#elite', '#turnyrai/ID', neprivalomai '?s=2026-2027'. */
export function parseRoute(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const [tab = 'bendras', id = null] = pathPart.split('/');
  const params = new URLSearchParams(queryPart);
  const tabs = ['bendras', 'elite', 'challenge', 'future', 'turnyrai'];
  return { tab: tabs.includes(tab) ? tab : 'bendras', tournamentId: id ? decodeURIComponent(id) : null, seasonId: params.get('s') };
}

export function buildRoute({ tab, tournamentId, seasonId }, defaultSeasonId) {
  let hash = `#${tab}`;
  if (tournamentId) hash += `/${encodeURIComponent(tournamentId)}`;
  if (seasonId && seasonId !== defaultSeasonId) hash += `?s=${encodeURIComponent(seasonId)}`;
  return hash;
}
