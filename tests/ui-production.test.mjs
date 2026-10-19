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

  assert.ok(app.includes('id="static-info"'), 'pranešimas, kad tai bendri oficialūs rezultatai');
  assert.ok(app.includes('id="incomplete-notice"') && app.includes('CHALLENGE #1') && app.includes('5–8') && app.includes('žinomos 3 iš 4'), 'nepilni duomenys aiškiai pažymėti');
  assert.ok(app.includes('žaidėjų nurodyti tik vardu arba vardu ir pavardės inicialu'));
  assert.ok(app.includes('Atnaujinta:'));
  const list = dom.el('list').innerHTML;
  assert.equal((list.match(/class="rrow/g) || []).length, 24, 'visi 24 žaidėjai bendrame reitinge');
  for (const name of ['Sofija B.', 'Emilija P.', 'Goda', 'Amelija', 'Girmantė']) assert.ok(list.includes(name), name);
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
  assert.ok(panel.includes('data-incomplete="5"') && panel.includes('trūksta 1'));
  assert.equal((panel.match(/<td data-label="Taškai kiekvienam žaidėjui" class="pts">15</g) || []).length, 3);
  assert.equal((panel.match(/class="pts">21</g) || []).length, 1, 'Goda / Amelija: 21');
  dom.loc.hash = '#turnyrai/2026-2027-elite-1';
  const elitePanel = dom.el('panel').innerHTML;
  assert.ok(!elitePanel.includes('data-incomplete'), 'ELITE pilnas');
  assert.equal((elitePanel.match(/class="pts">21</g) || []).length, 2, 'ELITE 5–6: po 21');

  // Kategorijų skirtukai
  dom.loc.hash = '#elite';
  assert.equal((dom.el('list').innerHTML.match(/class="rrow/g) || []).length, 12);
  dom.loc.hash = '#challenge';
  assert.equal((dom.el('list').innerHTML.match(/class="rrow/g) || []).length, 14);
  dom.loc.hash = '#future';
  assert.ok(dom.el('list').innerHTML.includes('rezultatų dar nėra'), 'FUTURE dar be rezultatų, be klaidų');
});
