import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';
import { installStaticResultsFetch } from './helpers.mjs';

// Gamybinis serveris (GitHub Pages) + bandymas įjungti ?demo + Supabase neprijungtas: rodomi OFICIALŪS rezultatai iš
// statinio failo data/official-results.json (tie patys visiems lankytojams), o demonstraciniai duomenys niekada neįkeliami.
const dom = installDom({ hostname: 'arturasbekis-png.github.io', search: '?demo' });
const requests = [];
installStaticResultsFetch({ onRequest: (u) => requests.push(u) });
// Net jei naršyklėje yra vietinių administravimo duomenų, viešas puslapis jų nenaudoja.
let storageReads = 0;
globalThis.window.localStorage = { getItem: () => { storageReads += 1; return JSON.stringify({ version: 1, dataset: { seasons: [], tournaments: [], players: [{ id: 'x', fullName: 'Vietinis Juodraštis' }], participations: [] } }); }, setItem() {}, removeItem() {} };

test('Gamyboje demonstraciniai duomenys niekada neįkeliami; viešas puslapis rodo oficialius rezultatus iš statinio failo', async () => {
  await import('../ranking/public-app.js');
  await tick(100);
  const app = dom.el('app').innerHTML;
  assert.ok(!app.includes('DEMONSTRACINIAI'), 'demo režimas gamyboje išjungtas');
  assert.ok(!app.includes('Demo '), 'jokių demonstracinių vardų');
  assert.ok(!app.includes('Vietinis Juodraštis') && storageReads === 0, 'vietinė saugykla viešam puslapiui nenaudojama');
  assert.deepEqual(requests, [requests[0]]);
  assert.ok(requests[0].endsWith('/data/official-results.json'), 'vienintelė užklausa – statinis failas');

  // Pašalinti pranešimai ir tuščia sezono skiltis
  for (const gone of ['id="static-info"', 'Oficialūs paskelbti rezultatai', 'Vietiniai administravimo juodraščiai', 'Duomenys nepilni', 'žinomos 3 iš 4', 'Trūkstama pora nekuriama', 'pilni vardai nepatvirtinti', 'žaidėjų nurodyti tik vardu', 'id="incomplete-notice"', 'SEZONAS', 'class="card toolbar"']) assert.ok(!app.includes(gone), `pašalinta: ${gone}`);
  // Numatytasis skirtukas – ELITE porų reitingas: 6 poros (ne 12 žaidėjų), bendro reitingo nėra
  const list = dom.el('list').innerHTML;
  assert.equal((list.match(/class="rrow/g) || []).length, 6, 'ELITE: 6 poros');
  assert.ok(list.includes('ELITE porų reitingas') && !app.includes('BENDRAS REITINGAS') && !app.includes('Visų sezonų statistika'));
  for (const name of ['Sofija B.', 'Emilija P.', 'Milda R.', 'Evgenija M.', 'Ditė', 'Gabrielė']) assert.ok(list.includes(name), name);
  assert.ok(!list.includes('Goda') && !list.includes('Rusnė'), 'CHALLENGE poros ELITE lentelėje nerodomos');
  assert.ok(!/▲|▼|Judėjimas/.test(list), 'vienas turnyras kategorijoje – judėjimas paslėptas');
  assert.ok(app.includes('Reitingavimo taisyklės'));
  assert.ok(app.includes('9–12') && app.includes('13–16'));
  assert.ok(app.includes('vidurkį'), 'taisyklėse paaiškinta pasidalintų vietų taškų taisyklė');

  // Kalendorius: 19 renginių, du patvirtinti
  dom.loc.hash = '#turnyrai';
  const tl = dom.el('tlist').innerHTML;
  assert.equal((tl.match(/class="tcard /g) || []).length, 19);
  assert.equal((tl.match(/Patvirtintas/g) || []).length, 2);
  assert.equal((tl.match(/Suplanuotas/g) || []).length, 17);

  // Turnyro detalė: komandos, vietos, taškai, nepilnos grupės įspėjimas
  dom.loc.hash = '#turnyrai/2026-2027-challenge-1';
  const panel = dom.el('panel').innerHTML;
  assert.ok(panel.includes('CHALLENGE #1') && panel.includes('Goda') && panel.includes('Luka B.'));
  assert.ok(!panel.includes('data-incomplete') && !panel.includes('žinomos 3 iš 4') && !panel.includes('Nepilni duomenys'), 'nepilnų duomenų pranešimo nėra');
  assert.equal((panel.match(/<td data-label="Taškai porai" class="pts">30</g) || []).length, 3);
  assert.equal((panel.match(/class="pts">42</g) || []).length, 1, 'Goda / Amelija: 42 (21 + 21)');
  assert.equal((panel.match(/data-label="Taškai žaidėjui">15</g) || []).length, 3, 'po 15 kiekvienam žaidėjui');
  dom.loc.hash = '#turnyrai/2026-2027-elite-1';
  const elitePanel = dom.el('panel').innerHTML;
  assert.ok(!elitePanel.includes('data-incomplete'), 'ELITE pilnas');
  assert.equal((elitePanel.match(/class="pts">42</g) || []).length, 2, 'ELITE 5–6: po 42');

  // Kategorijų skirtukai
  dom.loc.hash = '#elite';
  assert.equal((dom.el('list').innerHTML.match(/class="rrow/g) || []).length, 6);
  dom.loc.hash = '#challenge';
  const ch = dom.el('list').innerHTML;
  assert.equal((ch.match(/class="rrow/g) || []).length, 7, 'CHALLENGE: 7 žinomos poros (ketvirtos 5–8 poros nekuriame)');
  assert.ok(ch.includes('Goda') && ch.includes('Amelija') && ch.includes('Girmantė') && !ch.includes('Sofija B.'));
  assert.equal((ch.match(/class="rpts"><b>30<\/b>/g) || []).length, 3);
  assert.ok(!dom.el('app').innerHTML.includes('id="incomplete-notice"'));
  dom.loc.hash = '#future';
  assert.ok(dom.el('list').innerHTML.includes('ELITE porų reitingas'), 'FUTURE reitingo lentelės nėra – rodoma ELITE');
  dom.loc.hash = '#bendras';
  assert.ok(!dom.el('app').innerHTML.includes('BENDRAS REITINGAS'), 'bendro reitingo nėra');
});
