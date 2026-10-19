// Viešas puslapis ir bandomasis sezonas: nerodomas pagal nutylėjimą, neįtraukiamas į istorinę statistiką,
// tiesioginiu adresu atidaromas su aiškiu perspėjimu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom, tick } from './dom-stub.mjs';
import { computeAllTime } from '../ranking/engine.js';
import { pickDefaultSeason } from '../ranking/view.js';

const dom = installDom({ hostname: 'arturasbekis-png.github.io' });

const payload = {
  generatedAt: '2026-10-12T10:00:00Z',
  seasons: [
    { id: '2026-2027', label: '2026–2027', isCurrent: true, scoringVersion: 'v1', isTest: false },
    { id: 'bandymas', label: 'BANDOMASIS SEZONAS (neoficialus)', isCurrent: false, scoringVersion: 'v1', isTest: true },
  ],
  tournaments: [
    { id: '2026-2027-elite-1', seasonId: '2026-2027', type: 'elite', number: 1, name: 'ELITE #1', date: '2026-10-11', startTime: '11:00', status: 'finalized', allowTies: false, scoringVersion: 'v1', revision: 1 },
    { id: 'bandymas-elite-1', seasonId: 'bandymas', type: 'elite', number: 1, name: 'BANDOMASIS ELITE #1', date: '2026-10-12', startTime: '11:00', status: 'finalized', allowTies: false, scoringVersion: 'v1', revision: 1 },
  ],
  players: [
    { id: 'o1', fullName: 'Oficialus Vienas' }, { id: 'o2', fullName: 'Oficialus Du' },
    { id: 't1', fullName: 'Bandymas Vienas' }, { id: 't2', fullName: 'Bandymas Du' },
  ],
  participations: [
    { id: 'p1', tournamentId: '2026-2027-elite-1', position: 1, playerIds: ['o1', 'o2'] },
    { id: 'p2', tournamentId: 'bandymas-elite-1', position: 1, playerIds: ['t1', 't2'] },
  ],
};

test('Engine/view: bandomasis sezonas neįtraukiamas į istorinę statistiką ir nėra numatytasis', () => {
  const data = {
    seasons: payload.seasons, tournaments: payload.tournaments, participations: payload.participations,
    players: payload.players.map((p) => ({ ...p, gender: null, isActive: true, mergedInto: null })),
  };
  const names = computeAllTime(data).map((r) => r.name).sort();
  assert.deepEqual(names, ['Oficialus Du', 'Oficialus Vienas']);
  assert.equal(pickDefaultSeason(payload.seasons), '2026-2027');
  assert.equal(pickDefaultSeason([{ id: 'bandymas', isTest: true }, { id: 'x', isCurrent: false }]), 'x', 'bandomasis niekada nerenkamas, jei yra oficialus');
});

test('Viešas puslapis: bandomasis sezonas paslėptas, bet atidaromas tiesioginiu adresu su perspėjimu', async () => {
  const { RUNTIME } = await import('../ranking/runtime-config.js');
  RUNTIME.supabaseUrl = 'https://abcdefghijkl.supabase.co';
  RUNTIME.supabaseAnonKey = 'sb_publishable_TESTONLYabcdefghijklmnop';
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };
  await import('../ranking/public-app.js');
  await tick();

  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith('/rest/v1/rpc/public_ranking_data'));
  assert.ok(!('Authorization' in requests[0].init.headers), 'publishable raktas tik apikey antraštėje');

  let app = dom.el('app').innerHTML;
  assert.ok(!app.includes('test-banner') && !app.includes('(bandomasis)'), 'numatytame rodinyje bandymo nėra');
  assert.ok(!app.includes('BANDOMASIS SEZONAS'), 'bandomasis sezonas sąraše nerodomas');
  const list = dom.el('list').innerHTML;
  assert.ok(list.includes('Oficialus Vienas') && !list.includes('Bandymas Vienas'));
  const alltime = dom.el('alltime').innerHTML;
  assert.ok(alltime.includes('Oficialus Vienas') && !alltime.includes('Bandymas'), 'istorinėje statistikoje bandomųjų nėra');

  // tiesioginis adresas
  dom.loc.hash = '#bendras?s=bandymas';
  await tick();
  app = dom.el('app').innerHTML;
  assert.ok(app.includes('id="test-banner"') && app.includes('BANDOMASIS SEZONAS'), 'aiškus perspėjimas');
  assert.ok(app.includes('(bandomasis)'));
  const testList = dom.el('list').innerHTML;
  assert.ok(testList.includes('Bandymas Vienas') && testList.includes('Bandymas Du') && !testList.includes('Oficialus Vienas'));
  assert.equal((testList.match(/>50</g) || []).length >= 2, true, 'abu partneriai su pilnais 50 taškų');
  assert.ok(!dom.el('alltime').innerHTML.includes('Bandymas'), 'istorinė statistika ir čia be bandomųjų');

  // grįžus į numatytą sezoną bandymo vėl nėra
  dom.loc.hash = '#bendras';
  await tick();
  assert.ok(!dom.el('app').innerHTML.includes('test-banner'));
});
