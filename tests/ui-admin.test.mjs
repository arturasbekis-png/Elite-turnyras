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
  for (const label of ['ŽAIDĖJAI', 'REZULTATŲ SUVEDIMAS', 'Sezonai ir turnyrai', 'Auditas', 'Eksportas']) assert.ok(html().includes(label), label);

  // Numatytoji skiltis – ŽAIDĖJAI; rezultatų skiltis atidaroma atskirai
  assert.ok(html().includes('PRIDĖTI ŽAIDĖJĄ') && html().includes('Ieškoti žaidėjo'));
  app.handlers.click(act('tab', { tab: 'results' }));

  // Paskelbtas turnyras: rodomas pataisymo režimas
  app.handlers.change(adminChange({ sel: 'tournament' }, '2026-2027-elite-1'));
  assert.ok(html().includes('Rezultatai paskelbti (versija 1)'));
  assert.ok(html().includes('Išsaugoti pataisymą'));
  assert.ok(html().includes('Pataisymo priežastis'));
  assert.ok(!html().includes('PASKELBTI OFICIALIUS REZULTATUS'), 'paskelbto turnyro negalima skelbti iš naujo');
  app.handlers.click(act('preview'));
  assert.ok(html().includes('Validacija sėkminga'));
  assert.ok(html().includes('Taškų peržiūra'));
  assert.ok(/<th>Vieta<\/th><th>Žaidėjas 1<\/th><th>Žaidėjas 2<\/th><th>Taškai kiekvienam<\/th>/.test(html()), 'lentelės stulpeliai pagal specifikaciją');

  // Juodraščio turnyras (FUTURE #1 demo duomenyse): pridedame dvi komandas ir skelbiame
  app.handlers.change(adminChange({ sel: 'tournament' }, '2026-2027-future-1'));
  assert.ok(html().includes('PASKELBTI OFICIALIUS REZULTATUS'));
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
  assert.ok(html().includes('PASKELBTI OFICIALIUS REZULTATUS'), 'turnyras vis dar nepaskelbtas');

  // Pataisome ir skelbiame
  app.handlers.change(adminChange({ entry: keys[1], field: 'player1' }, p3));
  await app.handlers.click(act('finalize'));
  await tick(100);
  assert.ok(html().includes('Rezultatai patvirtinti ir paskelbti'), 'sėkmės pranešimas');
  assert.ok(html().includes('Rezultatai paskelbti (versija 1)'));

  // Kitos skiltys atsiveria be klaidų
  app.handlers.click(act('tab', { tab: 'players' }));
  assert.ok(html().includes('ŽAIDĖJAI') && html().includes('Sujungti dublikatus') && html().includes('Demo Alfa Žaidėjas'));
  assert.ok(html().includes('demo-p1'), 'sąraše rodomas žaidėjo ID');
  dom.el('new-first').value = 'Naujas';
  dom.el('new-last').value = 'Testas';
  await app.handlers.submit(submit('player'));
  await tick(50);
  assert.ok(html().includes('Naujas Testas'));
  assert.ok(html().includes('Žaidėjas „Naujas Testas“ išsaugotas'), 'aiškus sėkmės pranešimas');
  // dublikato apsauga (didžiosios raidės / tvarka): įspėjimas, įrašas nekuriamas
  dom.el('new-first').value = 'TESTAS';
  dom.el('new-last').value = 'naujas';
  await app.handlers.submit(submit('player'));
  await tick(50);
  assert.ok(html().includes('Galimas dublikatas'));
  assert.equal((html().match(/<strong>Naujas Testas<\/strong>/g) || []).length, 1, 'dublikatas nesukurtas');
  // sąmoningas patvirtinimas leidžia atskirą įrašą
  await app.handlers.click(act('force-create'));
  await tick(50);
  assert.equal((html().match(/<strong>TESTAS naujas<\/strong>/g) || []).length, 1, 'patvirtintas atskiras įrašas');
  // trūkstama pavardė
  dom.el('new-first').value = 'Vienas';
  dom.el('new-last').value = '  ';
  await app.handlers.submit(submit('player'));
  await tick(50);
  assert.ok(html().includes('Įveskite ir vardą, ir pavardę'));
  assert.ok(html().includes('value="Vienas"'), 'neteisingai užpildyta forma neišvaloma');

  app.handlers.click(act('tab', { tab: 'seasons' }));
  assert.ok(html().includes('Sezonai') && html().includes('2026-2027') && html().includes('Naujas turnyras'));
  app.handlers.click(act('tab', { tab: 'audit' }));
  await tick(50);
  assert.ok(html().includes('Audito žurnalas') && html().includes('Paskelbti rezultatai'), 'audite matomas paskelbimas');
  app.handlers.click(act('tab', { tab: 'export' }));
  assert.ok(html().includes('CSV eksportas') && html().includes('Bendras reitingas'));
  app.handlers.click(act('export', { kind: 'overall' }));
});

test('Administravimas (demo): skiltis BANDYMAS – sukurti, naudoti bandomąjį turnyrą ir viską ištrinti', async () => {
  const app = dom.el('app');
  const html = () => app.innerHTML;
  app.handlers.click(act('tab', { tab: 'test' }));
  assert.ok(html().includes('BANDYMAS – saugus sistemos patikrinimas'));
  assert.ok(html().includes('Bandomasis sezonas: <strong>nesukurtas</strong>'));
  assert.ok(/data-act="delete-test-data" disabled/.test(html()) || html().includes('data-act="delete-test-data"'));

  await app.handlers.click(act('create-test-season'));
  await tick(50);
  assert.ok(html().includes('Bandomasis sezonas: <strong>sukurtas</strong>'));
  assert.ok(html().includes('Bandomasis sezonas sukurtas'), 'sėkmės pranešimas');
  assert.ok(/data-act="create-test-season" disabled/.test(html()), 'pakartotinai kurti nereikia');
  assert.ok(html().includes('reitingai.html#bendras?s=bandymas'), 'nuoroda į bandomąjį viešą reitingą');

  // bandomasis žaidėjas per ŽAIDĖJŲ formą
  app.handlers.click(act('tab', { tab: 'players' }));
  assert.ok(html().includes('id="new-test"') && html().includes('Bandomasis žaidėjas'));
  dom.el('new-first').value = 'Bandymas';
  dom.el('new-last').value = 'Pirmas';
  dom.el('new-test').checked = true;
  await app.handlers.submit(submit('player'));
  await tick(50);
  assert.ok(html().includes('BANDOMASIS</span>'), 'sąraše pažymėtas kaip bandomasis');

  // atidarome bandomąjį turnyrą; bandomasis žaidėjas siūlomas tik čia
  app.handlers.click(act('tab', { tab: 'test' }));
  assert.ok(html().includes('id="test-players-count">1<'));
  app.handlers.click(act('open-test-tournament'));
  assert.ok(html().includes('BANDOMASIS turnyras'), 'įspėjimas apie bandomąjį turnyrą');
  app.handlers.click(act('add-team'));
  assert.ok(html().includes('Bandymas Pirmas [BANDOMASIS]') && !html().includes('tik bandomajam sezonui'));
  app.handlers.change(adminChange({ sel: 'tournament' }, '2026-2027-future-1'));
  app.handlers.click(act('add-team'));
  assert.ok(html().includes('Bandymas Pirmas [BANDOMASIS] – tik bandomajam sezonui'), 'oficialiame turnyre bandomasis žaidėjas išjungtas');

  // valymas
  app.handlers.click(act('tab', { tab: 'test' }));
  await app.handlers.click(act('delete-test-data'));
  await tick(50);
  assert.ok(html().includes('Bandymo duomenys ištrinti'));
  assert.ok(html().includes('Bandomasis sezonas: <strong>nesukurtas</strong>'));
  assert.ok(html().includes('id="test-players-count">0<'));
  app.handlers.click(act('tab', { tab: 'players' }));
  assert.ok(!html().includes('Bandymas Pirmas'), 'bandomasis žaidėjas ištrintas');
  assert.ok(html().includes('Demo Alfa Žaidėjas'), 'demo/oficialūs žaidėjai liko');
});
