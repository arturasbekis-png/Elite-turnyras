import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, normalizePublicData, normalizeAdminRows, ApiError } from '../ranking/api.js';
import { computeRankings } from '../ranking/engine.js';

const URL = 'https://example.supabase.test';
const KEY = 'public-anon-key';

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
