// Viešų nuostatų (ranking/runtime-config.js) patikra: aiškios būsenos, privilegijuotų raktų atmetimas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRuntime } from '../ranking/config-check.js';
import { fakeJwt } from './helpers.mjs';

const URL = 'https://abcdefghijkl.supabase.co';
const PUBLISHABLE = 'sb_publishable_TESTONLYabcdefghijklmnop';
const check = (supabaseUrl, supabaseAnonKey) => inspectRuntime({ supabaseUrl, supabaseAnonKey });

test('Tuščios reikšmės = „missing“ su aiškiu paaiškinimu, o ne tylus nieko nerodymas', () => {
  const r = check('', '');
  assert.equal(r.ok, false);
  assert.equal(r.status, 'missing');
  assert.match(r.text, /runtime-config\.js/);
  assert.equal(check('   ', '\n').status, 'missing');
  assert.equal(inspectRuntime().status, 'missing');
  assert.equal(inspectRuntime({ supabaseUrl: null, supabaseAnonKey: undefined }).status, 'missing');
});

test('Užpildytas tik vienas laukas = „incomplete“ ir nurodo, ko trūksta', () => {
  assert.equal(check(URL, '').status, 'incomplete');
  assert.match(check(URL, '').text, /viešojo rakto/);
  assert.equal(check('', PUBLISHABLE).status, 'incomplete');
  assert.match(check('', PUBLISHABLE).text, /projekto URL/);
});

test('Tinkamas publishable raktas ir URL', () => {
  const r = check(`${URL}/`, PUBLISHABLE);
  assert.equal(r.ok, true);
  assert.equal(r.keyKind, 'publishable');
  assert.equal(r.url, URL, 'pabaigos pasvirasis brūkšnys pašalinamas');
});

test('Tinkamas senasis anon JWT; iš kito projekto – atmetamas', () => {
  assert.equal(check(URL, fakeJwt({ role: 'anon', ref: 'abcdefghijkl' })).keyKind, 'anon-jwt');
  assert.equal(check(URL, fakeJwt({ role: 'anon' })).ok, true, 'be ref – leidžiama');
  const other = check(URL, fakeJwt({ role: 'anon', ref: 'zzzzzzzzzzzz' }));
  assert.equal(other.ok, false);
  assert.equal(other.status, 'bad_key');
  assert.match(other.title, /kito projekto/);
});

test('PRIVILEGIJUOTI raktai atmetami (service_role JWT ir sb_secret_) ir nenaudojami', () => {
  const service = check(URL, fakeJwt({ role: 'service_role', ref: 'abcdefghijkl' }));
  assert.equal(service.status, 'secret_key');
  assert.equal(service.ok, false);
  assert.equal(service.anonKey, '', 'privilegijuotas raktas negrąžinamas naudoti');
  const secret = check(URL, 'sb_secret_TESTONLYabcdefghijklmnop');
  assert.equal(secret.status, 'secret_key');
  assert.equal(secret.anonKey, '');
  // net jei URL neteisingas, privilegijuotas raktas vis tiek pastebimas
  assert.equal(check('nonsense', fakeJwt({ role: 'service_role' })).status, 'secret_key');
  // pranešimas neatkartoja paties rakto
  assert.ok(!service.text.includes(fakeJwt({ role: 'service_role', ref: 'abcdefghijkl' })));
});

test('Netinkami URL: ne https, dashboard adresas, per ilgas kelias', () => {
  assert.equal(check('http://abc.supabase.co', PUBLISHABLE).status, 'bad_url');
  assert.equal(check('abc.supabase.co', PUBLISHABLE).status, 'bad_url');
  assert.equal(check('https://supabase.com/dashboard/project/abc', PUBLISHABLE).status, 'bad_url');
  assert.match(check('https://supabase.com/dashboard/project/abc', PUBLISHABLE).title, /ne projekto/);
  assert.equal(check('https://abc.supabase.co/rest/v1', PUBLISHABLE).status, 'bad_url');
  assert.equal(check('https://abc.supabase.co/?x=1', PUBLISHABLE).status, 'bad_url');
});

test('Lokalus http leidžiamas tik localhost / 127.0.0.1 (testams)', () => {
  assert.equal(check('http://127.0.0.1:54321', PUBLISHABLE).ok, true);
  assert.equal(check('http://localhost:54321', PUBLISHABLE).ok, true);
  assert.equal(check('http://example.com', PUBLISHABLE).status, 'bad_url');
});

test('Netinkami raktai: su tarpais/kabutėmis, atsitiktinis tekstas, ne „anon“ rolė', () => {
  assert.equal(check(URL, `"${PUBLISHABLE}"`).status, 'bad_key');
  assert.equal(check(URL, `${PUBLISHABLE} dar kažkas`).status, 'bad_key');
  assert.equal(check(URL, 'public-anon-key').status, 'bad_key');
  assert.equal(check(URL, 'sb_publishable_trumpas').status, 'bad_key');
  assert.equal(check(URL, fakeJwt({ role: 'authenticated' })).status, 'bad_key');
  assert.equal(check(URL, 'aaa.bbb.ccc').status, 'bad_key');
});

test('Repozitorijoje esanti runtime-config.js: arba tuščia (neprijungta), arba su TINKAMOMIS viešomis reikšmėmis', async () => {
  const { RUNTIME } = await import('../ranking/runtime-config.js');
  const r = inspectRuntime(RUNTIME);
  assert.ok(r.status === 'missing' || r.ok, `runtime-config.js būsena: ${r.status} – ${r.title}`);
  assert.notEqual(r.status, 'secret_key');
});
