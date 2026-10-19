// Administravimo srauto logika be DOM priklausomybių (testuojama Node aplinkoje).
// Backend sąsaja: ranking/api.js klientas (Supabase) arba ranking/memory-backend.js (tik lokaliai / testams).
// SVARBU: čia daroma tik patogi validacija naudotojui. Galutinį sprendimą visada priima serveris
// (supabase/schema.sql funkcijos), todėl apeiti taisyklių per naršyklę negalima.

import { validateResults, previewPoints, computeRankings, tournamentView, scoringTableFor, pointsForPosition } from './engine.js';
import { overallCsv, categoryCsv, tournamentCsv } from './csv.js';
import { tournamentId as makeTournamentId } from './events.js';
import { fold, pickDefaultSeason } from './view.js';
import { buildName, namesAlike } from './names.js';
import { messageFor } from './api.js';
import { OFFICIAL_STATUS } from './config.js';

const parsePosition = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

export function createAdminController(backend, { onChange = () => {}, onAuthLost = () => {} } = {}) {
  let keyCounter = 0;
  const newKey = () => `row-${++keyCounter}`;

  const state = {
    ready: false, busy: false, notice: null,
    dataset: null, seasonId: null, tournamentId: null,
    entries: [], reason: '', preview: null, dirty: false,
    audit: [], pendingDuplicate: null,
  };
  const emit = () => onChange(state);
  const setNotice = (type, text, details = []) => { state.notice = { type, text, details }; };

  const tournament = () => state.dataset && state.dataset.tournaments.find((t) => t.id === state.tournamentId);
  const activePlayers = () => (state.dataset ? state.dataset.players.filter((p) => !p.mergedInto) : []);
  const isFinalized = () => Boolean(tournament() && tournament().status === OFFICIAL_STATUS);

  function entriesFromDataset(id) {
    return state.dataset.participations
      .filter((p) => p.tournamentId === id)
      .slice()
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
      .map((p) => ({ key: newKey(), teamName: p.teamName || '', playerIds: [p.playerIds[0] || '', p.playerIds[1] || ''], position: p.position == null ? '' : String(p.position) }));
  }

  const toParticipations = () => state.entries.map((e) => ({ id: e.key, teamName: e.teamName || null, playerIds: [...e.playerIds], position: parsePosition(e.position) }));
  const toPayload = () => state.entries.map((e) => ({ teamName: e.teamName || null, playerIds: e.playerIds.filter(Boolean), position: parsePosition(e.position) }));

  function validateNow() {
    return validateResults({ tournament: tournament(), participations: toParticipations(), players: activePlayers() });
  }

  async function run(fn) {
    if (state.busy) return false;
    state.busy = true;
    state.notice = null;
    emit();
    try {
      const result = await fn();
      return result === undefined ? true : result;
    } catch (err) {
      setNotice('error', err && err.message ? err.message : messageFor('network'), (err && err.details) || []);
      // Pasibaigusi sesija: grąžiname į prisijungimą (UI nusprendžia, kaip tai parodyti).
      if (err && (err.code === 'session_expired' || err.code === 'not_authenticated')) onAuthLost(err);
      return false;
    } finally {
      state.busy = false;
      emit();
    }
  }

  async function reload({ keepEntries = false } = {}) {
    state.dataset = await backend.loadAdminDataset();
    if (!state.seasonId || !state.dataset.seasons.some((s) => s.id === state.seasonId)) state.seasonId = pickDefaultSeason(state.dataset.seasons);
    if (state.tournamentId && !tournament()) { state.tournamentId = null; state.entries = []; state.preview = null; state.dirty = false; }
    if (state.tournamentId && !keepEntries) { state.entries = entriesFromDataset(state.tournamentId); state.dirty = false; state.preview = null; }
  }

  /** Taškų peržiūra + validacija prieš paskelbimą. */
  function preview() {
    const t = tournament();
    if (!t) return null;
    const validation = validateNow();
    const season = state.dataset.seasons.find((s) => s.id === t.seasonId);
    const names = new Map(state.dataset.players.map((p) => [p.id, p.fullName]));
    let teams = [];
    let scored = Boolean(scoringTableFor(t.type));
    if (validation.valid) {
      const parts = toParticipations();
      const pts = previewPoints({ tournament: t, participations: parts, scoringVersion: t.scoringVersion || (season && season.scoringVersion) });
      scored = pts.scored;
      teams = parts.map((p, i) => ({ position: p.position, teamName: p.teamName, players: p.playerIds.map((id) => ({ id, name: names.get(id) || '—' })), points: pts.rows[i].points }))
        .sort((a, b) => a.position - b.position);
    }
    state.preview = { validation, teams, scored };
    emit();
    return state.preview;
  }

  /** Panašūs esami žaidėjai (neatsižvelgiant į didžiąsias raides, lietuviškas žymes, vardo/pavardės tvarką). */
  const findSimilarPlayers = (fullName) => activePlayers().filter((p) => namesAlike(p.fullName, fullName));

  /** Paieška pagal vardą (be diakritikų ir didžiųjų raidžių) arba ID fragmentą. */
  const searchPlayers = (query, { includeMerged = false } = {}) => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    return state.dataset.players
      .filter((p) => includeMerged || !p.mergedInto)
      .filter((p) => {
        const name = fold(p.fullName);
        const id = String(p.id).toLowerCase();
        return words.every((w) => name.includes(w) || id.startsWith(w));
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'lt'));
  };

  /** Taškai kiekvienam žaidėjui pagal komandos vietą (tas pats variklis kaip viešame reitinge). */
  function livePoints() {
    const t = tournament();
    const result = { scored: false, byKey: new Map() };
    if (!t) return result;
    const season = state.dataset.seasons.find((s) => s.id === t.seasonId);
    const bands = scoringTableFor(t.type, t.scoringVersion || (season && season.scoringVersion));
    if (!bands) return result;
    result.scored = true;
    state.entries.forEach((e) => {
      const position = parsePosition(e.position);
      if (Number.isInteger(position) && position >= 1) result.byKey.set(e.key, pointsForPosition(bands, position));
    });
    return result;
  }

  /** Žaidėjai, jau priskirti kitoms komandoms šiame turnyre (formoje jų pasirinkti nebegalima). */
  const usedElsewhere = (key) => new Set(state.entries.filter((e) => e.key !== key).flatMap((e) => e.playerIds).filter(Boolean));

  return {
    state,

    // ── Pradžia ──
    load: () => run(async () => { await reload(); state.ready = true; }),

    selectSeason(id) { state.seasonId = id; state.tournamentId = null; state.entries = []; state.preview = null; emit(); },

    selectTournament(id) {
      state.tournamentId = id;
      state.reason = '';
      state.preview = null;
      state.notice = null;
      state.entries = id ? entriesFromDataset(id) : [];
      state.dirty = false;
      emit();
    },

    // ── Rezultatų redagavimas ──
    addTeam() { state.entries.push({ key: newKey(), teamName: '', playerIds: ['', ''], position: '' }); state.dirty = true; state.preview = null; emit(); },
    removeTeam(key) { state.entries = state.entries.filter((e) => e.key !== key); state.dirty = true; state.preview = null; emit(); },
    updateTeam(key, patch) {
      const e = state.entries.find((x) => x.key === key);
      if (!e) return;
      if (patch.teamName !== undefined) e.teamName = patch.teamName;
      if (patch.position !== undefined) e.position = patch.position;
      if (patch.player1 !== undefined) e.playerIds[0] = patch.player1;
      if (patch.player2 !== undefined) e.playerIds[1] = patch.player2;
      state.dirty = true;
      state.preview = null;
    },
    setReason(text) { state.reason = text; },

    preview,

    saveDraft: (status = 'draft') => run(async () => {
      if (isFinalized()) throw new Error(messageFor('tournament_finalized'));
      await backend.saveResults(state.tournamentId, toPayload(), status);
      await reload();
      setNotice('success', status === 'draft' ? 'Juodraštis išsaugotas. Jis neturi įtakos oficialiam reitingui.' : 'Rezultatai išsaugoti ir laukia patvirtinimo.');
    }),

    /** Išsaugo ir paskelbia. Dvigubas paskelbimas atmetamas – taškai neskiriami dukart. */
    finalize: () => run(async () => {
      if (isFinalized()) throw new Error(messageFor('already_finalized'));
      const validation = validateNow();
      state.preview = { validation, teams: [], scored: true };
      if (!validation.valid) {
        const err = new Error(messageFor('validation_failed'));
        err.details = validation.errors.map((e) => ({ code: e.code, message: e.message }));
        throw err;
      }
      await backend.saveResults(state.tournamentId, toPayload(), 'awaiting_confirmation');
      await backend.finalize(state.tournamentId);
      await reload();
      setNotice('success', 'Rezultatai patvirtinti ir paskelbti. Taškai įskaičiuoti į reitingus.');
    }),

    /** Paskelbtų rezultatų pataisymas – privaloma priežastis, išsaugoma audito žurnale. */
    correct: () => run(async () => {
      if (!isFinalized()) throw new Error(messageFor('not_finalized'));
      if (!state.reason || state.reason.trim().length < 5) throw new Error(messageFor('reason_required'));
      const validation = validateNow();
      if (!validation.valid) {
        const err = new Error(messageFor('validation_failed'));
        err.details = validation.errors.map((e) => ({ code: e.code, message: e.message }));
        throw err;
      }
      await backend.correct(state.tournamentId, toPayload(), state.reason.trim());
      state.reason = '';
      await reload();
      setNotice('success', 'Pataisymas išsaugotas, reitingai perskaičiuoti. Įrašas pridėtas į audito žurnalą.');
    }),

    setStatus: (status) => run(async () => {
      await backend.setStatus(state.tournamentId, status);
      await reload({ keepEntries: true });
      setNotice('success', 'Statusas atnaujintas.');
    }),

    // ── Žaidėjai ──
    /** Prieš kuriant naują žaidėją tikrinami panašūs vardai (apsauga nuo dublikatų). */
    findSimilarPlayers,
    searchPlayers,
    livePoints,
    usedElsewhere,

    /**
     * Prideda žaidėją. Vardas ir pavardė privalomi. Jei panašus žaidėjas jau yra, nekuriama –
     * `state.pendingDuplicate` užpildomas, o administratorius sąmoningai patvirtina per `force`.
     */
    createPlayer: (input, { force = false } = {}) => run(async () => {
      state.pendingDuplicate = null;
      const name = buildName(input.firstName, input.lastName);
      if (!name) {
        setNotice('error', 'Įveskite ir vardą, ir pavardę.');
        return false;
      }
      const similar = findSimilarPlayers(name.fullName);
      if (similar.length && !force) {
        state.pendingDuplicate = { input: { ...input }, name, similar: similar.map((p) => ({ id: p.id, fullName: p.fullName })) };
        setNotice('warning', `Panašus žaidėjas jau yra: „${similar[0].fullName}“. Jei tai tas pats žmogus, naujo įrašo nekurkite.`);
        return false;
      }
      const created = await backend.createPlayer({ ...input, firstName: name.firstName, lastName: name.lastName });
      await reload({ keepEntries: true });
      setNotice('success', `Žaidėjas „${(created && created.fullName) || name.fullName}“ išsaugotas.`);
      return true;
    }),
    clearPendingDuplicate() { state.pendingDuplicate = null; state.notice = null; emit(); },
    updatePlayer: (id, patch) => run(async () => {
      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        const name = buildName(patch.firstName, patch.lastName);
        if (!name) { setNotice('error', 'Įveskite ir vardą, ir pavardę.'); return false; }
        patch = { ...patch, firstName: name.firstName, lastName: name.lastName };
      }
      await backend.updatePlayer(id, patch);
      await reload({ keepEntries: true });
      setNotice('success', 'Žaidėjo duomenys atnaujinti. Taškai ir istorija nepakito.');
      return true;
    }),
    mergePlayers: (keepId, dropId, reason) => run(async () => {
      await backend.mergePlayers(keepId, dropId, reason);
      await reload({ keepEntries: true });
      setNotice('success', 'Žaidėjai sujungti. Visi istoriniai rezultatai išsaugoti pagrindiniame įraše.');
    }),

    // ── Sezonai ir turnyrai ──
    upsertSeason: (season) => run(async () => {
      await backend.upsertSeason(season);
      await reload({ keepEntries: true });
      setNotice('success', 'Sezonas išsaugotas.');
    }),
    upsertTournament: (t) => run(async () => {
      const id = t.id || makeTournamentId(t.seasonId, t.type, t.type === 'final' ? null : Number(t.number));
      await backend.upsertTournament({ ...t, id, number: t.type === 'final' ? null : Number(t.number) });
      await reload({ keepEntries: true });
      setNotice('success', 'Turnyras išsaugotas.');
    }),

    // ── Bandymo režimas ──
    /** Bandomasis sezonas (neoficialus) su trimis bandomaisiais turnyrais. */
    createTestSeason: () => run(async () => {
      await backend.createTestSeason();
      await reload({ keepEntries: true });
      setNotice('success', 'Bandomasis sezonas sukurtas. Jis atskirtas nuo oficialių rezultatų.');
    }),
    /** Ištrina TIK bandymo duomenis. Oficialūs sezonai, turnyrai ir žaidėjai nepaliečiami. */
    deleteTestData: () => run(async () => {
      const counts = await backend.deleteTestData();
      state.preview = null;
      await reload();
      const c = counts || {};
      setNotice('success', `Bandymo duomenys ištrinti (sezonų: ${c.seasons ?? 0}, turnyrų: ${c.tournaments ?? 0}, komandų: ${c.teams ?? 0}, žaidėjų: ${c.players ?? 0}). Oficialūs duomenys nepaliesti.`);
    }),
    testSummary() {
      const ds = state.dataset;
      const season = ds.seasons.find((x) => x.isTest) || null;
      const tournaments = season ? ds.tournaments.filter((t) => t.seasonId === season.id) : [];
      return {
        season,
        tournaments,
        players: ds.players.filter((p) => p.isTest && !p.mergedInto),
        published: tournaments.filter((t) => t.status === OFFICIAL_STATUS),
        teams: ds.participations.filter((p) => tournaments.some((t) => t.id === p.tournamentId)).length,
      };
    },

    // ── Auditas ──
    loadAudit: () => run(async () => { state.audit = await backend.listAudit(200); }),

    // ── CSV ──
    exportCsv(kind) {
      const ds = state.dataset;
      if (kind === 'tournament') {
        const t = tournament();
        if (!t) return null;
        let teams;
        if (t.status === OFFICIAL_STATUS) {
          teams = tournamentView(ds, t.id).teams;
        } else {
          const p = preview();
          teams = p && p.validation.valid ? p.teams : [];
        }
        return { filename: `turnyras-${t.id}.csv`, content: tournamentCsv(t, teams) };
      }
      const rankings = computeRankings(ds, { seasonId: state.seasonId });
      if (kind === 'overall') return { filename: `reitingas-bendras-${state.seasonId}.csv`, content: overallCsv(rankings.overall) };
      if (['elite', 'challenge', 'future'].includes(kind)) return { filename: `reitingas-${kind}-${state.seasonId}.csv`, content: categoryCsv(rankings.categories[kind]) };
      return null;
    },
  };
}
