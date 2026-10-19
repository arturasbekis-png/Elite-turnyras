// Oficialių rezultatų įkėlimas iš STATINIO failo (data/official-results.json), kai Supabase neprijungtas.
// Failas saugomas saugykloje ir skelbiamas kartu su svetaine, todėl VISI lankytojai mato tuos pačius rezultatus.
// Failas taškų nesaugo: juos visada skaičiuoja ranking/engine.js (viena taisyklių vieta).
// Vietinė naršyklės saugykla (localStorage) čia NIEKADA nenaudojama.

import { validateResults } from './engine.js';

export const STATIC_RESULTS_URL = new URL('../data/official-results.json', import.meta.url).href;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Patikrina ir normalizuoja failą į variklio duomenų rinkinį. Pasikartojantys įrašai (tas pats ID) atmetami –
 * pakartotinis įkėlimas ar dvigubas įrašas taškų nedubliuoja. Netinkamas failas → klaida (nerodomi sugadinti rezultatai).
 */
export function normalizeStaticResults(doc) {
  const problems = [];
  if (!isObj(doc) || doc.schemaVersion !== 1) throw new Error('Rezultatų failas netinkamo formato (schemaVersion).');
  for (const k of ['tournaments', 'players', 'participations']) if (!Array.isArray(doc[k])) problems.push(`trūksta sąrašo „${k}“`);
  if (problems.length) throw new Error(`Rezultatų failas netinkamas: ${problems.join('; ')}.`);

  const uniqueById = (list, label) => {
    const seen = new Set();
    return list.filter((item) => {
      if (!isObj(item) || !item.id) { problems.push(`${label}: įrašas be ID`); return false; }
      if (seen.has(item.id)) return false; // dublikatas – ignoruojamas (pirmas laimi)
      seen.add(item.id);
      return true;
    });
  };
  const players = uniqueById(doc.players, 'žaidėjas').map((p) => ({
    id: p.id, fullName: String(p.fullName || '').trim(), gender: p.gender || null, isActive: true, mergedInto: null, nameStatus: p.nameStatus || null,
  }));
  const tournaments = uniqueById(doc.tournaments, 'turnyras').map((t) => ({ ...t, startTime: t.startTime || '11:00' }));
  const participations = uniqueById(doc.participations, 'komanda');

  const playerIds = new Set(players.map((p) => p.id));
  const tournamentIds = new Set(tournaments.map((t) => t.id));
  players.forEach((p) => { if (!p.fullName) problems.push(`žaidėjas ${p.id} be vardo`); });
  participations.forEach((p) => {
    if (!tournamentIds.has(p.tournamentId)) problems.push(`komanda ${p.id}: nežinomas turnyras`);
    (p.playerIds || []).forEach((id) => { if (!playerIds.has(id)) problems.push(`komanda ${p.id}: nežinomas žaidėjas ${id}`); });
  });
  for (const t of tournaments) {
    const parts = participations.filter((p) => p.tournamentId === t.id);
    const result = validateResults({ tournament: t, participations: parts, players });
    result.errors.forEach((e) => problems.push(`${t.name || t.id}: ${e.message}`));
  }
  if (problems.length) throw new Error(`Rezultatų failas netinkamas: ${problems.join('; ')}`);

  return {
    seasons: [], tournaments, players, participations,
    generatedAt: doc.publishedAt || null,
    notes: Array.isArray(doc.notes) ? doc.notes.map(String) : [],
  };
}

/** Įkelia failą. `fetchFn` leidžia testuose pakeisti tinklą. `no-cache` – kad lankytojas visada gautų naujausią versiją. */
export async function loadStaticResults({ fetchFn = globalThis.fetch, url = STATIC_RESULTS_URL } = {}) {
  if (typeof fetchFn !== 'function') throw new Error('Naršyklė nepalaiko duomenų įkėlimo.');
  let res;
  try {
    res = await fetchFn(url, { cache: 'no-cache' });
  } catch (_) {
    throw new Error('Nepavyko įkelti oficialių rezultatų failo. Patikrinkite interneto ryšį ir bandykite dar kartą.');
  }
  if (!res || !res.ok) throw new Error('Oficialių rezultatų failo nepavyko gauti (serveris atsakė klaida). Bandykite vėliau.');
  let doc;
  try { doc = await res.json(); } catch (_) { throw new Error('Oficialių rezultatų failas sugadintas.'); }
  return normalizeStaticResults(doc);
}
