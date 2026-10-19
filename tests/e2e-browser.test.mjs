// Tikras naršyklės testas (Chromium per Playwright) prieš TIKRĄ PostgreSQL su supabase/schema.sql.
//
// Kelias: naršyklė → fetch → lokalus serveris (tests/support/local-supabase.mjs: JWT, rolės, /rest/v1, /auth/v1)
//         → PostgreSQL (RLS, admin_* funkcijos).
// Tai NE Supabase projektas: PostgREST ir GoTrue čia pakeisti mažais imitatoriais. Testas įrodo, kad mūsų
// puslapiai, schema ir taisyklės veikia kartu; realaus Supabase integraciją reikia patikrinti po diegimo.
//
// Paleidimas:  ELITE_TEST_PG_HOST=/kelias/iki/socket ELITE_TEST_PG_PORT=5432 npm test
// Playwright nėra projekto priklausomybė: ieškoma globaliai (arba ELITE_TEST_PLAYWRIGHT=/kelias/iki/playwright).
// Jei trūksta PostgreSQL, Playwright ar naršyklės, testai aiškiai praleidžiami.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startLocalSupabase } from './support/local-supabase.mjs';
import { normalizePublicData } from '../ranking/api.js';
import { computeRankings } from '../ranking/engine.js';

const HOST = process.env.ELITE_TEST_PG_HOST;
const PORT = process.env.ELITE_TEST_PG_PORT || '5432';
const USER = process.env.ELITE_TEST_PG_USER || 'postgres';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SHOTS = process.env.ELITE_TEST_SCREENSHOTS || '';

function loadPlaywright() {
  const candidates = [process.env.ELITE_TEST_PLAYWRIGHT, 'playwright'];
  try { candidates.push(join(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'playwright')); } catch (_) { /* nėra npm */ }
  const req = createRequire(import.meta.url);
  for (const c of candidates.filter(Boolean)) { try { return req(c); } catch (_) { /* bandome kitą */ } }
  return null;
}

const psqlOk = HOST && spawnSync('psql', ['--version']).status === 0;
const playwright = psqlOk ? loadPlaywright() : null;
const skip = !psqlOk ? 'PostgreSQL nepasiekiamas (nenurodytas ELITE_TEST_PG_HOST) – naršyklės testai praleisti'
  : !playwright ? 'Playwright nerastas – naršyklės testai praleisti' : false;

const DB = `elite_e2e_${process.pid}_${Date.now()}`;
const ADMIN = { id: randomUUID(), email: 'admin@example.test', password: randomBytes(12).toString('hex') };
const OUTSIDER = { id: randomUUID(), email: 'outsider@example.test', password: randomBytes(12).toString('hex') };

function psql(db, sql) {
  const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-h', HOST, '-p', PORT, '-U', USER, '-d', db, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const owner = (sql) => { const r = psql(DB, sql); assert.ok(r.ok, r.err); return r.out; };

let server; let unconfigured; let browser; let site; let siteOff;
const E1 = '2026-2027-elite-1';
const C1 = '2026-2027-challenge-1';
const pid = (fullName) => owner(`select id from public.players where full_name = '${fullName.replace(/'/g, "''")}' and merged_into is null order by created_at limit 1;`);

async function newPage(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => { throw e; });
  return page;
}

async function adminLogin(page, account = ADMIN, password = account.password) {
  await page.goto(`${site}reitingai-admin.html`);
  await page.fill('#login-email', account.email);
  await page.fill('#login-password', password);
  await page.click('form[data-form="login"] button[type="submit"]');
}

async function addPlayer(page, first, last, { force = false } = {}) {
  await page.fill('#new-first', first);
  await page.fill('#new-last', last);
  await page.click('form[data-form="player"] button[type="submit"]');
  if (force) {
    await page.locator('[data-act="force-create"]').click();
  }
  await page.locator('.notice.success', { hasText: 'išsaugotas' }).waitFor();
}

// Viena eilutė = viena PORA: vardas = abu žaidėjai (abėcėlės tvarka, kad tvarka įvedime nesvarbi).
const publicRows = (page) => page.evaluate(() => [...document.querySelectorAll('.rrow')].map((li) => {
  const names = [...li.querySelectorAll('.pair-names .n')].map((n) => n.textContent.trim()).sort();
  return { name: names.join(' / '), names, points: Number(li.querySelector('.rpts b').textContent) };
}));

async function api(path, { method = 'POST', body, token } = {}) {
  const res = await fetch(`${server.origin}${path}`, {
    method,
    headers: { apikey: server.anonKey, 'Content-Type': 'application/json', Authorization: `Bearer ${token || server.anonKey}`, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { /* ne JSON */ }
  return { status: res.status, json, text };
}
async function tokenFor(account) {
  const res = await fetch(`${server.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: server.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).access_token;
}
const publicDataset = async () => {
  const r = await api('/rest/v1/rpc/public_ranking_data', { body: {} });
  assert.equal(r.status, 200, r.text);
  return normalizePublicData(r.json);
};
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true }); } };

test('E2E paruošimas: DB (shim + schema + seed), serveriai, naršyklė', { skip }, async () => {
  assert.ok(psql('postgres', `create database ${DB};`).ok);
  for (const f of [join(here, 'sql', 'supabase-shim.sql'), join(root, 'supabase', 'schema.sql'), join(root, 'supabase', 'seed.sql')]) {
    const r = psql(DB, readFileSync(f, 'utf8')); assert.ok(r.ok, `${f}: ${r.err}`);
  }
  owner(`insert into auth.users (id, email) values ('${ADMIN.id}', '${ADMIN.email}'), ('${OUTSIDER.id}', '${OUTSIDER.email}');
         insert into public.admins (user_id, note) values ('${ADMIN.id}', 'testinis administratorius');`);
  const common = { pg: { host: HOST, port: PORT, user: USER }, database: DB, staticRoot: root, users: [ADMIN, OUTSIDER] };
  server = await startLocalSupabase(common);
  unconfigured = await startLocalSupabase({ ...common, configured: false });
  site = server.siteUrl;
  siteOff = unconfigured.siteUrl;
  browser = await playwright.chromium.launch();
});

test('Neprijungta duomenų bazė: viešas puslapis rodo oficialų failą visiems, administravimo juodraščiai atskirti', { skip }, async () => {
  const context = await browser.newContext();
  const page = await newPage(context);
  const foreign = [];
  page.on('request', (r) => { if (!r.url().startsWith(siteOff) && !r.url().startsWith('data:')) foreign.push(r.url()); });
  const officialPoints = (rows) => Object.fromEntries(rows.map((r) => [r.name, r.points]));

  // Viešas puslapis: oficialūs rezultatai iš statinio failo
  const pub = await context.newPage();
  await pub.goto(`${siteOff}reitingai.html`);
  await pub.locator('#static-info').waitFor();
  await pub.locator('.rrow').first().waitFor();
  const before = await publicRows(pub);
  assert.equal(before.length, 6, 'ELITE: 6 porų (ne 12 žaidėjų)');
  const pts = officialPoints(before);
  assert.equal(pts['Emilija P. / Sofija B.'], 100);
  assert.equal(pts['Evgenija M. / Milda R.'], 52);
  assert.equal(pts['Danielė Š. / Lea D.'], 42); assert.equal(pts['Ditė / Gabrielė'], 42);
  assert.equal(await pub.locator('.rrow', { hasText: 'Goda' }).count(), 0, 'CHALLENGE poros ELITE lentelėje nerodomos');
  // CHALLENGE – atskira lentelė; ta pati Lea D. / Danielė Š. pora turi tik CHALLENGE taškus (15), nesumuojama su ELITE
  await pub.goto(`${siteOff}reitingai.html#challenge`);
  await pub.locator('.rrow').first().waitFor();
  const challenge = officialPoints(await publicRows(pub));
  assert.equal(Object.keys(challenge).length, 7);
  assert.equal(challenge['Luknė M. / Rusnė A.'], 40);
  assert.equal(challenge['Amelija / Goda'], 21);
  assert.equal(challenge['Danielė Š. / Lea D.'], 15);
  assert.equal(challenge['Adrian / Luka B.'], 15);
  assert.equal(await pub.locator('.rmove, .rhead:has-text("Judėjimas")').count(), 0, 'nėra ▲/▼ – nėra su kuo lyginti');
  await pub.goto(`${siteOff}reitingai.html`);
  await pub.locator('.rrow').first().waitFor();
  const text = await pub.locator('#app').innerText();
  assert.match(text, /Duomenys nepilni/);
  assert.match(text, /žinomos 3 iš 4/);
  await pub.goto(`${siteOff}reitingai.html#turnyrai`);
  await pub.locator('.tcard').first().waitFor();
  assert.equal(await pub.locator('.tcard').count(), 19, 'kalendorius veikia');
  await pub.goto(`${siteOff}reitingai.html#turnyrai/2026-2027-challenge-1`);
  await pub.locator('[data-incomplete="5"]').waitFor();
  assert.match(await pub.locator('.tdetail').innerText(), /Goda[\s\S]*21/);

  // Kitas „lankytojas“ (švari naršyklė) mato tą patį
  const other = await browser.newContext();
  const otherPage = await newPage(other);
  await otherPage.goto(`${siteOff}reitingai.html`);
  await otherPage.locator('.rrow').first().waitFor();
  assert.deepEqual(await publicRows(otherPage), before, 'visi lankytojai mato tuos pačius rezultatus');
  await other.close();

  // Administravimas be prisijungimo, su aiškiu perspėjimu
  await page.goto(`${siteOff}reitingai-admin.html`);
  await page.locator('#local-banner').waitFor();
  assert.match(await page.locator('#local-banner').innerText(), /VIETINIS REŽIMAS[\s\S]*tik juodraštis[\s\S]*data\/official-results\.json/);
  assert.equal(await page.locator('#login-email').count(), 0, 'prisijungimo formos nėra');
  assert.equal(await page.locator('[data-tab="test"]').count(), 0, 'BANDYMAS vietiniame režime nerodomas');

  // Telefono dydžio ekranas: be horizontalios slinkties
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(await overflow() <= 1, 'administravimas telefone');
  await pub.setViewportSize({ width: 390, height: 800 });
  await pub.goto(`${siteOff}reitingai.html`);
  await pub.locator('.rrow').first().waitFor();
  assert.ok(await pub.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 1, 'viešas puslapis telefone');
  await pub.setViewportSize({ width: 1280, height: 800 });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Vietinis srautas: 4 testiniai žaidėjai, FUTURE #1 juodraštis ir „patvirtinimas“ TIK naršyklėje
  for (let i = 1; i <= 4; i++) await addPlayer(page, 'Testinis', `E${i}`);
  await page.click('[data-act="tab"][data-tab="results"]');
  await page.selectOption('select[data-sel="tournament"]', '2026-2027-future-1');
  await page.click('[data-act="add-team"]');
  await page.click('[data-act="add-team"]');
  const name = (n) => `Testinis E${n}`;
  for (const [i, [pos, a, b]] of [[1, 1, 2], [2, 3, 4]].entries()) {
    await page.locator('input[data-field="position"]').nth(i).fill(String(pos));
    await page.locator('select[data-field="player1"]').nth(i).selectOption({ label: name(a) });
    await page.locator('select[data-field="player2"]').nth(i).selectOption({ label: name(b) });
  }
  await page.click('[data-act="save-draft"]');
  await page.locator('.notice.success', { hasText: 'Juodraštis išsaugotas' }).waitFor();
  assert.match(await page.locator('#app').innerText(), /PATVIRTINTI \(TIK ŠIOJE NARŠYKLĖJE\)/);
  assert.doesNotMatch(await page.locator('#app').innerText(), /PASKELBTI OFICIALIUS/);
  await page.click('[data-act="finalize"]');
  await page.locator('.notice.success', { hasText: 'TIK šioje naršyklėje' }).waitFor();
  assert.match(await page.locator('.notice.success').innerText(), /NEPASKELBTI viešai/);

  // Po perkrovimo vietiniai duomenys išlieka administravime, bet VIEŠAS puslapis nepasikeičia
  await page.reload();
  await page.locator('#local-banner').waitFor();
  await pub.reload();
  await pub.locator('.rrow').first().waitFor();
  assert.deepEqual(await publicRows(pub), before, 'vietiniai duomenys viešame puslapyje nerodomi');
  assert.doesNotMatch(await pub.locator('#app').innerText(), /Testinis/);

  // Išvalymas liečia tik vietinius duomenis
  await page.click('[data-act="clear-local"]');
  await page.locator('#local-banner').waitFor();
  await page.click('[data-act="tab"][data-tab="players"]');
  assert.equal(await page.locator('#app', { hasText: 'Testinis E1' }).count(), 0);
  await pub.reload();
  await pub.locator('.rrow').first().waitFor();
  assert.deepEqual(await publicRows(pub), before);

  assert.deepEqual(foreign, [], 'jokių užklausų už svetainės ribų (nei į Supabase, nei kitur)');
  await context.close();
});

test('Prijungta, bet dar be rezultatų: viešas puslapis rodo tuščią būseną, o ne išgalvotus duomenis', { skip }, async () => {
  const context = await browser.newContext();
  const page = await newPage(context);
  await page.goto(`${site}reitingai.html`);
  await page.getByText('Oficialių rezultatų dar nėra').first().waitFor();
  assert.equal(await page.locator('.rrow').count(), 0);
  assert.doesNotMatch(await page.locator('#app').innerText(), /Demo /);
  await context.close();
});

test('Prisijungimas: blogas slaptažodis ir paprastas (ne administratoriaus) naudotojas atmetami', { skip }, async () => {
  const context = await browser.newContext();
  const page = await newPage(context);
  await adminLogin(page, ADMIN, 'neteisingas-slaptazodis');
  await page.getByText('Neteisingas el. paštas arba slaptažodis').waitFor();
  assert.equal(await page.locator('[data-act="logout"]').count(), 0);

  await adminLogin(page, OUTSIDER);
  await page.getByText('nėra administratoriaus').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'sesija neišsaugoma');
  assert.equal(await page.getByText('PRIDĖTI ŽAIDĖJĄ').count(), 0);
  await context.close();
});

let adminContext; let admin;

test('Administratorius prisijungia ir prideda žaidėją; po perkrovimo žaidėjas išlieka', { skip }, async () => {
  adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  admin = await newPage(adminContext);
  await adminLogin(admin);
  await admin.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  assert.ok(await admin.getByRole('heading', { name: 'ŽAIDĖJAI' }).count() >= 1);
  await shot(admin, 'admin-zaidejai-tuscia');

  // Trūksta pavardės: aiški klaida, įvestas vardas lieka formoje
  await admin.fill('#new-first', 'Jonas');
  await admin.click('form[data-form="player"] button[type="submit"]');
  await admin.locator('.notice.error', { hasText: 'vardą, ir pavardę' }).waitFor();
  assert.equal(await admin.inputValue('#new-first'), 'Jonas');
  assert.equal(owner('select count(*) from public.players;'), '0', 'nepilnas įrašas neišsaugotas');

  await admin.fill('#new-last', 'Jonaitis');
  await admin.click('form[data-form="player"] button[type="submit"]');
  await admin.locator('.notice.success', { hasText: 'Žaidėjas „Jonas Jonaitis“ išsaugotas' }).waitFor();
  assert.equal(await admin.inputValue('#new-first'), '', 'forma išvalyta po sėkmingo išsaugojimo');

  // Duomenų bazėje
  assert.equal(owner(`select first_name || '|' || last_name || '|' || full_name from public.players;`), 'Jonas|Jonaitis|Jonas Jonaitis');
  const id = pid('Jonas Jonaitis');
  assert.match(await admin.locator('#players-table').innerText(), new RegExp(id), 'sąraše rodomas ID');

  // Perkrovimas: sesija ir žaidėjas išlieka
  await admin.reload();
  await admin.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  assert.match(await admin.locator('#players-table').innerText(), /Jonas Jonaitis/);

  // Kita „naršyklė“ (naujas kontekstas, be bendros sesijos) mato tą patį žaidėją po prisijungimo
  const other = await browser.newContext();
  const otherPage = await newPage(other);
  await adminLogin(otherPage);
  await otherPage.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  assert.match(await otherPage.locator('#players-table').innerText(), /Jonas Jonaitis/);
  await other.close();
});

test('Dublikatų apsauga: didžiosios raidės, lietuviškos raidės ir žodžių tvarka; sąmoningas atskiras įrašas', { skip }, async () => {
  for (const [first, last] of [['JONAS', 'jonaitis'], ['Jonaitis', 'Jonas']]) {
    await admin.fill('#new-first', first);
    await admin.fill('#new-last', last);
    await admin.click('form[data-form="player"] button[type="submit"]');
    await admin.locator('.notice.warning', { hasText: 'Galimas dublikatas' }).waitFor();
    assert.match(await admin.locator('.notice.warning').innerText(), /Jonas Jonaitis/);
    assert.equal(owner('select count(*) from public.players;'), '1', `„${first} ${last}“ be patvirtinimo nesukurtas`);
  }
  // Atšaukti
  await admin.click('[data-act="cancel-duplicate"]');
  assert.equal(await admin.locator('.notice.warning').count(), 0);

  await addPlayer(admin, 'Žygimantas', 'Šimkus');
  await admin.fill('#new-first', 'Zygimantas');
  await admin.fill('#new-last', 'Simkus');
  await admin.click('form[data-form="player"] button[type="submit"]');
  await admin.locator('.notice.warning', { hasText: 'Žygimantas Šimkus' }).waitFor();
  assert.equal(owner('select count(*) from public.players;'), '2');
  await admin.click('[data-act="force-create"]');
  await admin.locator('.notice.success', { hasText: 'Zygimantas Simkus' }).waitFor();
  assert.equal(owner('select count(*) from public.players;'), '3', 'po sąmoningo patvirtinimo – atskiras įrašas');

  // Likę žaidėjai rezultatams
  for (const [first, last] of [['Petras', 'Petraitis'], ['Antanas', 'Antanaitis'], ['Kazys', 'Kazlauskas'], ['Rūta', 'Rutkauskaitė'], ['Ąžuolas', 'Ūdra'], ['Eglė', 'Egliūtė']]) {
    await addPlayer(admin, first, last);
  }
  assert.equal(owner('select count(*) from public.players;'), '9');
});

test('Žaidėjų paieška (be diakritikų) ir vardo taisymas išsaugo ID', { skip }, async () => {
  await admin.fill('#player-search', 'zygimantas');
  assert.equal(await admin.locator('#players-table tbody tr[data-player-row]').count(), 2, 'randa ir Žygimantas, ir Zygimantas');
  await admin.fill('#player-search', 'RUTA');
  assert.equal(await admin.locator('#players-table tbody tr[data-player-row]').count(), 1);
  assert.match(await admin.locator('#players-table').innerText(), /Rūta Rutkauskaitė/);
  await admin.fill('#player-search', 'nėra tokio žaidėjo');
  await admin.getByText('Žaidėjų nerasta').waitFor();
  await admin.fill('#player-search', '');

  const before = pid('Ąžuolas Ūdra');
  await admin.fill('#player-search', 'azuolas');
  await admin.click(`[data-act="edit-player"][data-id="${before}"]`);
  await admin.fill('#edit-last', 'Ūdrys');
  await admin.click(`[data-act="save-player"][data-id="${before}"]`);
  await admin.locator('.notice.success', { hasText: 'Taškai ir istorija nepakito' }).waitFor();
  assert.equal(owner(`select id || '|' || full_name from public.players where id = '${before}';`), `${before}|Ąžuolas Ūdrys`, 'ID tas pats, vardas pataisytas');
  assert.equal(owner('select count(*) from public.players;'), '9', 'dublikatas nesukurtas');
  await admin.fill('#player-search', '');
});

test('Rezultatų suvedimas: komandos, taškai iš karto, užblokuotas dvigubas dalyvavimas, juodraštis neturi įtakos viešam reitingui', { skip }, async () => {
  await admin.click('[data-act="tab"][data-tab="results"]');
  await admin.getByRole('heading', { name: 'REZULTATŲ SUVEDIMAS' }).waitFor();
  await admin.selectOption('select[data-sel="tournament"]', E1);
  await admin.getByRole('heading', { name: /ELITE #1/ }).waitFor();

  const teams = [['Jonas Jonaitis', 'Petras Petraitis', '1', '100'], ['Antanas Antanaitis', 'Kazys Kazlauskas', '2', '80'], ['Žygimantas Šimkus', 'Rūta Rutkauskaitė', '3', '64'], ['Ąžuolas Ūdrys', 'Eglė Egliūtė', '4', '52']];
  for (let i = 0; i < teams.length; i += 1) await admin.click('[data-act="add-team"]');
  const rows = admin.locator('#results-table tbody tr');
  assert.equal(await rows.count(), 4);
  for (let i = 0; i < teams.length; i += 1) {
    const [a, b, pos, pts] = teams[i];
    const row = rows.nth(i);
    await row.locator('select[data-field="player1"]').selectOption(pid(a));
    await row.locator('select[data-field="player2"]').selectOption(pid(b));
    await row.locator('input[data-field="position"]').fill(pos);
    assert.equal((await rows.nth(i).locator('[data-points]').innerText()).trim(), pts, `komandos ${pos} vietos taškai kiekvienam`);
  }

  // Jau pasirinktas žaidėjas kitoje komandoje užblokuotas
  await admin.click('[data-act="add-team"]');
  const fifth = rows.nth(4);
  const disabled = await fifth.locator(`select[data-field="player1"] option[value="${pid('Jonas Jonaitis')}"]`).getAttribute('disabled');
  assert.notEqual(disabled, null, 'Jonas jau komandoje – pasirinkti antrą kartą negalima');
  await rows.nth(4).locator('[data-act="remove-team"]').click();
  assert.equal(await rows.count(), 4);

  // Peržiūra: lentelė pagal specifikaciją
  await admin.click('[data-act="preview"]');
  await admin.getByText('Validacija sėkminga').waitFor();
  const preview = await admin.locator('#preview-table').innerText();
  assert.match(preview, /Vieta\s+Žaidėjas 1\s+Žaidėjas 2\s+Taškai porai/i);
  assert.match(preview, /1\s+Jonas Jonaitis\s+Petras Petraitis\s+100/);
  await shot(admin, 'admin-rezultatai-perziura');

  // Juodraštis
  await admin.click('[data-act="save-draft"]');
  await admin.locator('.notice.success', { hasText: 'Juodraštis išsaugotas' }).waitFor();
  assert.equal(owner(`select status from public.tournaments where id = '${E1}';`), 'draft');
  assert.equal(owner(`select count(*) from public.participations where tournament_id = '${E1}';`), '4');

  // Juodraštis NEįtakoja viešo reitingo (naršyklėje ir tiesiogiai per API)
  const data = await publicDataset();
  assert.equal(data.participations.length, 0, 'viešas API nerodo juodraščio komandų');
  assert.equal(data.players.length, 0, 'viešas API nerodo žaidėjų be paskelbtų rezultatų');
  const anon = await browser.newContext();
  const pub = await newPage(anon);
  await pub.goto(`${site}reitingai.html`);
  await pub.getByText('Oficialių rezultatų dar nėra').first().waitFor();
  assert.equal(await pub.locator('.rrow').count(), 0);
  await anon.close();

  // Juodraštis išlieka po perkrovimo
  await admin.reload();
  await admin.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  await admin.click('[data-act="tab"][data-tab="results"]');
  await admin.selectOption('select[data-sel="tournament"]', E1);
  await admin.locator('#results-table tbody tr').nth(3).waitFor();
  assert.equal(await admin.locator('#results-table tbody tr').count(), 4);
});

test('Paskelbimas: abu žaidėjai gauna pilnus taškus, viešas reitingas atsinaujina ir išlieka po perkrovimo', { skip }, async () => {
  await admin.click('[data-act="finalize"]');
  await admin.locator('.notice.success', { hasText: 'Rezultatai patvirtinti ir paskelbti' }).waitFor();
  assert.equal(owner(`select status from public.tournaments where id = '${E1}';`), 'finalized');
  await shot(admin, 'admin-paskelbta');

  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pub = await newPage(anon);
  await pub.goto(`${site}reitingai.html`);
  await pub.locator('.rrow').first().waitFor();
  const expected = { 'Jonas Jonaitis / Petras Petraitis': 100, 'Antanas Antanaitis / Kazys Kazlauskas': 80, 'Rūta Rutkauskaitė / Žygimantas Šimkus': 64, 'Eglė Egliūtė / Ąžuolas Ūdrys': 52 };
  const check = async () => {
    const rows = await publicRows(pub);
    assert.equal(rows.length, 4, 'ELITE: 4 poros');
    for (const [name, points] of Object.entries(expected)) assert.equal(rows.find((r) => r.name === name).points, points, name);
  };
  await check();
  await shot(pub, 'viesas-elite');
  await pub.reload();
  await pub.locator('.rrow').first().waitFor();
  await check();

  // ELITE kategorija ir turnyro rezultatai matomi viešai
  await pub.goto(`${site}reitingai.html#elite`);
  await pub.locator('.rrow').first().waitFor();
  assert.equal((await publicRows(pub)).length, 4);
  await pub.goto(`${site}reitingai.html#challenge`);
  await pub.getByText('oficialių rezultatų dar nėra').first().waitFor();
  await pub.goto(`${site}reitingai.html#turnyrai`);
  await pub.getByText('ELITE #1').first().waitFor();

  // Variklis iš viešų duomenų duoda tą patį
  const ranking = computeRankings(await publicDataset(), { seasonId: '2026-2027' });
  assert.equal(ranking.overall.find((r) => r.name === 'Jonas Jonaitis').points, 100);
  assert.equal(ranking.overall.reduce((s, r) => s + r.points, 0), 2 * (100 + 80 + 64 + 52));
  await anon.close();
});

test('Paskelbtų rezultatų pakartotinis paskelbimas atmetamas; taškai nedubliuojasi', { skip }, async () => {
  assert.equal(await admin.locator('[data-act="finalize"]').count(), 0, 'paskelbto turnyro nebegalima skelbti iš naujo');
  const token = await tokenFor(ADMIN);
  const again = await api('/rest/v1/rpc/admin_finalize_tournament', { body: { p_tournament_id: E1 }, token });
  assert.equal(again.status, 400);
  assert.equal(again.json.message, 'already_finalized');
  const ranking = computeRankings(await publicDataset(), { seasonId: '2026-2027' });
  assert.equal(ranking.overall.find((r) => r.name === 'Jonas Jonaitis').points, 100);
});

test('Pataisymas: vietos sukeičiamos, privaloma priežastis, taškai perskaičiuoti be dvigubo skaičiavimo, įrašas audite', { skip }, async () => {
  const rows = admin.locator('#results-table tbody tr');
  await rows.nth(0).locator('input[data-field="position"]').fill('2');
  await rows.nth(1).locator('input[data-field="position"]').fill('1');

  // Be priežasties – atmetama
  await admin.click('[data-act="correct"]');
  await admin.locator('.notice.error', { hasText: 'priežastį' }).waitFor();
  const stillOld = computeRankings(await publicDataset(), { seasonId: '2026-2027' });
  assert.equal(stillOld.overall.find((r) => r.name === 'Jonas Jonaitis').points, 100, 'be priežasties niekas nepasikeitė');

  await admin.fill('textarea[data-reason]', 'Neteisingai įvestos 1 ir 2 vietos');
  await admin.click('[data-act="correct"]');
  await admin.locator('.notice.success', { hasText: 'Pataisymas išsaugotas' }).waitFor();

  const ranking = computeRankings(await publicDataset(), { seasonId: '2026-2027' });
  const pts = (n) => ranking.overall.find((r) => r.name === n).points;
  assert.equal(pts('Jonas Jonaitis'), 80, 'Jonas dabar 2 vietoje – 80, o ne 180');
  assert.equal(pts('Petras Petraitis'), 80);
  assert.equal(pts('Antanas Antanaitis'), 100);
  assert.equal(pts('Kazys Kazlauskas'), 100);
  assert.equal(ranking.overall.reduce((s, r) => s + r.points, 0), 2 * (100 + 80 + 64 + 52), 'bendra suma nepasikeitė – taškai nesidubliuoja');
  assert.equal(owner(`select count(*) from public.participations where tournament_id = '${E1}';`), '4');
  assert.equal(owner(`select revision from public.tournaments where id = '${E1}';`), '2');

  await admin.click('[data-act="tab"][data-tab="audit"]');
  await admin.getByText('Pataisyti rezultatai').first().waitFor();
  assert.match(await admin.locator('.ttable').innerText(), /Neteisingai įvestos 1 ir 2 vietos/);
  assert.match(await admin.locator('.ttable').innerText(), /Paskelbti rezultatai/);

  // Viešas puslapis po perkrovimo
  const anon = await browser.newContext();
  const pub = await newPage(anon);
  await pub.goto(`${site}reitingai.html`);
  await pub.locator('.rrow').first().waitFor();
  const publicNow = Object.fromEntries((await publicRows(pub)).map((r) => [r.name, r.points]));
  assert.equal(publicNow['Jonas Jonaitis / Petras Petraitis'], 80);
  assert.equal(publicNow['Antanas Antanaitis / Kazys Kazlauskas'], 100);
  await anon.close();
});

test('Dublikatų sujungimas per naršyklę: istorija išlieka, taškai nedubliuojasi', { skip }, async () => {
  await admin.click('[data-act="tab"][data-tab="players"]');
  // Tas pats žmogus įvestas antrą kartą (sąmoningai patvirtinta) be rezultatų
  await admin.fill('#new-first', 'Petras');
  await admin.fill('#new-last', 'Petraitis');
  await admin.click('form[data-form="player"] button[type="submit"]');
  await admin.click('[data-act="force-create"]');
  await admin.locator('.notice.success', { hasText: 'Petras Petraitis' }).waitFor();
  const ids = owner(`select id from public.players where full_name = 'Petras Petraitis' order by created_at;`).split('\n');
  assert.equal(ids.length, 2);
  const [keep, drop] = ids;
  await admin.selectOption('#merge-keep', keep);
  await admin.selectOption('#merge-drop', drop);
  await admin.fill('#merge-reason', 'Dubliuotas įrašas');
  await admin.click('[data-act="merge"]');
  await admin.locator('.notice.success', { hasText: 'Žaidėjai sujungti' }).waitFor();
  assert.equal(owner(`select merged_into::text || '|' || is_active from public.players where id = '${drop}';`), `${keep}|false`);

  const ranking = computeRankings(await publicDataset(), { seasonId: '2026-2027' });
  assert.equal(ranking.overall.filter((r) => r.name === 'Petras Petraitis').length, 1);
  assert.equal(ranking.overall.find((r) => r.name === 'Petras Petraitis').points, 80);

  // Sujungtas įrašas nebesiūlomas komandų pasirinkime
  await admin.click('[data-act="tab"][data-tab="results"]');
  await admin.selectOption('select[data-sel="tournament"]', C1);
  await admin.click('[data-act="add-team"]');
  assert.equal(await admin.locator(`#results-table select[data-field="player1"] option[value="${drop}"]`).count(), 0);
});

test('Serveris atmeta dvigubą dalyvavimą ir dubliuotas vietas net apeinant naršyklę', { skip }, async () => {
  const token = await tokenFor(ADMIN);
  const [a, b, c] = [pid('Jonas Jonaitis'), pid('Antanas Antanaitis'), pid('Eglė Egliūtė')];
  const twice = await api('/rest/v1/rpc/admin_save_results', { token, body: { p_tournament_id: C1, p_status: 'draft', p_entries: [{ position: 1, playerIds: [a, b] }, { position: 2, playerIds: [a, c] }] } });
  assert.equal(twice.status, 400);
  assert.equal(twice.json.message, 'player_in_two_teams');
  assert.equal(owner(`select count(*) from public.participations where tournament_id = '${C1}';`), '0', 'nieko neišsaugota');

  const samePos = await api('/rest/v1/rpc/admin_save_results', { token, body: { p_tournament_id: C1, p_status: 'draft', p_entries: [{ position: 1, playerIds: [a, b] }, { position: 1, playerIds: [c, pid('Kazys Kazlauskas')] }] } });
  assert.equal(samePos.status, 200, 'juodraštyje dar galima neužbaigta būsena');
  const finalize = await api('/rest/v1/rpc/admin_finalize_tournament', { token, body: { p_tournament_id: C1 } });
  assert.equal(finalize.status, 400);
  assert.equal(finalize.json.message, 'validation_failed', 'su dubliuotomis vietomis paskelbti negalima');
  assert.equal(owner(`select status from public.tournaments where id = '${C1}';`), 'draft');

  // Nepilna komanda (vienas žaidėjas) juodraštyje leidžiama, bet jos paskelbti negalima
  const incomplete = await api('/rest/v1/rpc/admin_save_results', { token, body: { p_tournament_id: C1, p_status: 'draft', p_entries: [{ position: 1, playerIds: [a] }, { position: 2, playerIds: [b, c] }] } });
  assert.equal(incomplete.status, 200);
  const finalizeIncomplete = await api('/rest/v1/rpc/admin_finalize_tournament', { token, body: { p_tournament_id: C1 } });
  assert.equal(finalizeIncomplete.status, 400);
  assert.equal(finalizeIncomplete.json.message, 'validation_failed');
  assert.match(finalizeIncomplete.json.details, /team_needs_two_players/);
  assert.equal(owner(`select status from public.tournaments where id = '${C1}';`), 'draft', 'nepilni rezultatai nepaskelbti');
  assert.equal((computeRankings(await publicDataset(), { seasonId: '2026-2027' })).overall.length, 8, 'viešas reitingas nepasikeitė');

  // Daugiau nei du žaidėjai komandoje
  const three = await api('/rest/v1/rpc/admin_save_results', { token, body: { p_tournament_id: C1, p_status: 'draft', p_entries: [{ position: 1, playerIds: [a, b, c] }] } });
  assert.equal(three.status, 400);
  assert.equal(three.json.message, 'team_needs_two_players');
});

test('Atsijungimas: admin veiksmai nebeprieinami; neteisėti rašymai tiesiai į API atmetami', { skip }, async () => {
  await admin.click('[data-act="logout"]');
  await admin.locator('form[data-form="login"]').waitFor();
  assert.equal(await admin.evaluate(() => sessionStorage.length), 0, 'sesija išvalyta');
  assert.equal(await admin.getByText('PRIDĖTI ŽAIDĖJĄ').count(), 0);
  await admin.reload();
  await admin.locator('form[data-form="login"]').waitFor();
  assert.equal(await admin.getByText('PRIDĖTI ŽAIDĖJĄ').count(), 0, 'po perkrovimo vis dar atsijungta');

  const before = owner('select (select count(*) from public.players) || \'|\' || (select count(*) from public.participations) || \'|\' || (select count(*) from public.audit_log);');
  const entry = [{ position: 1, playerIds: [pid('Jonas Jonaitis'), pid('Antanas Antanaitis')] }];

  // Anoniminis (tik viešas raktas)
  for (const call of [
    () => api('/rest/v1/rpc/admin_save_results', { body: { p_tournament_id: C1, p_entries: entry, p_status: 'draft' } }),
    () => api('/rest/v1/rpc/admin_finalize_tournament', { body: { p_tournament_id: C1 } }),
    () => api('/rest/v1/rpc/admin_correct_results', { body: { p_tournament_id: E1, p_entries: entry, p_reason: 'bandymas apeiti' } }),
    () => api('/rest/v1/rpc/admin_merge_players', { body: { p_keep: pid('Jonas Jonaitis'), p_drop: pid('Antanas Antanaitis') } }),
    () => api('/rest/v1/players', { body: { first_name: 'Įsilaužėlis', last_name: 'Anonimas' } }),
    () => api('/rest/v1/players?id=eq.' + pid('Jonas Jonaitis'), { method: 'PATCH', body: { first_name: 'Sugadintas' } }),
    () => api('/rest/v1/participations', { body: { tournament_id: E1 } }),
    () => api('/rest/v1/tournaments?select=*', { method: 'GET' }),
    () => api('/rest/v1/players?select=*', { method: 'GET' }),
    () => api('/rest/v1/audit_log?select=*', { method: 'GET' }),
  ]) {
    const r = await call();
    assert.ok([401, 403].includes(r.status), `anoniminis kreipinys turi būti atmestas, gauta ${r.status}: ${r.text}`);
  }

  // Prisijungęs, bet ne administratorius
  const outsiderToken = await tokenFor(OUTSIDER);
  assert.equal((await api('/rest/v1/rpc/is_admin', { token: outsiderToken, body: {} })).json, false);
  for (const call of [
    () => api('/rest/v1/rpc/admin_save_results', { token: outsiderToken, body: { p_tournament_id: C1, p_entries: entry, p_status: 'draft' } }),
    () => api('/rest/v1/rpc/admin_finalize_tournament', { token: outsiderToken, body: { p_tournament_id: C1 } }),
    () => api('/rest/v1/rpc/admin_upsert_season', { token: outsiderToken, body: { p_id: 'x', p_label: 'x', p_is_current: false, p_scoring_version: 'v1' } }),
    () => api('/rest/v1/players', { token: outsiderToken, body: { first_name: 'Įsilaužėlis', last_name: 'Naudotojas' } }),
  ]) {
    const r = await call();
    assert.ok([401, 403].includes(r.status), `ne administratoriaus kreipinys turi būti atmestas, gauta ${r.status}: ${r.text}`);
  }
  const outsiderRead = await api('/rest/v1/players?select=*', { method: 'GET', token: outsiderToken });
  assert.equal(outsiderRead.status, 200);
  assert.deepEqual(outsiderRead.json, [], 'ne administratorius RLS paslepia visus žaidėjus');

  // Suklastotas ir pasibaigęs žetonas
  const now = Math.floor(Date.now() / 1000);
  const forged = server.signToken({ sub: ADMIN.id, role: 'authenticated', exp: now + 3600 }, 'ne-tas-paslaptis');
  const expired = server.signToken({ sub: ADMIN.id, role: 'authenticated', exp: now - 10 });
  for (const token of [forged, expired]) {
    const r = await api('/rest/v1/rpc/admin_finalize_tournament', { token, body: { p_tournament_id: C1 } });
    assert.equal(r.status, 401, 'suklastotas / pasibaigęs žetonas atmetamas');
  }

  const after = owner('select (select count(*) from public.players) || \'|\' || (select count(*) from public.participations) || \'|\' || (select count(*) from public.audit_log);');
  assert.equal(after, before, 'jokių neteisėtų pakeitimų duomenų bazėje');

  // Viešas skaitymas veikia visiems
  assert.equal((await api('/rest/v1/rpc/public_ranking_data', { body: {} })).status, 200);
});

test('Mobilus išdėstymas (360 ir 390 px): porų lentelės be horizontalaus slinkimo, kalendoriaus registracijos nuorodos nepakitusios', { skip }, async () => {
  for (const width of [360, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await newPage(context);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    for (const hash of ['#elite', '#challenge', '#turnyrai', '#turnyrai/2026-2027-challenge-1']) {
      await page.goto(`${siteOff}reitingai.html${hash}`);
      await page.locator(hash.startsWith('#turnyrai') ? '.tcard, .tdetail' : '.rrow').first().waitFor();
      assert.ok(await overflow() <= 1, `${hash} ${width}px: horizontalaus slinkimo nėra`);
    }
    // išskleista pora (detalių lentelė) taip pat telpa
    await page.goto(`${siteOff}reitingai.html#challenge`);
    await page.locator('.rrow').first().click();
    await page.locator('.rrow.open .dtable').waitFor();
    assert.ok(await overflow() <= 1, `išskleista pora ${width}px`);
    assert.equal(await page.locator('.rrow').count(), 7);
    await context.close();
  }
  // Kalendorius: registracijos nuorodos tos pačios kaip repozitorijos index.html
  const context = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await newPage(context);
  await page.goto(`${siteOff}index.html`);
  const live = await page.evaluate(() => [...document.querySelectorAll('a.register[href], .register[href]')].map((a) => a.getAttribute('href')));
  const source = [...readFileSync(join(root, 'index.html'), 'utf8').matchAll(/<a[^>]*class="register"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(source.length >= 3, 'kalendoriuje yra registracijos nuorodų');
  assert.deepEqual(live, source);
  assert.ok(source.some((h) => h === 'reitingai.html'));
  await context.close();
});

test('Naujas publishable raktas (NE JWT): viešas puslapis ir administravimas veikia, raktas niekada nesiunčiamas kaip Bearer', { skip }, async () => {
  const pub = await startLocalSupabase({ pg: { host: HOST, port: PORT, user: USER }, database: DB, staticRoot: root, users: [ADMIN, OUTSIDER], keyMode: 'publishable' });
  try {
    assert.match(pub.anonKey, /^sb_publishable_/);
    const context = await browser.newContext();
    const page = await newPage(context);
    await page.goto(`${pub.siteUrl}reitingai.html`);
    await page.locator('.rrow').first().waitFor();
    assert.equal((await publicRows(page)).length, 4, 'oficialūs rezultatai matomi ir su publishable raktu');

    await page.goto(`${pub.siteUrl}reitingai-admin.html`);
    await page.fill('#login-email', ADMIN.email);
    await page.fill('#login-password', ADMIN.password);
    await page.click('form[data-form="login"] button[type="submit"]');
    await page.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
    const before = owner('select count(*) from public.players;');
    await addPlayer(page, 'Publishable', 'Bandymas');
    assert.equal(owner('select count(*) from public.players;'), String(Number(before) + 1), 'rašymas veikia su publishable raktu');
    owner(`delete from public.players where full_name = 'Publishable Bandymas';`);

    // Anoniminės užklausos neturi Bearer antraštės (publishable raktas nėra JWT)
    const anonCalls = pub.stats.requests.filter((r) => r.path.includes('public_ranking_data'));
    assert.ok(anonCalls.length >= 1);
    assert.ok(anonCalls.every((r) => r.hasBearer === false), 'viešos užklausos be Authorization antraštės');
    await context.close();
  } finally {
    await pub.close();
  }
});

test('Privilegijuotas raktas per klaidą įrašytas į konfigūraciją: puslapiai rodo perspėjimą ir NIEKUR nesiunčia užklausų', { skip }, async () => {
  const bad = await startLocalSupabase({ pg: { host: HOST, port: PORT, user: USER }, database: DB, staticRoot: root, users: [ADMIN], runtime: { supabaseUrl: '@origin', supabaseAnonKey: '@service' } });
  try {
    const context = await browser.newContext();
    const page = await newPage(context);
    await page.goto(`${bad.siteUrl}reitingai.html`);
    await page.locator('#unconfigured [data-setup="secret_key"]').waitFor();
    assert.match(await page.locator('#unconfigured').innerText(), /PRIVILEGIJUOTAS raktas/);
    await page.goto(`${bad.siteUrl}reitingai-admin.html`);
    await page.locator('#unconfigured [data-setup="secret_key"]').waitFor();
    assert.equal(await page.locator('#login-email').count(), 0, 'prisijungimo formos nėra');
    const apiCalls = bad.stats.requests.filter((r) => r.path.startsWith('/rest/') || r.path.startsWith('/auth/'));
    assert.deepEqual(apiCalls, [], 'privilegijuotas raktas nenaudojamas jokioje užklausoje');
    await context.close();
  } finally {
    await bad.close();
  }
});

test('Sesijos galiojimas: nebegaliojantį žetoną puslapis atnaujina pats; atšaukta sesija grąžina į prisijungimą', { skip }, async () => {
  const context = await browser.newContext();
  const page = await newPage(context);
  await adminLogin(page);
  await page.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();

  // 1) serveris žetoną laiko nebegaliojančiu, bet atnaujinimo raktas geras → veiksmas pavyksta po automatinio atnaujinimo
  server.revokeAccessTokens();
  await addPlayer(page, 'Sesija', 'Atnaujinta');
  assert.equal(owner(`select count(*) from public.players where full_name = 'Sesija Atnaujinta';`), '1');
  assert.equal(await page.locator('form[data-form="login"]').count(), 0, 'prisijungimo forma nerodoma');

  // 2) sesija atšaukta visiškai → grįžtama į prisijungimą su paaiškinimu, nieko neįrašyta
  server.revokeSessions();
  await page.fill('#new-first', 'Sesija');
  await page.fill('#new-last', 'Pasibaigusi');
  await page.click('form[data-form="player"] button[type="submit"]');
  await page.locator('form[data-form="login"]').waitFor();
  assert.match(await page.locator('.notice.error').innerText(), /Prisijungimo galiojimas baigėsi/);
  assert.equal(owner(`select count(*) from public.players where full_name = 'Sesija Pasibaigusi';`), '0', 'pasibaigusi sesija nieko neįrašė');
  assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'negaliojanti sesija išvalyta');

  // 3) po perkrovimo su senu žetonu ir geru atnaujinimo raktu sesija atkuriama
  await page.fill('#login-email', ADMIN.email);
  await page.fill('#login-password', ADMIN.password);
  await page.click('form[data-form="login"] button[type="submit"]');
  await page.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  server.revokeAccessTokens();
  await page.reload();
  await page.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  assert.equal(await page.locator('form[data-form="login"]').count(), 0, 'perkrovus sesija atkurta per atnaujinimo raktą');
  owner(`delete from public.players where full_name = 'Sesija Atnaujinta';`);
  await context.close();
});

test('BANDYMAS (realioje DB per naršyklę): išbandomas visas kelias su neoficialiais duomenimis, o valymas grąžina tiksliai ankstesnę būseną', { skip }, async () => {
  const strip = (d) => { const copy = JSON.parse(JSON.stringify(d)); delete copy.generatedAt; return copy; };
  const officialBefore = strip(await publicDataset());
  const officialCount = officialBefore.participations.length;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await newPage(context);
  await adminLogin(page);
  await page.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();

  // 1. Sukurti bandomąjį sezoną
  await page.click('[data-act="tab"][data-tab="test"]');
  await page.getByRole('heading', { name: /BANDYMAS – saugus sistemos patikrinimas/ }).waitFor();
  await shot(page, 'admin-bandymas-pradzia');
  await page.click('[data-act="create-test-season"]');
  await page.locator('.notice.success', { hasText: 'Bandomasis sezonas sukurtas' }).waitFor();
  assert.equal(owner(`select count(*) from public.tournaments where season_id = 'bandymas';`), '3');

  // 2. Bandomieji žaidėjai (su varnele)
  await page.click('[data-act="tab"][data-tab="players"]');
  for (const last of ['Pirmas', 'Antras', 'Trečias', 'Ketvirtas']) {
    await page.fill('#new-first', 'Bandymas');
    await page.fill('#new-last', last);
    await page.check('#new-test');
    await page.click('form[data-form="player"] button[type="submit"]');
    await page.locator('.notice.success', { hasText: `Bandymas ${last}` }).waitFor();
    assert.equal(await page.locator('#new-test').isChecked(), false, 'varnelė po išsaugojimo išvaloma (kad netyčia nebūtų bandomasis kitas žaidėjas)');
  }
  assert.equal(owner(`select count(*) from public.players where is_test;`), '4');
  assert.equal(owner(`select count(*) from public.players where not is_test and full_name like 'Bandymas %';`), '0');
  assert.ok(await page.locator('#players-table .status', { hasText: 'BANDOMASIS' }).count() >= 4);

  // 3. Bandomasis turnyras: juodraštis nematomas viešai, paskelbimas matomas tik bandomajame sezone
  await page.click('[data-act="tab"][data-tab="test"]');
  await page.click('[data-act="open-test-tournament"]');
  await page.locator('#test-season-note').waitFor();
  const rows = page.locator('#results-table tbody tr');
  await page.click('[data-act="add-team"]'); await page.click('[data-act="add-team"]');
  const teams = [['Bandymas Pirmas', 'Bandymas Antras', '1', '50'], ['Bandymas Trečias', 'Bandymas Ketvirtas', '2', '40']];
  for (let i = 0; i < teams.length; i += 1) {
    const [a, b, pos, pts] = teams[i];
    await rows.nth(i).locator('select[data-field="player1"]').selectOption(pid(a));
    await rows.nth(i).locator('select[data-field="player2"]').selectOption(pid(b));
    await rows.nth(i).locator('input[data-field="position"]').fill(pos);
    assert.equal((await rows.nth(i).locator('[data-points]').innerText()).trim(), pts);
  }
  await page.click('[data-act="save-draft"]');
  await page.locator('.notice.success', { hasText: 'Juodraštis išsaugotas' }).waitFor();
  assert.equal(strip(await publicDataset()).participations.length, officialCount, 'bandomasis juodraštis viešai nematomas');
  await page.click('[data-act="finalize"]');
  await page.locator('.notice.success', { hasText: 'Rezultatai patvirtinti ir paskelbti' }).waitFor();
  await shot(page, 'admin-bandymas-paskelbta');

  // Oficialiame turnyre bandomieji žaidėjai išjungti (ir serveris jų neįsileistų)
  await page.selectOption('select[data-sel="season"]', '2026-2027');
  await page.selectOption('select[data-sel="tournament"]', C1);
  await page.click('[data-act="add-team"]');
  const blockedOpt = page.locator(`#results-table select[data-field="player1"] option[value="${pid('Bandymas Pirmas')}"]`).first();
  assert.notEqual(await blockedOpt.getAttribute('disabled'), null, 'bandomasis žaidėjas oficialiame turnyre neleidžiamas');
  const token = await tokenFor(ADMIN);
  const sneaky = await api('/rest/v1/rpc/admin_save_results', { token, body: { p_tournament_id: C1, p_status: 'draft', p_entries: [{ position: 1, playerIds: [pid('Bandymas Pirmas'), pid('Jonas Jonaitis')] }] } });
  assert.equal(sneaky.status, 400);
  assert.equal(sneaky.json.message, 'test_player_in_official');

  // 4. Viešai: bandomasis sezonas tik tiesioginiu adresu, su perspėjimu; pagrindinis reitingas nepakito
  const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pub = await newPage(anon);
  await pub.goto(`${site}reitingai.html`);
  await pub.locator('.rrow').first().waitFor();
  const mainRows = await publicRows(pub);
  assert.equal(mainRows.length, 4, 'pagrindiniame reitinge tik oficialios poros');
  assert.ok(mainRows.every((r) => !r.name.startsWith('Bandymas')));
  assert.ok(!(await pub.locator('#app').innerText()).includes('BANDOMASIS SEZONAS'));
  assert.ok(!(await pub.locator('#app').innerText()).includes('Bandymas'), 'bandomųjų žaidėjų numatytame rodinyje nėra');
  await pub.goto(`${site}reitingai.html#elite?s=bandymas`);
  await pub.locator('#test-banner').waitFor();
  await pub.locator('.rrow').first().waitFor();
  const testRows = await publicRows(pub);
  assert.deepEqual(testRows.map((r) => r.points).sort((x, y) => y - x), [50, 40], 'viena pora – vieni taškai (nedubliuojami)');
  assert.ok(testRows.every((r) => r.name.startsWith('Bandymas')));
  await shot(pub, 'viesas-bandymas');

  // 5. Valymas vienu mygtuku
  await page.click('[data-act="tab"][data-tab="test"]');
  assert.equal((await page.locator('#test-players-count').innerText()).trim(), '4');
  assert.equal((await page.locator('#test-published-count').innerText()).trim(), '1');
  await page.click('[data-act="delete-test-data"]');
  await page.locator('.notice.success', { hasText: 'Bandymo duomenys ištrinti' }).waitFor();
  assert.equal(owner(`select count(*) from public.players where is_test;`), '0');
  assert.equal(owner(`select count(*) from public.seasons where is_test;`), '0');
  assert.equal(owner(`select count(*) from public.tournaments where season_id = 'bandymas';`), '0');
  assert.equal(owner(`select count(*) from public.audit_log where action = 'delete_test_data';`), '1', 'audito žurnalas išlieka');
  assert.deepEqual(strip(await publicDataset()), officialBefore, 'po valymo viešas atsakymas identiškas ankstesniam');
  await pub.reload(); // lankytojas perkrauna puslapį ir gauna naujus duomenis
  await pub.locator('.rrow').first().waitFor();
  assert.equal(await pub.locator('#test-banner').count(), 0, 'bandomojo sezono nebėra');
  assert.equal((await publicRows(pub)).length, 4);
  await anon.close();
  await context.close();
});

test('Vadovo 12 žingsnio konsolės patikra (kodas paimtas tiesiai iš docs/SUPABASE-DIEGIMAS.md) duoda tikėtą rezultatą', { skip }, async () => {
  const doc = readFileSync(join(root, 'docs', 'SUPABASE-DIEGIMAS.md'), 'utf8');
  const code = /```js\n(const \{ RUNTIME: R \}[\s\S]*?)```/.exec(doc)[1];
  const before = owner('select (select count(*) from public.players) || \'|\' || (select count(*) from public.audit_log) || \'|\' || (select count(*) from public.seasons);');
  for (const mode of ['anon-jwt', 'publishable']) {
    const srv = await startLocalSupabase({ pg: { host: HOST, port: PORT, user: USER }, database: DB, staticRoot: root, users: [ADMIN], keyMode: mode });
    try {
      const context = await browser.newContext();
      const page = await newPage(context);
      const lines = [];
      page.on('console', (m) => lines.push(m.text()));
      await page.goto(`${srv.siteUrl}reitingai.html`);
      await page.locator('#app').waitFor();
      await page.evaluate(async (src) => {
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        await new AsyncFunction(src.replace("import('./ranking/runtime-config.js')", `import('${location.origin}${location.pathname.replace(/[^/]*$/, '')}ranking/runtime-config.js')`))();
      }, code);
      const status = (needle) => Number((lines.find((l) => l.includes(needle)) || '').split('→')[1]);
      assert.ok([401, 403].includes(status('POST /rest/v1/players')), `${mode}: anoniminis įrašymas atmestas: ${lines.join(' | ')}`);
      assert.ok([401, 403].includes(status('GET /rest/v1/players')), `${mode}: anoniminis skaitymas atmestas`);
      assert.ok([401, 403].includes(status('admin_delete_test_data')), `${mode}: admin funkcija atmesta`);
      assert.equal(status('public_ranking_data'), 200, `${mode}: viešas skaitymas veikia`);
      await context.close();
    } finally { await srv.close(); }
  }
  assert.equal(owner('select (select count(*) from public.players) || \'|\' || (select count(*) from public.audit_log) || \'|\' || (select count(*) from public.seasons);'), before, 'patikra nieko nepakeitė');
});

test('Telefono dydžio ekranas: viešas reitingas ir administravimas be horizontalios slinkties', { skip }, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newPage(context);
  await page.goto(`${site}reitingai.html`);
  await page.locator('.rrow').first().waitFor();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const offenders = () => page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > limit + 1)
      .slice(0, 6).map((el) => `${el.tagName.toLowerCase()}.${el.className} (${Math.round(el.getBoundingClientRect().right)}px)`);
  });
  assert.ok(await overflow() <= 1, 'viešas puslapis telefone netelpa');
  await shot(page, 'viesas-telefonas');
  await adminLogin(page);
  await page.getByText('PRIDĖTI ŽAIDĖJĄ').waitFor();
  assert.ok(await overflow() <= 1, 'administravimas (žaidėjai) telefone netelpa');
  await shot(page, 'admin-zaidejai-telefonas');
  await page.click('[data-act="tab"][data-tab="results"]');
  await page.selectOption('select[data-sel="tournament"]', E1);
  await page.locator('#results-table tbody tr').first().waitFor();
  assert.ok(await overflow() <= 1, `administravimas (rezultatai) telefone netelpa: ${(await offenders()).join('; ')}`);
  await shot(page, 'admin-rezultatai-telefonas');
  await page.click('[data-act="tab"][data-tab="test"]');
  await page.locator('#test-panel').waitFor();
  assert.ok(await overflow() <= 1, `administravimas (bandymas) telefone netelpa: ${(await offenders()).join('; ')}`);
  await shot(page, 'admin-bandymas-telefonas');
  await context.close();
});

test('Egzistuojantis kalendorius ir registracijos nuorodos puslapyje nepakito (naršyklėje)', { skip }, async () => {
  const context = await browser.newContext();
  const page = await newPage(context);
  await page.goto(`${site}index.html`);
  assert.equal(await page.locator('article.event').count(), 19);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
  assert.ok(hrefs.some((h) => /forms\.office\.com|forms\.cloud\.microsoft/.test(h)), 'registracijos nuoroda yra');
  assert.ok(hrefs.includes('reitingai.html'), 'REITINGAI nuoroda yra');
  await page.click('.mainnav a[href="reitingai.html"]');
  await page.waitForURL(/reitingai\.html/);
  await page.locator('#app').waitFor();
  await context.close();
});

test('E2E valymas', { skip }, async () => {
  if (browser) await browser.close();
  if (server) await server.close();
  if (unconfigured) await unconfigured.close();
  assert.ok(psql('postgres', `drop database if exists ${DB};`).ok);
});
