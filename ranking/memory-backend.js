// Atmintyje veikiantis „serveris“, atkartojantis Supabase admin_* funkcijų elgesį (per ranking/domain.js).
// Naudojamas TIK testuose ir lokaliame demonstraciniame administravimo režime (localhost + ?demo).
// Jis nieko nesaugo ir nėra jokia oficialių rezultatų saugykla.

import { saveDraft, finalizeTournament, correctTournament, mergePlayers, DomainError } from './domain.js';
import { ApiError, messageFor } from './api.js';
import { buildName, nameParts } from './names.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createMemoryBackend(initial, { actor = 'demo@local' } = {}) {
  let data = clone(initial);
  data.auditLog = data.auditLog || [];
  // Identifikatorių skaitiklis tęsiamas nuo didžiausio jau esančio (svarbu, kai duomenys įkelti iš vietinės saugyklos).
  let counter = 0;
  for (const item of [...(data.players || []), ...(data.participations || [])]) {
    const m = /mem-(\d+)$/.exec(String(item.id || ''));
    if (m) counter = Math.max(counter, Number(m[1]));
  }
  const nextId = () => `mem-${++counter}`;
  const session = { email: actor };

  const audit = (action, tournamentId, reason, before, after) => {
    data.auditLog.push({ id: data.auditLog.length + 1, at: new Date().toISOString(), actor, action, tournamentId, reason, before, after });
  };

  const guard = (fn) => async (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      if (err instanceof DomainError) throw new ApiError(err.code, messageFor(err.code, err.message), { details: (err.details || []).map((d) => (typeof d === 'string' ? { code: 'info', message: d } : { code: d.code, message: messageFor(d.code, d.message) })) });
      throw err;
    }
  };
  const apply = (next) => { data = next; };
  const isTestTournament = (tournamentId) => {
    const t = data.tournaments.find((x) => x.id === tournamentId);
    const season = t && data.seasons.find((x) => x.id === t.seasonId);
    return Boolean(season && season.isTest);
  };
  /** Bandomasis žaidėjas negali patekti į oficialų turnyrą (kaip ir duomenų bazėje). */
  const guardTestPlayers = (tournamentId, entries) => {
    if (isTestTournament(tournamentId)) return;
    const testIds = new Set(data.players.filter((p) => p.isTest).map((p) => p.id));
    if ((entries || []).some((e) => (e.playerIds || []).some((id) => testIds.has(id)))) {
      throw new DomainError('test_player_in_official', 'Bandomasis žaidėjas negali dalyvauti oficialiame turnyre.');
    }
  };

  return {
    kind: 'memory',
    configured: () => true,
    isSignedIn: () => true,
    isAdmin: async () => true,
    getSession: () => session,
    signIn: async () => session,
    signOut: async () => {},
    restoreSession: async () => session,

    loadAdminDataset: async () => clone(data),

    createPlayer: guard(({ firstName, lastName, gender, bio, isTest }) => {
      const name = buildName(firstName, lastName);
      if (!name) throw new DomainError('invalid_name', 'Įveskite žaidėjo vardą ir pavardę.');
      const player = { id: `pl-${nextId()}`, ...name, gender: gender || null, bio: bio || null, isActive: true, mergedInto: null, isTest: Boolean(isTest) };
      data.players.push(player);
      return player;
    }),

    updatePlayer: guard((id, patch) => {
      const player = data.players.find((p) => p.id === id);
      if (!player) throw new DomainError('player_not_found', 'Žaidėjas nerastas.');
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        const current = nameParts(player);
        const name = buildName(patch.firstName !== undefined ? patch.firstName : current.firstName, patch.lastName !== undefined ? patch.lastName : current.lastName);
        if (!name) throw new DomainError('invalid_name', 'Įveskite žaidėjo vardą ir pavardę.');
        Object.assign(player, name);
      }
      if (patch.gender !== undefined) player.gender = patch.gender || null;
      if (patch.bio !== undefined) player.bio = patch.bio || null;
      if (patch.isActive !== undefined) player.isActive = patch.isActive;
      return [player];
    }),

    saveResults: guard((tournamentId, entries, status = 'draft') => {
      guardTestPlayers(tournamentId, entries);
      apply(saveDraft(data, tournamentId, entries.map((e) => ({ ...e, id: undefined })), { status, actor, nextId }));
      return { status };
    }),
    finalize: guard((tournamentId) => {
      apply(finalizeTournament(data, tournamentId, { actor }));
      return { status: 'finalized' };
    }),
    correct: guard((tournamentId, entries, reason) => {
      guardTestPlayers(tournamentId, entries);
      apply(correctTournament(data, tournamentId, entries.map((e) => ({ ...e, id: undefined })), { reason, actor, nextId }));
      return { status: 'finalized' };
    }),
    mergePlayers: guard((keepId, dropId, reason) => {
      const a = data.players.find((p) => p.id === keepId); const b = data.players.find((p) => p.id === dropId);
      if (a && b && Boolean(a.isTest) !== Boolean(b.isTest)) throw new DomainError('merge_test_mismatch', 'Bandomojo žaidėjo negalima sujungti su oficialiu žaidėju.');
      apply(mergePlayers(data, keepId, dropId, { reason, actor }));
      return { kept: keepId };
    }),

    setStatus: guard((tournamentId, status) => {
      const t = data.tournaments.find((x) => x.id === tournamentId);
      if (!t) throw new DomainError('tournament_not_found', 'Turnyras nerastas.');
      if (t.status === 'finalized') throw new DomainError('tournament_finalized', 'Turnyras jau patvirtintas.');
      if (!['planned', 'in_progress', 'draft', 'awaiting_confirmation'].includes(status)) throw new DomainError('invalid_status', 'Netinkamas statusas.');
      audit('set_status', tournamentId, null, { status: t.status }, { status });
      t.status = status;
      return { status };
    }),

    upsertSeason: guard((season) => {
      if (!season.id || !season.label) throw new DomainError('invalid_season', 'Netinkami sezono duomenys.');
      if ((data.seasons.find((x) => x.id === season.id) || {}).isTest) throw new DomainError('test_season_locked', 'Bandomojo sezono duomenų keisti negalima.');
      if (season.isCurrent) data.seasons.forEach((s) => { if (s.id !== season.id) s.isCurrent = false; });
      const existing = data.seasons.find((s) => s.id === season.id);
      const next = { id: season.id, label: season.label, isCurrent: Boolean(season.isCurrent), scoringVersion: season.scoringVersion || 'v1' };
      if (existing) Object.assign(existing, next); else data.seasons.push(next);
      audit('upsert_season', null, null, null, next);
      return { id: season.id };
    }),

    upsertTournament: guard((t) => {
      const existing = data.tournaments.find((x) => x.id === t.id);
      if (existing && existing.status === 'finalized') throw new DomainError('tournament_finalized', 'Turnyras jau patvirtintas.');
      const next = { id: t.id, seasonId: t.seasonId, type: t.type, number: t.number ?? null, name: t.name, date: t.date, startTime: t.startTime || '11:00', allowTies: Boolean(t.allowTies), status: existing ? existing.status : 'planned', revision: existing ? existing.revision : 0, scoringVersion: null };
      if (existing) Object.assign(existing, next); else data.tournaments.push(next);
      audit('upsert_tournament', t.id, null, null, { name: t.name, date: t.date });
      return { id: t.id };
    }),

    createTestSeason: guard(() => {
      if (!data.seasons.some((x) => x.id === 'bandymas')) data.seasons.push({ id: 'bandymas', label: 'BANDOMASIS SEZONAS (neoficialus)', isCurrent: false, scoringVersion: 'v1', isTest: true });
      const today = new Date().toISOString().slice(0, 10);
      for (const [type, label] of [['elite', 'ELITE'], ['challenge', 'CHALLENGE'], ['future', 'FUTURE']]) {
        const id = `bandymas-${type}-1`;
        if (!data.tournaments.some((x) => x.id === id)) {
          data.tournaments.push({ id, seasonId: 'bandymas', type, number: 1, name: `BANDOMASIS ${label} #1`, date: today, startTime: '11:00', allowTies: false, status: 'planned', revision: 0, scoringVersion: null });
        }
      }
      audit('create_test_season', null, null, null, { season: 'bandymas' });
      return { seasonId: 'bandymas' };
    }),

    deleteTestData: guard(() => {
      const testSeasons = new Set(data.seasons.filter((x) => x.isTest).map((x) => x.id));
      const testTournaments = new Set(data.tournaments.filter((t) => testSeasons.has(t.seasonId)).map((t) => t.id));
      const testPlayers = new Set(data.players.filter((p) => p.isTest).map((p) => p.id));
      const blocking = data.participations.filter((p) => !testTournaments.has(p.tournamentId) && p.playerIds.some((id) => testPlayers.has(id)));
      if (blocking.length) throw new DomainError('test_player_in_real_tournament', 'Bandomasis žaidėjas yra oficialiame turnyre.');
      const counts = {
        seasons: testSeasons.size, tournaments: testTournaments.size, players: testPlayers.size,
        teams: data.participations.filter((p) => testTournaments.has(p.tournamentId)).length,
      };
      data.participations = data.participations.filter((p) => !testTournaments.has(p.tournamentId));
      data.tournaments = data.tournaments.filter((t) => !testTournaments.has(t.id));
      data.seasons = data.seasons.filter((x) => !testSeasons.has(x.id));
      data.players = data.players.filter((p) => !testPlayers.has(p.id));
      audit('delete_test_data', null, null, null, counts);
      return counts;
    }),

    listAudit: async (limit = 100) => data.auditLog.slice(-limit).reverse().map((a) => ({
      id: a.id, at: a.at, actor_email: a.actor, action: a.action, tournament_id: a.tournamentId, reason: a.reason, before: a.before, after: a.after,
    })),
  };
}
