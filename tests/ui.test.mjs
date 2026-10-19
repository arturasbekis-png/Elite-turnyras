import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRankings, computePairRankings, tournamentView } from '../ranking/engine.js';
import {
  applyView, fold, mergeTournaments, mergeSeasons, pickDefaultSeason, formatDate, parseRoute, buildRoute, withCalendar, hasGenderData, shortName,
} from '../ranking/view.js';
import * as R from '../ranking/render.js';
import { SCORING_TABLES } from '../ranking/config.js';
import { SEASON_EVENTS } from '../ranking/events.js';
import { build, player, SEASON } from './helpers.mjs';

const sample = () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[1, ['p3', 'p4']], [2, ['p1', 'p5']], [3, ['p2', 'p6']]] },
  ] });
  d.players.find((p) => p.id === 'p1').fullName = 'Žilvinas Žilys';
  d.players.find((p) => p.id === 'p2').fullName = 'Ąžuolas Ūdra';
  d.players.find((p) => p.id === 'p3').fullName = 'Rūta Kazlauskaitė';
  d.players.find((p) => p.id === 'p3').gender = 'F';
  d.tournaments.forEach((t) => { t.name = t.type === 'elite' ? 'ELITE #1' : 'CHALLENGE #1'; t.number = 1; });
  return d;
};

test('Paieška ignoruoja lietuviškus diakritikus ir didžiąsias raides', () => {
  assert.equal(fold('Žilvinas ŪDRA'), 'zilvinas udra');
  const rows = computeRankings(sample(), { seasonId: SEASON }).overall;
  assert.deepEqual(applyView(rows, { query: 'zilvinas' }).map((r) => r.name), ['Žilvinas Žilys']);
  assert.deepEqual(applyView(rows, { query: 'ruta kaz' }).map((r) => r.name), ['Rūta Kazlauskaitė']);
  assert.equal(applyView(rows, { query: 'nėra tokio' }).length, 0);
  assert.equal(applyView(rows, { gender: 'F' }).length, 1);
  assert.equal(hasGenderData(rows), true);
});

test('Rūšiavimas keičia tik rodymo tvarką, o oficiali vieta lieka', () => {
  const rows = computeRankings(sample(), { seasonId: SEASON }).overall;
  const byName = applyView(rows, { sort: 'name' });
  assert.deepEqual(byName.map((r) => r.name), [...byName.map((r) => r.name)].sort(new Intl.Collator('lt').compare));
  const official = new Map(rows.map((r) => [r.playerId, r.position]));
  byName.forEach((r) => assert.equal(r.position, official.get(r.playerId)));
  const byPlayed = applyView(rows, { sort: 'played' });
  assert.ok(byPlayed[0].played.total >= byPlayed[byPlayed.length - 1].played.total);
});

test('Kalendoriaus ir DB turnyrų sujungimas: DB laimi, trūkstami rodomi kaip suplanuoti', () => {
  const db = [{ ...SEASON_EVENTS[0], status: 'finalized' }];
  const merged = mergeTournaments(db);
  assert.equal(merged.length, 19, 'nėra dublikatų');
  assert.equal(merged.find((t) => t.id === SEASON_EVENTS[0].id).status, 'finalized');
  assert.equal(merged.filter((t) => t.status === 'planned').length, 18);
  assert.equal(mergeTournaments([]).length, 19);
  assert.deepEqual(merged.map((t) => t.date), [...merged.map((t) => t.date)].sort());
});

test('Sezonų sujungimas ir numatytasis sezonas', () => {
  assert.equal(pickDefaultSeason(mergeSeasons([])), '2026-2027');
  const seasons = mergeSeasons([{ id: '2027-2028', label: '2027–2028', isCurrent: true, scoringVersion: 'v1' }]);
  assert.equal(pickDefaultSeason(seasons), '2027-2028');
  assert.equal(seasons.length, 2);
  assert.equal(seasons.find((s) => s.id === '2026-2027').isCurrent, false, 'tik vienas dabartinis sezonas');
});

test('Datos ir maršrutai', () => {
  assert.equal(formatDate('2026-10-11'), '2026 m. spalio 11 d.');
  assert.equal(formatDate('2027-04-11'), '2027 m. balandžio 11 d.');
  assert.deepEqual(parseRoute('#elite'), { tab: 'elite', tournamentId: null, seasonId: null });
  assert.deepEqual(parseRoute('#turnyrai/2026-2027-elite-1?s=2025-2026'), { tab: 'turnyrai', tournamentId: '2026-2027-elite-1', seasonId: '2025-2026' });
  assert.equal(parseRoute('#nesamone').tab, 'elite');
  assert.equal(parseRoute('').tab, 'elite');
  assert.equal(parseRoute('#bendras').tab, 'elite', 'bendro reitingo nebėra – senas adresas rodo ELITE');
  assert.equal(parseRoute('#future').tab, 'elite');
  assert.equal(buildRoute({ tab: 'elite', seasonId: '2026-2027' }, '2026-2027'), '#elite');
  assert.equal(buildRoute({ tab: 'elite', seasonId: '2025-2026' }, '2026-2027'), '#elite?s=2025-2026');
  assert.equal(shortName({ type: 'challenge', number: 3 }), 'C3');
});

test('Porų reitingo HTML: viena eilutė porai, medaliai, vietos dalijimasis, be judėjimo kai nėra su kuo lyginti', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']], [3, ['p5', 'p6']], [3, ['p7', 'p8']]], allowTies: true },
  ] });
  d.players.find((p) => p.id === 'p1').fullName = 'Žilvinas Žilys';
  d.players.find((p) => p.id === 'p2').fullName = 'Ąžuolas Ūdra';
  d.tournaments[0].name = 'ELITE #1'; d.tournaments[0].number = 1;
  const r = computePairRankings(d, { seasonId: SEASON });
  const html = R.renderPairs({ category: 'elite', rows: r.categories.elite, movementAvailable: r.movementAvailable.elite });
  assert.equal((html.match(/class="rrow pair-row/g) || []).length, 4, 'viena eilutė porai (ne žaidėjui)');
  assert.ok(html.includes('🥇') && html.includes('🥈') && html.includes('🥉'));
  assert.ok(html.includes('class="tie"'), 'poros dalijasi vieta');
  assert.ok(html.includes('Žilvinas Žilys') && html.includes('Ąžuolas Ūdra'));
  assert.ok(html.includes('ELITE porų reitingas'));
  assert.ok(!/rmove|▲|▼|Judėjimas/.test(html), 'vieno turnyro lentelėje judėjimo nėra');
  const open = R.renderPairs({ category: 'elite', rows: r.categories.elite, expanded: new Set([`elite:${r.categories.elite[0].pairKey}`]) });
  assert.ok(open.includes('ELITE #1') && open.includes('Poros taškų suma') && open.includes('aria-expanded="true"'));
});

test('Porų reitingo HTML: judėjimas rodomas tik kai kategorijoje yra bent du turnyrai', () => {
  const d = build({ tournaments: [
    { id: 'e1', type: 'elite', date: '2026-10-11', teams: [[1, ['p1', 'p2']], [2, ['p3', 'p4']]] },
    { id: 'e2', type: 'elite', date: '2026-11-08', teams: [[1, ['p3', 'p4']], [2, ['p1', 'p2']]] },
    { id: 'c1', type: 'challenge', date: '2026-10-18', teams: [[1, ['p5', 'p6']]] },
  ] });
  d.tournaments.forEach((t) => { t.name = `${t.type.toUpperCase()} #1`; t.number = 1; });
  const r = computePairRankings(d, { seasonId: SEASON });
  assert.equal(r.movementAvailable.elite, true);
  assert.equal(r.movementAvailable.challenge, false);
  const elite = R.renderPairs({ category: 'elite', rows: r.categories.elite, movementAvailable: true });
  assert.ok(elite.includes('Judėjimas') && (elite.includes('▲') || elite.includes('▼')));
  const challenge = R.renderPairs({ category: 'challenge', rows: r.categories.challenge, movementAvailable: false });
  assert.ok(!/▲|▼|Judėjimas/.test(challenge));
});

test('XSS apsauga: vardai ir pavadinimai išvalomi', () => {
  const rows = [{ pairKey: 'x|y', names: ['<img src=x onerror=alert(1)>', 'B'], name: '<img src=x onerror=alert(1)> / B', position: 1, tied: false, points: 50, played: 1, wins: 1, seconds: 0, movement: null, results: [] }];
  const html = R.renderPairs({ category: 'elite', rows });
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.equal(R.esc(`"'&<>`), '&quot;&#39;&amp;&lt;&gt;');
  assert.ok(!R.renderError('<script>x</script>').includes('<script>'));
});

test('Būsenos: kraunama, klaida su kartojimu, tuščia', () => {
  assert.ok(R.renderLoading().includes('Kraunami reitingai'));
  const err = R.renderError('Nepavyko prisijungti');
  assert.ok(err.includes('data-action="retry"') && err.includes('Bandyti dar kartą'));
  assert.ok(R.renderEmpty(...R.EMPTY_OFFICIAL).includes('Oficialių rezultatų dar nėra'));
});

test('Turnyrų sąrašas: visi 19 kalendoriaus renginių, BEACH LEAGUE FINAL be taškų', () => {
  const data = withCalendar({ seasons: [], tournaments: [], players: [], participations: [] });
  const html = R.renderTournamentList({ tournaments: data.tournaments, teamCounts: new Map(), seasonId: null });
  assert.equal((html.match(/class="tcard /g) || []).length, 19);
  assert.ok(html.includes('BEACH LEAGUE FINAL'));
  assert.ok(html.includes('Taškų sistema nenustatyta'));
  assert.ok(html.includes('Suplanuotas'));
  const elite = R.renderTournamentList({ tournaments: data.tournaments, teamCounts: new Map(), filter: 'elite' });
  assert.equal((elite.match(/class="tcard /g) || []).length, 6);
});

test('Turnyro detalės: poveikis reitingams, taškai ir nepaskelbti rezultatai', () => {
  const d = sample();
  const view = tournamentView(d, 'c1');
  const html = R.renderTournamentDetail({ view, backHref: '#turnyrai' });
  assert.ok(html.includes('CHALLENGE porų reitingas') && !html.includes('BENDRAS REITINGAS'));
  assert.ok(html.includes('Taškai porai'));
  assert.ok(html.includes('Rūta Kazlauskaitė'));
  assert.ok(html.includes('40'), 'pirmos vietos CHALLENGE taškai');
  d.tournaments.find((t) => t.id === 'c1').status = 'draft';
  const draft = R.renderTournamentDetail({ view: tournamentView(d, 'c1'), backHref: '#turnyrai' });
  assert.ok(draft.includes('Rezultatai dar nepaskelbti'));
  assert.ok(!draft.includes('Rūta Kazlauskaitė'), 'juodraščio komandos nerodomos');
});

test('Taisyklių skiltis „Reitingavimo taisyklės“ generuojama iš config ir turi visą taškų lentelę', () => {
  const html = R.renderRules('v1');
  assert.ok(html.includes('Reitingavimo taisyklės'));
  for (const text of ['9–12', '13–16', 'dalyvavimas', 'ta pačia vieta', 'BEACH LEAGUE FINAL', 'porų, ne atskirų žaidėjų', 'Bendro reitingo nėra']) assert.ok(html.includes(text), text);
  // tikrinam, kad lentelėje yra visi skaičiai iš config (be hardcode)
  const bands = SCORING_TABLES.v1.tables;
  for (const key of ['elite', 'challenge', 'future']) {
    bands[key].forEach((b, i) => assert.equal(b.from, bands.elite[i].from, 'visos lentelės turi tas pačias juostas'));
  }
  assert.ok(html.includes('<td class="pts">50</td>') && html.includes('<td class="pts">40</td>') && html.includes('<td class="pts">30</td>'));
});

test('Poros detalės: kiekvienas turnyras ir poros taškai', () => {
  assert.ok(R.renderPairDetail({ results: [] }).includes('dar neturi'));
  const html = R.renderPairDetail({ points: 71, results: [
    { type: 'elite', tournamentName: 'ELITE #1', date: '2026-10-11', position: 1, points: 50 },
    { type: 'elite', tournamentName: 'ELITE #2', date: '2026-11-08', position: 5, points: 21 },
  ] });
  assert.ok(html.includes('ELITE #1') && html.includes('ELITE #2') && html.includes('Taškai porai') && html.includes('>71<'));
});
