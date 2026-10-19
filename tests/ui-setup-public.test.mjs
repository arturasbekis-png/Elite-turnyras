// Viešas puslapis, kai ranking/runtime-config.js reikšmės netinkamos / privilegijuotos: aiškus pranešimas, jokių užklausų.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';
import { fakeJwt } from './helpers.mjs';

const dom = installDom({ hostname: 'arturasbekis-png.github.io' });
const SERVICE = fakeJwt({ role: 'service_role', ref: 'abcdefghijkl' });

test('Viešas puslapis: įklijuotas PRIVILEGIJUOTAS raktas – aiškus perspėjimas, raktas nenaudojamas ir neatspausdinamas', async () => {
  const { RUNTIME } = await import('../ranking/runtime-config.js');
  RUNTIME.supabaseUrl = 'https://abcdefghijkl.supabase.co';
  RUNTIME.supabaseAnonKey = SERVICE;
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; throw new Error('tinklas neturi būti naudojamas'); };

  await import('../ranking/public-app.js');
  await tick();
  const app = dom.el('app').innerHTML;
  const panel = dom.el('panel').innerHTML;
  assert.equal(fetched, 0, 'su privilegijuotu raktu jokių užklausų');
  assert.ok(panel.includes('data-setup="secret_key"'), 'rodoma konkreti priežastis');
  assert.ok(panel.includes('PRIVILEGIJUOTAS raktas'));
  assert.ok(!panel.includes('Reitingai dar neprijungti'), 'tai ne tas pats, kas „tuščia konfigūracija“');
  assert.ok(!app.includes(SERVICE) && !app.includes(SERVICE.split('.')[1]), 'raktas niekur neparodomas');
  assert.ok(app.includes('Reitingavimo taisyklės'), 'taisyklės vis tiek matomos');
  assert.ok(!app.includes('Kraunami'), 'nėra amžino „kraunama“');
  dom.loc.hash = '#turnyrai';
  assert.equal((dom.el('tlist').innerHTML.match(/class="tcard /g) || []).length, 19, 'kalendorius lieka');
});
