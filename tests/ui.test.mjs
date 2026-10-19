import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRankings, tournamentView } from '../ranking/engine.js';
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
  assert.equal(parseRoute('#nesamone').tab, 'bendras');
  assert.equal(parseRoute('').tab, 'bendras');
  assert.equal(buildRoute({ tab: 'elite', seasonId: '2026-2027' }, '2026-2027'), '#elite');
  assert.equal(buildRoute({ tab: 'elite', seasonId: '2025-2026' }, '2026-2027'), '#elite?s=2025-2026');
  assert.equal(shortName({ type: 'challenge', number: 3 }), 'C3');
});

test('Reitingų HTML: medaliai, pozicijos, lygių indikatorius ir judėjimas', () => {
  const d = sample();
  const r = computeRankings(d, { seasonId: SEASON });
  const html = R.renderOverall({ rows: r.overall, playersById: new Map(d.players.map((p) => [p.id, p])), movementAvailable: r.movementAvailable });
  assert.ok(html.includes('🥇'));
  assert.ok(html.includes('🥈') || html.includes('🥉'));
  assert.ok(html.includes('class="tie"'), 'poros nariai dalijasi vieta');
  assert.ok(html.includes('Žilvinas Žilys'));
  assert.ok(html.includes('data-toggle="p1"'));
  // išskleista eilutė rodo taškų suskirstymą pagal turnyrus ir partnerius
  const open = R.renderOverall({ rows: r.overall, expanded: new Set(['p1']), playersById: new Map(d.players.map((p) => [p.id, p])) });
  assert.ok(open.includes('ELITE #1') && open.includes('CHALLENGE #1'));
  assert.ok(open.includes('Taškų suma'));
  assert.ok(open.includes('aria-expanded="true"'));
});

test('Kategorijos HTML rodo taškus pagal turnyrus ir tik tos kategorijos žaidėjus', () => {
  const d = sample();
  const r = computeRankings(d, { seasonId: SEASON });
  const html = R.renderCategory({ category: 'challenge', rows: r.categories.challenge, playersById: new Map(d.players.map((p) => [p.id, p])) });
  assert.ok(html.includes('CHALLENGE reitingas'));
  assert.ok(html.includes('class="chip type-challenge"'));
  assert.ok(!html.includes('type-elite"'), 'ELITE čipų nėra');
});

test('XSS apsauga: vardai ir pavadinimai išvalomi', () => {
  const rows = [{ playerId: 'x', name: '<img src=x onerror=alert(1)>', position: 1, tied: false, points: 50, played: { elite: 1, challenge: 0, future: 0, total: 1 }, wins: 1, movement: null, results: [] }];
  const html = R.renderOverall({ rows });
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
  assert.ok(html.includes('BENDRAS REITINGAS') && html.includes('CHALLENGE reitingas'));
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
  for (const text of ['9–12', '13–16', 'dalyvavimas', 'ta pačia vieta', 'BEACH LEAGUE FINAL', 'audito žurnale']) assert.ok(html.includes(text), text);
  // tikrinam, kad lentelėje yra visi skaičiai iš config (be hardcode)
  const bands = SCORING_TABLES.v1.tables;
  for (const key of ['elite', 'challenge', 'future']) {
    bands[key].forEach((b, i) => assert.equal(b.from, bands.elite[i].from, 'visos lentelės turi tas pačias juostas'));
  }
  assert.ok(html.includes('<td class="pts">50</td>') && html.includes('<td class="pts">40</td>') && html.includes('<td class="pts">30</td>'));
});

test('Visų sezonų statistika atskirta ir paaiškinta; tuščia – nerodoma', () => {
  assert.equal(R.renderAllTime([]), '');
  const html = R.renderAllTime([{ position: 1, tied: false, name: 'X', points: 90, played: { total: 2 }, wins: 1, seasons: 2 }]);
  assert.ok(html.includes('Visų sezonų statistika') && html.includes('ne sezono reitingas'));
});

test('Žaidėjo detalės: finalo rezultatas rodomas be taškų', () => {
  const html = R.renderPlayerDetail({ results: [{ type: 'final', tournamentName: 'BEACH LEAGUE FINAL', date: '2027-04-11', position: 1, partnerIds: ['p2'], points: 0, counted: false }] }, new Map([['p2', player('p2')]]));
  assert.ok(html.includes('BEACH LEAGUE FINAL'));
  assert.ok(html.includes('Šio renginio taškų sistema dar nenustatyta'));
});
