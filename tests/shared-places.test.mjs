// Pasidalintos vietos: komandos užima visas grupės vietas ir gauna jų taškų VIDURKĮ.
// ELITE 5–6 → 21, CHALLENGE 5–8 → 15. Abu poros nariai gauna pilną sumą. Visi vardai čia – tik testų duomenys.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoringTableFor, sharedPlacePoints, positionCounts, pointsForEntry, computeRankings, previewPoints, tournamentView, validateResults,
} from '../ranking/engine.js';
import { createAdminController } from '../ranking/admin-controller.js';
import { createMemoryBackend } from '../ranking/memory-backend.js';
import { withCalendar } from '../ranking/view.js';
import { build, row, SEASON, player, tournament, participations } from './helpers.mjs';

const elite = scoringTableFor('elite');
const challenge = scoringTableFor('challenge');
const pair = (n) => [`p${n}a`, `p${n}b`];

test('sharedPlacePoints: ELITE 5–6 = 21, CHALLENGE 5–8 = 15, nedalijama vieta = įprasti taškai', () => {
  assert.equal(sharedPlacePoints(elite, 5, 2), 21);
  assert.equal(sharedPlacePoints(challenge, 5, 4), 15);
  for (const p of [1, 2, 3, 4, 5, 6, 8, 12, 16, 17]) assert.equal(sharedPlacePoints(elite, p, 1), pointsOf(elite, p));
  assert.equal(sharedPlacePoints(elite, 1, 3), 40.67, '(50+40+32)/3 apvalinama iki 2 skaitmenų');
  assert.equal(sharedPlacePoints(challenge, 5, 3), 16, '(18+16+14)/3');
  assert.equal(sharedPlacePoints(elite, 9, 4), 10, '9–12 taškai vienodi');
  assert.throws(() => sharedPlacePoints(elite, 5, 0), RangeError);
  assert.throws(() => sharedPlacePoints(elite, 5, 1.5), RangeError);
});
const pointsOf = (bands, p) => sharedPlacePoints(bands, p, 1);

test('positionCounts ir pointsForEntry ignoruoja netinkamas vietas', () => {
  const counts = positionCounts([{ position: 5 }, { position: 5 }, { position: null }, { position: 'x' }, { position: 0 }, {}]);
  assert.deepEqual([...counts], [[5, 2]]);
  assert.equal(pointsForEntry(elite, 5, counts), 21);
  assert.equal(pointsForEntry(elite, 1, counts), 50);
});

const ELITE_TEAMS = [[1, pair(1)], [2, pair(2)], [3, pair(3)], [4, pair(4)], [5, pair(5)], [5, pair(6)]];
const CHALLENGE_TEAMS = [[1, pair(11)], [2, pair(12)], [3, pair(13)], [4, pair(14)], [5, pair(15)], [5, pair(16)], [5, pair(17)], [5, pair(18)]];

test('ELITE su dviem komandomis 5–6 vietoje: abu poros nariai gauna po 21', () => {
  const d = build({ tournaments: [{ id: 'e1', type: 'elite', allowTies: true, teams: ELITE_TEAMS }] });
  const r = computeRankings(d, { seasonId: SEASON });
  const expected = { 1: 50, 2: 40, 3: 32, 4: 26, 5: 21, 6: 21 };
  ELITE_TEAMS.forEach(([, [a, b]], i) => {
    const want = expected[i + 1];
    for (const id of [a, b]) {
      assert.equal(row(r.overall, id).points, want, `${id} bendrame`);
      assert.equal(row(r.categories.elite, id).points, want, `${id} ELITE`);
      assert.equal(row(r.categories.challenge, id), undefined, `${id} ne CHALLENGE`);
    }
  });
  const view = tournamentView(d, 'e1');
  assert.deepEqual(view.teams.map((t) => t.points), [50, 40, 32, 26, 21, 21]);
  assert.deepEqual(view.teams.map((t) => t.position), [1, 2, 3, 4, 5, 5]);
  assert.equal(r.overall.length, 12, 'visi 12 žaidėjų po vieną kartą');
});

test('CHALLENGE su keturiomis komandomis 5–8 vietoje: abu poros nariai gauna po 15', () => {
  const d = build({ tournaments: [{ id: 'c1', type: 'challenge', allowTies: true, teams: CHALLENGE_TEAMS }] });
  const r = computeRankings(d, { seasonId: SEASON });
  const expected = [40, 32, 26, 21, 15, 15, 15, 15];
  CHALLENGE_TEAMS.forEach(([, ids], i) => ids.forEach((id) => {
    assert.equal(row(r.overall, id).points, expected[i], id);
    assert.equal(row(r.categories.challenge, id).points, expected[i], id);
  }));
  assert.deepEqual(tournamentView(d, 'c1').teams.map((t) => t.points), expected);
});

test('Žaidėjas abiejuose turnyruose: 21 + 15 = 36; juodraštis taškų neduoda', () => {
  const both = ['shared-a', 'shared-b'];
  const eliteTeams = [...ELITE_TEAMS.slice(0, 5), [5, both]];
  const challengeTeams = [...CHALLENGE_TEAMS.slice(0, 7), [5, both]];
  const spec = (status) => build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', allowTies: true, teams: eliteTeams },
    { id: 'c1', type: 'challenge', date: '2026-10-18', allowTies: true, status, teams: challengeTeams },
  ] });
  let r = computeRankings(spec('finalized'), { seasonId: SEASON });
  for (const id of both) {
    assert.equal(row(r.overall, id).points, 36);
    assert.equal(row(r.overall, id).categoryPoints.elite, 21);
    assert.equal(row(r.overall, id).categoryPoints.challenge, 15);
  }
  r = computeRankings(spec('draft'), { seasonId: SEASON });
  for (const id of both) assert.equal(row(r.overall, id).points, 21, 'CHALLENGE juodraštis taškų nepriduoda');
});

test('Peržiūra (previewPoints) rodo tuos pačius taškus kaip oficialus reitingas', () => {
  const t = tournament('c1', 'challenge', { status: 'draft', allowTies: true });
  const parts = participations('c1', CHALLENGE_TEAMS);
  const preview = previewPoints({ tournament: t, participations: parts });
  assert.deepEqual(preview.rows.map((x) => x.points), [40, 32, 26, 21, 15, 15, 15, 15]);
  const players = parts.flatMap((p) => p.playerIds).map((id) => player(id));
  assert.equal(validateResults({ tournament: t, players, participations: parts }).valid, true);
});

test('Dešimtainiai taškai sumuojami be slankiojo kablelio triukšmo', () => {
  // Trys komandos dalijasi 1 vietą: po 40,67; du tokie turnyrai → 81,34 (ne 81,33999…)
  const teams = [[1, pair(1)], [1, pair(2)], [1, pair(3)], [4, pair(4)]];
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-01', allowTies: true, teams },
    { id: 'e2', type: 'elite', date: '2026-10-02', allowTies: true, teams },
  ] });
  const r = computeRankings(d, { seasonId: SEASON });
  assert.equal(row(r.overall, 'p1a').points, 81.34);
  assert.equal(row(r.categories.elite, 'p1b').points, 81.34);
  assert.equal(row(r.overall, 'p4a').points, 52);
});

// ───────── Administravimo srautas: juodraštis, paskelbimas, pataisymai, pakartotinis paskelbimas ─────────
const E1 = '2026-2027-elite-1';
const C1 = '2026-2027-challenge-1';

async function setup(count) {
  const backend = createMemoryBackend(withCalendar({ seasons: [], tournaments: [], players: [], participations: [] }));
  const ctl = createAdminController(backend);
  await ctl.load();
  for (let i = 1; i <= count; i++) assert.equal(await ctl.createPlayer({ firstName: 'Testinis', lastName: `Z${String(i).padStart(2, '0')}` }), true);
  const id = (i) => ctl.state.dataset.players.find((p) => p.fullName === `Testinis Z${String(i).padStart(2, '0')}`).id;
  return { ctl, id };
}
const enableTies = async (ctl, tid) => {
  const t = ctl.state.dataset.tournaments.find((x) => x.id === tid);
  assert.equal(await ctl.upsertTournament({ ...t, allowTies: true }), true);
};
function fill(ctl, id, tid, rows) {
  ctl.selectTournament(tid);
  rows.forEach(([position, a, b]) => {
    ctl.addTeam();
    ctl.updateTeam(ctl.state.entries.at(-1).key, { position: String(position), player1: id(a), player2: id(b) });
  });
}
const official = (ctl) => computeRankings(ctl.state.dataset, { seasonId: SEASON });
const pts = (rows, ctl, id, n) => row(rows, id(n)).points;

test('Srautas: gyvi taškai, peržiūra ir juodraštis rodo 21 (ELITE) bei 15 (CHALLENGE); juodraštis reitingo nekeičia', async () => {
  const { ctl, id } = await setup(20);
  await enableTies(ctl, E1);
  fill(ctl, id, E1, [[1, 1, 2], [2, 3, 4], [3, 5, 6], [4, 7, 8], [5, 9, 10], [5, 11, 12]]);
  const live = ctl.livePoints();
  assert.deepEqual(ctl.state.entries.map((e) => live.byKey.get(e.key)), [50, 40, 32, 26, 21, 21]);
  const pv = ctl.preview();
  assert.equal(pv.validation.valid, true);
  assert.deepEqual(pv.teams.map((t) => t.points), [50, 40, 32, 26, 21, 21]);
  assert.equal(await ctl.saveDraft('draft'), true);
  assert.equal(official(ctl).overall.length, 0, 'juodraštis oficialaus reitingo nekeičia');

  await enableTies(ctl, C1);
  fill(ctl, id, C1, [[1, 13, 14], [2, 15, 16], [3, 17, 18], [4, 19, 20], [5, 1, 2], [5, 3, 4], [5, 5, 6], [5, 7, 8]]);
  assert.deepEqual(ctl.preview().teams.map((t) => t.points), [40, 32, 26, 21, 15, 15, 15, 15]);
  assert.equal(await ctl.saveDraft('draft'), true);
  assert.equal(official(ctl).overall.length, 0);
});

test('Srautas: pakartotinis paskelbimas ir pakartotinis juodraščio išsaugojimas taškų nedubliuoja', async () => {
  const { ctl, id } = await setup(12);
  await enableTies(ctl, E1);
  fill(ctl, id, E1, [[1, 1, 2], [2, 3, 4], [3, 5, 6], [4, 7, 8], [5, 9, 10], [5, 11, 12]]);
  assert.equal(await ctl.saveDraft('draft'), true);
  assert.equal(await ctl.saveDraft('draft'), true, 'juodraštį galima išsaugoti kelis kartus');
  assert.equal(ctl.state.dataset.participations.filter((p) => p.tournamentId === E1).length, 6, 'komandos nesidubliuoja');
  assert.equal(await ctl.finalize(), true);
  const snapshot = JSON.stringify(official(ctl).overall.map((r) => [r.playerId, r.points]));
  assert.equal(await ctl.finalize(), false, 'antras paskelbimas atmestas');
  assert.equal(await ctl.saveDraft('draft'), false, 'paskelbto turnyro juodraštis nebeperrašomas');
  assert.equal(JSON.stringify(official(ctl).overall.map((r) => [r.playerId, r.points])), snapshot);
  assert.equal(pts(official(ctl).overall, ctl, id, 9), 21);
  assert.equal(pts(official(ctl).overall, ctl, id, 10), 21, 'abu poros nariai');
  assert.equal(official(ctl).overall.length, 12);
});

test('Srautas: pataisymas perskaičiuoja taškus, o ne prideda prie senų (3 → 4 komandos grupėje: 16 → 15)', async () => {
  const { ctl, id } = await setup(16);
  await enableTies(ctl, C1);
  // trūksta ketvirtos poros: trys komandos dalijasi 5 vietą → (18+16+14)/3 = 16
  fill(ctl, id, C1, [[1, 1, 2], [2, 3, 4], [3, 5, 6], [4, 7, 8], [5, 9, 10], [5, 11, 12], [5, 13, 14]]);
  assert.deepEqual(ctl.preview().teams.map((t) => t.points), [40, 32, 26, 21, 16, 16, 16]);
  assert.equal(await ctl.finalize(), true);
  assert.equal(pts(official(ctl).overall, ctl, id, 9), 16);

  // pataisymas: pridedama ketvirta pora → visos keturios po 15
  ctl.selectTournament(C1);
  ctl.addTeam();
  ctl.updateTeam(ctl.state.entries.at(-1).key, { position: '5', player1: id(15), player2: id(16) });
  ctl.setReason('Pridėta praleista ketvirta pora');
  assert.equal(await ctl.correct(), true);
  const o = official(ctl).overall;
  for (const n of [9, 10, 11, 12, 13, 14, 15, 16]) assert.equal(pts(o, ctl, id, n), 15, `žaidėjas ${n}`);
  assert.equal(pts(o, ctl, id, 1), 40, 'nepakitusių komandų taškai nepasikeitė');
  assert.equal(o.length, 16);

  // tas pats pataisymas pakartotas: rezultatas toks pat, taškai nesikaupia
  const before = JSON.stringify(o.map((r) => [r.playerId, r.points]));
  ctl.selectTournament(C1);
  ctl.setReason('Pakartotinė patikra be pakeitimų');
  assert.equal(await ctl.correct(), true);
  assert.equal(JSON.stringify(official(ctl).overall.map((r) => [r.playerId, r.points])), before);

  // pataisymas išskaido grupę: ketvirta pora perkeliama į 8 vietą → 5–7 dalijasi trys (po 16), 8 vieta – 12
  ctl.selectTournament(C1);
  const last = ctl.state.entries.find((e) => e.playerIds.includes(id(15)));
  ctl.updateTeam(last.key, { position: '8' });
  ctl.setReason('Ketvirtos poros vieta ištaisyta į 8');
  assert.equal(await ctl.correct(), true);
  const o2 = official(ctl).overall;
  for (const n of [9, 10, 11, 12, 13, 14]) assert.equal(pts(o2, ctl, id, n), 16, `žaidėjas ${n}`);
  for (const n of [15, 16]) assert.equal(pts(o2, ctl, id, n), 12, `žaidėjas ${n}`);
  assert.equal(o2.length, 16, 'žaidėjų skaičius nepasikeitė');

  // neteisinga vieta (praleistas skaičius) atmetama ir taškų nekeičia
  ctl.selectTournament(C1);
  const again = ctl.state.entries.find((e) => e.playerIds.includes(id(15)));
  ctl.updateTeam(again.key, { position: '7' });
  ctl.setReason('Bandymas su neteisinga vieta');
  assert.equal(await ctl.correct(), false);
  assert.equal(pts(official(ctl).overall, ctl, id, 15), 12, 'atmestas pataisymas taškų nepakeitė');
});

test('Srautas: be varnelės „leisti pasidalintas vietas“ dubliuota vieta atmetama', async () => {
  const { ctl, id } = await setup(4);
  fill(ctl, id, E1, [[1, 1, 2], [1, 3, 4]]);
  const pv = ctl.preview();
  assert.equal(pv.validation.valid, false);
  assert.ok(pv.validation.errors.some((e) => e.code === 'duplicate_position'));
});
