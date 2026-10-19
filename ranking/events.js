// 2026–2027 sezono renginiai. Šaltinis – esamas kalendorius index.html.
// Tests `tests/calendar-sync.test.mjs` tikrina, kad šis sąrašas sutampa su index.html kalendoriumi
// (pavadinimai, datos, laikas), todėl abu šaltiniai negali „išsiderinti“ nepastebėti.
// Registracijos nuorodos čia NESAUGOMOS – jos lieka tik index.html.

export const SEASON_ID = '2026-2027';

// [tipas, numeris, ISO data, kalendoriaus datos tekstas (kaip index.html)]
const CALENDAR = [
  ['elite', 1, '2026-10-11', 'Spalio 11 d.'],
  ['challenge', 1, '2026-10-18', 'Spalio 18 d.'],
  ['future', 1, '2026-10-25', 'Spalio 25 d.'],
  ['elite', 2, '2026-11-08', 'Lapkričio 8 d.'],
  ['challenge', 2, '2026-11-15', 'Lapkričio 15 d.'],
  ['future', 2, '2026-11-22', 'Lapkričio 22 d.'],
  ['elite', 3, '2026-11-29', 'Lapkričio 29 d.'],
  ['challenge', 3, '2026-12-06', 'Gruodžio 6 d.'],
  ['future', 3, '2026-12-13', 'Gruodžio 13 d.'],
  ['elite', 4, '2027-01-10', 'Sausio 10 d.'],
  ['challenge', 4, '2027-01-17', 'Sausio 17 d.'],
  ['future', 4, '2027-01-24', 'Sausio 24 d.'],
  ['elite', 5, '2027-01-31', 'Sausio 31 d.'],
  ['challenge', 5, '2027-02-07', 'Vasario 7 d.'],
  ['future', 5, '2027-02-14', 'Vasario 14 d.'],
  ['elite', 6, '2027-02-28', 'Vasario 28 d.'],
  ['challenge', 6, '2027-03-07', 'Kovo 7 d.'],
  ['future', 6, '2027-03-14', 'Kovo 14 d.'],
  ['final', null, '2027-04-11', 'Balandžio 11 d.'],
];

const NAMES = { elite: 'ELITE', challenge: 'CHALLENGE', future: 'FUTURE', final: 'BEACH LEAGUE FINAL' };

/** Turnyro ID: stabilus, skaitomas, nepriklauso nuo pavadinimo teksto (pvz. 2026-2027-elite-1). */
export function tournamentId(seasonId, type, number) {
  return number == null ? `${seasonId}-${type}` : `${seasonId}-${type}-${number}`;
}

export const SEASON_EVENTS = CALENDAR.map(([type, number, date, calendarDateText]) => ({
  id: tournamentId(SEASON_ID, type, number),
  seasonId: SEASON_ID,
  type,
  number,
  name: number == null ? NAMES[type] : `${NAMES[type]} #${number}`,
  date,
  startTime: '11:00',
  calendarDateText,
  status: 'planned',
  allowTies: false,
}));
