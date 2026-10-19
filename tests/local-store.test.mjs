// Vietinis režimas: saugojimas naršyklės localStorage (be Supabase). Visi vardai – tik testų duomenys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_KEY, readLocalDataset, writeLocalDataset, clearLocalDataset, hasLocalData, emptyDataset } from '../ranking/local-store.js';
import { createLocalBackend } from '../ranking/local-backend.js';
import { createAdminController } from '../ranking/admin-controller.js';
import { computeRankings } from '../ranking/engine.js';

const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, map: m };
};
const SEASON = '2026-2027';
const E1 = '2026-2027-elite-1';

async function boot(storage) {
  const backend = createLocalBackend({ storage });
  const ctl = createAdminController(backend);
  await ctl.load();
  return { backend, ctl };
}
async function addPlayers(ctl, n, from = 1) {
  for (let i = from; i < from + n; i++) assert.equal(await ctl.createPlayer({ firstName: 'Testinis', lastName: `V${String(i).padStart(2, '0')}` }), true);
  return (i) => ctl.state.dataset.players.find((p) => p.fullName === `Testinis V${String(i).padStart(2, '0')}`).id;
}

test('Pradinė vietinė būsena: tik kalendorius, jokių žaidėjų ar rezultatų, nieko neįrašyta į saugyklą', async () => {
  const storage = fakeStorage();
  const { backend, ctl } = await boot(storage);
  assert.equal(backend.local, true);
  assert.equal(ctl.state.dataset.players.length, 0);
  assert.equal(ctl.state.dataset.participations.length, 0);
  assert.equal(ctl.state.dataset.tournaments.length, 19, 'kalendorius yra');
  assert.ok(ctl.state.dataset.tournaments.every((t) => t.status === 'planned'));
  assert.equal(storage.map.size, 0, 'be veiksmų nieko nesaugoma');
  assert.equal(hasLocalData(ctl.state.dataset), false);
});

test('Duomenys išlieka po „perkrovimo“ (nauja sesija su ta pačia saugykla); identifikatoriai nesikartoja', async () => {
  const storage = fakeStorage();
  let { ctl } = await boot(storage);
  const id = await addPlayers(ctl, 4);
  const firstIds = ctl.state.dataset.players.map((p) => p.id);
  ctl.selectTournament(E1);
  [[1, 1, 2], [2, 3, 4]].forEach(([pos, a, b]) => { ctl.addTeam(); ctl.updateTeam(ctl.state.entries.at(-1).key, { position: String(pos), player1: id(a), player2: id(b) }); });
  assert.equal(await ctl.saveDraft('draft'), true);
  assert.ok(storage.map.has(LOCAL_KEY));

  ({ ctl } = await boot(storage)); // „perkrovimas“
  assert.equal(ctl.state.dataset.players.length, 4);
  assert.equal(ctl.state.dataset.participations.length, 2);
  assert.equal(ctl.state.dataset.tournaments.find((t) => t.id === E1).status, 'draft');
  await addPlayers(ctl, 2, 5);
  const allIds = ctl.state.dataset.players.map((p) => p.id);
  assert.equal(new Set(allIds).size, allIds.length, 'nauji ID nesutampa su išsaugotais');
  firstIds.forEach((x) => assert.ok(allIds.includes(x)));
  assert.equal(ctl.state.dataset.tournaments.filter((t) => t.id === E1).length, 1, 'turnyras nesidubliuoja');
});

test('Vietinis patvirtinimas: taškai teisingi, pranešimas aiškiai sako „TIK šioje naršyklėje“, pakartotinis patvirtinimas atmetamas', async () => {
  const storage = fakeStorage();
  const { ctl } = await boot(storage);
  const id = await addPlayers(ctl, 12);
  const t = ctl.state.dataset.tournaments.find((x) => x.id === E1);
  assert.equal(await ctl.upsertTournament({ ...t, allowTies: true }), true);
  ctl.selectTournament(E1);
  [[1, 1, 2], [2, 3, 4], [3, 5, 6], [4, 7, 8], [5, 9, 10], [5, 11, 12]].forEach(([pos, a, b]) => { ctl.addTeam(); ctl.updateTeam(ctl.state.entries.at(-1).key, { position: String(pos), player1: id(a), player2: id(b) }); });
  assert.equal(await ctl.saveDraft('draft'), true);
  assert.equal(computeRankings(ctl.state.dataset, { seasonId: SEASON }).overall.length, 0, 'juodraštis taškų neduoda');
  assert.equal(await ctl.finalize(), true);
  assert.match(ctl.state.notice.text, /TIK šioje naršyklėje/);
  assert.match(ctl.state.notice.text, /NEPASKELBTI viešai/);
  const { overall } = computeRankings(ctl.state.dataset, { seasonId: SEASON });
  const pts = (n) => overall.find((r) => r.name === `Testinis V${String(n).padStart(2, '0')}`).points;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(pts), [100, 100, 80, 80, 64, 64, 52, 52, 42, 42, 42, 42]);
  const snapshot = JSON.stringify(overall.map((r) => [r.playerId, r.points]));
  assert.equal(await ctl.finalize(), false, 'antras patvirtinimas atmestas');
  assert.equal(JSON.stringify(computeRankings(ctl.state.dataset, { seasonId: SEASON }).overall.map((r) => [r.playerId, r.points])), snapshot);
  // išlieka po „perkrovimo“ ir taškai tie patys
  const reloaded = await boot(storage);
  assert.equal(JSON.stringify(computeRankings(reloaded.ctl.state.dataset, { seasonId: SEASON }).overall.map((r) => [r.playerId, r.points])), snapshot);
});

test('Saugyklos klaida: naudotojas gauna aiškų pranešimą; sugadinti duomenys ignoruojami; išvalymas veikia', async () => {
  const full = fakeStorage();
  full.setItem = () => { throw new Error('QuotaExceededError'); };
  const { ctl } = await boot(full);
  assert.equal(await ctl.createPlayer({ firstName: 'Testinis', lastName: 'X' }), false);
  assert.match(ctl.state.notice.text, /nepavyko išsaugoti šioje naršyklėje/i);

  for (const bad of ['{netinkamas json', JSON.stringify({ version: 99, dataset: {} }), JSON.stringify({ version: 1, dataset: { players: 'x' } }), 'null']) {
    assert.equal(readLocalDataset(fakeStorage({ [LOCAL_KEY]: bad })), null, bad);
  }
  assert.equal(readLocalDataset(null), null, 'be saugyklos');

  const s = fakeStorage();
  writeLocalDataset(s, { ...emptyDataset() });
  assert.ok(readLocalDataset(s));
  clearLocalDataset(s);
  assert.equal(readLocalDataset(s), null);
  // be saugyklos (privatus režimas) administravimas vis tiek veikia atmintyje
  const { backend, ctl: memCtl } = await boot(null);
  assert.equal(backend.persistent, false);
  assert.equal(await memCtl.createPlayer({ firstName: 'Testinis', lastName: 'Y' }), true);
});
