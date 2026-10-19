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
  assert.equal(asAnon(`insert into public.players (first_name, last_name) values ('Įsilaužėlis', 'Anonimas');`).ok, false);
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
  const insert = asUser(`insert into public.players (first_name, last_name) values ('Neteisėtas', 'Naudotojas');`);
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
  const r = asAdmin(`insert into public.players (first_name, last_name) values ${names.map((n) => `('Testinis', '${n}')`).join(', ')};`);
  assert.ok(r.ok, r.err);
  const list = asAdmin(`select full_name || '=' || id from public.players order by full_name;`);
  list.out.split('\n').forEach((line) => { const [name, id] = line.split('='); ids[name.replace('Testinis ', '')] = id; });
  assert.equal(Object.keys(ids).length, 9);
  const rename = asAdmin(`update public.players set last_name = 'Dup (pataisyta)' where id = '${ids.Dup}'; select count(*) from public.players;`);
  assert.ok(rename.ok, rename.err);
  assert.equal(rename.out, '9');
  assert.equal(asOwner(`select full_name from public.players where id = '${ids.Dup}';`).out, 'Testinis Dup (pataisyta)', 'ID tas pats, pilnas vardas perskaičiuotas');
  // merged_into tiesiogiai keisti negalima (tik per sujungimo funkciją)
  assert.equal(asAdmin(`update public.players set merged_into = '${ids.A}' where id = '${ids.Dup}';`).ok, false);
});

test('Vardas ir pavardė: serveris apskaičiuoja full_name, atmeta tuščius, neleidžia rašyti full_name tiesiogiai', { skip }, () => {
  const ok = asAdmin(`insert into public.players (first_name, last_name) values ('  Žygimantas ', 'Šimkus  ') returning first_name || '|' || last_name || '|' || full_name;`);
  assert.ok(ok.ok, ok.err);
  assert.equal(ok.out.split('\n')[0], 'Žygimantas|Šimkus|Žygimantas Šimkus', 'tarpai sutvarkyti, lietuviškos raidės išsaugotos');
  const blankLast = asAdmin(`insert into public.players (first_name, last_name) values ('Vardas', '   ');`);
  assert.equal(blankLast.ok, false);
  assert.match(blankLast.err, /invalid_name/);
  assert.equal(asAdmin(`insert into public.players (first_name, last_name) values ('', 'Pavardė');`).ok, false, 'tuščias vardas');
  assert.equal(asAdmin(`insert into public.players (gender) values ('M');`).ok, false, 'be vardo negalima');
  const direct = asAdmin(`insert into public.players (full_name) values ('Tiesioginis Vardas');`);
  assert.equal(direct.ok, false, 'full_name tiesiogiai rašyti negalima');
  assert.match(direct.err, /permission denied/i);
  assert.equal(asAdmin(`update public.players set full_name = 'Apgaulė' where first_name = 'Žygimantas';`).ok, false);
  // Pataisius vardą ID nesikeičia
  const before = asOwner(`select id from public.players where last_name = 'Šimkus';`).out;
  const upd = asAdmin(`update public.players set first_name = 'Žygis' where last_name = 'Šimkus';`);
  assert.ok(upd.ok, upd.err);
  assert.equal(asOwner(`select id::text || '|' || full_name from public.players where last_name = 'Šimkus';`).out, `${before}|Žygis Šimkus`);
  // Išvalome, kad vėlesni testai matytų tik savo žaidėjus
  assert.ok(asOwner(`delete from public.players where last_name = 'Šimkus';`).ok);
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

// ───────── Teisių auditas (struktūra, ne tik elgesys) ─────────
test('Teisių auditas: RLS visose lentelėse, anon/authenticated teisės minimalios, funkcijos užrakintos', { skip }, () => {
  const tables = ['admins', 'seasons', 'tournaments', 'players', 'participations', 'participation_players', 'audit_log'];
  assert.equal(asOwner(`select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';`).out, String(tables.length), 'public schemoje tik žinomos lentelės');
  assert.equal(asOwner(`select coalesce(string_agg(relname, ','), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;`).out, '', 'RLS įjungtas visose lentelėse');

  const priv = (role, table, p) => asOwner(`select has_table_privilege('${role}', 'public.${table}', '${p}');`).out;
  for (const t of tables) {
    assert.equal(priv('anon', t, 'select,insert,update,delete,truncate,references,trigger'), 'f', `anon neturi jokių teisių: ${t}`);
    assert.equal(priv('authenticated', t, 'delete,truncate,references,trigger'), 'f', `authenticated negali trinti: ${t}`);
    assert.equal(priv('authenticated', t, 'select'), 't', `authenticated gali skaityti (RLS: tik adminai): ${t}`);
    if (t !== 'players') assert.equal(priv('authenticated', t, 'insert,update'), 'f', `tiesioginio rašymo nėra: ${t}`);
  }
  const col = (c, p) => asOwner(`select has_column_privilege('authenticated', 'public.players', '${c}', '${p}');`).out;
  assert.equal(col('first_name', 'insert'), 't');
  assert.equal(col('is_test', 'insert'), 't');
  assert.equal(col('is_test', 'update'), 'f', 'bandomojo požymio vėliau keisti negalima');
  for (const c of ['id', 'full_name', 'merged_into', 'created_at']) {
    assert.equal(col(c, 'insert'), 'f', `${c}: įterpti negalima`);
    assert.equal(col(c, 'update'), 'f', `${c}: keisti negalima`);
  }

  const seq = asOwner(`select pg_get_serial_sequence('public.audit_log', 'id');`).out;
  for (const role of ['anon', 'authenticated']) assert.equal(asOwner(`select has_sequence_privilege('${role}', '${seq}', 'usage,select,update');`).out, 'f', `${role}: sekos teisių nėra`);

  const anonFns = asOwner(`select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute');`).out;
  assert.equal(anonFns, 'public_ranking_data', 'anoniminis lankytojas gali kviesti tik viešą skaitymą');
  const authExtra = asOwner(`select coalesce(string_agg(p.proname, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute') and p.proname !~ '^(admin_|is_admin$|public_ranking_data$)';`).out;
  assert.equal(authExtra, '', 'vidinės funkcijos klientams neprieinamos');
  assert.equal(asOwner(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where n.nspname = 'public' and p.prokind = 'f' and a.grantee = 0 and a.privilege_type = 'EXECUTE';`).out, '0', 'PUBLIC rolei funkcijų vykdymas neleidžiamas');
  assert.equal(asOwner(`select coalesce(string_agg(p.proname, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%pg_temp%');`).out, '', 'visos SECURITY DEFINER funkcijos turi užfiksuotą search_path (su pg_temp gale)');
});

test('Lankytojas negali tapti administratoriumi nei tiesiogiai, nei per funkcijas', { skip }, () => {
  for (const who of [asUser, asAnon]) {
    assert.equal(who(`insert into public.admins (user_id) values ('${USER_ID}');`).ok, false);
    assert.equal(who(`update public.admins set note = 'x';`).ok, false);
    assert.equal(who(`delete from public.admins;`).ok, false);
  }
  assert.equal(asUser(`insert into public.admins (user_id) values ('${USER_ID}');`).ok, false);
  assert.equal(asOwner(`select count(*) from public.admins where user_id = '${USER_ID}';`).out, '0');
  assert.equal(asUser('select public.is_admin();').out, 'f');
  // net administratorius negali pridėti kito administratoriaus per API – tik savininkas SQL Editor'iuje
  assert.equal(asAdmin(`insert into public.admins (user_id) values ('${USER_ID}');`).ok, false);
});

test('make-admin.sql įgalioja tik PATVIRTINTO el. pašto naudotoją ir yra kartojamas saugiai', { skip }, () => {
  const script = readFileSync(join(root, 'supabase', 'make-admin.sql'), 'utf8');
  assert.match(script, /PAKEISKITE@JUSU-PASTAS\.lt/);
  assert.ok(asOwner(`insert into auth.users (id, email, email_confirmed_at) values ('33333333-3333-3333-3333-333333333333', 'patvirtintas@example.test', now()), ('44444444-4444-4444-4444-444444444444', 'nepatvirtintas@example.test', null);`).ok);
  const withEmail = (email) => script.replace('PAKEISKITE@JUSU-PASTAS.lt', email);
  assert.ok(asOwner(withEmail('Nepatvirtintas@Example.Test')).ok);
  assert.equal(asOwner(`select count(*) from public.admins where user_id = '44444444-4444-4444-4444-444444444444';`).out, '0', 'nepatvirtintas el. paštas neįgaliojamas');
  assert.ok(asOwner(withEmail('Patvirtintas@Example.Test')).ok, 'el. paštas nejautrus raidžių dydžiui');
  assert.ok(asOwner(withEmail('patvirtintas@example.test')).ok, 'pakartotinis paleidimas nieko nesugadina');
  assert.equal(asOwner(`select count(*) from public.admins where user_id = '33333333-3333-3333-3333-333333333333';`).out, '1');
  assert.equal(asOwner(withEmail('nera-tokio@example.test')).ok, true, 'neegzistuojantis el. paštas – tiesiog nieko neįgalioja');
  assert.equal(asOwner(`select count(*) from public.admins;`).out, '2', 'testinis administratorius + patvirtintas naudotojas');
  assert.ok(asOwner(`delete from public.admins where user_id = '33333333-3333-3333-3333-333333333333'; delete from auth.users where id in ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444');`).ok);
});

// ───────── Bandymo režimas (saugus patikrinimas realiame projekte) ─────────
test('Bandymo režimas: sukūrimas, oficialūs duomenys nepaliečiami, valymas grąžina tiksliai ankstesnę būseną', { skip }, () => {
  const E3 = '2026-2027-elite-3';
  const T = 'bandymas-elite-1';
  const officialBefore = publicJson();
  const rankingBefore = rankings().overall.map((r) => [r.name, r.points, r.position]);
  const countOwner = (sql) => asOwner(sql).out;
  const playersBefore = countOwner(`select count(*) from public.players;`);

  // Teisės: tik administratorius
  for (const fn of ['admin_create_test_season()', 'admin_delete_test_data()']) {
    const u = asUser(`select public.${fn};`);
    assert.equal(u.ok, false, fn); assert.match(u.err, /not_authorized/, fn);
    const a = asAnon(`select public.${fn};`);
    assert.equal(a.ok, false, fn); assert.match(a.err, /permission denied/i, fn);
  }
  assert.equal(countOwner(`select count(*) from public.seasons where is_test;`), '0');

  // Sukūrimas (kartojamas saugiai)
  assert.ok(asAdmin(`select public.admin_create_test_season()::text;`).ok);
  assert.ok(asAdmin(`select public.admin_create_test_season()::text;`).ok);
  assert.equal(countOwner(`select count(*) from public.tournaments where season_id = 'bandymas';`), '3');
  const withTest = publicJson();
  assert.deepEqual(withTest.seasons.map((x) => [x.id, x.isTest]).sort(), [['2026-2027', false], ['bandymas', true]]);
  assert.equal(withTest.tournaments.length, 22);
  assert.ok(withTest.seasons.every((x) => !(x.isTest && x.isCurrent)), 'bandomasis sezonas niekada nėra dabartinis');
  assert.deepEqual(rankings().overall.map((r) => [r.name, r.points, r.position]), rankingBefore, 'oficialus reitingas nepasikeitė');

  // Apsaugos nuo painiavos tarp bandomųjų ir oficialių duomenų
  const lockedSeason = asAdmin(`select public.admin_upsert_season('bandymas', 'Pakeista', true);`);
  assert.equal(lockedSeason.ok, false); assert.match(lockedSeason.err, /test_season_locked/);
  const moved = asAdmin(`select public.admin_upsert_tournament('${E3}', 'bandymas', 'elite', 3, 'ELITE #3', '2026-11-29');`);
  assert.equal(moved.ok, false); assert.match(moved.err, /test_season_locked/, 'oficialaus turnyro į bandomąjį sezoną perkelti negalima');
  assert.equal(countOwner(`select season_id from public.tournaments where id = '${E3}';`), SEASON);

  // Bandomieji žaidėjai: tik administratorius, požymis nustatomas tik kuriant
  assert.equal(asUser(`insert into public.players (first_name, last_name, is_test) values ('Svetimas', 'Bandymas', true);`).ok, false);
  const created = asAdmin(`insert into public.players (first_name, last_name, is_test) values ('Bandymas', 'Vienas', true), ('Bandymas', 'Du', true), ('Bandymas', 'Trys', true), ('Bandymas', 'Keturi', true);`);
  assert.ok(created.ok, created.err);
  asOwner(`select full_name || '=' || id from public.players where is_test order by full_name;`).out.split('\n').forEach((line, i) => { const [, id] = line.split('='); ids[`T${i + 1}`] = id; });
  // full_name tvarka: Bandymas Du, Keturi, Trys, Vienas
  assert.equal(Object.keys(ids).filter((k) => /^T\d$/.test(k)).length, 4);
  const flip = asAdmin(`update public.players set is_test = true where id = '${ids.A}';`);
  assert.equal(flip.ok, false); assert.match(flip.err, /permission denied/i, 'oficialaus žaidėjo paversti bandomuoju negalima');
  const unflip = asAdmin(`update public.players set is_test = false where id = '${ids.T1}';`);
  assert.equal(unflip.ok, false, 'bandomojo žaidėjo paversti oficialiu negalima');

  // Bandomasis žaidėjas negali patekti į oficialų turnyrą, o oficialus tinka bandomajame
  const intoOfficial = save(E3, [[1, ['T1', 'T2']], [2, ['T3', 'T4']]]);
  assert.equal(intoOfficial.ok, false); assert.match(intoOfficial.err, /test_player_in_official/);
  assert.equal(countOwner(`select count(*) from public.participations where tournament_id = '${E3}';`), '0');
  const mix = asAdmin(`select public.admin_merge_players('${ids.A}', '${ids.T1}', 'bandymas');`);
  assert.equal(mix.ok, false); assert.match(mix.err, /merge_test_mismatch/);

  // Juodraštis bandomajame turnyre viešai nematomas; paskelbus – matomas tik bandomajame sezone
  assert.ok(save(T, [[1, ['T1', 'T2']], [2, ['T3', 'T4']]]).ok);
  assert.equal(publicJson().participations.length, officialBefore.participations.length, 'juodraštis neviešinamas');
  assert.ok(asAdmin(`select public.admin_finalize_tournament('${T}')::text;`).ok);
  const published = publicJson();
  assert.equal(published.participations.length, officialBefore.participations.length + 2);
  const testRank = computeRankings(normalizePublicData(published), { seasonId: 'bandymas' }).overall;
  assert.deepEqual(testRank.slice(0, 2).map((r) => r.points), [50, 50], 'abu poros nariai gauna pilnus taškus');
  assert.equal(testRank.length, 4);
  assert.deepEqual(rankings().overall.map((r) => [r.name, r.points, r.position]), rankingBefore, 'oficialaus sezono reitingas nepasikeitė');

  // Valymas sustoja, jei bandomasis žaidėjas kažkaip atsidūrė oficialiame turnyre (tik tiesioginis DB įrašas gali tai padaryti)
  assert.ok(asOwner(`insert into public.participations (id, tournament_id, final_position) values ('00000000-0000-0000-0000-0000000000aa', '${E3}', 1);
    insert into public.participation_players (participation_id, tournament_id, player_id, slot) values ('00000000-0000-0000-0000-0000000000aa', '${E3}', '${ids.T1}', 1);`).ok);
  const blocked = asAdmin(`select public.admin_delete_test_data();`);
  assert.equal(blocked.ok, false); assert.match(blocked.err, /test_player_in_real_tournament/);
  assert.equal(countOwner(`select count(*) from public.players where is_test;`), '4', 'nesėkmė nieko neištrynė');
  assert.equal(countOwner(`select count(*) from public.seasons where is_test;`), '1');
  assert.ok(asOwner(`delete from public.participations where id = '00000000-0000-0000-0000-0000000000aa';`).ok);

  // Valymas: tik administratorius; ištrina tik bandomuosius įrašus
  assert.equal(asUser(`select public.admin_delete_test_data();`).ok, false);
  const del = asAdmin(`select public.admin_delete_test_data()::text;`);
  assert.ok(del.ok, del.err);
  assert.deepEqual(JSON.parse(del.out), { seasons: 1, tournaments: 3, teams: 2, players: 4 });
  assert.deepEqual(publicJson(), officialBefore, 'po valymo viešas atsakymas identiškas ankstesniam');
  assert.deepEqual(rankings().overall.map((r) => [r.name, r.points, r.position]), rankingBefore);
  assert.equal(countOwner(`select count(*) from public.players where is_test;`), '0');
  assert.equal(countOwner(`select count(*) from public.players;`), playersBefore, 'oficialūs žaidėjai nepaliesti');
  assert.deepEqual(JSON.parse(asAdmin(`select public.admin_delete_test_data()::text;`).out), { seasons: 0, tournaments: 0, teams: 0, players: 0 }, 'antras valymas – nieko nedaro');

  // Auditas išlieka (nekeičiamas)
  assert.equal(countOwner(`select count(*) from public.audit_log where action = 'create_test_season';`), '2');
  assert.equal(countOwner(`select count(*) from public.audit_log where action = 'delete_test_data';`), '2');
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
