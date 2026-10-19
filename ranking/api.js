// Lengvas Supabase (PostgREST + GoTrue) klientas be trečiųjų šalių bibliotekų.
// Naršyklėje naudojamas TIK viešas „anon“ raktas. Privilegijuoti raktai (service_role) čia niekada nenaudojami.
// Viešas skaitymas: RPC public_ranking_data (grąžina tik patvirtintus rezultatus).
// Administravimas: prisijungimas (Supabase Auth) + admin_* funkcijos, kurias serveris patikrina pats.

import { inspectRuntime } from './config-check.js';

export class ApiError extends Error {
  constructor(code, message, { status = 0, details = [] } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Klaidų kodų vertimai į lietuvių kalbą (serverio ir kliento validacijos kodai). */
export const ERROR_MESSAGES = {
  not_authenticated: 'Reikia prisijungti.',
  not_authorized: 'Neturite administratoriaus teisių šiam veiksmui.',
  not_configured: 'Duomenų bazė dar nesukonfigūruota.',
  network: 'Nepavyko prisijungti prie serverio. Patikrinkite interneto ryšį.',
  invalid_credentials: 'Neteisingas el. paštas arba slaptažodis.',
  email_not_confirmed: 'Šio el. pašto adresas dar nepatvirtintas. Supabase: Authentication → Users → pažymėkite naudotoją ir patvirtinkite el. paštą (arba sukurkite jį su „Auto Confirm User“).',
  rate_limited: 'Per daug bandymų. Palaukite kelias minutes ir bandykite dar kartą.',
  server_error: 'Serveris laikinai nepasiekiamas. Bandykite dar kartą po kelių minučių.',
  session_expired: 'Prisijungimo galiojimas baigėsi. Prisijunkite iš naujo.',
  local_storage_failed: 'Pakeitimo nepavyko išsaugoti šioje naršyklėje (saugykla pilna ar išjungta). Atsisiųskite CSV.',
  invalid_key: 'Duomenų bazė atmetė svetainės viešą raktą. Patikrinkite ranking/runtime-config.js: URL ir raktas turi būti iš to paties Supabase projekto.',
  schema_missing: 'Duomenų bazėje nerasta reikiamų funkcijų. Supabase SQL Editor paleiskite supabase/schema.sql (žr. docs/SUPABASE-DIEGIMAS.md).',
  tournament_not_found: 'Turnyras nerastas.',
  tournament_finalized: 'Turnyras jau patvirtintas. Naudokite rezultatų pataisymą.',
  already_finalized: 'Šio turnyro rezultatai jau paskelbti. Taškai antrą kartą neskiriami.',
  not_finalized: 'Pataisyti galima tik paskelbtus rezultatus.',
  reason_required: 'Nurodykite pataisymo priežastį (bent 5 simboliai).',
  validation_failed: 'Rezultatų patvirtinti negalima – yra klaidų.',
  player_in_two_teams: 'Tas pats žaidėjas negali dalyvauti dviejose komandose tame pačiame turnyre.',
  team_needs_two_players: 'Kiekvienoje komandoje turi būti du žaidėjai.',
  unknown_player: 'Pasirinktas žaidėjas nerastas.',
  merged_player: 'Pasirinktas žaidėjas sujungtas su kitu įrašu – naudokite pagrindinį įrašą.',
  invalid_position: 'Vieta turi būti sveikasis skaičius nuo 1.',
  invalid_entries: 'Netinkamas rezultatų formatas.',
  invalid_status: 'Netinkamas statusas.',
  too_few_teams: 'Turnyre turi būti bent 2 komandos.',
  missing_position: 'Kai kurioms komandoms nenurodyta galutinė vieta.',
  position_out_of_range: 'Vieta didesnė nei komandų skaičius.',
  duplicate_position: 'Kelios komandos turi tą pačią vietą (lygios vietos šiam turnyrui neleidžiamos).',
  invalid_tie_positions: 'Lygių vietų numeracija neteisinga (po pasidalintos vietos kita vieta praleidžiama).',
  duplicate_team: 'Ta pati komanda įrašyta du kartus.',
  same_player_twice: 'Tas pats žaidėjas pasirinktas du kartus.',
  merge_same: 'Negalima sujungti žaidėjo su juo pačiu.',
  merge_conflict: 'Abu įrašai dalyvavo tame pačiame turnyre – sujungti saugiai negalima. Pirmiau pataisykite komandas.',
  already_merged: 'Vienas iš įrašų jau sujungtas su kitu.',
  player_not_found: 'Žaidėjas nerastas.',
  invalid_season: 'Netinkami sezono duomenys.',
  invalid_name: 'Įveskite žaidėjo vardą ir pavardę.',
  test_player_in_real_tournament: 'Bandomasis žaidėjas yra įrašytas oficialiame turnyre – bandymo duomenų ištrinti negalima. Pirmiausia pašalinkite jį iš oficialaus turnyro (pataisymu).',
  test_player_in_official: 'Bandomasis žaidėjas negali dalyvauti oficialiame turnyre. Pasirinkite oficialų žaidėją.',
  test_season_locked: 'Bandomojo sezono duomenų keisti šiuo būdu negalima.',
  merge_test_mismatch: 'Bandomojo žaidėjo negalima sujungti su oficialiu žaidėju.',
};

export function messageFor(code, fallback) {
  return ERROR_MESSAGES[code] || fallback || 'Įvyko nenumatyta klaida.';
}

function parseDetails(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((e) => ({ code: e.code, message: messageFor(e.code) }));
  } catch (_) { /* detail gali būti paprastas tekstas (pvz. turnyrų pavadinimai) */ }
  return [{ code: 'info', message: String(raw) }];
}

// ───────────────────────── Duomenų normalizavimas ─────────────────────────

/** Viešo RPC atsakymo normalizavimas į variklio dataset formatą. */
export function normalizePublicData(raw) {
  const data = raw || {};
  return {
    generatedAt: data.generatedAt || null,
    seasons: (data.seasons || []).map((s) => ({ id: s.id, label: s.label, isCurrent: Boolean(s.isCurrent), scoringVersion: s.scoringVersion || 'v1', isTest: Boolean(s.isTest) })),
    tournaments: (data.tournaments || []).map((t) => ({
      id: t.id, seasonId: t.seasonId, type: t.type, number: t.number ?? null, name: t.name, date: t.date,
      startTime: t.startTime || null, status: t.status, allowTies: Boolean(t.allowTies),
      scoringVersion: t.scoringVersion || null, revision: t.revision || 0, finalizedAt: t.finalizedAt || null,
    })),
    players: (data.players || []).map((p) => ({ id: p.id, fullName: p.fullName, gender: p.gender || null, bio: p.bio || null, isActive: p.isActive !== false, mergedInto: null })),
    participations: (data.participations || []).map((p) => ({
      id: p.id, tournamentId: p.tournamentId, teamName: p.teamName || null,
      position: p.position, playerIds: p.playerIds || [],
    })),
    auditLog: [],
  };
}

/** Administratoriaus lentelių eilučių (PostgREST) pavertimas dataset formatu. */
export function normalizeAdminRows({ seasons = [], tournaments = [], players = [], participations = [] }) {
  return {
    generatedAt: null,
    seasons: seasons.map((s) => ({ id: s.id, label: s.label, isCurrent: Boolean(s.is_current), scoringVersion: s.scoring_version || 'v1', isTest: Boolean(s.is_test) })),
    tournaments: tournaments.map((t) => ({
      id: t.id, seasonId: t.season_id, type: t.event_type, number: t.number ?? null, name: t.name, date: t.event_date,
      startTime: t.start_time ? String(t.start_time).slice(0, 5) : null, status: t.status, allowTies: Boolean(t.allow_ties),
      scoringVersion: t.scoring_version || null, revision: t.revision || 0, finalizedAt: t.finalized_at || null,
    })),
    players: players.map((p) => ({ id: p.id, firstName: p.first_name || null, lastName: p.last_name || null, fullName: p.full_name, gender: p.gender || null, bio: p.bio || null, isActive: p.is_active !== false, mergedInto: p.merged_into || null, isTest: Boolean(p.is_test) })),
    participations: participations.map((p) => ({
      id: p.id, tournamentId: p.tournament_id, teamName: p.team_name || null, position: p.final_position,
      playerIds: (p.participation_players || []).slice().sort((a, b) => a.slot - b.slot).map((x) => x.player_id),
    })),
    auditLog: [],
  };
}

// ───────────────────────── Klientas ─────────────────────────

const SESSION_KEY = 'elite-ranking-admin-session';

export function createClient({ url, anonKey, fetchImpl, storage } = {}) {
  // Nuostatų patikra: tuščios, netinkamos ar PRIVILEGIJUOTOS reikšmės niekada nenaudojamos (kliento užklausos neteikiamos).
  const config = inspectRuntime({ supabaseUrl: url, supabaseAnonKey: anonKey });
  const baseUrl = config.ok ? config.url : '';
  const key = config.ok ? config.anonKey : '';
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let session = null;

  const configured = () => config.ok;
  const notConfigured = () => new ApiError('not_configured', config.title ? `${config.title}. ${config.text}` : messageFor('not_configured'));

  /**
   * Antraštės. „publishable“ raktas (sb_publishable_…) NĖRA JWT, todėl siunčiamas tik `apikey` antraštėje
   * (Supabase dokumentacija). Senasis „anon“ raktas yra JWT ir gali eiti ir kaip Bearer. Prisijungus – Bearer yra
   * naudotojo sesijos JWT.
   */
  function headers(extra = {}, withSession = false) {
    const h = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
    if (withSession && session) h.Authorization = `Bearer ${session.accessToken}`;
    else if (config.keyKind === 'anon-jwt') h.Authorization = `Bearer ${key}`;
    return h;
  }

  async function request(path, { method = 'GET', body, withSession = false, extraHeaders, retried = false } = {}) {
    if (!configured()) throw notConfigured();
    if (withSession && !session) throw new ApiError('not_authenticated', messageFor('not_authenticated'));
    let response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: headers(extraHeaders, withSession),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) {
      throw new ApiError('network', messageFor('network'));
    }
    let payload = null;
    const text = await response.text();
    if (text) { try { payload = JSON.parse(text); } catch (_) { payload = text; } }
    if (!response.ok) {
      // Prisijungusio naudotojo 401 reiškia nebegaliojantį žetoną: bandome atnaujinti vieną kartą, kitaip prašome prisijungti.
      if (withSession && response.status === 401) {
        if (!retried && (await refresh())) return request(path, { method, body, withSession, extraHeaders, retried: true });
        session = null;
        persist();
        throw new ApiError('session_expired', messageFor('session_expired'), { status: 401 });
      }
      const code = (payload && (payload.message || payload.error_code || payload.error)) || `http_${response.status}`;
      let known = ERROR_MESSAGES[code] ? code : (response.status === 401 || response.status === 403 ? 'not_authorized' : code);
      // Neprisijungusio užklausos 401 reiškia, kad atmestas pats viešas raktas (ne „teisių trūkumą“).
      if (!withSession && response.status === 401 && !ERROR_MESSAGES[code] && !(payload && payload.code === '42501')) known = 'invalid_key';
      if (payload && payload.code === 'PGRST202') known = 'schema_missing';
      throw new ApiError(known, messageFor(known, (payload && (payload.message || payload.msg)) || `Klaida (${response.status})`), {
        status: response.status,
        details: parseDetails(payload && payload.details),
      });
    }
    return payload;
  }

  const rpc = (name, args, withSession = false) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body: args || {}, withSession });

  // ── Viešas skaitymas ──
  async function fetchPublicData() {
    return normalizePublicData(await rpc('public_ranking_data', {}));
  }

  // ── Prisijungimas ──
  function persist() {
    if (!storage) return;
    try {
      if (session) storage.setItem(SESSION_KEY, JSON.stringify(session)); else storage.removeItem(SESSION_KEY);
    } catch (_) { /* privatus režimas */ }
  }

  function setSession(token) {
    session = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
      email: token.user && token.user.email,
    };
    persist();
    return session;
  }

  const authHeaders = () => ({ apikey: key, 'Content-Type': 'application/json' });

  async function signIn(email, password) {
    if (!configured()) throw notConfigured();
    let response;
    try {
      response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ email, password }),
      });
    } catch (_) { throw new ApiError('network', messageFor('network')); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const gotrue = String((payload && (payload.error_code || payload.code)) || '');
      let code = 'invalid_credentials';
      if (gotrue === 'email_not_confirmed') code = 'email_not_confirmed';
      else if (response.status === 429 || gotrue === 'over_request_rate_limit') code = 'rate_limited';
      else if (response.status >= 500) code = 'server_error';
      throw new ApiError(code, messageFor(code), { status: response.status });
    }
    return setSession(payload);
  }

  /** Atnaujina sesiją. Grąžina naują sesiją arba null (tada reikia prisijungti iš naujo). Niekada nemeta klaidos. */
  async function refresh() {
    if (!session || !session.refreshToken) return null;
    let response;
    try {
      response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
    } catch (_) { return null; }
    if (!response.ok) { session = null; persist(); return null; }
    try { return setSession(await response.json()); } catch (_) { return null; }
  }

  async function restoreSession() {
    if (!storage) return null;
    try {
      const saved = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
      if (!saved || !saved.accessToken) return null;
      session = saved;
    } catch (_) { return null; }
    if (session.expiresAt - Date.now() < 60_000) return refresh();
    return session;
  }

  async function signOut() {
    const token = session && session.accessToken;
    session = null;
    persist();
    if (token && configured()) {
      try { await doFetch(`${baseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}` } }); } catch (_) { /* nesvarbu */ }
    }
  }

  async function freshSession() {
    if (session && session.expiresAt - Date.now() < 30_000) await refresh();
    return session;
  }

  const admin = async (name, args) => { await freshSession(); return rpc(name, args, true); };
  const select = async (path) => { await freshSession(); return request(`/rest/v1/${path}`, { withSession: true }); };

  // ── Administravimas ──
  async function loadAdminDataset() {
    const [seasons, tournaments, players, participations] = await Promise.all([
      select('seasons?select=*&order=id'),
      select('tournaments?select=*&order=event_date,id'),
      select('players?select=*&order=full_name'),
      select('participations?select=id,tournament_id,team_name,final_position,participation_players(player_id,slot)'),
    ]);
    return normalizeAdminRows({ seasons, tournaments, players, participations });
  }

  const toEntries = (entries) => entries.map((e) => ({ teamName: e.teamName || null, position: e.position == null || e.position === '' ? null : Number(e.position), playerIds: e.playerIds || [] }));

  return {
    configured,
    /** Kodėl nesukonfigūruota: { status, title, text } arba null, jei viskas gerai. */
    configProblem: () => (config.ok ? null : { status: config.status, title: config.title, text: config.text }),
    fetchPublicData,
    signIn, signOut, restoreSession,
    isSignedIn: () => Boolean(session),
    getSession: () => session,
    loadAdminDataset,
    /** Ar prisijungęs naudotojas yra administratorius (tikrina serveris, ne naršyklė). */
    async isAdmin() { return (await admin('is_admin', {})) === true; },
    async createPlayer({ firstName, lastName, gender, bio, isTest }) {
      await freshSession();
      const body = { first_name: firstName, last_name: lastName, gender: gender || null, bio: bio || null };
      if (isTest) body.is_test = true;
      const rows = await request('/rest/v1/players', {
        method: 'POST', withSession: true, extraHeaders: { Prefer: 'return=representation' }, body,
      });
      const row = rows && rows[0];
      return row && { id: row.id, firstName: row.first_name, lastName: row.last_name, fullName: row.full_name };
    },
    async updatePlayer(id, { firstName, lastName, gender, bio, isActive }) {
      await freshSession();
      const patch = {};
      if (firstName !== undefined) patch.first_name = firstName;
      if (lastName !== undefined) patch.last_name = lastName;
      if (gender !== undefined) patch.gender = gender || null;
      if (bio !== undefined) patch.bio = bio || null;
      if (isActive !== undefined) patch.is_active = isActive;
      const rows = await request(`/rest/v1/players?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', withSession: true, body: patch, extraHeaders: { Prefer: 'return=representation' } });
      // RLS neleidžia ne administratoriui keisti nieko; tuščias atsakymas reiškia, kad įrašas nepakeistas.
      if (!rows || !rows.length) throw new ApiError('player_not_found', messageFor('player_not_found'));
      return rows;
    },
    saveResults: (tournamentId, entries, status = 'draft') => admin('admin_save_results', { p_tournament_id: tournamentId, p_entries: toEntries(entries), p_status: status }),
    finalize: (tournamentId) => admin('admin_finalize_tournament', { p_tournament_id: tournamentId }),
    correct: (tournamentId, entries, reason) => admin('admin_correct_results', { p_tournament_id: tournamentId, p_entries: toEntries(entries), p_reason: reason }),
    setStatus: (tournamentId, status) => admin('admin_set_tournament_status', { p_tournament_id: tournamentId, p_status: status }),
    mergePlayers: (keepId, dropId, reason) => admin('admin_merge_players', { p_keep: keepId, p_drop: dropId, p_reason: reason || null }),
    upsertSeason: (s) => admin('admin_upsert_season', { p_id: s.id, p_label: s.label, p_is_current: Boolean(s.isCurrent), p_scoring_version: s.scoringVersion || 'v1' }),
    upsertTournament: (t) => admin('admin_upsert_tournament', {
      p_id: t.id, p_season_id: t.seasonId, p_event_type: t.type, p_number: t.number ?? null, p_name: t.name,
      p_event_date: t.date, p_start_time: t.startTime || '11:00', p_allow_ties: Boolean(t.allowTies),
    }),
    /** Bandomasis sezonas (neoficialus) – saugiam sistemos patikrinimui. */
    createTestSeason: () => admin('admin_create_test_season', {}),
    /** Ištrina TIK bandomuosius duomenis (bandomąjį sezoną, jo turnyrus ir „bandomuosius“ žaidėjus). */
    deleteTestData: () => admin('admin_delete_test_data', {}),
    async listAudit(limit = 100) {
      return select(`audit_log?select=*&order=id.desc&limit=${Number(limit) || 100}`);
    },
  };
}
