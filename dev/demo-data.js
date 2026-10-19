// TIK LOKALIAM KŪRIMUI. Šie duomenys NĖRA oficialūs ir niekada nerodomi gamybinėje svetainėje:
// public-app.js įkelia šį failą tik kai adresas yra localhost / 127.0.0.1 IR URL turi ?demo.
// Vardai aiškiai pažymėti „Demo“, kad jų nebūtų galima supainioti su tikrais žaidėjais.

import { SEASON_EVENTS } from '../ranking/events.js';

export function demoDataset() {
  const names = ['Alfa', 'Beta', 'Gama', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Teta', 'Jota', 'Kapa', 'Lambda', 'Mi'];
  const players = names.map((n, i) => ({ id: `demo-p${i + 1}`, fullName: `Demo ${n} Žaidėjas`, gender: i % 2 ? 'F' : 'M', isActive: true, mergedInto: null }));
  const id = (n) => `demo-p${n}`;
  const finalize = (e, status) => ({ ...e, status, revision: status === 'finalized' ? 1 : 0, scoringVersion: status === 'finalized' ? 'v1' : null });
  const tournaments = SEASON_EVENTS.map((e) => {
    if (['2026-2027-elite-1', '2026-2027-challenge-1'].includes(e.id)) return finalize(e, 'finalized');
    if (e.id === '2026-2027-future-1') return finalize(e, 'draft');
    return finalize(e, 'planned');
  });
  const part = (tournamentId, position, a, b) => ({ id: `${tournamentId}-${position}`, tournamentId, teamName: null, position, playerIds: [id(a), id(b)] });
  const participations = [
    part('2026-2027-elite-1', 1, 1, 2), part('2026-2027-elite-1', 2, 3, 4), part('2026-2027-elite-1', 3, 5, 6),
    part('2026-2027-elite-1', 4, 7, 8), part('2026-2027-elite-1', 5, 9, 10), part('2026-2027-elite-1', 6, 11, 12),
    part('2026-2027-challenge-1', 1, 3, 4), part('2026-2027-challenge-1', 2, 1, 5), part('2026-2027-challenge-1', 3, 2, 6),
    part('2026-2027-challenge-1', 4, 7, 12),
  ];
  return {
    generatedAt: new Date().toISOString(),
    seasons: [{ id: '2026-2027', label: '2026–2027', isCurrent: true, scoringVersion: 'v1' }],
    tournaments, players, participations,
  };
}
