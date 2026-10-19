// TIK TESTAMS. Lokalus serveris, kuris pateikia tą pačią HTTP sutartį kaip Supabase (/rest/v1, /auth/v1)
// ir kreipiasi į TIKRĄ PostgreSQL su mūsų supabase/schema.sql. Jis leidžia naršyklės testui išbandyti visą kelią:
// puslapis → fetch → JWT patikra → rolė (anon/authenticated) → RLS → admin_* funkcijos → duomenų bazė.
//
// Svarbu: tai NE Supabase. PostgREST ir GoTrue čia pakeisti mažais imitatoriais (rolės perjungimas, JWT HS256,
// PostgREST stiliaus klaidų formatas). Tikras Supabase projektas turi būti patikrintas po diegimo (žr. docs).
// Serveris taip pat atiduoda statinę svetainę po /Elite-turnyras/ keliu (kaip GitHub Pages) ir pakeičia
// ranking/runtime-config.js testine konfigūracija (repozitorijaus failas nekeičiamas).

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

const b64 = (input) => Buffer.from(input).toString('base64url');

function signJwt(payload, secret) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  let given;
  try { given = Buffer.from(parts[2], 'base64url'); } catch (_) { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.exp && claims.exp * 1000 < Date.now()) return { expired: true };
    return claims;
  } catch (_) { return null; }
}

const TABLES = new Set(['seasons', 'tournaments', 'players', 'participations', 'participation_players', 'audit_log', 'admins']);
const IDENT = /^[a-z_][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startLocalSupabase({
  pg, database, staticRoot, basePath = '/Elite-turnyras/', users = [], configured = true, port = 0,
  // keyMode: 'anon-jwt' (senasis anon raktas, JWT) arba 'publishable' (naujas sb_publishable_… raktas – NE JWT).
  // runtime: neprivaloma ranking/runtime-config.js reikšmių pakeitimas ({ supabaseUrl, supabaseAnonKey }; '@origin' = serverio adresas).
  keyMode = 'anon-jwt', runtime = null,
}) {
  const jwtSecret = randomBytes(32).toString('hex');
  const anonJwt = signJwt({ role: 'anon', iss: 'local-test', exp: Math.floor(Date.now() / 1000) + 86400 }, jwtSecret);
  const publishableKey = `sb_publishable_${randomBytes(18).toString('base64url')}`;
  const anonKey = keyMode === 'publishable' ? publishableKey : anonJwt;
  // Kaip tikras Supabase vartai: apikey antraštėje priimamas JWT anon raktas arba publishable raktas.
  const apikeyValid = (value) => {
    if (keyMode === 'publishable' && value === publishableKey) return true;
    const claims = verifyJwt(value, jwtSecret);
    return Boolean(claims && !claims.expired);
  };
  const accounts = users.map((u) => ({ ...u }));
  const refreshTokens = new Map();
  let generation = 0; // didinama, kai testas „atšaukia“ sesijas (žetonai su senesne karta laikomi nebegaliojančiais)
  const stats = { requests: [] };

  // ── PostgreSQL per psql ──
  const psqlArgs = ['-X', '-q', '-A', '-t', '-h', pg.host, '-p', String(pg.port), '-U', pg.user || 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'];
  function psql(script, vars = {}) {
    return new Promise((resolve) => {
      const args = [...psqlArgs];
      Object.entries(vars).forEach(([k, v]) => args.push('-v', `${k}=${v}`));
      const child = spawn('psql', args);
      let out = ''; let err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => resolve({ ok: code === 0, out: out.trim(), err }));
      child.stdin.end(script);
    });
  }

  // Funkcijų parašai (kaip PostgREST schema cache)
  const sig = spawnSync('psql', [...psqlArgs, '-c', `select p.proname || '|' || coalesce(array_to_string(p.proargnames, ','), '') || '|' ||
      coalesce((select string_agg(format_type(t, null), ',' order by ord) from unnest(p.proargtypes::oid[]) with ordinality as u(t, ord)), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'`], { encoding: 'utf8' });
  const functions = new Map();
  (sig.stdout || '').split('\n').filter(Boolean).forEach((line) => {
    const [name, names, types] = line.split('|');
    functions.set(name, { names: names ? names.split(',') : [], types: types ? types.split(',') : [] });
  });
  const CALLABLE = /^(public_ranking_data|is_admin|admin_[a-z_]+)$/;

  function pgError(errText, role) {
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(errText);
    const detail = /DETAIL:\s+(.*)/.exec(errText);
    const code = m ? m[1] : 'XX000';
    const message = m ? m[2].trim() : errText.trim().split('\n')[0];
    let status = 400;
    if (code === '42501') status = role === 'anon' ? 401 : 403;
    return { status, body: { code, details: detail ? detail[1].trim() : null, hint: null, message } };
  }

  async function runAs(role, claims, statement, vars = {}) {
    const script = `begin;\nset local role ${role};\nselect set_config('request.jwt.claims', :'claims', true) \\g /dev/null\n${statement}\ncommit;\n`;
    return psql(script, { claims: JSON.stringify(claims), ...vars });
  }

  // ── Autentifikacija ──
  function authenticate(req) {
    const apikey = req.headers.apikey;
    if (!apikey || !apikeyValid(apikey)) return { error: { status: 401, body: { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' } } };
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!bearer) return { role: 'anon', claims: { role: 'anon' } };
    const claims = verifyJwt(bearer, jwtSecret);
    // Publishable raktas NĖRA JWT: kaip tikras Supabase, jį Authorization: Bearer antraštėje atmetame.
    if (!claims) return { error: { status: 401, body: { code: 'PGRST301', message: 'Invalid JWT' } } };
    if (claims.expired || (claims.role === 'authenticated' && (claims.gen ?? 0) < generation)) return { error: { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } } };
    return { role: claims.role === 'authenticated' ? 'authenticated' : 'anon', claims };
  }

  function issueTokens(account) {
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({ sub: account.id, role: 'authenticated', aud: 'authenticated', email: account.email, iat: now, exp: now + 3600, gen: generation }, jwtSecret);
    const refresh = randomUUID();
    refreshTokens.set(refresh, account.id);
    return { access_token: access, token_type: 'bearer', expires_in: 3600, refresh_token: refresh, user: { id: account.id, email: account.email } };
  }

  // ── REST ──
  async function handleRest(req, res, url, bodyText) {
    const auth = authenticate(req);
    if (auth.error) return send(res, auth.error.status, auth.error.body);
    const path = url.pathname.replace(/^\/rest\/v1\//, '');

    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      const fn = functions.get(name);
      if (!CALLABLE.test(name) || !fn) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` });
      let args;
      try { args = bodyText ? JSON.parse(bodyText) : {}; } catch (_) { return send(res, 400, { code: 'PGRST102', message: 'Empty or invalid json' }); }
      const parts = [];
      for (const key of Object.keys(args)) {
        const idx = fn.names.indexOf(key);
        if (idx < 0) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${name}(${key}) in the schema cache` });
        const type = fn.types[idx];
        parts.push(type === 'jsonb' ? `${key} := (:'body'::jsonb -> '${key}')` : `${key} := ((:'body'::jsonb ->> '${key}')::${type})`);
      }
      const call = `public.${name}(${parts.join(', ')})`;
      const result = await runAs(auth.role, auth.claims, `select coalesce((select to_jsonb(x.r) from (select ${call} as r) x)::text, 'null');`, { body: JSON.stringify(args) });
      if (!result.ok) { const e = pgError(result.err, auth.role); return send(res, e.status, e.body); }
      return sendRaw(res, 200, result.out || 'null');
    }

    const table = path.split('?')[0];
    if (!TABLES.has(table)) return send(res, 404, { code: '42P01', message: `relation "public.${table}" does not exist` });

    if (req.method === 'GET') {
      const orderParam = url.searchParams.get('order');
      const limit = Number(url.searchParams.get('limit'));
      let order = '';
      if (orderParam) {
        const cols = orderParam.split(',').map((c) => c.trim());
        if (!cols.every((c) => /^[a-z_]+(\.(asc|desc))?$/.test(c))) return send(res, 400, { code: 'PGRST100', message: 'bad order' });
        order = ` order by ${cols.map((c) => { const [col, dir] = c.split('.'); return `${col}${dir ? ` ${dir}` : ''}`; }).join(', ')}`;
      }
      const lim = Number.isInteger(limit) && limit > 0 ? ` limit ${limit}` : '';
      let inner = `select * from public.${table}${order}${lim}`;
      if (table === 'participations' && (url.searchParams.get('select') || '').includes('participation_players')) {
        inner = `select p.id, p.tournament_id, p.team_name, p.final_position,
          (select coalesce(jsonb_agg(jsonb_build_object('player_id', pp.player_id, 'slot', pp.slot)), '[]'::jsonb) from public.participation_players pp where pp.participation_id = p.id) as participation_players
          from public.participations p${order.replace(/\b([a-z_]+)\b/g, (m) => (m === 'order' || m === 'by' || m === 'asc' || m === 'desc' ? m : `p.${m}`))}${lim}`;
      }
      const result = await runAs(auth.role, auth.claims, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)::text from (${inner}) t;`);
      if (!result.ok) { const e = pgError(result.err, auth.role); return send(res, e.status, e.body); }
      return sendRaw(res, 200, result.out);
    }

    if (table === 'players' && (req.method === 'POST' || req.method === 'PATCH')) {
      let body;
      try { body = JSON.parse(bodyText); } catch (_) { return send(res, 400, { code: 'PGRST102', message: 'Empty or invalid json' }); }
      const keys = Object.keys(body);
      if (!keys.length || !keys.every((k) => IDENT.test(k))) return send(res, 400, { code: 'PGRST100', message: 'bad columns' });
      const cols = keys.map((k) => `"${k}"`).join(', ');
      let statement;
      if (req.method === 'POST') {
        statement = `with ins as (insert into public.players (${cols}) select ${cols} from jsonb_populate_record(null::public.players, :'body'::jsonb) returning *)
          select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb)::text from ins;`;
      } else {
        const filter = /^eq\.(.+)$/.exec(url.searchParams.get('id') || '');
        if (!filter || !UUID.test(filter[1])) return send(res, 400, { code: 'PGRST100', message: 'only id=eq.<uuid> is supported' });
        statement = `with upd as (update public.players set (${cols}) = (select ${cols} from jsonb_populate_record(null::public.players, :'body'::jsonb)) where id = '${filter[1]}' returning *)
          select coalesce(jsonb_agg(to_jsonb(upd)), '[]'::jsonb)::text from upd;`;
      }
      const result = await runAs(auth.role, auth.claims, statement, { body: JSON.stringify(body) });
      if (!result.ok) { const e = pgError(result.err, auth.role); return send(res, e.status, e.body); }
      return sendRaw(res, req.method === 'POST' ? 201 : 200, result.out);
    }

    // Kitų lentelių rašymas per REST neleidžiamas – imituojame tą patį atsakymą, kurį duotų teisių trūkumas.
    const e = pgError(`ERROR:  42501: permission denied for table ${table}`, auth.role);
    return send(res, e.status, e.body);
  }

  // ── Auth ──
  async function handleAuth(req, res, url, bodyText) {
    if (!req.headers.apikey || !apikeyValid(req.headers.apikey)) return send(res, 401, { message: 'No API key found in request' });
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      let body = {};
      try { body = JSON.parse(bodyText || '{}'); } catch (_) { /* tuščia */ }
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const account = accounts.find((a) => a.email.toLowerCase() === String(body.email || '').toLowerCase());
        if (!account || account.password !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', error_code: 'invalid_credentials' });
        return send(res, 200, issueTokens(account));
      }
      if (grant === 'refresh_token') {
        const id = refreshTokens.get(body.refresh_token);
        const account = accounts.find((a) => a.id === id);
        if (!account) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        refreshTokens.delete(body.refresh_token);
        return send(res, 200, issueTokens(account));
      }
    }
    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
      const claims = verifyJwt(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), jwtSecret);
      if (claims && claims.sub) for (const [token, id] of refreshTokens) if (id === claims.sub) refreshTokens.delete(token);
      res.writeHead(204); return res.end();
    }
    // Viešas registravimasis (signup) šioje imitacijoje neįgyvendintas – realiame projekte jį reikia išjungti nustatymuose.
    return send(res, 404, { message: 'not implemented in local test server' });
  }

  // ── Statinė svetainė ──
  const runtimeConfig = () => {
    if (runtime) {
      // '@service' = imituojamas PRIVILEGIJUOTAS raktas (service_role), kad būtų įrodyta, jog svetainė jo nenaudoja.
      const fix = (v) => (v === '@origin' ? origin() : v === '@key' ? anonKey : v === '@service' ? signJwt({ role: 'service_role', iss: 'local-test', exp: Math.floor(Date.now() / 1000) + 86400 }, jwtSecret) : v);
      return `export const RUNTIME = ${JSON.stringify({ supabaseUrl: fix(runtime.supabaseUrl), supabaseAnonKey: fix(runtime.supabaseAnonKey) })};\n`;
    }
    return `export const RUNTIME = { supabaseUrl: ${configured ? JSON.stringify(origin()) : "''"}, supabaseAnonKey: ${configured ? JSON.stringify(anonKey) : "''"} };\n`;
  };

  async function handleStatic(res, pathname) {
    if (!pathname.startsWith(basePath)) { res.writeHead(404); return res.end('Not found (outside project path)'); }
    let rel = decodeURIComponent(pathname.slice(basePath.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel === 'ranking/runtime-config.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); return res.end(runtimeConfig()); }
    const file = normalize(join(staticRoot, rel));
    if (!file.startsWith(normalize(staticRoot) + sep)) { res.writeHead(403); return res.end(); }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      return res.end(await readFile(file));
    } catch (_) { res.writeHead(404); return res.end('Not found'); }
  }

  function send(res, status, body) { sendRaw(res, status, JSON.stringify(body)); }
  function sendRaw(res, status, text) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    let bodyText = '';
    for await (const chunk of req) bodyText += chunk;
    stats.requests.push({ method: req.method, path: url.pathname + url.search, hasBearer: Boolean(req.headers.authorization) });
    try {
      if (url.pathname.startsWith('/rest/v1/')) await handleRest(req, res, url, bodyText);
      else if (url.pathname.startsWith('/auth/v1/')) await handleAuth(req, res, url, bodyText);
      else await handleStatic(res, url.pathname);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(String(err && err.stack ? err.stack : err));
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const origin = () => `http://127.0.0.1:${server.address().port}`;

  return {
    origin: origin(),
    siteUrl: `${origin()}${basePath}`,
    anonKey,
    keyMode,
    jwtSecret,
    stats,
    /** Visi iki šiol išduoti prieigos žetonai nebegalioja (atnaujinimo raktai lieka geri). */
    revokeAccessTokens: () => { generation += 1; },
    /** Nebegalioja ir žetonai, ir atnaujinimo raktai (pvz. administratorius atjungtas serveryje). */
    revokeSessions: () => { generation += 1; refreshTokens.clear(); },
    /** Kuria testinį JWT (pvz. pasibaigusį ar svetimą) – naudojama neteisėtų bandymų testams. */
    signToken: (claims, secret = jwtSecret) => signJwt(claims, secret),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
