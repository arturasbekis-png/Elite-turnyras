// Generuoja supabase/seed.sql iš ranking/events.js ir ranking/config.js (vienas šaltinis).
// Naudojimas: npm run seed
// Sėkloje NĖRA žaidėjų, komandų ar rezultatų – tik sezonas ir kalendoriaus renginiai.

import { SEASON_EVENTS, SEASON_ID } from '../ranking/events.js';
import { DEFAULT_SEASONS } from '../ranking/config.js';

const q = (value) => (value == null ? 'null' : `'${String(value).replace(/'/g, "''")}'`);
const season = DEFAULT_SEASONS.find((s) => s.id === SEASON_ID);

const lines = [];
lines.push('-- SUGENERUOTA: npm run seed (nuo ranking/events.js). Rankiniu būdu nekeisti.');
lines.push('-- Sėkloje nėra žaidėjų ar rezultatų. Paleidžiama po schema.sql; pakartotinai paleisti saugu.');
lines.push('');
lines.push('insert into public.seasons (id, label, is_current, scoring_version)');
lines.push(`values (${q(season.id)}, ${q(season.label)}, ${season.isCurrent}, ${q(season.scoringVersion)})`);
lines.push('on conflict (id) do nothing;');
lines.push('');
lines.push('insert into public.tournaments (id, season_id, event_type, number, name, event_date, start_time, status, allow_ties) values');
lines.push(SEASON_EVENTS.map((e) => `  (${q(e.id)}, ${q(e.seasonId)}, ${q(e.type)}, ${e.number == null ? 'null' : e.number}, ${q(e.name)}, ${q(e.date)}, ${q(e.startTime)}, 'planned', ${e.allowTies})`).join(',\n'));
lines.push('on conflict (id) do nothing;');
lines.push('');
process.stdout.write(lines.join('\n'));
