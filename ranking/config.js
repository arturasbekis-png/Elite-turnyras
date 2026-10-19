// ELITE reitingų modulio centrinė konfigūracija.
// Visa taškų lentelė, kategorijos, renginių tipai ir statusai aprašyti TIK čia.
// Nieko iš čia nurodytų reikšmių nekopijuokite į kitus failus.

/** Ranguojamos turnyrų kategorijos (jų taškai sudaro reitingus). */
export const RANKED_CATEGORIES = ['elite', 'challenge', 'future'];

/** Oficialūs VIEŠI reitingai: tik porų lentelės, atskirai ELITE ir CHALLENGE (bendro ar individualaus reitingo nėra). */
export const PAIR_CATEGORIES = ['elite', 'challenge'];

/** Kategorijų išvaizda (spalvos paimtos iš esamo kalendoriaus puslapio index.html). */
export const CATEGORIES = {
  elite: { id: 'elite', label: 'ELITE', emoji: '🟣', color: '#8e44ff', soft: '#f0e7ff', text: '#7137c8' },
  challenge: { id: 'challenge', label: 'CHALLENGE', emoji: '🔵', color: '#168cff', soft: '#e4f2ff', text: '#0871c9' },
  future: { id: 'future', label: 'FUTURE', emoji: '🟢', color: '#20b957', soft: '#e5f8ec', text: '#158640' },
};

/**
 * Renginių tipai.
 *  - scoringKey: kuri taškų lentelė taikoma (null = taškai NENUSTATYTI, renginys į reitingus neįskaičiuojamas).
 *  - category: į kurį kategorijos reitingą įskaičiuojami taškai.
 *
 * BEACH LEAGUE FINAL specialiai NEGAUNA ELITE taškų. Kai organizatoriai patvirtins finalo taškų taisykles,
 * pakanka pridėti naują lentelę į SCORING_TABLES ir čia nurodyti `scoringKey` (žr. docs/RANKING.md).
 */
export const EVENT_TYPES = {
  elite: { id: 'elite', label: 'ELITE', category: 'elite', scoringKey: 'elite' },
  challenge: { id: 'challenge', label: 'CHALLENGE', category: 'challenge', scoringKey: 'challenge' },
  future: { id: 'future', label: 'FUTURE', category: 'future', scoringKey: 'future' },
  final: {
    id: 'final', label: 'BEACH LEAGUE FINAL', emoji: '🏆', category: null, scoringKey: null,
    color: '#f5a400', soft: '#fff1cf', text: '#a66a00',
  },
};

/** Turnyro statusai (tvarka = gyvavimo ciklo tvarka). Tik `finalized` daro įtaką oficialiam reitingui. */
export const STATUSES = {
  planned: 'Suplanuotas',
  in_progress: 'Vyksta',
  draft: 'Rezultatų juodraštis',
  awaiting_confirmation: 'Laukiama patvirtinimo',
  finalized: 'Patvirtintas',
};
export const OFFICIAL_STATUS = 'finalized';

/** Mažiausias komandų skaičius, kad rezultatus būtų galima patvirtinti. */
export const MIN_TEAMS_TO_FINALIZE = 2;

/**
 * OFICIALI PRADINĖ TAŠKŲ LENTELĖ (v1) – taškai už galutinę komandos vietą turnyre.
 * Eilutė: [nuo vietos, iki vietos, ELITE, CHALLENGE, FUTURE]
 */
const V1_ROWS = [
  [1, 1, 50, 40, 30],
  [2, 2, 40, 32, 24],
  [3, 3, 32, 26, 20],
  [4, 4, 26, 21, 16],
  [5, 5, 22, 18, 13],
  [6, 6, 20, 16, 12],
  [7, 7, 18, 14, 10],
  [8, 8, 16, 12, 9],
  [9, 12, 10, 8, 6],
  [13, 16, 6, 5, 4],
];
/** Dalyvavimas be aukštesnio klasifikuoto rezultato (vietos 17 ir žemesnės): ELITE, CHALLENGE, FUTURE. */
const V1_PARTICIPATION = [2, 2, 2];

function buildTables(rows, participation) {
  const keys = ['elite', 'challenge', 'future'];
  const tables = {};
  keys.forEach((key, i) => {
    const bands = rows.map(([from, to, ...pts]) => ({ from, to, points: pts[i] }));
    const lastTo = rows[rows.length - 1][1];
    bands.push({ from: lastTo + 1, to: null, points: participation[i] }); // to:null = be viršutinės ribos
    tables[key] = bands;
  });
  return tables;
}

/**
 * Taškų lentelių versijos. Keisdami taškus ateičiai PRIDĖKITE naują versiją (pvz. `v2`) ir
 * sezone nurodykite `scoringVersion: 'v2'` – jau patvirtinti turnyrai išsaugo savo versiją
 * ir jų taškai nesikeičia.
 */
/**
 * v2 (nuo 2026–2027 sezono): ELITE taškai padvigubinti (100/80/64/52/44/40/36/32/20/12, dalyvavimas 4).
 * CHALLENGE ir FUTURE lentelės nepakeistos. Taškai skiriami porai.
 */
const V2_ROWS = V1_ROWS.map(([from, to, elite, challenge, future]) => [from, to, elite * 2, challenge, future]);
const V2_PARTICIPATION = [V1_PARTICIPATION[0] * 2, V1_PARTICIPATION[1], V1_PARTICIPATION[2]];

/**
 * v3 (dabartinė): taškai skiriami KIEKVIENAM ŽAIDĖJUI (žaidėjo taškai = V1_ROWS), o poros reitingo balas yra ABIEJŲ
 * žaidėjų taškų SUMA. Lentelėje saugomi poros balai (= 2 × žaidėjo taškai): ELITE 1 vieta 50 + 50 = 100,
 * CHALLENGE 1 vieta 40 + 40 = 80. ELITE poros balai sutampa su v2 (jie nepakito).
 */
export const PLAYERS_PER_PAIR = 2;
const V3_ROWS = V1_ROWS.map(([from, to, ...pts]) => [from, to, ...pts.map((v) => v * PLAYERS_PER_PAIR)]);
const V3_PARTICIPATION = V1_PARTICIPATION.map((v) => v * PLAYERS_PER_PAIR);

export const SCORING_TABLES = {
  v1: {
    label: 'Pradinė taškų lentelė (ELITE 50 už pirmą vietą)',
    tables: buildTables(V1_ROWS, V1_PARTICIPATION),
  },
  v2: {
    label: 'Dabartinė taškų lentelė (ELITE padvigubinta: 100 už pirmą vietą)',
    tables: buildTables(V2_ROWS, V2_PARTICIPATION),
  },
  v3: {
    label: 'Dabartinė taškų lentelė (taškai žaidėjui; poros balas = abiejų žaidėjų suma)',
    perPlayer: true,
    tables: buildTables(V3_ROWS, V3_PARTICIPATION),
  },
};
export const DEFAULT_SCORING_VERSION = 'v3';

/**
 * Partnerio keitimo taisyklė: jei pasikeičia lygiai vienas poros narys, nauja pora paveldi šią dalį ankstesnės poros
 * sukauptų TOS PAČIOS kategorijos taškų. Ankstesnė pora savo taškų nepraranda.
 */
export const INHERITANCE_RATE = 0.5;

/** Sezonai, žinomi iki duomenų bazės prijungimo (duomenų bazė gali pridėti naujų). */
export const DEFAULT_SEASONS = [
  { id: '2026-2027', label: '2026–2027', isCurrent: true, scoringVersion: 'v3' },
];

/**
 * Lygių pozicijų politika (rodoma „Reitingavimo taisyklėse“).
 * Pagal nutylėjimą lygių vietų turnyre NĖRA: kiekviena komanda turi unikalią vietą 1..N.
 * Jei turnyrui įjungta `allowTies`, galioja standartinis „1-2-2-4“ (competition ranking) principas:
 * vietos numeruojamos taip (5,5,7,7), o komandos, pasidalinusios vietą, užima visas tos grupės vietas
 * ir KIEKVIENA gauna jų taškų VIDURKĮ (ELITE 5–6: (44+40)/2 = 42; CHALLENGE 5–8: (18+16+14+12)/4 = 15).
 * Kiekvienas poros narys gauna visus šiuos taškus. Vidurkis apvalinamas iki 2 skaitmenų po kablelio.
 */
export const TIE_POLICY = {
  defaultAllowTies: false,
  sharedPlaceRule: 'average-of-occupied-places',
};

/** Reitingų sudarymo lygių sprendimo tvarka (naudojama ir taisyklių tekste). */
export const TIEBREAKERS = {
  pairs: ['wins', 'seconds', 'played'],
  overall: ['eliteWins', 'totalWins', 'eliteSeconds', 'played'],
  category: ['wins', 'seconds', 'played'],
};
