import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEASON_EVENTS } from '../ranking/events.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function parseCalendar(source) {
  const re = /<article class="event [^"]*" data-type="([^"]+)">[\s\S]*?<div class="event-name">([^<]+)<\/div>\s*<div class="event-date">([^<]*?) · <strong>([^<]+)<\/strong>/g;
  const typeMap = { start: 'future' };
  const events = [];
  let m;
  while ((m = re.exec(source))) {
    events.push({ type: typeMap[m[1]] || m[1], name: m[2].replace(/^[^A-Za-z]+/, '').trim(), dateText: m[3].trim(), time: m[4].trim() });
  }
  return events;
}

test('Reitingų turnyrai sutampa su index.html kalendoriumi (pavadinimai, datos, laikas, tvarka)', () => {
  const calendar = parseCalendar(html);
  assert.equal(calendar.length, 19, 'kalendoriuje 19 renginių');
  assert.equal(SEASON_EVENTS.length, calendar.length);
  calendar.forEach((c, i) => {
    const e = SEASON_EVENTS[i];
    assert.equal(e.name, c.name, `pavadinimas #${i + 1}`);
    assert.equal(e.type, c.type, `tipas ${c.name}`);
    assert.equal(e.calendarDateText, c.dateText, `data ${c.name}`);
    assert.equal(e.startTime, c.time, `laikas ${c.name}`);
  });
});

test('Renginių ID unikalūs, datos didėjančios ir sezono ribose', () => {
  assert.equal(new Set(SEASON_EVENTS.map((e) => e.id)).size, SEASON_EVENTS.length);
  const dates = SEASON_EVENTS.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.ok(dates[0] >= '2026-10-01' && dates.at(-1) <= '2027-04-30');
  // Mėnuo iš lietuviško teksto sutampa su ISO data
  const months = { Spalio: '10', Lapkričio: '11', Gruodžio: '12', Sausio: '01', Vasario: '02', Kovo: '03', Balandžio: '04' };
  SEASON_EVENTS.forEach((e) => {
    const [, month, day] = /^(\S+) (\d+) d\.$/.exec(e.calendarDateText);
    assert.equal(e.date.slice(5, 7), months[month], e.name);
    assert.equal(Number(e.date.slice(8)), Number(day), e.name);
  });
  assert.equal(SEASON_EVENTS.filter((e) => e.type === 'final').length, 1);
  ['elite', 'challenge', 'future'].forEach((t) => assert.equal(SEASON_EVENTS.filter((e) => e.type === t).length, 6));
});

test('index.html: registracijos nuorodos nepakeistos struktūra ir turi saugius atributus', () => {
  const links = [...html.matchAll(/<a class="register" href="([^"]+)" target="_blank" rel="noopener noreferrer">/g)].map((m) => m[1]);
  assert.equal(links.length, 2, 'šiuo metu atviros dvi registracijos (ELITE #2 ir CHALLENGE #2)');
  links.forEach((l) => assert.match(l, /^https:\/\/forms\.cloud\.microsoft\//));
  assert.ok(html.includes('Registracija uždaryta'), 'uždarytos registracijos išliko');
});

test('index.html turi REITINGAI navigaciją ir nuorodą į reitingų puslapį', () => {
  assert.match(html, /<a href="reitingai\.html"[^>]*>[^<]*REITINGAI/);
  assert.ok(!html.includes('prijungsime kitame etape'), 'senas „kitame etape“ tekstas pakeistas');
});
