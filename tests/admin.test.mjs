import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminController } from '../ranking/admin-controller.js';
import { createMemoryBackend } from '../ranking/memory-backend.js';
import { ApiError } from '../ranking/api.js';
import { computeRankings } from '../ranking/engine.js';
import { withCalendar } from '../ranking/view.js';

const E1 = '2026-2027-elite-1';
const SEASON = '2026-2027';
const empty = () => withCalendar({ seasons: [], tournaments: [], players: [], participations: [] });
const official = (ctl) => computeRankings(ctl.state.dataset, { seasonId: SEASON });
const pointsOf = (rows, name) => (rows.find((r) => r.name === name) || {}).points;

async function setup() {
  const backend = createMemoryBackend(empty());
  const ctl = createAdminController(backend);
  await ctl.load();
  for (const last of ['A', 'B', 'C', 'D', 'E', 'F']) {
    assert.equal(await ctl.createPlayer({ firstName: 'Testinis', lastName: last }), true);
  }
  const id = (n) => ctl.state.dataset.players.find((p) => p.fullName === `Testinis ${n}`).id;
  return { backend, ctl, id };
}

function fillTeams(ctl, id, teams) {
  ctl.selectTournament(E1);
  teams.forEach(([position, a, b]) => {
    ctl.addTeam();
    const row = ctl.state.entries.at(-1);
    ctl.updateTeam(row.key, { position: String(position), player1: id(a), player2: id(b) });
  });
}

test('Administratoriaus srautas: peržiūra → juodraštis → patvirtinimas', async () => {
  const { ctl, id } = await setup();
  assert.equal(ctl.state.dataset.tournaments.filter((t) => t.id === E1).length, 1, 'naudojamas esamas kalendoriaus renginys, ne dublikatas');
  fillTeams(ctl, id, [[1, 'A', 'B'], [2, 'C', 'D'], [3, 'E', 'F']]);

  const preview = ctl.preview();
  assert.equal(preview.validation.valid, true);
  assert.deepEqual(preview.teams.map((t) => t.points), [50, 40, 32]);
  assert.equal(preview.teams[0].players.length, 2);

  // juodraštis neturi įtakos oficialiam reitingui
  assert.equal(await ctl.saveDraft('draft'), true);
  assert.equal(ctl.state.notice.type, 'success');
  assert.equal(ctl.state.dataset.tournaments.find((t) => t.id === E1).status, 'draft');
  assert.equal(official(ctl).overall.length, 0);

  // patvirtinimas
  assert.equal(await ctl.finalize(), true);
  assert.equal(ctl.state.dataset.tournaments.find((t) => t.id === E1).status, 'finalized');
  const { overall } = official(ctl);
  assert.equal(pointsOf(overall, 'Testinis A'), 50);
  assert.equal(pointsOf(overall, 'Testinis B'), 50);
  assert.equal(pointsOf(overall, 'Testinis C'), 40);
});

test('Antras paskelbimas ir dvigubas paspaudimas taškų neskiria dukart', async () => {
  const { ctl, id } = await setup();
  fillTeams(ctl, id, [[1, 'A', 'B'], [2, 'C', 'D']]);
  const [first, second] = await Promise.all([ctl.finalize(), ctl.finalize()]);
  assert.equal(first, true);
  assert.equal(second, false, 'antras vienalaikis paspaudimas ignoruojamas');
  assert.equal(await ctl.finalize(), false);
  assert.match(ctl.state.notice.text, /jau paskelbti/);
  assert.equal(pointsOf(official(ctl).overall, 'Testinis A'), 50);
  assert.equal(official(ctl).results.length, 4);
  assert.equal(ctl.state.dataset.participations.filter((p) => p.tournamentId === E1).length, 2);
});

test('Neteisingų rezultatų patvirtinti neleidžiama, klaidos rodomos lietuviškai', async () => {
  const { ctl, id } = await setup();
  fillTeams(ctl, id, [[1, 'A', 'B'], [1, 'C', 'D']]);
  assert.equal(await ctl.finalize(), false);
  assert.equal(ctl.state.notice.type, 'error');
  assert.ok(ctl.state.notice.details.some((d) => /tą pačią/.test(d.message)));
  assert.notEqual(ctl.state.dataset.tournaments.find((t) => t.id === E1).status, 'finalized');

  const p = ctl.preview();
  assert.equal(p.validation.valid, false);
  assert.equal(p.teams.length, 0, 'neteisingiems rezultatams taškai neskaičiuojami');

  // tas pats žaidėjas dviejose komandose
  ctl.selectTournament(E1);
  ctl.addTeam(); ctl.addTeam();
  const [r1, r2] = ctl.state.entries;
  ctl.updateTeam(r1.key, { position: '1', player1: id('A'), player2: id('B') });
  ctl.updateTeam(r2.key, { position: '2', player1: id('A'), player2: id('C') });
  assert.equal(ctl.preview().validation.valid, false);
  assert.equal(await ctl.saveDraft(), false, 'serveris atmeta net juodraštį su dubliuotu žaidėju');
  assert.match(ctl.state.notice.text, /dviejose komandose/);

  // tuščia komanda / trūksta partnerio / trūksta vietos
  ctl.updateTeam(r2.key, { player1: id('C'), player2: '', position: '' });
  const v = ctl.preview().validation;
  assert.ok(v.errors.some((e) => e.code === 'team_needs_two_players') && v.errors.some((e) => e.code === 'missing_position'));
});

test('Pataisymas: priežastis privaloma, tinkamas pataisymas perskaičiuoja, netinkamas nieko nepakeičia', async () => {
  const { ctl, id, backend } = await setup();
  fillTeams(ctl, id, [[1, 'A', 'B'], [2, 'C', 'D'], [3, 'E', 'F']]);
  await ctl.finalize();

  // negalima naudoti paprasto juodraščio išsaugojimo
  assert.equal(await ctl.saveDraft(), false);
  ctl.selectTournament(E1);
  const [t1, t2] = ctl.state.entries;
  ctl.updateTeam(t1.key, { position: '2' });
  ctl.updateTeam(t2.key, { position: '1' });

  assert.equal(await ctl.correct(), false, 'be priežasties');
  assert.match(ctl.state.notice.text, /priežast/);
  ctl.setReason('Finalo vietos buvo sukeistos');
  assert.equal(await ctl.correct(), true);
  assert.equal(pointsOf(official(ctl).overall, 'Testinis A'), 40);
  assert.equal(pointsOf(official(ctl).overall, 'Testinis C'), 50);
  assert.equal(ctl.state.dataset.tournaments.find((t) => t.id === E1).revision, 2);
  assert.equal(official(ctl).results.length, 6, 'taškai nedubliuojami');

  // netinkamas pataisymas
  ctl.selectTournament(E1);
  ctl.updateTeam(ctl.state.entries[0].key, { position: '2' });
  ctl.updateTeam(ctl.state.entries[1].key, { position: '2' });
  ctl.setReason('Bandymas su klaida');
  assert.equal(await ctl.correct(), false);
  assert.equal(pointsOf(official(ctl).overall, 'Testinis C'), 50, 'oficialūs rezultatai nepakito');

  // auditas
  await ctl.loadAudit();
  const correction = ctl.state.audit.find((a) => a.action === 'correct');
  assert.equal(correction.reason, 'Finalo vietos buvo sukeistos');
  assert.ok(correction.before && correction.after);
  assert.ok(ctl.state.audit.some((a) => a.action === 'finalize'));
  void backend;
});

test('Žaidėjai: vardas ir pavardė privalomi, panašių vardų įspėjimas (diakritikai, tvarka), vardo taisymas, paieška, sujungimas', async () => {
  const { ctl, id } = await setup();

  // Būtini abu laukai
  assert.equal(await ctl.createPlayer({ firstName: 'Tik vardas', lastName: '' }), false);
  assert.equal(await ctl.createPlayer({ firstName: '   ', lastName: 'Tik pavardė' }), false);
  assert.match(ctl.state.notice.text, /vardą, ir pavardę/);
  assert.equal(ctl.state.dataset.players.length, 6, 'nepilni duomenys neišsaugomi');

  const created = await ctl.createPlayer({ firstName: '  Žilvinas ', lastName: 'Žilys  ' });
  assert.equal(created, true);
  assert.match(ctl.state.notice.text, /„Žilvinas Žilys“ išsaugotas/);
  const stored = ctl.state.dataset.players.find((p) => p.fullName === 'Žilvinas Žilys');
  assert.equal(stored.firstName, 'Žilvinas');
  assert.equal(stored.lastName, 'Žilys');

  // Dublikatai: skirtingos raidės, be diakritikų, kita žodžių tvarka
  for (const [first, last] of [['zilvinas', 'zilys'], ['ŽILVINAS', 'ŽILYS'], ['Žilys', 'Žilvinas']]) {
    assert.equal(await ctl.createPlayer({ firstName: first, lastName: last }), false, `${first} ${last}`);
    assert.ok(ctl.state.pendingDuplicate, 'pateikiamas įspėjimas su esamu įrašu');
    assert.equal(ctl.state.pendingDuplicate.similar[0].id, stored.id);
    assert.equal(ctl.state.notice.type, 'warning');
  }
  assert.equal(ctl.state.dataset.players.length, 7, 'be patvirtinimo naujas įrašas nekuriamas');
  // Skirtingas žmogus (kita pavardė) – be įspėjimo
  assert.equal(await ctl.createPlayer({ firstName: 'Žilvinas', lastName: 'Žilinskas' }), true);
  assert.equal(ctl.state.pendingDuplicate, null);
  // Sąmoningas atskiro įrašo sukūrimas (tas pats vardas, kitas žmogus)
  assert.equal(await ctl.createPlayer({ firstName: 'Žilvinas', lastName: 'Žilys' }, { force: true }), true, 'sąmoningas kūrimas leidžiamas');
  assert.equal(ctl.state.dataset.players.length, 9);

  // Paieška be diakritikų ir didžiųjų raidžių, taip pat pagal ID
  assert.equal(ctl.searchPlayers('zilvinas').length, 3);
  assert.equal(ctl.searchPlayers('ZILYS').length, 2);
  assert.equal(ctl.searchPlayers('zilvinas zilys').length, 2);
  assert.equal(ctl.searchPlayers(stored.id.slice(0, 8))[0].id, stored.id);
  assert.equal(ctl.searchPlayers('nėra tokio').length, 0);

  // Vardo taisymas išsaugo ID
  const zil = ctl.state.dataset.players.filter((p) => p.fullName === 'Žilvinas Žilys');
  assert.equal(await ctl.updatePlayer(zil[0].id, { firstName: 'Žilvinas', lastName: 'Žilys-Pataisytas' }), true);
  assert.equal(ctl.state.dataset.players.length, 9, 'vardo pataisymas nekuria dublikato');
  const fixed = ctl.state.dataset.players.find((p) => p.id === zil[0].id);
  assert.equal(fixed.fullName, 'Žilvinas Žilys-Pataisytas');
  assert.equal(await ctl.updatePlayer(zil[0].id, { firstName: 'Žilvinas', lastName: '' }), false, 'tuščios pavardės neišsaugo');
  assert.equal(ctl.state.dataset.players.find((p) => p.id === zil[0].id).fullName, 'Žilvinas Žilys-Pataisytas');

  // Sujungimas po rezultatų
  fillTeams(ctl, id, [[1, 'A', 'B'], [2, 'C', 'D']]);
  await ctl.finalize();
  assert.equal(await ctl.mergePlayers(id('A'), id('B'), 'bandymas'), false, 'abu dalyvavo tame pačiame turnyre');
  assert.match(ctl.state.notice.text, /saugiai negalima/);
  assert.equal(await ctl.mergePlayers(zil[0].id, zil[1].id, 'Dublikatas'), true);
  assert.equal(ctl.state.dataset.players.find((p) => p.id === zil[1].id).mergedInto, zil[0].id);
  // sujungtas įrašas nebesiūlomas komandų redagavime
  ctl.selectTournament('2026-2027-challenge-1');
  ctl.addTeam();
  ctl.updateTeam(ctl.state.entries[0].key, { player1: zil[1].id, player2: id('E'), position: '1' });
  ctl.addTeam();
  ctl.updateTeam(ctl.state.entries[1].key, { player1: id('C'), player2: id('F'), position: '2' });
  assert.ok(ctl.preview().validation.errors.some((e) => e.code === 'unknown_player'));
});

test('Sezonai ir turnyrai: naujas sezonas, turnyro ID iš sezono/tipo/numerio, patvirtinto turnyro neperrašyti', async () => {
  const { ctl, id } = await setup();
  assert.equal(await ctl.upsertSeason({ id: '2027-2028', label: '2027–2028', isCurrent: false, scoringVersion: 'v1' }), true);
  assert.ok(ctl.state.dataset.seasons.some((s) => s.id === '2027-2028'));
  assert.equal(await ctl.upsertTournament({ seasonId: '2027-2028', type: 'elite', number: 1, name: 'ELITE #1', date: '2027-10-10', startTime: '11:00', allowTies: false }), true);
  assert.ok(ctl.state.dataset.tournaments.some((t) => t.id === '2027-2028-elite-1'));
  assert.equal(await ctl.upsertSeason({ id: '2027-2028', label: '2027–2028', isCurrent: true }), true);
  assert.equal(ctl.state.dataset.seasons.filter((s) => s.isCurrent).length, 1, 'tik vienas dabartinis sezonas');

  fillTeams(ctl, id, [[1, 'A', 'B'], [2, 'C', 'D']]);
  await ctl.finalize();
  assert.equal(await ctl.upsertTournament({ id: E1, seasonId: SEASON, type: 'elite', number: 1, name: 'KITAS', date: '2026-10-12' }), false, 'paskelbto turnyro keisti negalima');
  assert.equal(ctl.state.dataset.tournaments.find((t) => t.id === E1).name, 'ELITE #1');
});

test('CSV eksportas: reitingų ir turnyro (juodraštis ir paskelbtas)', async () => {
  const { ctl, id } = await setup();
  fillTeams(ctl, id, [[1, 'A', 'B'], [2, 'C', 'D']]);
  const draft = ctl.exportCsv('tournament');
  assert.equal(draft.filename, `turnyras-${E1}.csv`);
  assert.equal(draft.content.trim().split('\r\n').length, 5, 'antraštė + 4 žaidėjai');
  await ctl.finalize();
  const overall = ctl.exportCsv('overall');
  assert.equal(overall.filename, 'reitingas-bendras-2026-2027.csv');
  const lines = overall.content.trim().split('\r\n');
  assert.equal(lines.length, 5);
  assert.ok(lines[1].startsWith('1=;Testinis A;50;') || lines[1].startsWith('1=;Testinis B;50;'), lines[1]);
  assert.ok(ctl.exportCsv('elite').content.includes('Pergalės'));
  assert.equal(ctl.exportCsv('future').content.trim().split('\r\n').length, 1, 'FUTURE reitingas tuščias');
  assert.equal(ctl.exportCsv('nežinoma'), null);
});

// ───────── TEST L — saugumas valdiklio lygiu ─────────
test('L: kai serveris atmeta (neįgaliotas naudotojas), niekas nepasikeičia ir rodoma lietuviška klaida', async () => {
  const backend = createMemoryBackend(empty());
  const denied = async () => { throw new ApiError('not_authorized', 'Neturite administratoriaus teisių šiam veiksmui.', { status: 403 }); };
  const guarded = { ...backend, saveResults: denied, finalize: denied, correct: denied, mergePlayers: denied, createPlayer: denied, upsertSeason: denied };
  const ctl = createAdminController(guarded);
  await ctl.load();
  ctl.selectTournament(E1);
  ctl.addTeam();
  assert.equal(await ctl.saveDraft(), false);
  assert.equal(ctl.state.notice.type, 'error');
  assert.match(ctl.state.notice.text, /administratoriaus teisių/);
  assert.equal(await ctl.createPlayer({ firstName: 'Įsilaužėlis', lastName: 'Testas' }), false);
  assert.equal(await ctl.upsertSeason({ id: 'x', label: 'x' }), false);
  const official2 = computeRankings(ctl.state.dataset, { seasonId: SEASON });
  assert.equal(official2.overall.length, 0);
  assert.equal(ctl.state.dataset.players.length, 0);
});

test('Rezultatų suvedimas: taškai kiekvienam žaidėjui rodomi iš karto, jau pasirinkti žaidėjai kitoms komandoms užblokuoti', async () => {
  const { ctl, id } = await setup();
  ctl.selectTournament(E1);
  ctl.addTeam();
  ctl.addTeam();
  const [a, b] = ctl.state.entries;
  ctl.updateTeam(a.key, { player1: id('A'), player2: id('B'), position: '1' });
  ctl.updateTeam(b.key, { position: '13' });
  let live = ctl.livePoints();
  assert.equal(live.scored, true);
  assert.equal(live.byKey.get(a.key), 50, 'ELITE 1 vieta – 50 taškų kiekvienam');
  assert.equal(live.byKey.get(b.key), 6, 'ELITE 13 vieta – 6 taškai');
  ctl.updateTeam(b.key, { position: '' });
  assert.equal(ctl.livePoints().byKey.has(b.key), false, 'be vietos taškų nerodoma');

  // Kitos komandos pasirinkimuose A ir B nebeleidžiami, savos komandos pasirinkimai – leidžiami
  assert.deepEqual([...ctl.usedElsewhere(b.key)].sort(), [id('A'), id('B')].sort());
  assert.deepEqual([...ctl.usedElsewhere(a.key)], []);

  // Tas pats žaidėjas dviejose komandose vis tiek atmetamas peržiūroje (serveris tikrina irgi)
  ctl.updateTeam(b.key, { player1: id('A'), player2: id('C'), position: '2' });
  const preview = ctl.preview();
  assert.equal(preview.validation.valid, false);

  // Finalas be taškų lentelės
  ctl.selectTournament('2026-2027-final');
  ctl.addTeam();
  ctl.updateTeam(ctl.state.entries[0].key, { position: '1' });
  assert.equal(ctl.livePoints().scored, false, 'BEACH LEAGUE FINAL taškų neskiria');
});
