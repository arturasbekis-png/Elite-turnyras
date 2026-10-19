// Statinis oficialių rezultatų failas (data/official-results.json): turinys, taškai, pasidalintos vietos, bendras reitingas,
// trūkstamos komandos žymėjimas, pakartotinis įkėlimas ir atskyrimas nuo vietinių juodraščių.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  computeRankings, tournamentView, incompleteGroups, positionCounts, validateResults,
} from '../ranking/engine.js';
import { normalizeStaticResults, loadStaticResults } from '../ranking/static-results.js';
import { withCalendar } from '../ranking/view.js';
import { SEASON_EVENTS } from '../ranking/events.js';
import { namesAlike } from '../ranking/names.js';
import { tournament, participations, player } from './helpers.mjs';

const SEASON = '2026-2027';
const E1 = '2026-2027-elite-1';
const C1 = '2026-2027-challenge-1';
const raw = () => JSON.parse(readFileSync(new URL('../data/official-results.json', import.meta.url), 'utf8'));
const dataset = (doc = raw()) => withCalendar(normalizeStaticResults(doc));
const rank = (ds = dataset()) => computeRankings(ds, { seasonId: SEASON });
const byName = (rows, name) => rows.find((r) => r.name === name);

const ELITE = [
  [1, 'Sofija B.', 'Emilija P.', 100], [2, 'Austėja M.', 'Lukrecija U.', 80], [3, 'Vakarė K.', 'Upė N.', 64],
  [4, 'Milda R.', 'Evgenija M.', 52], [5, 'Lea D.', 'Danielė Š.', 42], [5, 'Ditė', 'Gabrielė', 42],
];
const CHALLENGE = [
  [1, 'Rusnė A.', 'Luknė M.', 40], [2, 'Miglė U.', 'Urtė G.', 32], [3, 'Saulė R.', 'Aurėja R.', 26], [4, 'Goda', 'Amelija', 21],
  [5, 'Danielė Š.', 'Lea D.', 15], [5, 'Luka B.', 'Adrian', 15], [5, 'Nerilė', 'Girmantė', 15],
];

test('Failas galioja ir neturi įrašytų taškų (taškus skaičiuoja tik variklis)', () => {
  const doc = raw();
  assert.equal(doc.schemaVersion, 1);
  assert.doesNotThrow(() => normalizeStaticResults(doc));
  assert.ok(!/"points"/.test(JSON.stringify(doc)), 'faile taškų nėra');
  const ids = (list) => list.map((x) => x.id);
  for (const list of [doc.players, doc.tournaments, doc.participations]) assert.equal(new Set(ids(list)).size, list.length, 'ID unikalūs');
});

test('Turnyrai atitinka esamą kalendorių (ID, pavadinimas, data); naujų renginių nekuriama', () => {
  const doc = raw();
  assert.equal(doc.tournaments.length, 2);
  for (const t of doc.tournaments) {
    const cal = SEASON_EVENTS.find((e) => e.id === t.id);
    assert.ok(cal, `${t.id} yra kalendoriuje`);
    assert.equal(t.name, cal.name); assert.equal(t.date, cal.date); assert.equal(t.type, cal.type); assert.equal(t.status, 'finalized');
  }
  assert.equal(doc.tournaments.find((t) => t.id === E1).date, '2026-10-11');
  assert.equal(doc.tournaments.find((t) => t.id === C1).date, '2026-10-18');
  const ds = dataset();
  assert.equal(ds.tournaments.length, 19, 'kalendorius nepakito: 19 renginių, be dublikatų');
  assert.equal(ds.tournaments.filter((t) => t.id === E1).length, 1);
});

test('Komandos ir vietos tiksliai atitinka patvirtintus rezultatus', () => {
  const ds = dataset();
  const names = new Map(ds.players.map((p) => [p.id, p.fullName]));
  const teams = (tid) => ds.participations.filter((p) => p.tournamentId === tid).sort((a, b) => a.position - b.position).map((p) => [p.position, ...p.playerIds.map((id) => names.get(id))]);
  assert.deepEqual(teams(E1), ELITE.map(([pos, a, b]) => [pos, a, b]));
  assert.deepEqual(teams(C1), CHALLENGE.map(([pos, a, b]) => [pos, a, b]));
  assert.equal(ds.players.length, 24, 'tiksliai 24 žaidėjai, jokių išgalvotų');
});

test('Taškai: ELITE 100/80/64/52/42/42, CHALLENGE 40/32/26/21/15/15/15 (kiekvienam poros nariui rodoma poros suma)', () => {
  const ds = dataset();
  assert.deepEqual(tournamentView(ds, E1).teams.map((t) => t.points), ELITE.map((r) => r[3]));
  assert.deepEqual(tournamentView(ds, C1).teams.map((t) => t.points), CHALLENGE.map((r) => r[3]));
  const r = rank(ds);
  for (const [, a, b, pts] of ELITE) for (const n of [a, b]) assert.equal(byName(r.categories.elite, n).points, pts, `ELITE ${n}`);
  for (const [, a, b, pts] of CHALLENGE) for (const n of [a, b]) assert.equal(byName(r.categories.challenge, n).points, pts, `CHALLENGE ${n}`);
  assert.equal(byName(r.categories.challenge, 'Goda').points, 21);
  assert.equal(byName(r.categories.challenge, 'Amelija').points, 21);
  assert.equal(byName(r.categories.challenge, 'Goda').position, byName(r.categories.challenge, 'Amelija').position);
  const goda = tournamentView(ds, C1).teams.find((t) => t.players.some((p) => p.name === 'Goda'));
  assert.equal(goda.position, 4, 'Goda / Amelija liko 4 vietoje');
  assert.equal(goda.points, 21);
  assert.equal(tournamentView(ds, C1).teams.filter((t) => t.position === 5).length, 3, 'Goda / Amelija nėra 5–8 grupėje');
  assert.equal(r.categories.elite.length, 12);
  assert.equal(r.categories.challenge.length, 14);
});

test('Senas individualus variklis (nenaudojamas viešai): Lea D. ir Danielė Š. = 42 + 15 = 57', () => {
  const r = rank();
  assert.equal(r.overall.length, 24);
  assert.deepEqual(r.overall.map((x) => x.points), [100, 100, 80, 80, 64, 64, 57, 57, 52, 52, 42, 42, 40, 40, 32, 32, 26, 26, 21, 21, 15, 15, 15, 15]);
  for (const n of ['Lea D.', 'Danielė Š.']) {
    const row = byName(r.overall, n);
    assert.equal(row.points, 57); assert.equal(row.categoryPoints.elite, 42); assert.equal(row.categoryPoints.challenge, 15); assert.equal(row.played.total, 2);
  }
  assert.equal(r.overall.reduce((s, x) => s + x.points, 0), 2 * 380 + 2 * 164, 'bendra taškų suma');
  assert.equal(r.anomalies.length, 0);
  // kiekvieno žaidėjo bendra suma = ELITE + CHALLENGE
  for (const row of r.overall) assert.equal(row.points, row.categoryPoints.elite + row.categoryPoints.challenge + row.categoryPoints.future);
  assert.equal(byName(r.overall, 'Sofija B.').position, 1);
  assert.equal(byName(r.overall, 'Adrian').position, 21);
});

test('Trūkstama ketvirta CHALLENGE komanda: pažymėta, nekuriama, taškai nepriklauso nuo jos įvedimo', () => {
  const doc = raw();
  const ds = dataset(doc);
  const view = tournamentView(ds, C1);
  assert.deepEqual(view.incomplete, [{ position: 5, declared: 4, known: 3, missing: 1 }]);
  assert.equal(view.teamCount, 7, 'tik 3 + 4 žinomos komandos, ketvirta nekuriama');
  assert.deepEqual(tournamentView(ds, E1).incomplete, [], 'ELITE pilnas');
  assert.ok(doc.notes.some((n) => /trūksta/.test(n) && /CHALLENGE/.test(n)), 'failo pastabose įspėjimas');
  assert.ok(!ds.players.some((p) => /\?|nežinom|trūks|TBD/i.test(p.fullName)), 'jokių vietos laikytojų');

  // hipotetinė ketvirta komanda (TIK testui, bendri vardai): likusių taškai nesikeičia, grupė tampa pilna
  const extended = raw();
  extended.players.push({ id: 'p-test-a', fullName: 'Testinis A' }, { id: 'p-test-b', fullName: 'Testinis B' });
  extended.participations.push({ id: 'c1-test', tournamentId: C1, position: 5, groupSize: 4, playerIds: ['p-test-a', 'p-test-b'] });
  const ds2 = dataset(extended);
  assert.deepEqual(tournamentView(ds2, C1).incomplete, []);
  const r1 = rank(ds); const r2 = rank(ds2);
  for (const n of ['Luka B.', 'Adrian', 'Nerilė', 'Girmantė', 'Goda']) assert.equal(byName(r2.overall, n).points, byName(r1.overall, n).points, n);
  assert.equal(byName(r2.overall, 'Testinis A').points, 15);
});

test('Pasidalinta vieta: grupės dydis įskaito deklaruotą dydį; netinkamas dydis atmetamas', () => {
  const parts = [{ position: 5, groupSize: 4 }, { position: 5 }, { position: 5 }];
  assert.deepEqual([...positionCounts(parts)], [[5, 4]]);
  assert.deepEqual(incompleteGroups(parts), [{ position: 5, declared: 4, known: 3, missing: 1 }]);
  assert.deepEqual(incompleteGroups([{ position: 5, groupSize: 2 }, { position: 5 }]), []);
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player(id));
  const t = tournament('t', 'challenge', { allowTies: true, status: 'draft' });
  const ok = participations('t', [[1, ['a', 'b']], [2, ['c', 'd']], [2, ['e', 'f']]]).map((p) => (p.position === 2 ? { ...p, groupSize: 2 } : p));
  assert.equal(validateResults({ tournament: t, players, participations: ok }).valid, true);
  const bad = ok.map((p) => (p.position === 2 ? { ...p, groupSize: 1 } : p));
  assert.ok(validateResults({ tournament: t, players, participations: bad }).errors.some((e) => e.code === 'invalid_group_size'));
});

test('Pakartotinis įkėlimas ir dvigubas skelbimas taškų nedubliuoja', () => {
  const once = rank();
  const doc = raw();
  doc.tournaments.push(...raw().tournaments);
  doc.players.push(...raw().players);
  doc.participations.push(...raw().participations);
  const twice = rank(dataset(doc));
  assert.deepEqual(twice.overall.map((r) => [r.name, r.points, r.position]), once.overall.map((r) => [r.name, r.points, r.position]));
  assert.equal(dataset(doc).participations.length, 13);
  // tas pats failas du kartus iš eilės
  assert.deepEqual(rank(dataset()).overall.map((r) => r.points), once.overall.map((r) => r.points));
  // tas pats žaidėjas dviejose komandose to paties turnyro viduje taškų negauna dukart (variklio apsauga) – failas tokiu atveju netinkamas
  const bad = raw();
  bad.participations.push({ id: 'dup', tournamentId: E1, position: 6, playerIds: ['p-sofija-b', 'p-test-x'] });
  bad.players.push({ id: 'p-test-x', fullName: 'Testinis X' });
  assert.throws(() => normalizeStaticResults(bad), /netinkamas/);
});

test('Tapatybė: žaidėjai nejungiami pagal panašumą; Lea D. ir Danielė Š. – tie patys ID abiejuose turnyruose', () => {
  const ds = dataset();
  for (let i = 0; i < ds.players.length; i++) for (let j = i + 1; j < ds.players.length; j++) {
    assert.ok(!namesAlike(ds.players[i].fullName, ds.players[j].fullName), `${ds.players[i].fullName} / ${ds.players[j].fullName}`);
  }
  const usage = (name) => {
    const id = ds.players.find((p) => p.fullName === name).id;
    return ds.participations.filter((p) => p.playerIds.includes(id)).map((p) => p.tournamentId).sort();
  };
  assert.deepEqual(usage('Lea D.'), [C1, E1].sort());
  assert.deepEqual(usage('Danielė Š.'), [C1, E1].sort());
  assert.equal(ds.players.filter((p) => p.fullName === 'Lea D.').length, 1);
  // kiekvienas žaidėjas kiekviename turnyre ne daugiau kaip vieną kartą
  for (const t of [E1, C1]) {
    const ids = ds.participations.filter((p) => p.tournamentId === t).flatMap((p) => p.playerIds);
    assert.equal(new Set(ids).size, ids.length, t);
  }
  assert.equal(ds.players.filter((p) => p.nameStatus === 'first_name_only').length, 7, 'septyni tik vardu');
  assert.equal(ds.players.filter((p) => p.nameStatus === 'initial').length, 17);
});

test('Juodraščiai ir nepatvirtinti turnyrai failo rezultatuose reitingo nekeičia', () => {
  for (const status of ['draft', 'planned', 'awaiting_confirmation']) {
    const doc = raw();
    doc.tournaments.find((t) => t.id === C1).status = status;
    const r = rank(dataset(doc));
    assert.equal(byName(r.overall, 'Rusnė A.'), undefined, status);
    assert.equal(byName(r.overall, 'Lea D.').points, 42, status);
    assert.equal(r.overall.length, 12, status);
  }
});

test('Netinkamas failas atmetamas (sugadinti rezultatai nerodomi)', async () => {
  const bad = (fn) => { const d = raw(); fn(d); return d; };
  assert.throws(() => normalizeStaticResults(null), /formato/);
  assert.throws(() => normalizeStaticResults(bad((d) => { d.schemaVersion = 2; })), /formato/);
  assert.throws(() => normalizeStaticResults(bad((d) => { delete d.players; })), /trūksta/);
  assert.throws(() => normalizeStaticResults(bad((d) => { d.participations[0].playerIds[0] = 'nera-tokio'; })), /nežinomas žaidėjas/);
  assert.throws(() => normalizeStaticResults(bad((d) => { d.participations[0].tournamentId = 'nera'; })), /nežinomas turnyras/);
  assert.throws(() => normalizeStaticResults(bad((d) => { d.tournaments[0].allowTies = false; })), /tą pačią 5 vietą/);
  assert.throws(() => normalizeStaticResults(bad((d) => { d.participations[0].position = 9; })), /netinkamas/);

  const resp = (over) => async () => ({ ok: true, status: 200, json: async () => raw(), ...over });
  await assert.rejects(loadStaticResults({ fetchFn: async () => { throw new Error('tinklas'); }, url: 'x' }), /Nepavyko įkelti/);
  await assert.rejects(loadStaticResults({ fetchFn: resp({ ok: false, status: 404 }), url: 'x' }), /nepavyko gauti/);
  await assert.rejects(loadStaticResults({ fetchFn: resp({ json: async () => { throw new Error('x'); } }), url: 'x' }), /sugadintas/);
  const ok = await loadStaticResults({ fetchFn: resp({}), url: 'x' });
  assert.equal(ok.players.length, 24);
});

test('Viešas šaltinis yra tik failas: įkėlimo kodas nenaudoja localStorage ar vietinės saugyklos', () => {
  for (const file of ['static-results.js', 'public-app.js']) {
    const src = readFileSync(new URL(`../ranking/${file}`, import.meta.url), 'utf8');
    assert.ok(!/localStorage|sessionStorage|local-store|local-backend/.test(src.replace(/\/\/.*$/gm, '')), `${file} nenaudoja naršyklės saugyklos`);
  }
});
