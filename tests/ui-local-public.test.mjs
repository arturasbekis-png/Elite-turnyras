// Viešas reitingų puslapis be Supabase: veikia, rodo tik tai, kas yra šios naršyklės saugykloje, ir aiškiai tai pažymi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';
import { LOCAL_KEY } from '../ranking/local-store.js';
import { createLocalBackend } from '../ranking/local-backend.js';
import { createAdminController } from '../ranking/admin-controller.js';

const dom = installDom({ hostname: 'arturasbekis-png.github.io' });
const store = new Map();
const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
globalThis.window.localStorage = storage;
let fetched = 0;
globalThis.fetch = async () => { fetched += 1; throw new Error('tinklas neturi būti naudojamas'); };

test('Be vietinių duomenų: puslapis veikia, nieko neišgalvoja ir nesako, kad kažkas paskelbta', async () => {
  await import('../ranking/public-app.js');
  await tick();
  const app = dom.el('app').innerHTML;
  assert.ok(app.includes('id="local-info"') && app.includes('duomenų bazė dar neprijungta'));
  assert.ok(!app.includes('id="local-banner"'));
  assert.ok(dom.el('panel').innerHTML.includes('Oficialių rezultatų dar nėra'));
  assert.ok(!dom.el('panel').innerHTML.includes('class="rrow'), 'jokių išgalvotų eilučių');
  assert.ok(app.includes('Reitingavimo taisyklės'));
  assert.ok(app.includes('<option value="2026-2027"'), 'sezonas pasirenkamas');
  dom.loc.hash = '#turnyrai';
  assert.equal((dom.el('tlist').innerHTML.match(/class="tcard /g) || []).length, 19, 'kalendorius veikia');
  assert.equal(fetched, 0);
});

test('Su vietiniais duomenimis: rodomi taškai (su pasidalintų vietų vidurkiu), bet su ryškiu „tik šioje naršyklėje“ perspėjimu', async () => {
  const backend = createLocalBackend({ storage });
  const ctl = createAdminController(backend);
  await ctl.load();
  for (let i = 1; i <= 12; i++) await ctl.createPlayer({ firstName: 'Testinis', lastName: `P${String(i).padStart(2, '0')}` });
  const id = (i) => ctl.state.dataset.players.find((p) => p.fullName === `Testinis P${String(i).padStart(2, '0')}`).id;
  const t = ctl.state.dataset.tournaments.find((x) => x.id === '2026-2027-elite-1');
  await ctl.upsertTournament({ ...t, allowTies: true });
  ctl.selectTournament('2026-2027-elite-1');
  [[1, 1, 2], [2, 3, 4], [3, 5, 6], [4, 7, 8], [5, 9, 10], [5, 11, 12]].forEach(([pos, a, b]) => { ctl.addTeam(); ctl.updateTeam(ctl.state.entries.at(-1).key, { position: String(pos), player1: id(a), player2: id(b) }); });
  assert.equal(await ctl.finalize(), true);
  assert.ok(store.has(LOCAL_KEY));

  dom.loc.hash = '#bendras';
  dom.listeners.hashchange.forEach((fn) => fn());
  // pakartotinis įkėlimas (retry) perskaito saugyklą iš naujo
  await dom.el('app').handlers.click({ target: { closest: (s) => (s === '[data-action="retry"]' ? {} : null) } });
  await tick(60);
  const app = dom.el('app').innerHTML;
  assert.ok(app.includes('id="local-banner"') && app.includes('VIETINIAI DUOMENYS'));
  assert.ok(app.includes('kiti lankytojai šių rezultatų nemato') && app.includes('nėra viešai paskelbti'));
  const list = dom.el('list').innerHTML;
  assert.ok(list.includes('Testinis P01') && list.includes('Testinis P12'));
  assert.equal((list.match(/class="rrow/g) || []).length, 12);
  assert.ok(list.includes('<b>21</b>'), 'pasidalintos 5–6 vietos: po 21');
  assert.equal(fetched, 0);
});
