// Testų pagalbinės funkcijos. Visi čia esantys žaidėjai ir rezultatai – TIK testų duomenys.

export function player(id, extra = {}) {
  return { id, fullName: `Testinis ${id}`, gender: null, isActive: true, mergedInto: null, ...extra };
}

export function tournament(id, type, extra = {}) {
  return {
    id, seasonId: '2026-2027', type, number: 1, name: `${type.toUpperCase()} ${id}`,
    date: '2026-10-11', status: 'finalized', allowTies: false, ...extra,
  };
}

/** entries: [[position, [playerA, playerB]], ...] */
export function participations(tournamentId, entries) {
  return entries.map(([position, playerIds], i) => ({
    id: `${tournamentId}-team-${i + 1}`, tournamentId, teamName: null, playerIds, position,
  }));
}

export function dataset({ players = [], tournaments = [], participations: parts = [] } = {}) {
  return {
    seasons: [{ id: '2026-2027', label: '2026–2027', isCurrent: true, scoringVersion: 'v1' }],
    players, tournaments, participations: parts, auditLog: [],
  };
}

export const SEASON = '2026-2027';

/** Greitai sukuria duomenų rinkinį iš trumpo aprašo. */
export function build(spec) {
  const ids = new Set();
  spec.tournaments.forEach((t) => t.teams.forEach(([, pair]) => pair.forEach((id) => ids.add(id))));
  return dataset({
    players: [...ids].map((id) => player(id)),
    tournaments: spec.tournaments.map((t) => tournament(t.id, t.type, { date: t.date || '2026-10-11', status: t.status || 'finalized', allowTies: Boolean(t.allowTies), seasonId: t.seasonId || SEASON })),
    participations: spec.tournaments.flatMap((t) => participations(t.id, t.teams)),
  });
}

export function row(rows, playerId) {
  return rows.find((r) => r.playerId === playerId);
}
