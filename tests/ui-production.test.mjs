import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';

// Gamybinis serveris (GitHub Pages) + bandymas įjungti ?demo + nesukonfigūruota duomenų bazė.
const dom = installDom({ hostname: 'arturasbekis-png.github.io', search: '?demo' });

test('Gamyboje demonstraciniai duomenys niekada neįkeliami, o neprijungta duomenų bazė rodo aiškią „neprijungta“ būseną', async () => {
  await import('../ranking/public-app.js');
  await tick();
  const app = dom.el('app').innerHTML;
  assert.ok(!app.includes('DEMONSTRACINIAI'), 'demo režimas gamyboje išjungtas');
  assert.ok(!app.includes('Demo '), 'jokių demonstracinių vardų');
  // Supabase neprijungtas: puslapis veikia (vietinis režimas), bet aiškiai sako, kad bendros duomenų bazės dar nėra
  assert.ok(dom.el('panel').innerHTML.includes('Bendra reitingų duomenų bazė dar neprijungta'), 'neprijungta būsena pasakyta aiškiai');
  assert.ok(app.includes('id="local-info"'), 'informacinė žinutė');
  assert.ok(!app.includes('id="local-banner"'), 'be vietinių duomenų „vietinių duomenų“ perspėjimo nėra');
  assert.ok(!dom.el('panel').innerHTML.includes('class="rrow'), 'jokių reitingo eilučių – nieko neišgalvojama');
  assert.ok(app.includes('Reitingavimo taisyklės'));
  assert.ok(app.includes('9–12') && app.includes('13–16'));

  // Kalendorius vis tiek matomas, visi renginiai „Suplanuoti“
  dom.loc.hash = '#turnyrai';
  const tl = dom.el('tlist').innerHTML;
  assert.equal((tl.match(/class="tcard /g) || []).length, 19);
  assert.equal((tl.match(/Suplanuotas/g) || []).length, 19);
  assert.ok(!tl.includes('Patvirtintas'));

  // Kategorijų skirtukuose tuščia būsena be klaidų
  for (const tab of ['#elite', '#challenge', '#future']) {
    dom.loc.hash = tab;
    assert.ok(dom.el('panel').innerHTML.includes('Bendra reitingų duomenų bazė dar neprijungta'), tab);
  }
});
