// Vietinis režimas: kol Supabase neprijungtas, duomenys gali būti saugomi TIK šios naršyklės localStorage.
// Tai NĖRA bendra saugykla ir NĖRA viešas paskelbimas: kiti lankytojai šių duomenų nemato.
// Čia nėra jokių žaidėjų ar rezultatų – saugoma tik tai, ką administratorius pats įveda savo naršyklėje.

export const LOCAL_KEY = 'elite-ranking-local-v1';
const VERSION = 1;

/** Grąžina localStorage arba null (privatus režimas, išjungta saugykla). */
export function getLocalStorage() {
  try {
    const s = window.localStorage;
    if (!s) return null;
    const probe = '__elite_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch (_) {
    return null;
  }
}

export const emptyDataset = () => ({ seasons: [], tournaments: [], players: [], participations: [], auditLog: [] });

const isArray = (v) => Array.isArray(v);

/** Perskaito išsaugotą duomenų rinkinį. Sugadinti ar netinkami duomenys ignoruojami (grąžinama null). */
export function readLocalDataset(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const d = parsed && parsed.version === VERSION ? parsed.dataset : null;
    if (!d || !['seasons', 'tournaments', 'players', 'participations'].every((k) => isArray(d[k]))) return null;
    return { ...d, auditLog: isArray(d.auditLog) ? d.auditLog : [] };
  } catch (_) {
    return null;
  }
}

/** Įrašo duomenų rinkinį. Klaidą (pilna saugykla ir pan.) meta aukštyn – naudotojui turi būti pasakyta. */
export function writeLocalDataset(storage, dataset) {
  if (!storage) throw new Error('Naršyklės saugykla nepasiekiama.');
  storage.setItem(LOCAL_KEY, JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), dataset }));
}

export function clearLocalDataset(storage) {
  if (!storage) return;
  try { storage.removeItem(LOCAL_KEY); } catch (_) { /* nieko */ }
}

/** Ar vietiniame rinkinyje yra ką nors, ką įvedė administratorius (žaidėjai, komandos ar pakeisti turnyrų statusai). */
export function hasLocalData(dataset) {
  if (!dataset) return false;
  return dataset.players.length > 0 || dataset.participations.length > 0
    || dataset.tournaments.some((t) => t.status && t.status !== 'planned');
}
