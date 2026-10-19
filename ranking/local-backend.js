// Vietinio režimo „serveris“: ta pati logika kaip ranking/memory-backend.js (tos pačios taisyklės, tas pats variklis),
// tik po kiekvieno rašymo duomenys išsaugomi šios naršyklės localStorage.
// SVARBU: tai NĖRA bendra duomenų bazė. Niekas, ką čia įvedate, nepasiekia kitų lankytojų.

import { createMemoryBackend } from './memory-backend.js';
import { ApiError } from './api.js';
import { withCalendar } from './view.js';
import { readLocalDataset, writeLocalDataset, emptyDataset } from './local-store.js';

const PASSTHROUGH = new Set(['loadAdminDataset', 'listAudit', 'getSession', 'configured', 'isSignedIn', 'isAdmin', 'restoreSession', 'signIn', 'signOut']);

export function createLocalBackend({ storage = null } = {}) {
  const saved = readLocalDataset(storage);
  const memory = createMemoryBackend(withCalendar(saved || emptyDataset()), { actor: 'vietinis režimas' });
  const backend = { ...memory, kind: 'local', local: true, persistent: Boolean(storage), restored: Boolean(saved) };

  async function persist() {
    if (!storage) return; // be saugyklos duomenys gyvena tik šiame puslapyje – UI apie tai perspėja
    const dataset = await memory.loadAdminDataset();
    try {
      writeLocalDataset(storage, dataset);
    } catch (_) {
      throw new ApiError('local_storage_failed', 'Pakeitimas atliktas, bet jo nepavyko išsaugoti šioje naršyklėje (saugykla pilna ar išjungta). Atsisiųskite CSV ir nebeuždarykite puslapio.');
    }
  }

  for (const [name, fn] of Object.entries(memory)) {
    if (typeof fn !== 'function' || PASSTHROUGH.has(name)) continue;
    backend[name] = async (...args) => {
      const result = await fn(...args);
      await persist();
      return result;
    };
  }
  return backend;
}
