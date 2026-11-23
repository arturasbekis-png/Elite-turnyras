import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEASON_EVENTS } from '../ranking/events.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function parseCalendar(source) {
  const re = /<article class="event ([^"]*)" data-type="([^"]+)">([\s\S]*?)<\/article>/g;
  const typeMap = { start: 'future' };
  const events = [];
  let m;
  while ((m = re.exec(source))) {
    const [, cls, type, body] = m;
    if (cls.split(' ').includes('joint')) {
      // Jungtinė diena (gruodžio 13 d.): viena kortelė, trys seansai
      const dateText = /<div class="event-date">([^<]*?) · <strong>/.exec(body)[1].trim();
      for (const s of body.matchAll(/<li class="session" data-type="([^"]+)">[^A-Z]*([A-Z]+ #\d) · <strong>([^<]+)<\/strong>/g)) {
        events.push({ type: typeMap[s[1]] || s[1], name: s[2], dateText, time: s[3] });
      }
      continue;
    }
    const d = /<div class="event-name">([^<]+)<\/div>\s*<div class="event-date">([^<]*?) · <strong>([^<]+)<\/strong>/.exec(body);
    events.push({ type: typeMap[type] || type, name: d[1].replace(/^[^A-Za-z]+/, '').trim(), dateText: d[2].trim(), time: d[3].trim() });
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
  assert.equal(links.length, 0, 'atskirų renginių registracijos uždarytos (ELITE #2, CHALLENGE #2, FUTURE #2); atvira tik „Naujametinio turnyro“ kortelė');
  assert.ok(!/ELITE #2[\s\S]{0,400}?<a class="register"/.test(html.split('ELITE #3')[0].split('FUTURE #2')[0].slice(html.indexOf('ELITE #2'))), 'ELITE #2 be registracijos nuorodos');
  links.forEach((l) => assert.match(l, /^https:\/\/forms\.cloud\.microsoft\//));
  assert.ok(html.includes('Registracija uždaryta'), 'uždarytos registracijos išliko');
  const closedFuture2 = /FUTURE #2<\/div>[\s\S]*?<span class="badge closed-badge">REGISTRACIJA UŽDARYTA<\/span>[\s\S]*?<button class="register closed"[^>]*disabled/.exec(html);
  assert.ok(closedFuture2 && closedFuture2[0].length < 600, 'FUTURE #2 (lapkričio 22 d.) registracija uždaryta');
});

test('index.html turi REITINGAI navigaciją ir nuorodą į reitingų puslapį', () => {
  assert.match(html, /<a href="reitingai\.html"[^>]*>[^<]*REITINGAI/);
  assert.ok(!html.includes('prijungsime kitame etape'), 'senas „kitame etape“ tekstas pakeistas');
});

test('Gruodžio 13 d. „Naujametinis turnyras“: viena kortelė, trys atvirų registracijų nuorodos (FUTURE, CHALLENGE, ELITE); atskirų lapkričio 29 / gruodžio 6 dienų nebėra', () => {
  const day = SEASON_EVENTS.filter((e) => e.date === '2026-12-13').map((e) => [e.name, e.startTime, e.endTime]);
  assert.deepEqual(day, [['FUTURE #3', '11:00', '13:00'], ['CHALLENGE #3', '13:00', '15:00'], ['ELITE #3', '15:00', '17:00']]);
  assert.ok(!SEASON_EVENTS.some((e) => e.date === '2026-11-29' || e.date === '2026-12-06'));
  assert.ok(!html.includes('Lapkričio 29 d. ·') && !html.includes('Gruodžio 6 d. ·'));
  const card = /<article class="event joint"[\s\S]*?<\/article>/.exec(html)[0];
  assert.ok(card.includes('NAUJAMETINIS TURNYRAS') && card.includes('REGISTRACIJA ATVIRA') && card.includes('<details class="joint-reg">'));
  const links = [...card.matchAll(/<a class="register sub (\w+)" href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)<\/a>/g)];
  assert.deepEqual(links.map((l) => l[1]), ['start', 'challenge', 'elite']);
  assert.deepEqual(links.map((l) => l[3].replace(/^\S+ /, '')), ['FUTURE #3 · 11:00–13:00', 'CHALLENGE #3 · 13:00–15:00', 'ELITE #3 · 15:00–17:00']);
  assert.equal(new Set(links.map((l) => l[2])).size, 3, 'trys skirtingos formos');
  links.forEach((l) => assert.match(l[2], /^https:\/\/forms\.cloud\.microsoft\/Pages\/ResponsePage\.aspx\?id=[\w-]+$/));
  assert.match(card, /data-type="elite challenge start"/, 'rodoma po visais trimis filtrais');
  const closed = (name) => new RegExp(`${name}</div>[\\s\\S]*?REGISTRACIJA UŽDARYTA`).test(html);
  assert.ok(closed('ELITE #2') && closed('CHALLENGE #2'), 'ELITE #2 ir CHALLENGE #2 registracija uždaryta');
});
