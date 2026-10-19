// Administravimas be Supabase (vietinis režimas) per puslapio kodą: aiškūs perspėjimai, visas darbo srautas, išvalymas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, act, submit, adminInput, adminChange } from './dom-stub.mjs';
import { LOCAL_KEY } from '../ranking/local-store.js';

const dom = installDom({ hostname: 'arturasbekis-png.github.io' });
const store = new Map();
globalThis.window.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
let fetched = 0;
globalThis.fetch = async () => { fetched += 1; throw new Error('tinklas neturi būti naudojamas'); };

test('Vietinis administravimas: perspėjimas, be prisijungimo, be BANDYMAS skilties; žaidėjai ir rezultatai saugomi tik naršyklėje', async () => {
  await import('../ranking/admin-app.js');
  await tick(100);
  const app = dom.el('app');
  const html = () => app.innerHTML;

  assert.ok(html().includes('id="local-banner"') && html().includes('VIETINIS REŽIMAS'));
  assert.ok(html().includes('tik juodraštis') && html().includes('NĖRA, kiti lankytojai šių duomenų nemato') && html().includes('data/official-results.json'));
  assert.ok(!html().includes('login-password'), 'prisijungimo formos nėra');
  assert.ok(!html().includes('data-act="logout"'));
  assert.ok(html().includes('data-act="clear-local"'));
  assert.ok(!html().includes('data-tab="test"'), 'BANDYMAS skilties vietiniame režime nėra');
  assert.ok(html().includes('ŽAIDĖJAI') && html().includes('REZULTATŲ SUVEDIMAS') && html().includes('Eksportas'));
  assert.ok(!html().includes('Demo '), 'jokių demonstracinių duomenų');
  assert.ok(!html().includes('DEMONSTRACINIS'));

  // žaidėjai (testiniai vardai)
  for (let i = 1; i <= 4; i++) {
    dom.el('new-first').value = 'Testinis';
    dom.el('new-last').value = `L${i}`;
    await app.handlers.submit(submit('player'));
    await tick(30);
  }
  assert.ok(html().includes('Testinis L4'));
  assert.ok(store.has(LOCAL_KEY), 'išsaugota naršyklėje');

  // rezultatai
  app.handlers.click(act('tab', { tab: 'results' }));
  app.handlers.change(adminChange({ sel: 'tournament' }, '2026-2027-elite-1'));
  app.handlers.click(act('add-team'));
  app.handlers.click(act('add-team'));
  const keys = [...html().matchAll(/data-entry="(row-\d+)" data-field="position"/g)].map((m) => m[1]);
  const ids = [...html().matchAll(/<option value="(pl-mem-\d+)"/g)].map((m) => m[1]);
  const uniq = [...new Set(ids)];
  assert.equal(uniq.length, 4);
  app.handlers.input(adminInput(keys[0], 'position', '1'));
  app.handlers.input(adminInput(keys[1], 'position', '2'));
  app.handlers.change(adminChange({ entry: keys[0], field: 'player1' }, uniq[0]));
  app.handlers.change(adminChange({ entry: keys[0], field: 'player2' }, uniq[1]));
  app.handlers.change(adminChange({ entry: keys[1], field: 'player1' }, uniq[2]));
  app.handlers.change(adminChange({ entry: keys[1], field: 'player2' }, uniq[3]));

  assert.ok(html().includes('PATVIRTINTI (TIK ŠIOJE NARŠYKLĖJE)') && !html().includes('PASKELBTI OFICIALIUS REZULTATUS'), 'mygtukas nemeluoja apie paskelbimą');
  await app.handlers.click(act('save-draft'));
  await tick(30);
  assert.ok(html().includes('Juodraštis išsaugotas'));
  await app.handlers.click(act('finalize'));
  await tick(60);
  assert.ok(html().includes('Rezultatai patvirtinti TIK šioje naršyklėje') && html().includes('NEPASKELBTI viešai'));
  assert.ok(html().includes('id="local-finalized"') && html().includes('viešai NEPASKELBTI') && html().includes('viešame reitingų puslapyje nerodomi'));
  assert.ok(!html().includes('Rezultatai patvirtinti ir paskelbti'), 'nesakoma, kad paskelbta viešai');
  assert.ok(!html().includes('Atidaryti viešą reitingą'));
  assert.equal(fetched, 0, 'jokių tinklo užklausų (nėra jokio serverio)');

  // CSV eksportas veikia
  app.handlers.click(act('tab', { tab: 'export' }));
  app.handlers.click(act('export', { kind: 'overall' }));

  // išvalymas
  app.handlers.click(act('tab', { tab: 'players' }));
  assert.ok(html().includes('Testinis L1'));
  await app.handlers.click(act('clear-local'));
  await tick(80);
  assert.ok(!store.has(LOCAL_KEY), 'vietiniai duomenys ištrinti');
  assert.ok(!html().includes('Testinis L1'));
  assert.ok(html().includes('id="local-banner"'));
});
