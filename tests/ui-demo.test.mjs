import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick, clickOn, inputEvent, changeEvent } from './dom-stub.mjs';

const dom = installDom({ hostname: 'localhost', search: '?demo' });

test('Puslapio logika su demonstraciniais duomenimis (tik localhost)', async () => {
  await import('../ranking/public-app.js');
  await tick();
  const app = dom.el('app');
  const list = () => dom.el('list').innerHTML;
  const panel = () => dom.el('panel').innerHTML;

  // Pradinė būsena: demo reklama ir bendras reitingas
  assert.ok(app.innerHTML.includes('DEMONSTRACINIAI DUOMENYS'), 'demonstraciniai duomenys aiškiai pažymėti');
  assert.ok(app.innerHTML.includes('Reitingavimo taisyklės'), 'taisyklių skiltis matoma');
  assert.ok(app.innerHTML.includes('BENDRAS REITINGAS') && app.innerHTML.includes('TURNYRŲ REZULTATAI'));
  assert.ok(list().includes('Demo Alfa Žaidėjas'));
  assert.ok(app.innerHTML.includes('2026–2027 (dabartinis)'));

  // Išskleidžiama žaidėjo kortelė
  app.handlers.click(clickOn({ '[data-toggle]': { dataset: { toggle: 'demo-p1' } } }));
  assert.ok(list().includes('Taškų suma'));
  assert.ok(list().includes('aria-expanded="true"'));
  app.handlers.click(clickOn({ '[data-toggle]': { dataset: { toggle: 'demo-p1' } } }));
  assert.ok(!list().includes('Taškų suma'), 'uždaroma');

  // Paieška (be diakritikų) ir rūšiavimas
  app.handlers.input(inputEvent('[data-control="query"]', 'beta'));
  assert.ok(list().includes('Demo Beta') && !list().includes('Demo Alfa'));
  app.handlers.input(inputEvent('[data-control="query"]', 'nėra tokio'));
  assert.ok(list().includes('Žaidėjų nerasta'));
  app.handlers.input(inputEvent('[data-control="query"]', ''));
  app.handlers.change(changeEvent('sort', 'name'));
  assert.ok(list().indexOf('Demo Alfa') < list().indexOf('Demo Zeta'));

  // Kategorijų skirtukai
  dom.loc.hash = '#challenge';
  assert.ok(list().includes('CHALLENGE reitingas'));
  dom.loc.hash = '#future';
  assert.ok(panel().includes('Oficialių rezultatų dar nėra') || list().includes('FUTURE reitingas') || list().includes('oficialių rezultatų dar nėra'),
    'FUTURE #1 yra tik juodraštis, todėl FUTURE reitinge taškų nėra');
  assert.ok(!list().includes('Demo Alfa'), 'juodraščio rezultatai nerodomi');

  // Turnyrų sąrašas ir detalės
  dom.loc.hash = '#turnyrai';
  const tl = dom.el('tlist').innerHTML;
  assert.equal((tl.match(/class="tcard /g) || []).length, 19);
  assert.ok(tl.includes('Patvirtintas') && tl.includes('Rezultatų juodraštis') && tl.includes('Suplanuotas'));
  app.handlers.click(clickOn({ '[data-tfilter]': { dataset: { tfilter: 'final' } } }));
  assert.equal((dom.el('tlist').innerHTML.match(/class="tcard /g) || []).length, 1);

  dom.loc.hash = '#turnyrai/2026-2027-elite-1';
  assert.ok(panel().includes('Šio turnyro taškai įskaičiuojami'));
  assert.ok(panel().includes('Demo Alfa Žaidėjas'));
  dom.loc.hash = '#turnyrai/2026-2027-future-1';
  assert.ok(panel().includes('Rezultatai dar nepaskelbti'));
  assert.ok(!panel().includes('Demo'), 'juodraščio komandų nerodoma');
  dom.loc.hash = '#turnyrai/neegzistuoja';
  assert.ok(panel().includes('Turnyras nerastas'));

  // Nežinomas sezonas grąžina numatytąjį
  dom.loc.hash = '#bendras?s=1999-2000';
  assert.ok(list().includes('Demo Alfa Žaidėjas'));
  // Sezono pakeitimas nesugriauna puslapio
  app.handlers.change(changeEvent('season', '2026-2027'));
  assert.ok(list().includes('Demo'));
});
