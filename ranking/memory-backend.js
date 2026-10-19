// Atmintyje veikiantis „serveris“, atkartojantis Supabase admin_* funkcijų elgesį (per ranking/domain.js).
// Naudojamas TIK testuose ir lokaliame demonstraciniame administravimo režime (localhost + ?demo).
// Jis nieko nesaugo ir nėra jokia oficialių rezultatų saugykla.

import { saveDraft, finalizeTournament, correctTournament, mergePlayers, DomainError } from './domain.js';
import { ApiError, messageFor } from './api.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

export function createMemoryBackend(initial, { actor = 'demo@local' } = {}) {
  let data = clone(initial);
  data.auditLog = data.auditLog || [];
  let counter = 0;
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

    createPlayer: guard(({ fullName, gender, bio }) => {
      if (!fullName || !fullName.trim()) throw new DomainError('invalid_name', 'Įveskite žaidėjo vardą ir pavardę.');
      const player = { id: `pl-${nextId()}`, fullName: fullName.trim(), gender: gender || null, bio: bio || null, isActive: true, mergedInto: null };
      data.players.push(player);
      return player;
    }),

    updatePlayer: guard((id, patch) => {
      const player = data.players.find((p) => p.id === id);
      if (!player) throw new DomainError('player_not_found', 'Žaidėjas nerastas.');
      if (patch.fullName !== undefined) {
        if (!patch.fullName.trim()) throw new DomainError('invalid_name', 'Įveskite žaidėjo vardą ir pavardę.');
        player.fullName = patch.fullName.trim();
      }
      if (patch.gender !== undefined) player.gender = patch.gender || null;
      if (patch.bio !== undefined) player.bio = patch.bio || null;
      if (patch.isActive !== undefined) player.isActive = patch.isActive;
      return [player];
    }),

    saveResults: guard((tournamentId, entries, status = 'draft') => {
      apply(saveDraft(data, tournamentId, entries.map((e) => ({ ...e, id: undefined })), { status, actor, nextId }));
      return { status };
    }),
    finalize: guard((tournamentId) => {
      apply(finalizeTournament(data, tournamentId, { actor }));
      return { status: 'finalized' };
    }),
    correct: guard((tournamentId, entries, reason) => {
      apply(correctTournament(data, tournamentId, entries.map((e) => ({ ...e, id: undefined })), { reason, actor, nextId }));
      return { status: 'finalized' };
    }),
    mergePlayers: guard((keepId, dropId, reason) => {
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

    listAudit: async (limit = 100) => data.auditLog.slice(-limit).reverse().map((a) => ({
      id: a.id, at: a.at, actor_email: a.actor, action: a.action, tournament_id: a.tournamentId, reason: a.reason, before: a.before, after: a.after,
    })),
  };
}
