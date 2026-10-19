// Lengvas Supabase (PostgREST + GoTrue) klientas be trečiųjų šalių bibliotekų.
// Naršyklėje naudojamas TIK viešas „anon“ raktas. Privilegijuoti raktai (service_role) čia niekada nenaudojami.
// Viešas skaitymas: RPC public_ranking_data (grąžina tik patvirtintus rezultatus).
// Administravimas: prisijungimas (Supabase Auth) + admin_* funkcijos, kurias serveris patikrina pats.

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
    seasons: (data.seasons || []).map((s) => ({ id: s.id, label: s.label, isCurrent: Boolean(s.isCurrent), scoringVersion: s.scoringVersion || 'v1' })),
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
    seasons: seasons.map((s) => ({ id: s.id, label: s.label, isCurrent: Boolean(s.is_current), scoringVersion: s.scoring_version || 'v1' })),
    tournaments: tournaments.map((t) => ({
      id: t.id, seasonId: t.season_id, type: t.event_type, number: t.number ?? null, name: t.name, date: t.event_date,
      startTime: t.start_time ? String(t.start_time).slice(0, 5) : null, status: t.status, allowTies: Boolean(t.allow_ties),
      scoringVersion: t.scoring_version || null, revision: t.revision || 0, finalizedAt: t.finalized_at || null,
    })),
    players: players.map((p) => ({ id: p.id, fullName: p.full_name, gender: p.gender || null, bio: p.bio || null, isActive: p.is_active !== false, mergedInto: p.merged_into || null })),
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
  const baseUrl = (url || '').replace(/\/+$/, '');
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  let session = null;

  const configured = () => Boolean(baseUrl && anonKey);

  function headers(extra = {}, withSession = false) {
    const h = { apikey: anonKey, 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
    h.Authorization = `Bearer ${withSession && session ? session.accessToken : anonKey}`;
    return h;
  }

  async function request(path, { method = 'GET', body, withSession = false, extraHeaders } = {}) {
    if (!configured()) throw new ApiError('not_configured', messageFor('not_configured'));
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
      const code = (payload && (payload.message || payload.error_code || payload.error)) || `http_${response.status}`;
      const known = ERROR_MESSAGES[code] ? code : (response.status === 401 || response.status === 403 ? 'not_authorized' : code);
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

  async function signIn(email, password) {
    if (!configured()) throw new ApiError('not_configured', messageFor('not_configured'));
    let response;
    try {
      response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
    } catch (_) { throw new ApiError('network', messageFor('network')); }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError('invalid_credentials', messageFor('invalid_credentials'), { status: response.status });
    return setSession(payload);
  }

  async function refresh() {
    if (!session || !session.refreshToken) return null;
    const response = await doFetch(`${baseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!response.ok) { session = null; persist(); return null; }
    return setSession(await response.json());
  }

  async function restoreSession() {
    if (!storage) return null;
    try {
      const saved = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
      if (!saved) return null;
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
      try { await doFetch(`${baseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}` } }); } catch (_) { /* nesvarbu */ }
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
    fetchPublicData,
    signIn, signOut, restoreSession,
    isSignedIn: () => Boolean(session),
    getSession: () => session,
    loadAdminDataset,
    /** Ar prisijungęs naudotojas yra administratorius (tikrina serveris, ne naršyklė). */
    async isAdmin() { return (await admin('is_admin', {})) === true; },
    async createPlayer({ fullName, gender, bio }) {
      await freshSession();
      const rows = await request('/rest/v1/players', {
        method: 'POST', withSession: true, extraHeaders: { Prefer: 'return=representation' },
        body: { full_name: fullName, gender: gender || null, bio: bio || null },
      });
      return rows && rows[0];
    },
    async updatePlayer(id, { fullName, gender, bio, isActive }) {
      await freshSession();
      const patch = {};
      if (fullName !== undefined) patch.full_name = fullName;
      if (gender !== undefined) patch.gender = gender || null;
      if (bio !== undefined) patch.bio = bio || null;
      if (isActive !== undefined) patch.is_active = isActive;
      return request(`/rest/v1/players?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', withSession: true, body: patch, extraHeaders: { Prefer: 'return=representation' } });
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
    async listAudit(limit = 100) {
      return select(`audit_log?select=*&order=id.desc&limit=${Number(limit) || 100}`);
    },
  };
}
