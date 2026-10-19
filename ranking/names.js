// Žaidėjų vardų pagalbinės funkcijos: sutvarkymas, sujungimas, panašumo paieška dublikatams.
// Galutinę tikrą taisyklę (abu laukai privalomi, full_name = vardas + pavardė) užtikrina duomenų bazė
// (supabase/schema.sql, trigeris players_sync_name); čia – patogi patikra naudotojui.

import { fold } from './view.js';

/** Sutvarko tarpus: nuima pradžios/pabaigos ir sutraukia pasikartojančius. */
export const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Grąžina { firstName, lastName, fullName } arba null, jei trūksta vardo ar pavardės. */
export function buildName(firstName, lastName) {
  const f = collapse(firstName);
  const l = collapse(lastName);
  if (!f || !l) return null;
  return { firstName: f, lastName: l, fullName: `${f} ${l}` };
}

/** Senų įrašų (be atskirų laukų) vardą skaido pagal pirmą tarpą. */
export function splitFullName(fullName) {
  const c = collapse(fullName);
  const i = c.indexOf(' ');
  return i < 0 ? { firstName: c, lastName: '' } : { firstName: c.slice(0, i), lastName: c.slice(i + 1) };
}

/** Vardas ir pavardė redagavimo formai (naudoja atskirus laukus, jei jie yra). */
export function nameParts(player) {
  if (player.firstName && player.lastName) return { firstName: player.firstName, lastName: player.lastName };
  return splitFullName(player.fullName);
}

const tokens = (value) => fold(collapse(value)).split(' ').filter(Boolean).sort().join(' ');

/**
 * Ar du vardai gali būti tas pats žmogus: sutampa neatsižvelgiant į didžiąsias raides, lietuviškas
 * diakritines žymes, tarpus ir žodžių tvarką („Jonas Jonaitis“ = „jonaitis JONAS“ = „Jonas Jonaitís“).
 */
export function namesAlike(a, b) {
  const x = fold(collapse(a));
  const y = fold(collapse(b));
  return x === y || tokens(a) === tokens(b);
}
