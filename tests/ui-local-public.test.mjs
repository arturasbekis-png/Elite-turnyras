// Viešas puslapis ir vietiniai administravimo juodraščiai yra visiškai atskirti: viešas puslapis rodo TIK oficialų failą.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';
import { LOCAL_KEY } from '../ranking/local-store.js';
import { createLocalBackend } from '../ranking/local-backend.js';
import { createAdminController } from '../ranking/admin-controller.js';
import { installStaticResultsFetch } from './helpers.mjs';

const dom = installDom({ hostname: 'arturasbekis-png.github.io' });
const store = new Map();
const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
globalThis.window.localStorage = storage;
const requests = [];
installStaticResultsFetch({ onRequest: (u) => requests.push(u) });

test('Vietinis juodraštis (patvirtintas administravime) viešame puslapyje nematomas; matomi tik oficialūs rezultatai', async () => {
  // administratorius šioje naršyklėje turi vietinį „patvirtintą“ turnyrą su kitais žaidėjais
  const backend = createLocalBackend({ storage });
  const ctl = createAdminController(backend);
  await ctl.load();
  for (let i = 1; i <= 4; i++) await ctl.createPlayer({ firstName: 'Testinis', lastName: `J${i}` });
  const id = (i) => ctl.state.dataset.players.find((p) => p.fullName === `Testinis J${i}`).id;
  ctl.selectTournament('2026-2027-future-1');
  [[1, 1, 2], [2, 3, 4]].forEach(([pos, a, b]) => { ctl.addTeam(); ctl.updateTeam(ctl.state.entries.at(-1).key, { position: String(pos), player1: id(a), player2: id(b) }); });
  assert.equal(await ctl.finalize(), true);
  assert.ok(store.has(LOCAL_KEY));

  await import('../ranking/public-app.js');
  await tick(100);
  const app = dom.el('app').innerHTML;
  const list = dom.el('list').innerHTML;
  assert.ok(!app.includes('Testinis') && !list.includes('Testinis'), 'vietinių duomenų viešame puslapyje nėra');
  assert.equal((list.match(/class="rrow/g) || []).length, 6, 'tik 6 oficialios ELITE poros');
  assert.ok(!app.includes('id="local-banner"'));
  assert.ok(!app.includes('id="static-info"') && !app.includes('Oficialūs paskelbti rezultatai') && !app.includes('Vietiniai administravimo juodraščiai'), 'pašalintas bendras pranešimas');
  assert.ok(requests.every((u) => u.endsWith('/data/official-results.json')));
  dom.loc.hash = '#turnyrai';
  assert.equal((dom.el('tlist').innerHTML.match(/Patvirtintas/g) || []).length, 2, 'vietinis FUTURE #1 nėra patvirtintas viešai');
});

test('Rezultatų failo nepavyko įkelti: aiški klaida su „bandyti dar kartą“, o ne tušti ar išgalvoti rezultatai', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  dom.loc.hash = '#bendras';
  await dom.el('app').handlers.click({ target: { closest: (s) => (s === '[data-action="retry"]' ? {} : null) } });
  await tick(60);
  const app = dom.el('app').innerHTML;
  assert.ok(app.includes('nepavyko gauti') || app.includes('Nepavyko'), 'klaidos pranešimas');
  assert.ok(app.includes('data-action="retry"'));
  assert.ok(!app.includes('class="rrow'), 'jokių rezultatų, kol failas nepasiekiamas');
});
