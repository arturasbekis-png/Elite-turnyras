import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRankings } from '../ranking/engine.js';
import { saveDraft, finalizeTournament, correctTournament, mergePlayers, DomainError } from '../ranking/domain.js';
import { overallCsv, categoryCsv, tournamentCsv, toCsv } from '../ranking/csv.js';
import { dataset, player, tournament, row, SEASON } from './helpers.mjs';

function fresh() {
  return dataset({
    players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => player(id)),
    tournaments: [tournament('e1', 'elite', { status: 'planned' }), tournament('c1', 'challenge', { status: 'planned', date: '2026-10-18' })],
  });
}
let n = 0;
const nextId = () => `id-${++n}`;
const entries = (spec) => spec.map(([position, playerIds]) => ({ position, playerIds }));
const rank = (d) => computeRankings(d, { seasonId: SEASON });

// ───────── TEST G — patvirtinimas ─────────
test('G: patvirtinus turnyrą taškai paskelbiami teisingai ir lygiai vieną kartą', () => {
  let d = fresh();
  d = saveDraft(d, 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']], [3, ['e', 'f']]]), { nextId });
  assert.equal(rank(d).overall.length, 0, 'juodraštis taškų neduoda');

  d = finalizeTournament(d, 'e1', { now: '2026-10-11T18:00:00Z', actor: 'admin-1' });
  const r = rank(d);
  assert.equal(row(r.overall, 'a').points, 50);
  assert.equal(row(r.overall, 'b').points, 50);
  assert.equal(row(r.overall, 'c').points, 40);
  assert.equal(row(r.overall, 'e').points, 32);
  assert.equal(r.results.length, 6, 'po vieną rezultatą kiekvienam iš 6 žaidėjų');

  // antras paskelbimas – klaida, niekas nekinta
  assert.throws(() => finalizeTournament(d, 'e1'), (err) => err instanceof DomainError && err.code === 'already_finalized');
  assert.equal(rank(d).results.length, 6);
  assert.equal(row(rank(d).overall, 'a').points, 50);
  assert.equal(d.auditLog.filter((x) => x.action === 'finalize').length, 1);
});

test('G: neteisingų ar nepilnų rezultatų patvirtinti negalima', () => {
  let d = fresh();
  d = saveDraft(d, 'e1', entries([[1, ['a', 'b']], [1, ['c', 'd']]]), { nextId });
  assert.throws(() => finalizeTournament(d, 'e1'), (err) => err.code === 'validation_failed' && err.details.some((e) => e.code === 'duplicate_position'));
  assert.equal(d.tournaments.find((t) => t.id === 'e1').status, 'draft');
  assert.equal(rank(d).overall.length, 0);

  const incomplete = saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['c', null]]]), { nextId });
  assert.throws(() => finalizeTournament(incomplete, 'e1'), (err) => err.details.some((e) => e.code === 'team_needs_two_players'));
});

test('G: patvirtintame turnyre juodraščio išsaugoti negalima', () => {
  let d = saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']]]), { nextId });
  d = finalizeTournament(d, 'e1');
  assert.throws(() => saveDraft(d, 'e1', entries([[1, ['c', 'd']], [2, ['a', 'b']]]), { nextId }), (err) => err.code === 'tournament_finalized');
});

// ───────── TEST H — pataisymas ─────────
test('H: paskelbtų rezultatų pataisymas perskaičiuoja sumas, nedubliuoja taškų ir palieka auditą', () => {
  let d = saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']], [3, ['e', 'f']]]), { nextId });
  d = finalizeTournament(d, 'e1', { now: '2026-10-11T18:00:00Z' });
  assert.equal(row(rank(d).overall, 'a').points, 50);

  // Pataisymas: iš tiesų laimėjo c+d, a+b – antri.
  d = correctTournament(d, 'e1', entries([[2, ['a', 'b']], [1, ['c', 'd']], [3, ['e', 'f']]]), { reason: 'Neteisingai įvesta finalo vieta', actor: 'admin-1', now: '2026-10-12T09:00:00Z', nextId });
  const r = rank(d);
  assert.equal(row(r.overall, 'a').points, 40);
  assert.equal(row(r.overall, 'c').points, 50);
  assert.equal(row(r.overall, 'e').points, 32);
  assert.equal(r.results.length, 6, 'taškai nesidubliuoja');
  assert.equal(r.overall.reduce((s, x) => s + x.points, 0), 2 * (50 + 40 + 32), 'bendra taškų suma nepasikeitė dėl dubliavimo');
  assert.equal(d.tournaments.find((t) => t.id === 'e1').revision, 2);

  const audit = d.auditLog.filter((x) => x.action === 'correct');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, 'Neteisingai įvesta finalo vieta');
  assert.equal(audit[0].before.find((p) => p.playerIds.includes('a')).position, 1, 'audite išsaugotas senas variantas');
  assert.equal(audit[0].after.find((p) => p.playerIds.includes('a')).position, 2);
});

test('H: pataisymui reikia priežasties, o netinkamas pataisymas nepažeidžia oficialių rezultatų', () => {
  let d = saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']]]), { nextId });
  d = finalizeTournament(d, 'e1');
  assert.throws(() => correctTournament(d, 'e1', entries([[1, ['c', 'd']], [2, ['a', 'b']]]), { reason: '' , nextId }), (err) => err.code === 'reason_required');
  assert.throws(() => correctTournament(d, 'e1', entries([[1, ['c', 'd']], [1, ['a', 'b']]]), { reason: 'Bandymas su klaida', nextId }), (err) => err.code === 'validation_failed');
  // originalas (d) nepakeistas
  assert.equal(row(rank(d).overall, 'a').points, 50);
  assert.equal(d.tournaments[0].revision, 1);
  assert.throws(() => correctTournament(fresh(), 'e1', [], { reason: 'Dar nepaskelbta', nextId }), (err) => err.code === 'not_finalized');
});

// ───────── TEST I — dubliavimo prevencija ─────────
test('I: tas pats žaidėjas negali būti dviejose to paties turnyro komandose (net juodraštyje)', () => {
  assert.throws(
    () => saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['a', 'c']]]), { nextId }),
    (err) => err.code === 'player_in_two_teams',
  );
});

// ───────── Žaidėjų sujungimas ─────────
test('Žaidėjų sujungimas išsaugo visą istoriją ir taškus', () => {
  let d = fresh();
  d.players.push(player('a-dup', { fullName: 'Testinis a (dublikatas)' }));
  d = saveDraft(d, 'e1', entries([[1, ['a-dup', 'b']], [2, ['c', 'd']]]), { nextId });
  d = finalizeTournament(d, 'e1');
  d = saveDraft(d, 'c1', entries([[1, ['a', 'e']], [2, ['c', 'f']]]), { nextId });
  d = finalizeTournament(d, 'c1');
  assert.equal(row(rank(d).overall, 'a').points, 40);
  assert.equal(row(rank(d).overall, 'a-dup').points, 50);

  const merged = mergePlayers(d, 'a', 'a-dup', { reason: 'Dublikatas', actor: 'admin-1' });
  const r = rank(merged);
  assert.equal(row(r.overall, 'a').points, 90, 'ELITE 50 + CHALLENGE 40');
  assert.equal(row(r.overall, 'a').played.total, 2);
  assert.equal(row(r.overall, 'a-dup'), undefined, 'dublikato eilutės nebėra');
  assert.equal(merged.players.find((p) => p.id === 'a-dup').mergedInto, 'a');
  assert.equal(merged.players.find((p) => p.id === 'a-dup').isActive, false);
  assert.ok(merged.auditLog.some((x) => x.action === 'merge_players'));
  // visi ankstesni taškai išliko: bendra taškų suma nepasikeitė
  assert.equal(r.overall.reduce((s, x) => s + x.points, 0), rank(d).overall.reduce((s, x) => s + x.points, 0));
});

test('Žaidėjų sujungimas atmetamas, kai abu įrašai žaidė tame pačiame turnyre', () => {
  let d = saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']]]), { nextId });
  assert.throws(() => mergePlayers(d, 'a', 'b'), (err) => err.code === 'merge_conflict');
  assert.throws(() => mergePlayers(d, 'a', 'a'), (err) => err.code === 'merge_same');
});

test('Vardo pataisymas nekuria dublikato ir nekeičia taškų', () => {
  let d = saveDraft(fresh(), 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']]]), { nextId });
  d = finalizeTournament(d, 'e1');
  const corrected = { ...d, players: d.players.map((p) => (p.id === 'a' ? { ...p, fullName: 'Teisingas Vardas' } : p)) };
  const r = rank(corrected);
  assert.equal(corrected.players.length, d.players.length);
  assert.equal(row(r.overall, 'a').name, 'Teisingas Vardas');
  assert.equal(row(r.overall, 'a').points, 50);
});

test('Dataset funkcijos nekeičia gauto objekto', () => {
  const d = fresh();
  const frozen = JSON.stringify(d);
  saveDraft(d, 'e1', entries([[1, ['a', 'b']], [2, ['c', 'd']]]), { nextId });
  assert.equal(JSON.stringify(d), frozen);
});

// ───────── CSV ─────────
test('CSV: antraštės, BOM, lietuviškos raidės ir apsauga nuo formulių', () => {
  const rows = [{ position: 1, tied: false, name: 'Žaidėjas; „Testas“', points: 50, played: { elite: 1, challenge: 0, future: 0, total: 1 }, wins: 1 },
    { position: 2, tied: true, name: '=HYPERLINK("x")', points: 40, played: { elite: 1, challenge: 0, future: 0, total: 1 }, wins: 0 }];
  const csv = overallCsv(rows);
  assert.ok(csv.startsWith('﻿Vieta;Žaidėjas;Taškai;'));
  assert.ok(csv.includes('"Žaidėjas; „Testas“"'));
  assert.ok(csv.includes("'=HYPERLINK"), 'formulė neutralizuota');
  assert.ok(csv.includes('2=;'), 'lygi vieta pažymėta');
  assert.equal(toCsv(['a'], [['-5'], ['-abc']]), '﻿a\r\n-5\r\n\'-abc\r\n');
  assert.ok(categoryCsv([{ position: 1, tied: false, name: 'X', points: 40, played: 1, wins: 1, seconds: 0 }]).includes('Pergalės'));
  const t = { name: 'ELITE #1', date: '2026-10-11' };
  const tcsv = tournamentCsv(t, [{ position: 1, teamName: null, points: 50, players: [{ name: 'A' }, { name: 'B' }] }]);
  assert.equal(tcsv.trim().split('\r\n').length, 3, 'antraštė + po eilutę kiekvienam žaidėjui');
});
