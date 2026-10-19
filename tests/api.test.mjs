import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, normalizePublicData, normalizeAdminRows, ApiError } from '../ranking/api.js';
import { computeRankings } from '../ranking/engine.js';

import { fakeJwt } from './helpers.mjs';

const URL = 'https://example.supabase.test';
// Testinis „anon“ tipo raktas (neturi jokios galios – tik formatas, kurį atpažįsta kliento patikra).
const KEY = fakeJwt({ role: 'anon' });

/** Imituoja serverį: visi lankytojai gauna tą patį viešą atsakymą. */
function fakeServer(publicPayload) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const respond = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
    if (url.endsWith('/rest/v1/rpc/public_ranking_data')) return respond(200, publicPayload);
    if (url.endsWith('/rest/v1/rpc/is_admin')) return respond(200, init.headers.Authorization === 'Bearer admin-token');
    if (url.includes('/rest/v1/rpc/admin_')) {
      const auth = init.headers.Authorization;
      if (auth === `Bearer ${KEY}`) return respond(403, { code: '42501', message: 'permission denied for function admin_finalize_tournament' });
      if (auth === 'Bearer user-token') return respond(403, { code: '42501', message: 'not_authorized' });
      return respond(200, { ok: true });
    }
    if (url.includes('/auth/v1/token?grant_type=password')) {
      const body = JSON.parse(init.body);
      return body.password === 'good'
        ? respond(200, { access_token: body.email === 'admin@x.test' ? 'admin-token' : 'user-token', refresh_token: 'r', expires_in: 3600, user: { email: body.email } })
        : respond(400, { error: 'invalid_grant' });
    }
    if (url.includes('/rest/v1/tournaments')) return respond(200, []);
    return respond(404, { message: 'nerasta' });
  };
  return { fetchImpl, calls };
}

const payload = {
  generatedAt: '2026-10-11T18:00:00Z',
  seasons: [{ id: '2026-2027', label: '2026–2027', isCurrent: true, scoringVersion: 'v1' }],
  tournaments: [{ id: 't1', seasonId: '2026-2027', type: 'elite', number: 1, name: 'ELITE #1', date: '2026-10-11', startTime: '11:00', status: 'finalized', allowTies: false, scoringVersion: 'v1', revision: 1 }],
  players: [{ id: 'a', fullName: 'Testinis A' }, { id: 'b', fullName: 'Testinis B' }, { id: 'c', fullName: 'Testinis C' }, { id: 'd', fullName: 'Testinis D' }],
  participations: [{ id: 'p1', tournamentId: 't1', teamName: null, position: 1, playerIds: ['a', 'b'] }, { id: 'p2', tournamentId: 't1', teamName: null, position: 2, playerIds: ['c', 'd'] }],
};

// ───────── TEST K — nuoseklumas skirtingiems lankytojams ─────────
test('K: skirtingi lankytojai (nepriklausomi klientai) gauna tą patį oficialų reitingą', async () => {
  const server = fakeServer(payload);
  const rankingsOf = async () => {
    const client = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
    return computeRankings(await client.fetchPublicData(), { seasonId: '2026-2027' }).overall.map((r) => [r.name, r.points, r.position]);
  };
  const a = await rankingsOf();
  const b = await rankingsOf(); // „po puslapio perkrovimo“ – naujas klientas, jokios vietinės būsenos
  assert.deepEqual(a, b);
  assert.deepEqual(a[0], ['Testinis A', 50, 1]);
  // viešas skaitymas nenaudoja administratoriaus kredencialų
  server.calls.forEach((c) => assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`));
});

test('Viešas klientas siunčia tik anon raktą ir nekviečia admin funkcijų', async () => {
  const server = fakeServer(payload);
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
  await client.fetchPublicData();
  assert.equal(server.calls.length, 1);
  assert.ok(server.calls[0].url.endsWith('/rest/v1/rpc/public_ranking_data'));
  assert.equal(server.calls[0].init.headers.apikey, KEY);
});

// ───────── TEST L — saugumas kliento lygiu ─────────
test('L: be prisijungimo administratoriaus veiksmai net nesiunčiami į serverį', async () => {
  const server = fakeServer(payload);
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
  for (const call of [
    () => client.finalize('t1'), () => client.saveResults('t1', []), () => client.correct('t1', [], 'priežastis'),
    () => client.mergePlayers('a', 'b'), () => client.loadAdminDataset(), () => client.createPlayer({ fullName: 'X' }),
  ]) {
    await assert.rejects(call, (err) => err instanceof ApiError && err.code === 'not_authenticated');
  }
  assert.equal(server.calls.length, 0, 'serveris nebuvo kviečiamas');
});

test('L: serveris atmeta anoniminį ir paprasto vartotojo bandymą skelbti – klaida perduodama lietuviškai', async () => {
  const server = fakeServer(payload);
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
  await client.signIn('user@x.test', 'good');
  await assert.rejects(() => client.finalize('t1'), (err) => err.code === 'not_authorized' && /administratoriaus teisių/.test(err.message));
});

test('Prisijungimas: neteisingas slaptažodis, sėkmė ir atsijungimas išvalo sesiją', async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const server = fakeServer(payload);
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl, storage });
  await assert.rejects(() => client.signIn('admin@x.test', 'bad'), (err) => err.code === 'invalid_credentials');
  assert.equal(client.isSignedIn(), false);
  await client.signIn('admin@x.test', 'good');
  assert.equal(client.isSignedIn(), true);
  await client.finalize('t1');
  assert.equal(server.calls.at(-1).init.headers.Authorization, 'Bearer admin-token');
  assert.ok(store.size === 1, 'sesija išsaugota tik sesijos saugykloje');
  assert.ok(![...store.values()].some((v) => v.includes('good')), 'slaptažodis niekur neišsaugomas');
  await client.signOut();
  assert.equal(client.isSignedIn(), false);
  assert.equal(store.size, 0);
  const restored = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl, storage });
  assert.equal(await restored.restoreSession(), null);
});

test('Nesukonfigūruotas klientas aiškiai pasako, kad duomenų bazės nėra', async () => {
  const client = createClient({ url: '', anonKey: '' });
  assert.equal(client.configured(), false);
  await assert.rejects(() => client.fetchPublicData(), (err) => err.code === 'not_configured');
  await assert.rejects(() => client.signIn('a@b.c', 'x'), (err) => err.code === 'not_configured');
});

test('Tinklo klaida paverčiama aiškiu lietuvišku pranešimu', async () => {
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(() => client.fetchPublicData(), (err) => err.code === 'network' && /ryšį/.test(err.message));
});

test('Serverio validacijos klaida išskleidžiama į lietuviškų pranešimų sąrašą', async () => {
  const fetchImpl = async (url) => ({
    ok: false, status: 400,
    text: async () => JSON.stringify({ message: 'validation_failed', details: '[{"code":"duplicate_position"},{"code":"missing_position"}]' }),
  });
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl });
  const fakeSignedIn = createClient({
    url: URL, anonKey: KEY,
    fetchImpl: async (u, init) => (u.includes('/auth/v1/token') ? { ok: true, status: 200, json: async () => ({ access_token: 't', refresh_token: 'r', expires_in: 3600, user: { email: 'a@b.c' } }) } : fetchImpl(u, init)),
  });
  await fakeSignedIn.signIn('a@b.c', 'x');
  await assert.rejects(() => fakeSignedIn.finalize('t1'), (err) => err.code === 'validation_failed' && err.details.length === 2 && /tą pačią vietą/.test(err.details[0].message));
  void client;
});

test('Normalizavimas: viešas ir administratoriaus formatai sutampa su variklio dataset', () => {
  const pub = normalizePublicData(payload);
  assert.equal(pub.participations[0].playerIds.length, 2);
  assert.equal(pub.players[0].mergedInto, null);
  const adm = normalizeAdminRows({
    seasons: [{ id: 's', label: 'S', is_current: true, scoring_version: 'v1' }],
    tournaments: [{ id: 't', season_id: 's', event_type: 'elite', number: 1, name: 'ELITE #1', event_date: '2026-10-11', start_time: '11:00:00', status: 'draft', allow_ties: false }],
    players: [{ id: 'a', full_name: 'A', is_active: true, merged_into: null }],
    participations: [{ id: 'p', tournament_id: 't', team_name: null, final_position: 1, participation_players: [{ player_id: 'b', slot: 2 }, { player_id: 'a', slot: 1 }] }],
  });
  assert.deepEqual(adm.participations[0].playerIds, ['a', 'b'], 'žaidėjų eilė pagal slot');
  assert.equal(adm.tournaments[0].startTime, '11:00');
  assert.deepEqual(normalizePublicData(null).participations, []);
});

test('Administratoriaus patikra: serveris pasako, ar prisijungęs naudotojas yra administratorius', async () => {
  const server = fakeServer(payload);
  const admin = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
  await admin.signIn('admin@x.test', 'good');
  assert.equal(await admin.isAdmin(), true);
  const user = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
  await user.signIn('user@x.test', 'good');
  assert.equal(await user.isAdmin(), false, 'paprastas naudotojas nėra administratorius');
  const anon = createClient({ url: URL, anonKey: KEY, fetchImpl: server.fetchImpl });
  await assert.rejects(() => anon.isAdmin(), (err) => err.code === 'not_authenticated');
});

// ───────── Rakto formatai, sesijos atnaujinimas, aiškios klaidos ─────────

test('Publishable raktas (NE JWT) siunčiamas tik apikey antraštėje, o ne kaip Bearer', async () => {
  const PUB = 'sb_publishable_TESTONLYabcdefghijklmnop';
  const server = fakeServer(payload);
  const client = createClient({ url: URL, anonKey: PUB, fetchImpl: server.fetchImpl });
  assert.equal(client.configured(), true);
  await client.fetchPublicData();
  assert.equal(server.calls[0].init.headers.apikey, PUB);
  assert.ok(!('Authorization' in server.calls[0].init.headers), 'be Authorization antraštės viešoms užklausoms');
  // prisijungimo užklausa taip pat tik su apikey
  await client.signIn('admin@x.test', 'good');
  const signin = server.calls.find((c) => c.url.includes('grant_type=password'));
  assert.equal(signin.init.headers.apikey, PUB);
  assert.ok(!('Authorization' in signin.init.headers));
  // prisijungus Bearer yra naudotojo sesijos žetonas, o ne raktas
  await client.finalize('t1');
  assert.equal(server.calls.at(-1).init.headers.Authorization, 'Bearer admin-token');
  assert.equal(server.calls.at(-1).init.headers.apikey, PUB);
});

test('Privilegijuotas raktas niekada nenaudojamas: kliento užklausos į tinklą net neišeina', async () => {
  const server = fakeServer(payload);
  for (const bad of [fakeJwt({ role: 'service_role' }), 'sb_secret_TESTONLYabcdefghijklmnop']) {
    const client = createClient({ url: URL, anonKey: bad, fetchImpl: server.fetchImpl });
    assert.equal(client.configured(), false);
    assert.equal(client.configProblem().status, 'secret_key');
    await assert.rejects(() => client.fetchPublicData(), (err) => err.code === 'not_configured' && /PRIVILEGIJUOTAS/.test(err.message));
    await assert.rejects(() => client.signIn('a@b.c', 'x'), (err) => err.code === 'not_configured');
  }
  assert.equal(server.calls.length, 0, 'jokio tinklo kreipinio su privilegijuotu raktu');
});

test('Nesukonfigūruoto kliento priežastis prieinama (missing / bad_url)', () => {
  assert.equal(createClient({ url: '', anonKey: '' }).configProblem().status, 'missing');
  assert.equal(createClient({ url: 'abc', anonKey: KEY }).configProblem().status, 'bad_url');
  assert.equal(createClient({ url: URL, anonKey: KEY }).configProblem(), null);
});

test('Prisijungimo klaidos: neteisingi duomenys, nepatvirtintas el. paštas, per daug bandymų, serverio klaida', async () => {
  const mk = (status, body) => createClient({ url: URL, anonKey: KEY, fetchImpl: async () => ({ ok: false, status, json: async () => body, text: async () => JSON.stringify(body) }) });
  await assert.rejects(() => mk(400, { error_code: 'invalid_credentials' }).signIn('a@b.c', 'x'), (e) => e.code === 'invalid_credentials');
  await assert.rejects(() => mk(400, { error_code: 'email_not_confirmed' }).signIn('a@b.c', 'x'), (e) => e.code === 'email_not_confirmed' && /Auto Confirm/.test(e.message));
  await assert.rejects(() => mk(429, { error_code: 'over_request_rate_limit' }).signIn('a@b.c', 'x'), (e) => e.code === 'rate_limited');
  await assert.rejects(() => mk(503, {}).signIn('a@b.c', 'x'), (e) => e.code === 'server_error');
});

test('Pasibaigęs žetonas: viena sėkminga atnaujinimo + pakartojimo grandinė, o nepavykus – „sesija baigėsi“', async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  let rpcCalls = 0; let refreshOk = true;
  const fetchImpl = async (url, init = {}) => {
    const respond = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
    if (url.includes('grant_type=password')) return respond(200, { access_token: 'old-token', refresh_token: 'r1', expires_in: 3600, user: { email: 'a@b.c' } });
    if (url.includes('grant_type=refresh_token')) return refreshOk ? respond(200, { access_token: 'new-token', refresh_token: 'r2', expires_in: 3600, user: { email: 'a@b.c' } }) : respond(400, { error: 'invalid_grant' });
    if (url.includes('/rpc/admin_finalize_tournament')) {
      rpcCalls += 1;
      return init.headers.Authorization === 'Bearer new-token' ? respond(200, { status: 'finalized' }) : respond(401, { code: 'PGRST301', message: 'JWT expired' });
    }
    return respond(404, {});
  };
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl, storage });
  await client.signIn('a@b.c', 'x');
  assert.deepEqual(await client.finalize('t1'), { status: 'finalized' });
  assert.equal(rpcCalls, 2, 'pirmas bandymas su senu žetonu, antras – po atnaujinimo');
  assert.equal(client.getSession().accessToken, 'new-token');

  // atnaujinti nepavyksta → aiški klaida ir išvalyta sesija (UI grąžina į prisijungimą)
  const client2 = createClient({ url: URL, anonKey: KEY, fetchImpl, storage: null });
  await client2.signIn('a@b.c', 'x');
  refreshOk = false;
  await assert.rejects(() => client2.finalize('t1'), (e) => e.code === 'session_expired');
  assert.equal(client2.isSignedIn(), false);
});

test('Tinklo klaida atnaujinant sesiją nesugriauna kliento (grąžinamas aiškus kodas)', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    if (url.includes('grant_type=password')) return { ok: true, status: 200, json: async () => ({ access_token: 'old', refresh_token: 'r', expires_in: 1, user: { email: 'a@b.c' } }), text: async () => '' };
    n += 1;
    throw new TypeError('fetch failed');
  };
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl });
  await client.signIn('a@b.c', 'x'); // expires_in 1 s → refresh bus bandomas prieš kiekvieną kvietimą
  await assert.rejects(() => client.finalize('t1'), (e) => e instanceof ApiError && ['network', 'session_expired'].includes(e.code));
  assert.ok(n >= 1);
});

test('Viešo skaitymo klaidos: atmestas raktas ir nepaleista schema turi aiškius pranešimus', async () => {
  const mk = (status, body) => createClient({ url: URL, anonKey: KEY, fetchImpl: async () => ({ ok: false, status, text: async () => JSON.stringify(body) }) });
  await assert.rejects(() => mk(401, { message: 'Invalid API key' }).fetchPublicData(), (e) => e.code === 'invalid_key' && /runtime-config/.test(e.message));
  await assert.rejects(() => mk(404, { code: 'PGRST202', message: 'Could not find the function public.public_ranking_data' }).fetchPublicData(), (e) => e.code === 'schema_missing' && /schema\.sql/.test(e.message));
  // teisių klaida (42501) nepainiojama su blogu raktu
  await assert.rejects(() => mk(401, { code: '42501', message: 'permission denied for function x' }).fetchPublicData(), (e) => e.code === 'not_authorized');
});

test('Normalizavimas perduoda bandomąjį požymį (sezonas, žaidėjas)', () => {
  const pub = normalizePublicData({ seasons: [{ id: 'bandymas', label: 'B', isTest: true }, { id: 's', label: 'S' }] });
  assert.deepEqual(pub.seasons.map((s) => s.isTest), [true, false]);
  const adm = normalizeAdminRows({ seasons: [{ id: 'b', label: 'B', is_test: true }], players: [{ id: 'p', full_name: 'A B', is_test: true }, { id: 'q', full_name: 'C D' }] });
  assert.equal(adm.seasons[0].isTest, true);
  assert.deepEqual(adm.players.map((p) => p.isTest), [true, false]);
});

test('Žaidėjo kūrimas siunčia is_test tik kai žaidėjas bandomasis', async () => {
  const bodies = [];
  const fetchImpl = async (url, init = {}) => {
    if (url.includes('grant_type=password')) return { ok: true, status: 200, json: async () => ({ access_token: 't', refresh_token: 'r', expires_in: 3600, user: { email: 'a@b.c' } }), text: async () => '' };
    if (url.endsWith('/rest/v1/players')) { bodies.push(JSON.parse(init.body)); return { ok: true, status: 201, text: async () => JSON.stringify([{ id: 'x', first_name: 'A', last_name: 'B', full_name: 'A B' }]) }; }
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const client = createClient({ url: URL, anonKey: KEY, fetchImpl });
  await client.signIn('a@b.c', 'x');
  await client.createPlayer({ firstName: 'A', lastName: 'B' });
  await client.createPlayer({ firstName: 'A', lastName: 'B', isTest: true });
  assert.ok(!('is_test' in bodies[0]));
  assert.equal(bodies[1].is_test, true);
});
