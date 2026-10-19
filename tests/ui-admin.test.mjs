import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, act, submit, adminInput, adminChange } from './dom-stub.mjs';

const dom = installDom({ hostname: 'localhost', search: '?demo' });

test('Administravimo puslapis (demo): prisijungimas nereikalingas, visos skiltys atsiveria, rezultatų srautas veikia', async () => {
  await import('../ranking/admin-app.js');
  await tick(100);
  const app = dom.el('app');
  const html = () => app.innerHTML;

  assert.ok(html().includes('DEMONSTRACINIS REŽIMAS'), 'demo aiškiai pažymėtas');
  for (const label of ['Rezultatai', 'Žaidėjai', 'Sezonai ir turnyrai', 'Auditas', 'Eksportas']) assert.ok(html().includes(label), label);

  // Paskelbtas turnyras: rodomas pataisymo režimas
  app.handlers.change(adminChange({ sel: 'tournament' }, '2026-2027-elite-1'));
  assert.ok(html().includes('Rezultatai paskelbti (versija 1)'));
  assert.ok(html().includes('Išsaugoti pataisymą'));
  assert.ok(html().includes('Pataisymo priežastis'));
  assert.ok(!html().includes('Patvirtinti ir paskelbti'), 'paskelbto turnyro negalima skelbti iš naujo');
  app.handlers.click(act('preview'));
  assert.ok(html().includes('Validacija sėkminga'));
  assert.ok(html().includes('Taškų peržiūra'));

  // Juodraščio turnyras (FUTURE #1 demo duomenyse): pridedame dvi komandas ir skelbiame
  app.handlers.change(adminChange({ sel: 'tournament' }, '2026-2027-future-1'));
  assert.ok(html().includes('Patvirtinti ir paskelbti'));
  app.handlers.click(act('add-team'));
  app.handlers.click(act('add-team'));
  const keys = [...html().matchAll(/data-entry="(row-\d+)" data-field="position"/g)].map((m) => m[1]);
  assert.equal(keys.length, 2);
  const playerIds = [...html().matchAll(/<option value="(demo-p\d+)"/g)].map((m) => m[1]);
  assert.ok(playerIds.length >= 4);
  const [p1, p2, p3, p4] = ['demo-p1', 'demo-p2', 'demo-p3', 'demo-p4'];
  app.handlers.input(adminInput(keys[0], 'position', '1'));
  app.handlers.input(adminInput(keys[1], 'position', '2'));
  app.handlers.change(adminChange({ entry: keys[0], field: 'player1' }, p1));
  app.handlers.change(adminChange({ entry: keys[0], field: 'player2' }, p2));
  app.handlers.change(adminChange({ entry: keys[1], field: 'player1' }, p3));
  app.handlers.change(adminChange({ entry: keys[1], field: 'player2' }, p4));

  app.handlers.click(act('preview'));
  assert.ok(html().includes('Validacija sėkminga'));

  // Dubliuotas žaidėjas -> klaida peržiūroje, o skelbimas neįvyksta
  app.handlers.change(adminChange({ entry: keys[1], field: 'player1' }, p1));
  app.handlers.click(act('preview'));
  assert.ok(html().includes('Rasta klaidų'));
  assert.ok(html().includes('kelias komandas'));
  await app.handlers.click(act('finalize'));
  await tick();
  assert.ok(!html().includes('Rezultatai paskelbti (versija 1)'), 'neteisingi rezultatai nebuvo paskelbti');
  assert.ok(html().includes('Patvirtinti ir paskelbti'), 'turnyras vis dar nepaskelbtas');

  // Pataisome ir skelbiame
  app.handlers.change(adminChange({ entry: keys[1], field: 'player1' }, p3));
  await app.handlers.click(act('finalize'));
  await tick(100);
  assert.ok(html().includes('Rezultatai patvirtinti ir paskelbti'), 'sėkmės pranešimas');
  assert.ok(html().includes('Rezultatai paskelbti (versija 1)'));

  // Kitos skiltys atsiveria be klaidų
  app.handlers.click(act('tab', { tab: 'players' }));
  assert.ok(html().includes('Naujas žaidėjas') && html().includes('Sujungti dublikatus') && html().includes('Demo Alfa Žaidėjas'));
  dom.el('new-name').value = 'Naujas Demo Testas';
  await app.handlers.submit(submit('player'));
  await tick(50);
  assert.ok(html().includes('Naujas Demo Testas'));
  // dublikato apsauga
  dom.el('new-name').value = 'naujas demo testas';
  await app.handlers.submit(submit('player'));
  await tick(50);
  assert.equal((html().match(/Naujas Demo Testas/g) || []).length >= 1, true);

  app.handlers.click(act('tab', { tab: 'seasons' }));
  assert.ok(html().includes('Sezonai') && html().includes('2026-2027') && html().includes('Naujas turnyras'));
  app.handlers.click(act('tab', { tab: 'audit' }));
  await tick(50);
  assert.ok(html().includes('Audito žurnalas') && html().includes('Paskelbti rezultatai'), 'audite matomas paskelbimas');
  app.handlers.click(act('tab', { tab: 'export' }));
  assert.ok(html().includes('CSV eksportas') && html().includes('Bendras reitingas'));
  app.handlers.click(act('export', { kind: 'overall' }));
});
