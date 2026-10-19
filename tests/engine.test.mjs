import test from 'node:test';
import assert from 'node:assert/strict';
import { SCORING_TABLES } from '../ranking/config.js';
import {
  scoringTableFor, pointsForPosition, computeRankings, validateResults, previewPoints, tournamentView, computeAllTime,
  buildPlayerResults, playerShare, sharedPlacePoints,
} from '../ranking/engine.js';
import { build, row, dataset, player, tournament, participations, SEASON } from './helpers.mjs';

const pts = (type, position, version) => pointsForPosition(scoringTableFor(type, version), position);

// ───────── TEST A — turnyrų taškai ─────────
test('A: dabartinė v3 lentelė: taškai žaidėjui, poros balas = abiejų žaidėjų suma', () => {
  // poros balas (ELITE nepakito: 50 + 50 = 100; CHALLENGE 40 + 40 = 80)
  assert.equal(pts('elite', 1), 100);
  assert.equal(pts('challenge', 1), 80);
  assert.equal(pts('elite', 2), 80);
  assert.equal(pts('challenge', 2), 64);
  assert.equal(pts('challenge', 3), 52);
  assert.equal(pts('challenge', 4), 42);
  assert.equal(pts('elite', 1, 'v1'), 50, 'sena v1 lentelė išlieka tiems, kas ją nurodo');
  assert.equal(pts('challenge', 2, 'v2'), 32, 'v2 CHALLENGE nepakito istorijai');
  assert.equal(playerShare(pts('challenge', 1)), 40);
  assert.equal(playerShare(pts('challenge', 2)), 32);
  assert.equal(playerShare(pts('challenge', 3)), 26);
  assert.equal(playerShare(pts('challenge', 4)), 21);
  assert.equal(playerShare(sharedPlacePoints(scoringTableFor('challenge'), 5, 4)), 15);
  assert.equal(sharedPlacePoints(scoringTableFor('challenge'), 5, 4), 30, 'CHALLENGE 5–8: 15 + 15');
});

test('A: visa v3 lentelė sutampa su užduotimi (žaidėjo taškai × 2), ELITE sutampa su v2', () => {
  // [vieta, taškai ŽAIDĖJUI: ELITE, CHALLENGE, FUTURE] – perrašyta ranka iš užduoties
  const perPlayer = [
    [1, 50, 40, 30], [2, 40, 32, 24], [3, 32, 26, 20], [4, 26, 21, 16], [5, 22, 18, 13], [6, 20, 16, 12], [7, 18, 14, 10], [8, 16, 12, 9],
    [9, 10, 8, 6], [12, 10, 8, 6], [13, 6, 5, 4], [16, 6, 5, 4], [17, 2, 2, 2], [40, 2, 2, 2],
  ];
  for (const [position, e, c, f] of perPlayer) {
    assert.equal(pts('elite', position, 'v3'), e * 2, `ELITE ${position}`);
    assert.equal(pts('elite', position, 'v3'), pts('elite', position, 'v2'), `ELITE ${position}: poros balas nepakito`);
    assert.equal(pts('challenge', position, 'v3'), c * 2, `CHALLENGE ${position}`);
    assert.equal(pts('future', position, 'v3'), f * 2, `FUTURE ${position}`);
    assert.equal(playerShare(pts('challenge', position, 'v3')), c, `CHALLENGE ${position} žaidėjui`);
  }
});

test('A: visa oficiali v2 taškų lentelė sutampa su užduoties lentele (nepriklausomas kopijavimas)', () => {
  // [vieta, ELITE, CHALLENGE, FUTURE] – perrašyta ranka iš užduoties, ne iš config.js
  const spec2 = [
    [1, 100, 40, 30], [2, 80, 32, 24], [3, 64, 26, 20], [4, 52, 21, 16], [5, 44, 18, 13],
    [6, 40, 16, 12], [7, 36, 14, 10], [8, 32, 12, 9],
    [9, 20, 8, 6], [10, 20, 8, 6], [11, 20, 8, 6], [12, 20, 8, 6],
    [13, 12, 5, 4], [14, 12, 5, 4], [15, 12, 5, 4], [16, 12, 5, 4],
    [17, 4, 2, 2], [18, 4, 2, 2], [40, 4, 2, 2],
  ];
  for (const [position, e, c, f] of spec2) {
    assert.equal(pts('elite', position, 'v2'), e, `ELITE ${position}`);
    assert.equal(pts('challenge', position, 'v2'), c, `CHALLENGE ${position} (nepakito)`);
    assert.equal(pts('future', position, 'v2'), f, `FUTURE ${position}`);
  }
});

test('A: sena v1 taškų lentelė (ELITE 50) nepakito', () => {
  // [vieta, ELITE, CHALLENGE, FUTURE] – perrašyta ranka iš užduoties, ne iš config.js
  const spec = [
    [1, 50, 40, 30], [2, 40, 32, 24], [3, 32, 26, 20], [4, 26, 21, 16], [5, 22, 18, 13],
    [6, 20, 16, 12], [7, 18, 14, 10], [8, 16, 12, 9],
    [9, 10, 8, 6], [10, 10, 8, 6], [11, 10, 8, 6], [12, 10, 8, 6],
    [13, 6, 5, 4], [14, 6, 5, 4], [15, 6, 5, 4], [16, 6, 5, 4],
    [17, 2, 2, 2], [18, 2, 2, 2], [40, 2, 2, 2],
  ];
  for (const [position, e, c, f] of spec) {
    assert.equal(pts('elite', position, 'v1'), e, `ELITE ${position}`);
    assert.equal(pts('challenge', position, 'v1'), c, `CHALLENGE ${position}`);
    assert.equal(pts('future', position, 'v1'), f, `FUTURE ${position}`);
  }
});

test('A: netinkama vieta ir BEACH LEAGUE FINAL be taškų lentelės', () => {
  assert.throws(() => pointsForPosition(scoringTableFor('elite'), 0), RangeError);
  assert.throws(() => pointsForPosition(scoringTableFor('elite'), 1.5), RangeError);
  assert.equal(scoringTableFor('final'), null, 'finalas automatiškai negauna ELITE taškų');
});

test('A: taškų lentelė laikoma vienoje vietoje ir turi versijas', () => {
  assert.deepEqual(Object.keys(SCORING_TABLES), ['v1', 'v2', 'v3']);
});

// ───────── TEST B — bendras reitingas ─────────
test('B: ELITE 1 vt. + CHALLENGE 2 vt. + FUTURE 3 vt. = 102 taškai', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[1, ['p3', 'p4']], [2, ['p1', 'p5']]] },
    { id: 'f1', type: 'future', date: '2026-10-25', teams: [[1, ['p6', 'p7']], [2, ['p3', 'p4']], [3, ['p1', 'p8']]] },
  ] });
  const { overall } = computeRankings(d, { seasonId: SEASON });
  const p1 = row(overall, 'p1');
  assert.equal(p1.points, 50 + 32 + 20);
  assert.equal(p1.points, 102);
  assert.deepEqual(p1.played, { elite: 1, challenge: 1, future: 1, total: 3 });
  assert.equal(p1.wins, 1);
  // p3: ELITE 2 vt. (40) + CHALLENGE 1 vt. (40) + FUTURE 2 vt. (24) = 104, todėl pirmauja p3, o p1 – antras.
  assert.equal(overall[0].playerId, 'p3');
  assert.equal(overall[0].points, 104);
  assert.equal(p1.position, 3, 'p3 ir p4 (po 104) dalijasi 1 vietą, todėl p1 – 3');
});

// ───────── TEST C — individualus reitingas ─────────
test('C: abu laimėjusios ELITE komandos žaidėjai gauna po 50 taškų (taškai nedalijami)', () => {
  const d = build({ tournaments: [{ id: 'e1', type: 'elite', teams: [[1, ['a', 'b']], [2, ['c', 'd']]] }] });
  const { overall } = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(overall, 'a').points, 50);
  assert.equal(row(overall, 'b').points, 50);
  assert.equal(row(overall, 'c').points, 40);
  assert.equal(row(overall, 'd').points, 40);
});

// ───────── TEST D — partnerių keitimas ─────────
test('D: pakeitus partnerį žaidėjas išlaiko ankstesnius taškus', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', teams: [[1, ['p1', 'p2']], [2, ['x1', 'x2']]] },
    { id: 'e2', type: 'elite', date: '2026-11-08', teams: [[1, ['y1', 'y2']], [2, ['x1', 'x2']], [3, ['p1', 'p3']]] },
  ] });
  const { overall } = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(overall, 'p1').points, 50 + 32, 'p1 turi abiejų partnerių taškus');
  assert.equal(row(overall, 'p2').points, 50, 'p2 išlaiko savo taškus');
  assert.equal(row(overall, 'p3').points, 32, 'naujas partneris gauna tik savo turnyro taškus');
  const history = row(overall, 'p1').results;
  assert.deepEqual(history.map((r) => r.partnerIds[0]), ['p2', 'p3']);
});

// ───────── TEST E — kategorijų atskyrimas ─────────
test('E: CHALLENGE taškai neatsiranda ELITE kategorijos sumoje', () => {
  const d = build({ tournaments: [
    { id: 'c1', type: 'challenge', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
  ] });
  const r = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(r.overall, 'p1').points, 40);
  assert.equal(row(r.overall, 'p1').categoryPoints.elite, 0);
  assert.equal(row(r.overall, 'p1').categoryPoints.challenge, 40);
  assert.equal(row(r.categories.elite, 'p1'), undefined, 'ELITE reitinge žaidėjo nėra');
  assert.equal(row(r.categories.challenge, 'p1').points, 40);
  assert.equal(row(r.categories.future, 'p1'), undefined);
});

test('E: kategorijų reitingų suma sutampa su bendru reitingu', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[2, ['p1', 'p2']], [1, ['p3', 'p4']]] },
    { id: 'f1', type: 'future', date: '2026-10-25', teams: [[3, ['p1', 'p2']], [1, ['p3', 'p4']]] },
  ] });
  const r = computeRankings(d, { seasonId: SEASON });
  for (const o of r.overall) {
    const sum = ['elite', 'challenge', 'future'].reduce((s, c) => s + (row(r.categories[c], o.playerId)?.points || 0), 0);
    assert.equal(o.points, sum);
  }
});

// ───────── TEST F — juodraščiai ─────────
test('F: juodraščiai, vykstantys ir nepatvirtinti turnyrai neduoda taškų', () => {
  for (const status of ['planned', 'in_progress', 'draft', 'awaiting_confirmation']) {
    const d = build({ tournaments: [{ id: 'e1', type: 'elite', status, teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] }] });
    const r = computeRankings(d, { seasonId: SEASON });
    assert.equal(r.overall.length, 0, `status ${status}`);
    assert.equal(r.categories.elite.length, 0);
    assert.equal(r.results.length, 0);
  }
});

// ───────── Turnyro įtaka ir sezonai ─────────
test('BEACH LEAGUE FINAL nėra įskaitomas į reitingus, bet jo rezultatai matomi', () => {
  const d = build({ tournaments: [
    { id: 'fin', type: 'final', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
  ] });
  const r = computeRankings(d, { seasonId: SEASON });
  assert.equal(r.overall.length, 0);
  const view = tournamentView(d, 'fin');
  assert.equal(view.scored, false);
  assert.deepEqual(view.affects, []);
  assert.equal(view.teams[0].points, 0);
});

test('Skirtingų sezonų taškai nesumuojami sezono reitinge, bet sumuojami visų sezonų statistikoje', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', seasonId: '2026-2027', date: '2026-10-11', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'e2', type: 'elite', seasonId: '2027-2028', date: '2027-10-10', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
  ] });
  d.seasons.push({ id: '2027-2028', label: '2027–2028', isCurrent: false, scoringVersion: 'v1' });
  assert.equal(row(computeRankings(d, { seasonId: '2026-2027' }).overall, 'p1').points, 50);
  assert.equal(row(computeRankings(d, { seasonId: '2027-2028' }).overall, 'p1').points, 50);
  const all = computeAllTime(d);
  assert.equal(row(all, 'p1').points, 100);
  assert.equal(row(all, 'p1').seasons, 2);
});

test('Turnyro vaizdas: vietos, taškai ir poveikis reitingams', () => {
  const d = build({ tournaments: [{ id: 'c1', type: 'challenge', teams: [[2, ['p3', 'p4']], [1, ['p1', 'p2']]] }] });
  const v = tournamentView(d, 'c1');
  assert.equal(v.teamCount, 2);
  assert.deepEqual(v.teams.map((t) => [t.position, t.points]), [[1, 40], [2, 32]]);
  assert.deepEqual(v.affects, ['challenge']);
  d.tournaments[0].status = 'draft';
  const draft = tournamentView(d, 'c1');
  assert.equal(draft.official, false);
  assert.equal(draft.teams.length, 0, 'juodraščio rezultatai nerodomi');
});

test('Taškų peržiūra prieš paskelbimą', () => {
  const t = tournament('e1', 'elite', { status: 'draft' });
  const parts = participations('e1', [[1, ['a', 'b']], [2, ['c', 'd']], [3, ['e', 'f']]]);
  const preview = previewPoints({ tournament: t, participations: parts });
  assert.equal(preview.scored, true);
  assert.deepEqual(preview.rows.map((r) => r.points), [100, 80, 64]);
});

// ───────── TEST I — dubliavimosi prevencija ─────────
test('I: validacija atmeta žaidėją dviejose komandose, dubliuotą komandą ir tą patį žaidėją dukart', () => {
  const t = tournament('e1', 'elite', { status: 'draft' });
  const players = ['a', 'b', 'c', 'd'].map((id) => player(id));
  const dupPlayer = validateResults({ tournament: t, players, participations: participations('e1', [[1, ['a', 'b']], [2, ['a', 'c']]]) });
  assert.ok(dupPlayer.errors.some((e) => e.code === 'player_in_two_teams'));
  const dupTeam = validateResults({ tournament: t, players, participations: participations('e1', [[1, ['a', 'b']], [2, ['b', 'a']]]) });
  assert.ok(dupTeam.errors.some((e) => e.code === 'duplicate_team'));
  const same = validateResults({ tournament: t, players, participations: participations('e1', [[1, ['a', 'a']], [2, ['c', 'd']]]) });
  assert.ok(same.errors.some((e) => e.code === 'same_player_twice'));
  const sameId = participations('e1', [[1, ['a', 'b']], [2, ['c', 'd']]]);
  sameId[1].id = sameId[0].id;
  assert.ok(validateResults({ tournament: t, players, participations: sameId }).errors.some((e) => e.code === 'duplicate_team'));
});

test('I: variklis niekada neduoda to paties turnyro taškų žaidėjui dukart, net jei duomenys sugadinti', () => {
  const d = build({ tournaments: [{ id: 'e1', type: 'elite', teams: [[1, ['p1', 'p2']], [2, ['p1', 'p3']]] }] });
  const { overall, anomalies } = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(overall, 'p1').points, 50, 'tik vienas įrašas');
  assert.equal(row(overall, 'p1').played.total, 1);
  assert.equal(anomalies.length, 1);
});

test('Sujungti žaidėjai: taškai priskiriami pagrindiniam įrašui', () => {
  const d = build({ tournaments: [{ id: 'e1', type: 'elite', teams: [[1, ['dup', 'p2']], [2, ['p3', 'p4']]] }] });
  d.players.push(player('main'));
  d.players.find((p) => p.id === 'dup').mergedInto = 'main';
  const { results } = buildPlayerResults(d, { seasonId: SEASON });
  assert.ok(results.some((r) => r.playerId === 'main'));
  assert.ok(!results.some((r) => r.playerId === 'dup'));
});

// ───────── Validacijos taisyklės ─────────
test('Validacija: trūkstamos / pasikartojančios / neteisingos vietos', () => {
  const t = tournament('e1', 'elite', { status: 'draft' });
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player(id));
  const run = (entries, t2 = t) => validateResults({ tournament: t2, players, participations: participations('e1', entries) });

  assert.equal(run([[1, ['a', 'b']], [2, ['c', 'd']]]).valid, true);
  assert.ok(run([[1, ['a', 'b']], [1, ['c', 'd']]]).errors.some((e) => e.code === 'duplicate_position'));
  assert.ok(run([[1, ['a', 'b']], [null, ['c', 'd']]]).errors.some((e) => e.code === 'missing_position'));
  assert.ok(run([[1, ['a', 'b']], [0, ['c', 'd']]]).errors.some((e) => e.code === 'invalid_position'));
  assert.ok(run([[1, ['a', 'b']], [2.5, ['c', 'd']]]).errors.some((e) => e.code === 'invalid_position'));
  assert.ok(run([[1, ['a', 'b']], [5, ['c', 'd']]]).errors.some((e) => e.code === 'position_out_of_range'));
  assert.ok(run([[1, ['a', 'b']]]).errors.some((e) => e.code === 'too_few_teams'));
  assert.ok(run([[1, ['a']], [2, ['c', 'd']]]).errors.some((e) => e.code === 'team_needs_two_players'));
  assert.ok(run([[1, ['a', 'zzz']], [2, ['c', 'd']]]).errors.some((e) => e.code === 'unknown_player'));
});

test('Validacija: lygios vietos tik kai leidžiama, pagal 1-2-2-4 taisyklę', () => {
  const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => player(id));
  const strict = tournament('e1', 'elite', { status: 'draft', allowTies: false });
  const loose = tournament('e1', 'elite', { status: 'draft', allowTies: true });
  const entries = [[1, ['a', 'b']], [2, ['c', 'd']], [2, ['e', 'f']], [4, ['g', 'h']]];
  const parts = participations('e1', entries);
  assert.equal(validateResults({ tournament: strict, players, participations: parts }).valid, false);
  assert.equal(validateResults({ tournament: loose, players, participations: parts }).valid, true);
  // netinkamas „praleidimas“: 1,2,2,3
  const wrong = participations('e1', [[1, ['a', 'b']], [2, ['c', 'd']], [2, ['e', 'f']], [3, ['g', 'h']]]);
  assert.ok(validateResults({ tournament: loose, players, participations: wrong }).errors.some((e) => e.code === 'invalid_tie_positions'));
});

test('Lygios vietos turnyre: pasidalinusios komandos gauna užimtų vietų taškų vidurkį', () => {
  const d = build({ tournaments: [{ id: 'e1', type: 'elite', allowTies: true, teams: [[1, ['a', 'b']], [2, ['c', 'd']], [2, ['e', 'f']], [4, ['g', 'h']]] }] });
  const { overall } = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(overall, 'a').points, 50);
  assert.equal(row(overall, 'c').points, 36, '(40+32)/2');
  assert.equal(row(overall, 'd').points, 36, 'abu poros nariai gauna pilną sumą');
  assert.equal(row(overall, 'e').points, 36);
  assert.equal(row(overall, 'g').points, 26, 'vieta 4 (po praleistos 3) – įprasti taškai');
});

test('Validacija: finalui taškų nėra – įspėjimas, ne klaida', () => {
  const t = tournament('fin', 'final', { status: 'draft' });
  const players = ['a', 'b', 'c', 'd'].map((id) => player(id));
  const res = validateResults({ tournament: t, players, participations: participations('fin', [[1, ['a', 'b']], [2, ['c', 'd']]]) });
  assert.equal(res.valid, true);
  assert.equal(res.warnings[0].code, 'unscored_event');
});

// ───────── TEST J — lygių sprendimas ─────────
test('J: lygių taškų sprendimo tvarka ir ta pati vieta, kai viskas vienoda', () => {
  // Visos poros turi lygiai 50 taškų, bet skirtingą profilį. Poros nariai visada turi tą patį profilį.
  const d = build({ tournaments: [
    { id: 'E1', type: 'elite', date: '2026-10-01', teams: [[1, ['t1a', 't1b']], [2, ['t3a', 't3b']]] },
    { id: 'E2', type: 'elite', date: '2026-10-02', teams: [[9, ['t2a', 't2b']], [10, ['t3a', 't3b']]] },
    { id: 'C1', type: 'challenge', date: '2026-10-03', teams: [[1, ['t2a', 't2b']]] },
    { id: 'C2', type: 'challenge', date: '2026-10-04', teams: [[3, ['t4a', 't4b']]] },
    { id: 'F1', type: 'future', date: '2026-10-05', teams: [[2, ['t4a', 't4b']]] },
    { id: 'C3', type: 'challenge', date: '2026-10-06', teams: [[4, ['t5a', 't5b']]] },
    { id: 'F2', type: 'future', date: '2026-10-07', teams: [[5, ['t5a', 't5b']]] },
    { id: 'F3', type: 'future', date: '2026-10-08', teams: [[4, ['t5a', 't5b']]] },
    { id: 'C4', type: 'challenge', date: '2026-10-09', teams: [[4, ['t6a', 't6b']]] },
    { id: 'F4', type: 'future', date: '2026-10-10', teams: [[5, ['t6a', 't6b']]] },
    { id: 'F5', type: 'future', date: '2026-10-11', teams: [[4, ['t6a', 't6b']]] },
  ] });
  const { overall } = computeRankings(d, { seasonId: SEASON });
  const total = (id) => row(overall, id).points;
  ['t1a', 't2a', 't3a', 't4a', 't5a', 't6a'].forEach((id) => assert.equal(total(id), 50, id));

  const pos = (id) => row(overall, id).position;
  assert.equal(pos('t1a'), 1, '1) daugiau ELITE pergalių');
  assert.equal(pos('t2a'), 3, '2) daugiau pergalių iš viso (ELITE pergalių abu neturi)');
  assert.equal(pos('t3a'), 5, '3) daugiau ELITE antrų vietų');
  assert.equal(pos('t5a'), 7, '4) daugiau sužaistų turnyrų (3 prieš 2)');
  assert.equal(pos('t6a'), 7, '5) identiški profiliai dalijasi ta pačia vieta');
  assert.equal(pos('t5b'), 7);
  assert.equal(pos('t4a'), 11, 'kita vieta po keturių lygiųjų = 11');

  assert.equal(row(overall, 't5a').tied, true);
  assert.equal(row(overall, 't6b').tied, true);
  assert.equal(row(overall, 't1a').tied, true, 'poros narys su ta pačia vieta – taip pat žymimas kaip lygus');
});

test('J: vardas nenaudojamas sportiniam lygių sprendimui – lygūs žaidėjai turi tą pačią vietą', () => {
  const d = build({ tournaments: [{ id: 'e1', type: 'elite', teams: [[1, ['zzz', 'aaa']], [2, ['mmm', 'nnn']]] }] });
  d.players.find((p) => p.id === 'zzz').fullName = 'Žilvinas Žilys';
  d.players.find((p) => p.id === 'aaa').fullName = 'Adomas Abraitis';
  const { overall } = computeRankings(d, { seasonId: SEASON });
  assert.equal(overall[0].position, 1);
  assert.equal(overall[1].position, 1);
  assert.equal(overall[0].name, 'Adomas Abraitis', 'abėcėlė tik rodymo tvarkai');
});

test('J: kategorijos reitingas – pirmiausia pergalės toje kategorijoje', () => {
  // 30 taškų FUTURE: pirma vieta (30) prieš trečia (20) + šešta (12)? -> naudojame: A: 1 vt. = 30; B: 3 vt. (20) + 8 vt. (9) + 13 vt. (4) = 33 > 30.
  // Lygūs taškai: A: 1 vt. = 30. B: 2 vt. (24) + 6 vt. (12) = 36 ≠ 30. Imame B: 4 vt. (16) + 7 vt. (10) + 15 vt. (4) = 30.
  const d = build({ tournaments: [
    { id: 'f1', type: 'future', date: '2026-10-01', teams: [[1, ['a1', 'a2']], [4, ['b1', 'b2']]] },
    { id: 'f2', type: 'future', date: '2026-10-02', teams: [[7, ['b1', 'b2']]] },
    { id: 'f3', type: 'future', date: '2026-10-03', teams: [[15, ['b1', 'b2']]] },
  ] });
  const { categories } = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(categories.future, 'a1').points, 30);
  assert.equal(row(categories.future, 'b1').points, 30);
  assert.equal(row(categories.future, 'a1').position, 1, 'daugiau pergalių');
  assert.equal(row(categories.future, 'b1').position, 3);
});

// ───────── Judėjimas ─────────
test('Judėjimas: be istorijos (vienas turnyras) nerodomas; vėliau lyginama su lentele prieš paskutinį turnyrą', () => {
  const one = build({ tournaments: [{ id: 'e1', type: 'elite', date: '2026-10-01', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] }] });
  const r1 = computeRankings(one, { seasonId: SEASON });
  assert.equal(r1.movementAvailable, false);
  assert.equal(r1.overall[0].movement, null);

  const two = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-01', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'e2', type: 'elite', date: '2026-11-01', teams: [[1, ['p3', 'p4']], [2, ['p1', 'p2']], [3, ['p5', 'p6']]] },
  ] });
  const r2 = computeRankings(two, { seasonId: SEASON });
  assert.equal(r2.movementAvailable, true);
  assert.equal(row(r2.overall, 'p5').movement, 'new');
  assert.equal(row(r2.overall, 'p1').movement, 0, 'p1 ir p3 su ta pačia 90 taškų suma – abu 1 vietoje');
});

test('Rezultatai deterministiški: tie patys duomenys visada duoda tą patį reitingą', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[1, ['p3', 'p4']], [2, ['p1', 'p5']]] },
  ] });
  const a = computeRankings(d, { seasonId: SEASON });
  const shuffled = { ...d, participations: [...d.participations].reverse(), players: [...d.players].reverse() };
  const b = computeRankings(shuffled, { seasonId: SEASON });
  assert.deepEqual(a.overall.map((r) => [r.playerId, r.position, r.points]), b.overall.map((r) => [r.playerId, r.position, r.points]));
});

test('Tuščias duomenų rinkinys neduoda klaidų', () => {
  const r = computeRankings(dataset(), { seasonId: SEASON });
  assert.deepEqual(r.overall, []);
  assert.deepEqual(r.categories.elite, []);
});
