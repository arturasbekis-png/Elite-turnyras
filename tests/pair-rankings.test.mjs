// Oficialus reitingas: PORŲ (ne atskirų žaidėjų), ELITE ir CHALLENGE atskirai, be bendro reitingo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePairRankings, buildPairResults, tournamentView, pairKeyOf } from '../ranking/engine.js';
import { normalizeStaticResults } from '../ranking/static-results.js';
import { withCalendar } from '../ranking/view.js';
import { build, SEASON } from './helpers.mjs';

const E1 = '2026-2027-elite-1';
const C1 = '2026-2027-challenge-1';
const official = () => withCalendar(normalizeStaticResults(JSON.parse(readFileSync(new URL('../data/official-results.json', import.meta.url), 'utf8'))));
const table = (r, cat) => r.categories[cat].map((x) => [x.position, x.names.join(' / '), x.points]);

test('Oficialūs rezultatai iš statinio JSON: galutinės ELITE ir CHALLENGE porų lentelės', () => {
  const r = computePairRankings(official(), { seasonId: SEASON });
  assert.deepEqual(table(r, 'elite'), [
    [1, 'Sofija B. / Emilija P.', 100], [2, 'Austėja M. / Lukrecija U.', 80], [3, 'Vakarė K. / Upė N.', 64],
    [4, 'Milda R. / Evgenija M.', 52], [5, 'Ditė / Gabrielė', 42], [5, 'Lea D. / Danielė Š.', 42],
  ]);
  assert.deepEqual(table(r, 'challenge'), [
    [1, 'Rusnė A. / Luknė M.', 80], [2, 'Miglė U. / Urtė G.', 64], [3, 'Saulė R. / Aurėja R.', 52], [4, 'Goda / Amelija', 42],
    [5, 'Danielė Š. / Lea D.', 30], [5, 'Luka B. / Adrian', 30], [5, 'Nerilė / Girmantė', 30],
  ]);
  assert.equal(r.anomalies.length, 0);
  assert.deepEqual(Object.keys(r.categories).sort(), ['challenge', 'elite'], 'jokio bendro, FUTURE ar individualaus reitingo');
});

test('Reitingas porų, ne žaidėjų: viena eilutė porai, taškai nedubliuojami', () => {
  const r = computePairRankings(official(), { seasonId: SEASON });
  assert.equal(r.categories.elite.length, 6, '12 žaidėjų = 6 poros');
  assert.equal(r.categories.challenge.length, 7);
  for (const row of [...r.categories.elite, ...r.categories.challenge]) {
    assert.equal(row.names.length, 2);
    assert.equal(row.played, 1);
  }
  // kategorijos taškų suma = poros × taškai (ne ×2)
  assert.equal(r.categories.elite.reduce((s, x) => s + x.points, 0), 100 + 80 + 64 + 52 + 42 + 42);
  assert.equal(r.categories.challenge.reduce((s, x) => s + x.points, 0), 80 + 64 + 52 + 42 + 30 * 3);
});

test('ELITE ir CHALLENGE niekada nesumuojami: ta pati pora turi atskirus taškus kiekvienoje lentelėje', () => {
  const r = computePairRankings(official(), { seasonId: SEASON });
  const eliteLea = r.categories.elite.find((x) => x.names.includes('Lea D.'));
  const challengeLea = r.categories.challenge.find((x) => x.names.includes('Lea D.'));
  assert.equal(eliteLea.points, 42);
  assert.equal(challengeLea.points, 30);
  assert.equal(eliteLea.pairKey, challengeLea.pairKey, 'tai ta pati pora');
  assert.ok(eliteLea.results.every((x) => x.category === 'elite'));
  assert.ok(challengeLea.results.every((x) => x.category === 'challenge'));
});

test('Kitas partneris = kita pora: taškai iš skirtingų partnerysčių nesujungiami', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', teams: [[1, ['a', 'b']], [2, ['c', 'd']]] },
    { id: 'e2', type: 'elite', date: '2026-11-08', teams: [[1, ['a', 'c']], [2, ['b', 'd']]] },
    { id: 'e3', type: 'elite', date: '2026-12-06', teams: [[1, ['b', 'a']], [2, ['d', 'c']]] },
  ] });
  const r = computePairRankings(d, { seasonId: SEASON });
  const rows = r.categories.elite;
  assert.equal(rows.length, 4, 'a+b, c+d, a+c, b+d');
  const ab = rows.find((x) => x.pairKey === pairKeyOf(['a', 'b']));
  assert.equal(ab.points, 100, 'a+b: 50 + 50 (kitas užrašymo tvarka tapati pora)');
  assert.equal(ab.played, 2);
  assert.equal(rows.find((x) => x.pairKey === pairKeyOf(['a', 'c'])).points, 50);
  assert.equal(rows.find((x) => x.pairKey === pairKeyOf(['b', 'd'])).points, 40);
  assert.equal(rows.find((x) => x.pairKey === pairKeyOf(['c', 'd'])).points, 80);
});

test('Pasidalintų vietų taškai: ELITE 5–6 = 42, CHALLENGE 5–8 (3 žinomos poros) = 30 poros balo (15 + 15)', () => {
  const ds = official();
  const e = tournamentView(ds, E1).teams.filter((t) => t.position === 5);
  const c = tournamentView(ds, C1).teams.filter((t) => t.position === 5);
  assert.deepEqual(e.map((t) => t.points), [42, 42]);
  assert.deepEqual(c.map((t) => t.points), [30, 30, 30]);
  assert.deepEqual(c.map((t) => t.playerPoints), [15, 15, 15], 'kiekvienam žaidėjui po 15');
  assert.equal((44 + 40) / 2, 42); assert.equal((18 + 16 + 14 + 12) / 4, 15);
});

test('Taškai skiriami vieną kartą: pakartotinis skaičiavimas ir dubliuoti įrašai poros nedubliuoja', () => {
  const ds = official();
  const first = computePairRankings(ds, { seasonId: SEASON });
  const second = computePairRankings(ds, { seasonId: SEASON });
  assert.deepEqual(table(second, 'elite'), table(first, 'elite'));
  assert.deepEqual(table(second, 'challenge'), table(first, 'challenge'));

  // tas pats rezultatas įrašytas dar kartą (kitas ID) – antras įrašas atmetamas, taškai nesidubliuoja
  const dup = structuredClone(ds);
  const src = dup.participations.find((p) => p.id === `${E1}-t1`);
  dup.participations.push({ ...src, id: `${E1}-t1-dup` });
  const r = computePairRankings(dup, { seasonId: SEASON });
  assert.equal(r.categories.elite.find((x) => x.names.includes('Sofija B.')).points, 100);
  assert.equal(r.anomalies.length, 1);
  assert.equal(r.anomalies[0].code, 'duplicate_pair_in_tournament');

  // žaidėjas dviejose skirtingose poros įrašuose to paties turnyro metu
  const twice = structuredClone(ds);
  twice.participations.push({ id: `${E1}-x`, tournamentId: E1, position: 9, playerIds: ['p-sofija-b', 'p-ditė'] });
  const r2 = computePairRankings(twice, { seasonId: SEASON });
  assert.equal(r2.anomalies[0].code, 'player_in_two_pairs');
  assert.equal(r2.categories.elite.length, 6);
});

test('Trūkstama ketvirta CHALLENGE 5–8 pora pranešama, bet nekuriama', () => {
  const ds = official();
  const view = tournamentView(ds, C1);
  assert.deepEqual(view.incomplete.map((g) => [g.position, g.declared, g.known, g.missing]), [[5, 4, 3, 1]]);
  assert.equal(view.teamCount, 7);
  const r = computePairRankings(ds, { seasonId: SEASON });
  assert.equal(r.categories.challenge.length, 7, 'ketvirta pora neišgalvota');
  assert.equal(tournamentView(ds, E1).incomplete.length, 0);
  assert.ok(!ds.players.some((p) => /nežinom|trūksta|\?/i.test(p.fullName)), 'jokių vietos žymeklių vietoje žaidėjų');
});

test('Judėjimas (▲/▼) rodomas tik tada, kai kategorijoje yra ankstesnis turnyras', () => {
  const r = computePairRankings(official(), { seasonId: SEASON });
  assert.equal(r.movementAvailable.elite, false);
  assert.equal(r.movementAvailable.challenge, false);
  assert.ok(r.categories.elite.every((x) => x.movement === null));

  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', teams: [[1, ['a', 'b']], [2, ['c', 'd']], [3, ['e', 'f']]] },
    { id: 'e2', type: 'elite', date: '2026-11-08', teams: [[1, ['e', 'f']], [2, ['c', 'd']], [3, ['g', 'h']]] },
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[1, ['a', 'b']]] },
  ] });
  const m = computePairRankings(d, { seasonId: SEASON });
  assert.equal(m.movementAvailable.elite, true);
  assert.equal(m.movementAvailable.challenge, false, 'CHALLENGE turi tik vieną turnyrą – ELITE turnyras nėra palyginimas');
  const ef = m.categories.elite.find((x) => x.pairKey === pairKeyOf(['e', 'f']));
  assert.equal(ef.position, 1);
  assert.equal(ef.movement, 2, 'pakilo iš 3 į 1');
  assert.equal(m.categories.elite.find((x) => x.pairKey === pairKeyOf(['g', 'h'])).movement, 'new');
});

test('Juodraščiai ir nepatvirtinti turnyrai poros taškų neduoda', () => {
  const ds = official();
  const draft = structuredClone(ds);
  draft.tournaments.find((t) => t.id === C1).status = 'draft';
  const r = computePairRankings(draft, { seasonId: SEASON });
  assert.equal(r.categories.challenge.length, 0);
  assert.equal(r.categories.elite.length, 6);
  assert.equal(buildPairResults(draft, { seasonId: SEASON }).results.every((x) => x.category === 'elite'), true);
});
