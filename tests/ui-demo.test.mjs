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
  assert.ok(app.innerHTML.includes('🟣 ELITE') && app.innerHTML.includes('TURNYRŲ REZULTATAI'));
  assert.ok(!app.innerHTML.includes('BENDRAS REITINGAS'), 'bendro reitingo nėra');
  assert.ok(list().includes('Demo Alfa Žaidėjas'));
  assert.ok(!app.innerHTML.includes('SEZONAS') && !app.innerHTML.includes('class="card toolbar"'), 'vienas sezonas – tuščios sezono skilties nėra');

  // Išskleidžiama žaidėjo kortelė
  app.handlers.click(clickOn({ '[data-toggle]': { dataset: { toggle: 'elite:demo-p1|demo-p2' } } }));
  assert.ok(list().includes('Poros taškų suma'));
  assert.ok(list().includes('aria-expanded="true"'));
  app.handlers.click(clickOn({ '[data-toggle]': { dataset: { toggle: 'elite:demo-p1|demo-p2' } } }));
  assert.ok(!list().includes('Poros taškų suma'), 'uždaroma');

  // Paieška (be diakritikų) ir rūšiavimas
  app.handlers.input(inputEvent('[data-control="query"]', 'lambda'));
  assert.ok(list().includes('Demo Lambda') && !list().includes('Demo Alfa'));
  app.handlers.input(inputEvent('[data-control="query"]', 'nėra tokio'));
  assert.ok(list().includes('Porų nerasta'));
  app.handlers.input(inputEvent('[data-control="query"]', ''));
  app.handlers.change(changeEvent('sort', 'name'));
  assert.ok(list().indexOf('Demo Alfa') < list().indexOf('Demo Zeta'));

  // Kategorijų skirtukai
  dom.loc.hash = '#challenge';
  assert.ok(list().includes('CHALLENGE porų reitingas'));
  assert.ok(!list().includes('Demo Alfa Žaidėjas</span><span class="n">Demo Beta'), 'ELITE pora CHALLENGE lentelėje nerodoma');
  dom.loc.hash = '#future';
  assert.ok(!app.innerHTML.includes('FUTURE reitingas'), 'FUTURE reitingo lentelės nėra; adresas rodo ELITE');
  assert.ok(list().includes('ELITE porų reitingas'));

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
  dom.loc.hash = '#elite?s=1999-2000';
  assert.ok(list().includes('Demo Alfa Žaidėjas'));
  // Sezono pakeitimas nesugriauna puslapio
  app.handlers.change(changeEvent('season', '2026-2027'));
  assert.ok(list().includes('Demo'));
});
