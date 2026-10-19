// Duomenų bazės testai (saugumas, patvirtinimas, pataisymai, išlikimas).
// Vykdomi ant tikro PostgreSQL. Jei jis nepasiekiamas, testai praleidžiami (aiškiai pažymima).
//
// Paleidimas:  ELITE_TEST_PG_HOST=/kelias/iki/socket ELITE_TEST_PG_PORT=5432 npm test
// Neprivalomai: ELITE_TEST_PG_RESTART='komanda' – serverio perkrovimui (patikrina duomenų išlikimą).
//
// Svarbu: tai paprastas PostgreSQL su `auth` imitacija (tests/sql/supabase-shim.sql), o ne tikras
// Supabase projektas. Jis įrodo RLS, teisių ir funkcijų logiką, bet NE Supabase Auth / PostgREST integracijos.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizePublicData } from '../ranking/api.js';
import { computeRankings } from '../ranking/engine.js';

const HOST = process.env.ELITE_TEST_PG_HOST;
const PORT = process.env.ELITE_TEST_PG_PORT || '5432';
const USER = process.env.ELITE_TEST_PG_USER || 'postgres';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

function run(db, sql, { role, sub, email } = {}) {
  let input = '';
  if (role) {
    const claims = JSON.stringify({ role, sub: sub || '', email: email || '' }).replace(/'/g, "''");
    input += `set role ${role};\ndo $c$ begin perform set_config('request.jwt.claims', '${claims}', false); end $c$;\n`;
  }
  input += sql;
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const psqlAvailable = HOST && spawnSync('psql', ['--version']).status === 0;
const skip = psqlAvailable ? false : 'PostgreSQL nepasiekiamas (nenurodytas ELITE_TEST_PG_HOST) – DB testai praleisti';

const DB = `elite_test_${process.pid}_${Date.now()}`;
const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const asAdmin = (sql) => run(DB, sql, { role: 'authenticated', sub: ADMIN, email: 'admin@example.test' });
const asUser = (sql) => run(DB, sql, { role: 'authenticated', sub: USER_ID, email: 'user@example.test' });
const asAnon = (sql) => run(DB, sql, { role: 'anon' });
const asOwner = (sql) => run(DB, sql);

const E1 = '2026-2027-elite-1';
const C1 = '2026-2027-challenge-1';
const E2 = '2026-2027-elite-2';
const SEASON = '2026-2027';
const ids = {};
const entries = (list) => JSON.stringify(list.map(([position, names]) => ({ position, playerIds: names.map((n) => ids[n]) }))).replace(/'/g, "''");
const save = (t, list, status = 'draft') => asAdmin(`select public.admin_save_results('${t}', '${entries(list)}'::jsonb, '${status}')::text;`);
const publicJson = (who = asAnon) => {
  const r = who('select public.public_ranking_data()::text;');
  assert.ok(r.ok, r.err);
  const parsed = JSON.parse(r.out);
  delete parsed.generatedAt;
  return parsed;
};
const rankings = () => computeRankings(normalizePublicData(publicJson()), { seasonId: SEASON });
const pointsOf = (rows, name) => (rows.find((r) => r.name === name) || {}).points;

test('DB paruošimas: shim + schema.sql (du kartus) + seed', { skip }, () => {
  const create = run('postgres', `create database ${DB};`);
  assert.ok(create.ok, create.err);
  const files = [join(here, 'sql', 'supabase-shim.sql'), join(root, 'supabase', 'schema.sql'), join(root, 'supabase', 'schema.sql'), join(root, 'supabase', 'seed.sql')];
  for (const f of files) {
    const r = asOwner(readFileSync(f, 'utf8'));
    assert.ok(r.ok, `${f}: ${r.err}`);
  }
  const setup = asOwner(`
    insert into auth.users (id, email) values ('${ADMIN}', 'admin@example.test'), ('${USER_ID}', 'user@example.test');
    insert into public.admins (user_id, note) values ('${ADMIN}', 'testinis administratorius');`);
  assert.ok(setup.ok, setup.err);
});

// ───────── TEST L — saugumas ─────────
test('L: anoniminis lankytojas neturi tiesioginės prieigos prie lentelių', { skip }, () => {
  for (const table of ['players', 'tournaments', 'seasons', 'participations', 'participation_players', 'audit_log', 'admins']) {
    const r = asAnon(`select count(*) from public.${table};`);
    assert.equal(r.ok, false, `anon galėjo skaityti ${table}`);
    assert.match(r.err, /permission denied/i);
  }
  assert.equal(asAnon(`insert into public.players (full_name) values ('Įsilaužėlis');`).ok, false);
});

test('L: anoniminis lankytojas negali kviesti administratoriaus funkcijų', { skip }, () => {
  const calls = [
    `select public.admin_finalize_tournament('${E1}');`,
    `select public.admin_save_results('${E1}', '[]'::jsonb);`,
    `select public.admin_correct_results('${E1}', '[]'::jsonb, 'bandymas');`,
    `select public.admin_merge_players(gen_random_uuid(), gen_random_uuid());`,
    `select public.admin_upsert_season('x', 'x', false);`,
    `select public._apply_entries('${E1}', '[]'::jsonb);`,
    `select public._validate_results('${E1}');`,
  ];
  for (const sql of calls) {
    const r = asAnon(sql);
    assert.equal(r.ok, false, sql);
    assert.match(r.err, /permission denied/i, sql);
  }
});

test('L: prisijungęs, bet NE administratorius – negali nieko skaityti ar keisti', { skip }, () => {
  assert.equal(asUser('select count(*) from public.tournaments;').out, '0', 'RLS paslepia eilutes');
  assert.equal(asUser('select count(*) from public.audit_log;').out, '0');
  for (const sql of [
    `select public.admin_save_results('${E1}', '[]'::jsonb);`,
    `select public.admin_finalize_tournament('${E1}');`,
    `select public.admin_merge_players(gen_random_uuid(), gen_random_uuid());`,
    `select public.admin_upsert_tournament('x', '${SEASON}', 'elite', 9, 'X', '2027-01-01');`,
  ]) {
    const r = asUser(sql);
    assert.equal(r.ok, false, sql);
    assert.match(r.err, /not_authorized/, sql);
  }
  const insert = asUser(`insert into public.players (full_name) values ('Neteisėtas');`);
  assert.equal(insert.ok, false);
  assert.match(insert.err, /row-level security/i);
});

test('L: is_admin() atskiria administratorių nuo paprasto naudotojo ir anoniminio lankytojo', { skip }, () => {
  assert.equal(asAdmin('select public.is_admin();').out, 't');
  assert.equal(asUser('select public.is_admin();').out, 'f');
  const anon = asAnon('select public.is_admin();');
  assert.equal(anon.ok, false);
  assert.match(anon.err, /permission denied/i);
});

test('L: net administratorius negali apeiti taisyklių tiesioginiu rašymu', { skip }, () => {
  const attempts = [
    `update public.tournaments set status = 'finalized' where id = '${E1}';`,
    `insert into public.participations (tournament_id, final_position) values ('${E1}', 1);`,
    `insert into public.participation_players (participation_id, tournament_id, player_id, slot) values (gen_random_uuid(), '${E1}', gen_random_uuid(), 1);`,
    `delete from public.audit_log;`,
    `update public.audit_log set reason = 'x';`,
    `insert into public.admins (user_id) values ('${USER_ID}');`,
    `insert into public.seasons (id, label) values ('hack', 'hack');`,
  ];
  for (const sql of attempts) {
    const r = asAdmin(sql);
    assert.equal(r.ok, false, sql);
    assert.match(r.err, /permission denied/i, sql);
  }
  const owner = asOwner(`insert into public.audit_log (action) values ('x'); update public.audit_log set reason = 'x';`);
  assert.equal(owner.ok, false);
  assert.match(owner.err, /audit_log_immutable/, 'audito žurnalas nekeičiamas net savininkui');
});

// ───────── Pradinė būsena ─────────
test('Pradinė būsena: viešai matomas kalendorius, bet nėra nei žaidėjų, nei rezultatų', { skip }, () => {
  const data = publicJson();
  assert.equal(data.tournaments.length, 19);
  assert.equal(data.participations.length, 0);
  assert.equal(data.players.length, 0);
  assert.equal(data.seasons.length, 1);
  assert.ok(data.tournaments.every((t) => t.status === 'planned'));
  assert.equal(rankings().overall.length, 0);
});

test('Administratorius kuria žaidėjus; vardo pataisymas nekuria dublikato', { skip }, () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Dup'];
  const r = asAdmin(`insert into public.players (full_name) values ${names.map((n) => `('Testinis ${n}')`).join(', ')};`);
  assert.ok(r.ok, r.err);
  const list = asAdmin(`select full_name || '=' || id from public.players order by full_name;`);
  list.out.split('\n').forEach((line) => { const [name, id] = line.split('='); ids[name.replace('Testinis ', '')] = id; });
  assert.equal(Object.keys(ids).length, 9);
  const rename = asAdmin(`update public.players set full_name = 'Testinis Dup (pataisyta)' where id = '${ids.Dup}'; select count(*) from public.players;`);
  assert.ok(rename.ok, rename.err);
  assert.equal(rename.out, '9');
  // merged_into tiesiogiai keisti negalima (tik per sujungimo funkciją)
  assert.equal(asAdmin(`update public.players set merged_into = '${ids.A}' where id = '${ids.Dup}';`).ok, false);
});

// ───────── TEST F / G — juodraštis ir patvirtinimas ─────────
test('F: juodraščio rezultatai nematomi viešai ir neturi įtakos reitingui', { skip }, () => {
  const r = save(E1, [[1, ['A', 'B']], [1, ['C', 'D']], [3, ['E', 'F']]]);
  assert.ok(r.ok, r.err);
  const data = publicJson();
  assert.equal(data.participations.length, 0, 'juodraštis neviešinamas');
  assert.equal(data.players.length, 0);
  assert.equal(data.tournaments.find((t) => t.id === E1).status, 'draft');
  assert.equal(rankings().overall.length, 0);
});

test('G: neteisingų rezultatų patvirtinti negalima (duplikuota vieta), būsena nesikeičia', { skip }, () => {
  const r = asAdmin(`select public.admin_finalize_tournament('${E1}');`);
  assert.equal(r.ok, false);
  assert.match(r.err, /validation_failed/);
  assert.match(r.err, /duplicate_position/);
  assert.equal(publicJson().tournaments.find((t) => t.id === E1).status, 'draft');
  assert.equal(rankings().overall.length, 0);
});

test('G: patvirtinus, taškai paskelbiami teisingai ir lygiai vieną kartą', { skip }, () => {
  assert.ok(save(E1, [[1, ['A', 'B']], [2, ['C', 'D']], [3, ['E', 'F']]]).ok);
  const fin = asAdmin(`select public.admin_finalize_tournament('${E1}')::text;`);
  assert.ok(fin.ok, fin.err);

  const data = publicJson();
  assert.equal(data.participations.length, 3);
  assert.equal(data.players.length, 6);
  const t = data.tournaments.find((x) => x.id === E1);
  assert.equal(t.status, 'finalized');
  assert.equal(t.scoringVersion, 'v1', 'išsaugota taškų lentelės versija');

  const { overall, categories } = rankings();
  assert.equal(pointsOf(overall, 'Testinis A'), 50);
  assert.equal(pointsOf(overall, 'Testinis B'), 50, 'abu poros nariai gauna visus taškus');
  assert.equal(pointsOf(overall, 'Testinis C'), 40);
  assert.equal(pointsOf(overall, 'Testinis E'), 32);
  assert.equal(pointsOf(categories.elite, 'Testinis A'), 50);

  // Antras paskelbimas
  const again = asAdmin(`select public.admin_finalize_tournament('${E1}');`);
  assert.equal(again.ok, false);
  assert.match(again.err, /already_finalized/);
  assert.equal(pointsOf(rankings().overall, 'Testinis A'), 50, 'taškai nesidubliuoja');
  assert.equal(asOwner(`select count(*) from public.audit_log where action = 'finalize' and tournament_id = '${E1}';`).out, '1');
  // Patvirtinto turnyro juodraščio perrašyti negalima
  const overwrite = save(E1, [[1, ['C', 'D']], [2, ['A', 'B']]]);
  assert.equal(overwrite.ok, false);
  assert.match(overwrite.err, /tournament_finalized/);
});

// ───────── TEST I — dubliavimo prevencija ─────────
test('I: žaidėjas negali būti dviejose to paties turnyro komandose; nesėkmė nieko nekeičia', { skip }, () => {
  assert.ok(save(C1, [[1, ['G', 'H']], [2, ['A', 'C']]]).ok);
  const bad = save(C1, [[1, ['G', 'H']], [2, ['G', 'A']]]);
  assert.equal(bad.ok, false);
  assert.match(bad.err, /player_in_two_teams/);
  const rows = asAdmin(`select count(*) from public.participations where tournament_id = '${C1}';`);
  assert.equal(rows.out, '2', 'ankstesnis juodraštis išliko (operacija atšaukta)');
  const unknown = asAdmin(`select public.admin_save_results('${C1}', '[{"position":1,"playerIds":["${ids.G}","99999999-9999-9999-9999-999999999999"]}]'::jsonb);`);
  assert.equal(unknown.ok, false);
  assert.match(unknown.err, /unknown_player/);
  // fiziškai: ta pats žaidėjas nei per kitą kelią negali patekti dukart
  assert.equal(asOwner(`select count(*) from (select tournament_id, player_id from public.participation_players group by 1, 2 having count(*) > 1) d;`).out, '0');
});

test('G: juodraštis su nepilna komanda nepatvirtinamas', { skip }, () => {
  const half = asAdmin(`select public.admin_save_results('${C1}', '[{"position":1,"playerIds":["${ids.G}"]},{"position":2,"playerIds":["${ids.A}","${ids.C}"]}]'::jsonb);`);
  assert.ok(half.ok, half.err);
  const r = asAdmin(`select public.admin_finalize_tournament('${C1}');`);
  assert.equal(r.ok, false);
  assert.match(r.err, /team_needs_two_players/);
});

// ───────── TEST H — pataisymas ─────────
test('H: pataisymas reikalauja priežasties, o netinkamas pataisymas oficialių rezultatų nepakeičia', { skip }, () => {
  const before = publicJson();
  const noReason = asAdmin(`select public.admin_correct_results('${E1}', '${entries([[1, ['C', 'D']], [2, ['A', 'B']], [3, ['E', 'F']]])}'::jsonb, '');`);
  assert.equal(noReason.ok, false);
  assert.match(noReason.err, /reason_required/);
  const invalid = asAdmin(`select public.admin_correct_results('${E1}', '${entries([[1, ['C', 'D']], [1, ['A', 'B']], [3, ['E', 'F']]])}'::jsonb, 'Bandymas su klaida');`);
  assert.equal(invalid.ok, false);
  assert.match(invalid.err, /validation_failed/);
  assert.deepEqual(publicJson(), before, 'oficialūs rezultatai nepakito');
  const draftFirst = asAdmin(`select public.admin_correct_results('${C1}', '[]'::jsonb, 'nepaskelbtas turnyras');`);
  assert.equal(draftFirst.ok, false);
  assert.match(draftFirst.err, /not_finalized/);
});

test('H: tinkamas pataisymas perskaičiuoja visas sumas be dubliavimo ir palieka auditą', { skip }, () => {
  const fix = asAdmin(`select public.admin_correct_results('${E1}', '${entries([[2, ['A', 'B']], [1, ['C', 'D']], [3, ['E', 'F']]])}'::jsonb, 'Finalo vietos buvo sukeistos')::text;`);
  assert.ok(fix.ok, fix.err);
  assert.equal(JSON.parse(fix.out).revision, 2);
  const { overall } = rankings();
  assert.equal(pointsOf(overall, 'Testinis A'), 40);
  assert.equal(pointsOf(overall, 'Testinis C'), 50);
  assert.equal(pointsOf(overall, 'Testinis E'), 32);
  assert.equal(overall.reduce((s, r) => s + r.points, 0), 2 * (50 + 40 + 32), 'taškai nesidubliuoja');
  const audit = asAdmin(`select reason || ' | ' || (before -> 0 ->> 'position') || ' | ' || (after -> 0 ->> 'position') from public.audit_log where action = 'correct' and tournament_id = '${E1}';`);
  assert.match(audit.out, /Finalo vietos buvo sukeistos/);
  assert.equal(asOwner(`select revision from public.tournaments where id = '${E1}';`).out, '2');
  assert.equal(asOwner(`select actor_email from public.audit_log where action = 'correct';`).out, 'admin@example.test');
});

// ───────── Lygios vietos ─────────
test('Lygių vietų taisyklė DB lygmeniu sutampa su kliento validacija', { skip }, () => {
  const strict = save(E2, [[1, ['A', 'B']], [2, ['C', 'D']], [2, ['E', 'F']], [4, ['G', 'H']]]);
  assert.ok(strict.ok, strict.err);
  const denied = asAdmin(`select public.admin_finalize_tournament('${E2}');`);
  assert.equal(denied.ok, false, 'lygios vietos neleidžiamos pagal nutylėjimą');
  assert.match(denied.err, /duplicate_position/);

  const allow = asAdmin(`select public.admin_upsert_tournament('${E2}', '${SEASON}', 'elite', 2, 'ELITE #2', '2026-11-08', '11:00', true);`);
  assert.ok(allow.ok, allow.err);
  assert.ok(save(E2, [[1, ['A', 'B']], [2, ['C', 'D']], [2, ['E', 'F']], [3, ['G', 'H']]]).ok);
  const wrong = asAdmin(`select public.admin_finalize_tournament('${E2}');`);
  assert.equal(wrong.ok, false);
  assert.match(wrong.err, /invalid_tie_positions/);
  assert.ok(save(E2, [[1, ['A', 'B']], [2, ['C', 'D']], [2, ['E', 'F']], [4, ['G', 'H']]]).ok);
  const ok = asAdmin(`select public.admin_finalize_tournament('${E2}');`);
  assert.ok(ok.ok, ok.err);
  const { overall } = rankings();
  assert.equal(pointsOf(overall, 'Testinis G'), 26, 'ketvirta vieta – 26');
});

// ───────── Žaidėjų sujungimas ─────────
test('Žaidėjų sujungimas: istorija ir taškai išlieka, konfliktai atmetami', { skip }, () => {
  // Dup žaidė CHALLENGE #1 (vietoje G), pagrindinis G – ELITE #2. Tai teisėtas sujungimas.
  assert.ok(save(C1, [[1, ['Dup', 'H']], [2, ['A', 'C']]]).ok);
  assert.ok(asAdmin(`select public.admin_finalize_tournament('${C1}');`).ok);
  const before = rankings();
  const totalBefore = before.overall.reduce((s, r) => s + r.points, 0);
  const dupName = 'Testinis Dup (pataisyta)';
  assert.equal(pointsOf(before.overall, dupName), 40);
  assert.equal(pointsOf(before.overall, 'Testinis G'), 26);

  const conflict = asAdmin(`select public.admin_merge_players('${ids.G}', '${ids.H}', 'testas');`);
  assert.equal(conflict.ok, false);
  assert.match(conflict.err, /merge_conflict/);
  assert.equal(asAdmin(`select public.admin_merge_players('${ids.G}', '${ids.G}');`).ok, false);

  const merged = asAdmin(`select public.admin_merge_players('${ids.G}', '${ids.Dup}', 'Dublikatas')::text;`);
  assert.ok(merged.ok, merged.err);
  const after = rankings();
  assert.equal(pointsOf(after.overall, 'Testinis G'), 26 + 40, 'ELITE #2 + CHALLENGE #1');
  assert.equal(pointsOf(after.overall, dupName), undefined);
  assert.equal(after.overall.reduce((s, r) => s + r.points, 0), totalBefore, 'bendra taškų suma nepasikeitė');
  assert.ok(publicJson().players.every((p) => p.id !== ids.Dup), 'dublikatas viešai nerodomas');
  assert.equal(asOwner(`select merged_into::text || ',' || is_active from public.players where id = '${ids.Dup}';`).out, `${ids.G},false`);
  assert.equal(asAdmin(`select public.admin_merge_players('${ids.A}', '${ids.Dup}');`).ok, false, 'jau sujungto įrašo kartotinai sujungti negalima');
});

// ───────── TEST K — išlikimas ir nuoseklumas ─────────
test('K: skirtingi lankytojai mato tą patį reitingą', { skip }, () => {
  const visitor1 = publicJson(asAnon);
  const visitor2 = publicJson(asAnon);
  const loggedUser = publicJson(asUser);
  assert.deepEqual(visitor1, visitor2);
  assert.deepEqual(visitor1, loggedUser, 'neadministratorius mato tą patį');
  assert.deepEqual(rankings().overall.map((r) => [r.name, r.points, r.position]), rankings().overall.map((r) => [r.name, r.points, r.position]));
});

test('K: oficialūs rezultatai išlieka po DB serverio perkrovimo', { skip: skip || (process.env.ELITE_TEST_PG_RESTART ? false : 'nenurodytas ELITE_TEST_PG_RESTART – perkrovimo testas praleistas') }, () => {
  const before = publicJson();
  const ranking = rankings().overall.map((r) => [r.name, r.points, r.position]);
  execSync(process.env.ELITE_TEST_PG_RESTART, { stdio: 'pipe' });
  for (let i = 0; i < 40; i++) {
    if (spawnSync('pg_isready', ['-h', HOST, '-p', PORT]).status === 0) break;
    spawnSync('sleep', ['0.5']);
  }
  assert.deepEqual(publicJson(), before);
  assert.deepEqual(rankings().overall.map((r) => [r.name, r.points, r.position]), ranking);
});

test('Atnaujinus schema.sql (naujas diegimas) duomenys nepraranda', { skip }, () => {
  const before = publicJson();
  const r = asOwner(readFileSync(join(root, 'supabase', 'schema.sql'), 'utf8') + readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'));
  assert.ok(r.ok, r.err);
  assert.deepEqual(publicJson(), before);
});

test('DB valymas', { skip }, () => {
  const r = run('postgres', `drop database ${DB} with (force);`);
  assert.ok(r.ok, r.err);
});
