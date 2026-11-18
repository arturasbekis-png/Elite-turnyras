// Patikra, kad reitingų modulis nepakeitė esamo kalendoriaus: renginių, datų ir registracijos nuorodų.
// Palyginama su ankstesne versija iš Git (origin/main arba main). Jei Git nuorodos nėra, testas praleidžiamas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function baseline() {
  for (const ref of ['origin/main', 'main']) {
    const r = spawnSync('git', ['-C', root, 'show', `${ref}:index.html`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (r.status === 0 && r.stdout) return { ref, html: r.stdout };
  }
  return null;
}
const base = baseline();
const skip = base ? false : 'Git nuoroda main nepasiekiama – palyginimas praleistas';
const current = readFileSync(join(root, 'index.html'), 'utf8');

const section = (html, open) => {
  const start = html.indexOf(open);
  const end = html.indexOf('</section>', start);
  return start < 0 || end < 0 ? null : html.slice(start, end + '</section>'.length);
};
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

// Sąmoningai pakeisti renginiai (2026-11-18): ELITE #2 ir CHALLENGE #2 registracija uždaryta,
// o ELITE #3, CHALLENGE #3 ir FUTURE #3 sujungti į vieną kortelę „Naujametinis turnyras“ (gruodžio 13 d.). Kiti renginiai turi likti nepakitę.
const CHANGED = ['ELITE #2', 'CHALLENGE #2', 'ELITE #3', 'CHALLENGE #3', 'FUTURE #3'];
const articles = (block) => [...block.matchAll(/<article class="event [\s\S]*?<\/article>/g)].map((m) => m[0]);
const isJoint = (a) => /^<article class="event joint"/.test(a);
const nameOf = (a) => (/<div class="event-name">[^<]*?(\b(?:ELITE|CHALLENGE|FUTURE) #\d|BEACH LEAGUE FINAL)/.exec(a) || [])[1];

test('Kalendoriaus blokas: 19 renginių, nepakeisti renginiai (išskyrus sąmoningai pakeistus) nepakito', { skip }, () => {
  const before = section(base.html, '<section class="schedule">');
  const after = section(current, '<section class="schedule">');
  assert.ok(before && after);
  assert.equal(articles(after).length, 17, '16 atskirų renginių + viena jungtinė kortelė (3 renginiai) = 19 renginių');
  assert.equal(articles(after).filter(isJoint).length, 1);
  const keep = (list) => list.filter((a) => !isJoint(a) && !CHANGED.includes(nameOf(a)));
  assert.deepEqual(keep(articles(after)), keep(articles(before)), `nepakeisti renginiai skiriasi nuo ${base.ref}`);
  assert.equal(keep(articles(after)).length, 14);
});

test('Ankstesnės nuorodos išlikusios (išskyrus uždarytų ELITE #2 ir CHALLENGE #2 registracijas); naujos tik į reitingus', { skip }, () => {
  const before = hrefs(base.html);
  const after = hrefs(current);
  const closedEvents = articles(base.html).filter((a) => ['ELITE #2', 'CHALLENGE #2'].includes(nameOf(a))).flatMap((a) => hrefs(a));
  for (const h of before) assert.ok(after.includes(h) || closedEvents.includes(h), `dingo nuoroda: ${h}`);
  const added = after.filter((h) => !before.includes(h));
  const newForms = added.filter((h) => /^https:\/\/forms\.cloud\.microsoft\/Pages\/ResponsePage\.aspx\?id=/.test(h));
  assert.ok(newForms.length === 3 || newForms.length === 0, 'tik trys gruodžio 13 d. registracijos formos');
  assert.ok(added.every((h) => h === './' || h === 'reitingai.html' || h === 'privatumas.html' || newForms.includes(h)), `netikėtos naujos nuorodos: ${added.join(', ')}`);
  assert.ok(after.some((h) => /forms\.office\.com|forms\.cloud\.microsoft/.test(h)), 'registracijos forma išlikusi');
});

test('Filtrų ir kitų puslapio skriptų turinys nepakito', { skip }, () => {
  const script = (html) => (html.match(/<script>[\s\S]*?<\/script>/) || [''])[0];
  // Vienintelis leistinas pakeitimas: filtras atpažįsta kelis tipus (kortelė „Naujametinis turnyras“ rodoma po ELITE, CHALLENGE ir FUTURE).
  const norm = (t) => t.replace(/\(type==='all'\|\|\(' '\+event\.dataset\.type\+' '\)\.indexOf\(' '\+type\+' '\)>-1\)/, "(type==='all'||event.dataset.type===type)");
  assert.equal(norm(script(current)), script(base.html));
});
