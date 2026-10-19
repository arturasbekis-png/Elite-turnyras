// Administravimo puslapis su netinkama konfigūracija: konkrečios priežasties pranešimas vietoje prisijungimo formos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';

const dom = installDom({ hostname: 'arturasbekis-png.github.io' });

test('Administravimas: neteisingas projekto adresas parodo priežastį ir žingsnius, o ne prisijungimo formą', async () => {
  const { RUNTIME } = await import('../ranking/runtime-config.js');
  RUNTIME.supabaseUrl = 'https://supabase.com/dashboard/project/abc';
  RUNTIME.supabaseAnonKey = 'sb_publishable_TESTONLYabcdefghijklmnop';
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; throw new Error('nenaudoti'); };

  await import('../ranking/admin-app.js');
  await tick(80);
  const html = dom.el('app').innerHTML;
  assert.equal(fetched, 0);
  assert.ok(html.includes('id="unconfigured"'));
  assert.ok(html.includes('data-setup="bad_url"') && html.includes('Tai ne projekto adresas'));
  assert.ok(html.includes('docs/SUPABASE-DIEGIMAS.md'));
  assert.ok(!html.includes('login-password'), 'prisijungimo formos nėra, kol nuostatos neteisingos');
});
