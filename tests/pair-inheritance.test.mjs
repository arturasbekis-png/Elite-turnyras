// Partnerio keitimo taisyklė: 50 % paveldėjimas, kai pasikeičia lygiai vienas poros narys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePairRankings, pairKeyOf } from '../ranking/engine.js';
import { normalizeStaticResults } from '../ranking/static-results.js';
import { withCalendar } from '../ranking/view.js';
import * as R from '../ranking/render.js';
import { build, SEASON } from './helpers.mjs';

// Dabartinė v2 lentelė: ELITE 1 vieta = 100, 2 vieta = 80; CHALLENGE 1 vieta = 40.
const make = (tournaments, decisions) => {
  const d = build({ tournaments });
  d.seasons[0].scoringVersion = 'v2';
  d.tournaments.forEach((t, i) => { t.name = `${t.type.toUpperCase()} #${i + 1}`; });
  if (decisions) d.inheritanceDecisions = decisions;
  return d;
};
const rows = (d, cat = 'elite') => computePairRankings(d, { seasonId: SEASON }).categories[cat];
const find = (list, ...ids) => list.find((r) => r.pairKey === pairKeyOf(ids));
const e = (id, date, teams) => ({ id, type: 'elite', date, teams });

test('Pora, likusi kartu, pasilieka 100 % savo taškų (be paveldėjimo)', () => {
  const d = make([e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]), e('e2', '2026-11-08', [[1, ['A', 'B']], [2, ['C', 'D']]])]);
  const ab = find(rows(d), 'A', 'B');
  assert.equal(ab.points, 200);
  assert.equal(ab.inheritance, null);
  assert.equal(ab.inheritedPoints, 0);
  assert.equal(ab.played, 2);
});

test('Pasikeitus lygiai vienam nariui nauja pora paveldi 50 %, o ankstesnė pora išlaiko savo taškus', () => {
  const d = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'E']], [2, ['C', 'D']]]),
  ]);
  const list = rows(d);
  const ab = find(list, 'A', 'B');
  const ae = find(list, 'A', 'E');
  assert.equal(ab.points, 100, 'ankstesnė pora išlaiko istorinius taškus');
  assert.equal(ae.inheritedPoints, 50, '50 % nuo 100');
  assert.equal(ae.ownPoints, 100, 'nauji turnyro taškai pridedami prie paveldėtų');
  assert.equal(ae.points, 150);
  assert.equal(ae.inheritance.fromPairKey, ab.pairKey);
  assert.deepEqual(ae.inheritance.fromNames, ['Testinis A', 'Testinis B']);
  assert.equal(ae.inheritance.basis, 100);
  assert.equal(ae.played, 1, 'paveldėjimas nėra sužaistas turnyras');
});

test('Jei abu nariai nauji – nepaveldima nieko', () => {
  const d = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['X', 'Y']], [2, ['A', 'B']]]),
  ]);
  const xy = find(rows(d), 'X', 'Y');
  assert.equal(xy.points, 100);
  assert.equal(xy.inherited ?? xy.inheritedPoints, 0);
  assert.equal(xy.inheritance, null);
  assert.equal(xy.flag, null);
});

test('Paveldėjimas tik toje pačioje kategorijoje: ELITE taškai neperkeliami į CHALLENGE ir atvirkščiai', () => {
  const d = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[1, ['A', 'E']], [2, ['F', 'G']]] },
    { id: 'c2', type: 'challenge', date: '2026-11-15', teams: [[1, ['A', 'H']], [2, ['F', 'G']]] },
    e('e2', '2026-12-06', [[1, ['B', 'K']], [2, ['C', 'D']]]),
  ]);
  const r = computePairRankings(d, { seasonId: SEASON }).categories;
  const ae = find(r.challenge, 'A', 'E');
  assert.equal(ae.points, 40, 'A+E CHALLENGE turnyre: nėra ankstesnės CHALLENGE poros – ELITE A+B taškai neperduodami');
  assert.equal(ae.inheritedPoints, 0);
  const ah = find(r.challenge, 'A', 'H');
  assert.equal(ah.inheritedPoints, 20, '50 % nuo A+E CHALLENGE 40 (ne nuo ELITE 100)');
  assert.equal(ah.points, 60);
  const bk = find(r.elite, 'B', 'K');
  assert.equal(bk.inheritedPoints, 50, 'ELITE: iš A+B (100), ne iš CHALLENGE');
  assert.equal(bk.points, 150);
  assert.ok(r.elite.every((x) => x.results.every((y) => y.category === 'elite')));
});

test('Paveldėjimas taikomas vieną kartą ir stabilus: perskaičiavimas, perkrovimas ir tolesni turnyrai jo nekeičia', () => {
  const spec = [
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'E']], [2, ['C', 'D']]]),
    e('e3', '2026-12-06', [[1, ['A', 'B']], [2, ['A2', 'E']]]),
  ];
  const d = make(spec);
  const first = rows(d);
  const again = rows(d);
  const clone = rows(structuredClone(d));
  const strip = (list) => list.map((x) => [x.pairKey, x.position, x.points, x.inheritedPoints, x.ownPoints]);
  assert.deepEqual(strip(again), strip(first));
  assert.deepEqual(strip(clone), strip(first));
  // e3: A+B žaidžia vėl (pasiekė 200), A+E nežaidė – jų paveldėti 50 nesikeičia (nėra „antro pusinimo“)
  const ae = find(first, 'A', 'E');
  assert.equal(ae.inheritedPoints, 50, 'paveldėjimas fiksuotas iki pirmo turnyro, nėra perskaičiuojamas iš naujų A+B taškų');
  assert.equal(ae.points, 150);
  assert.equal(find(first, 'A', 'B').points, 200);
  // kai pora jau turi paskyrą, naujas jos turnyras paveldėjimo nekartoja
  const d2 = make([...spec, e('e4', '2027-01-10', [[1, ['A', 'E']], [2, ['C', 'D']]])]);
  assert.equal(find(rows(d2), 'A', 'E').inheritedPoints, 50);
  assert.equal(find(rows(d2), 'A', 'E').points, 250);
});

test('Du skirtingi paveldėjimo šaltiniai: neaišku – pažymima patvirtinimui, taškai neperduodami', () => {
  const d = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'C']], [2, ['X', 'Y']]]),
  ]);
  const res = computePairRankings(d, { seasonId: SEASON });
  const ac = find(res.categories.elite, 'A', 'C');
  assert.equal(ac.points, 100, 'tik savi taškai');
  assert.equal(ac.inheritance, null);
  assert.equal(ac.flag.code, 'ambiguous_inheritance');
  assert.equal(ac.flag.candidates.length, 2);
  assert.equal(res.inheritanceFlags.length, 1);
  assert.equal(res.inheritanceFlags[0].category, 'elite');
  assert.deepEqual(res.inheritanceFlags[0].candidates.map((c) => c.points).sort(), [100, 80]);
  // ta pati žaidėja su keliomis ankstesnėmis poromis
  const d2 = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'E']], [2, ['C', 'D']]]),
    e('e3', '2026-12-06', [[1, ['A', 'F']], [2, ['C', 'D']]]),
  ]);
  const af = find(rows(d2), 'A', 'F');
  assert.equal(af.flag.code, 'ambiguous_inheritance', 'A turi dvi ankstesnes poras (A+B ir A+E)');
  assert.equal(af.inheritedPoints, 0);
});

test('Rankinis patvirtinimas (inheritanceDecisions) išsprendžia neaiškų atvejį; sprendimas „nieko“ išjungia paveldėjimą', () => {
  const spec = [
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'C']], [2, ['X', 'Y']]]),
  ];
  const chosen = make(spec, [{ category: 'elite', playerIds: ['C', 'A'], inheritFrom: ['B', 'A'] }]);
  const res = computePairRankings(chosen, { seasonId: SEASON });
  const ac = find(res.categories.elite, 'A', 'C');
  assert.equal(ac.inheritedPoints, 50);
  assert.equal(ac.points, 150);
  assert.equal(ac.inheritance.manual, true);
  assert.equal(ac.flag, null);
  assert.equal(res.inheritanceFlags.length, 0);
  assert.equal(find(res.categories.elite, 'A', 'B').points, 100, 'šaltinis išlaiko taškus');

  const none = make(spec, [{ category: 'elite', playerIds: ['A', 'C'], inheritFrom: null }]);
  const noneRes = computePairRankings(none, { seasonId: SEASON });
  assert.equal(find(noneRes.categories.elite, 'A', 'C').points, 100);
  assert.equal(noneRes.inheritanceFlags.length, 0, 'sprendimas „nepaveldėti“ taip pat patvirtina');

  const bad = make(spec, [{ category: 'elite', playerIds: ['A', 'C'], inheritFrom: ['X', 'Y'] }]);
  assert.equal(computePairRankings(bad, { seasonId: SEASON }).inheritanceFlags[0].code, 'invalid_decision', 'šaltinis be bendro žaidėjo atmetamas');
  const otherCat = make(spec, [{ category: 'challenge', playerIds: ['A', 'C'], inheritFrom: ['A', 'B'] }]);
  assert.equal(computePairRankings(otherCat, { seasonId: SEASON }).inheritanceFlags.length, 1, 'kitos kategorijos sprendimas netaikomas');
});

test('Paveldėjimas iš to paties šaltinio dviem naujoms poroms viename turnyre: kiekviena po 50 %, šaltinis nieko nepraranda', () => {
  const d = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'E']], [2, ['B', 'F']]]),
  ]);
  const list = rows(d);
  assert.equal(find(list, 'A', 'E').inheritedPoints, 50);
  assert.equal(find(list, 'B', 'F').inheritedPoints, 50);
  assert.equal(find(list, 'A', 'B').points, 100);
});

test('Paveldėjimas apvalinamas iki 2 skaitmenų (CHALLENGE 15 → 7,5) ir įtakoja vietą bei lygius taškus', () => {
  const d = make([
    { id: 'c1', type: 'challenge', date: '2026-10-18', allowTies: true, teams: [[1, ['A', 'B']], [2, ['C', 'D']], [3, ['G', 'H']], [4, ['I', 'J']], [5, ['K', 'L']], [5, ['M', 'N']], [5, ['O', 'P']], [5, ['Q', 'R']]] },
    { id: 'c2', type: 'challenge', date: '2026-11-15', teams: [[1, ['K', 'S']], [2, ['A', 'B']]] },
  ]);
  const list = rows(d, 'challenge');
  const ks = find(list, 'K', 'S');
  assert.equal(ks.inheritedPoints, 7.5);
  assert.equal(ks.points, 47.5);
  assert.equal(find(list, 'A', 'B').points, 72, '40 + 32');
  assert.equal(ks.position, 2, 'paveldėti taškai skaičiuojami reitinge');
  assert.equal(list.length, 9);
});

test('Statinis failas: paveldėjimo sprendimai tikrinami, oficialūs rezultatai paveldėjimo neturi', () => {
  const raw = JSON.parse(JSON.stringify(JSON.parse(require_fs())));
  assert.deepEqual(raw.inheritanceDecisions, []);
  const ds = withCalendar(normalizeStaticResults(raw));
  const res = computePairRankings(ds, { seasonId: SEASON });
  assert.equal(res.inheritanceFlags.length, 0);
  for (const cat of ['elite', 'challenge']) assert.ok(res.categories[cat].every((r) => r.inheritance === null && r.inheritedPoints === 0), `${cat}: kol kas niekas nepaveldėjo`);
  raw.inheritanceDecisions = [{ category: 'elite', playerIds: ['p-sofija-b', 'nera-tokio'], inheritFrom: null }];
  assert.throws(() => normalizeStaticResults(raw), /paveldėjimo sprendimas/);
  raw.inheritanceDecisions = [{ category: 'bendras', playerIds: ['p-sofija-b', 'p-emilija-p'], inheritFrom: null }];
  assert.throws(() => normalizeStaticResults(raw), /paveldėjimo sprendimas/);
});

test('Viešas vaizdas: paveldėjimas, laukiantis patvirtinimo, ir taisyklė aiškiai paaiškinti', () => {
  const d = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'E']], [2, ['X', 'Y']]]),
  ]);
  const res = computePairRankings(d, { seasonId: SEASON });
  const html = R.renderPairs({ category: 'elite', rows: res.categories.elite, movementAvailable: true });
  assert.ok(html.includes('class="chip inherit"') && html.includes('paveldėta'));
  assert.ok(!html.includes('class="chip flag"'));
  const open = R.renderPairDetail(find(res.categories.elite, 'A', 'E'));
  assert.ok(open.includes('Paveldėta 50 %') && open.includes('Ankstesnė pora savo taškų išlaiko'));

  const amb = make([
    e('e1', '2026-10-11', [[1, ['A', 'B']], [2, ['C', 'D']]]),
    e('e2', '2026-11-08', [[1, ['A', 'C']], [2, ['X', 'Y']]]),
  ]);
  const ar = computePairRankings(amb, { seasonId: SEASON });
  const ahtml = R.renderPairs({ category: 'elite', rows: ar.categories.elite, movementAvailable: true });
  assert.ok(ahtml.includes('class="chip flag"') && ahtml.includes('paveldėjimas nepatvirtintas'));
  const notice = R.renderDataNotices({ inheritanceFlags: ar.inheritanceFlags });
  assert.ok(notice.includes('id="incomplete-notice"') && notice.includes('Paveldėjimas netaikomas, kol organizatoriai jo nepatvirtins'));
  assert.ok(R.renderPairDetail(find(ar.categories.elite, 'A', 'C')).includes('Paveldėjimas nepatvirtintas'));

  const rules = R.renderRules('v2');
  for (const text of ['Partnerio keitimas (50 % paveldėjimas)', '100 % savo sukauptų taškų', 'lygiai vienas', 'Jei abu nariai nauji', 'neperkeliami į CHALLENGE', 'vieną kartą', 'paveldėjimas nepatvirtintas']) assert.ok(rules.includes(text), text);
  assert.ok(rules.includes('(44 + 40) / 2 = 42') && rules.includes('(18 + 16 + 14 + 12) / 4 = 15'));
});

function require_fs() {
  return globalThis.process.getBuiltinModule('node:fs').readFileSync(new URL('../data/official-results.json', import.meta.url), 'utf8');
}
