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

test('Kalendoriaus blokas (visi 19 renginių, datos, ženkleliai, registracijos mygtukai) nepakito', { skip }, () => {
  const before = section(base.html, '<section class="schedule">');
  const after = section(current, '<section class="schedule">');
  assert.ok(before && after);
  assert.equal(after, before, `kalendoriaus HTML skiriasi nuo ${base.ref}`);
  assert.equal((after.match(/<article class="event /g) || []).length, 19);
});

test('Visos ankstesnės nuorodos (registracija ir kt.) išlikusios; naujos tik į reitingus', { skip }, () => {
  const before = hrefs(base.html);
  const after = hrefs(current);
  for (const h of before) assert.ok(after.includes(h), `dingo nuoroda: ${h}`);
  const added = after.filter((h) => !before.includes(h));
  assert.ok(added.every((h) => h === './' || h === 'reitingai.html'), `netikėtos naujos nuorodos: ${added.join(', ')}`);
  assert.ok(after.some((h) => /forms\.office\.com|forms\.cloud\.microsoft/.test(h)), 'registracijos forma išlikusi');
});

test('Filtrų ir kitų puslapio skriptų turinys nepakito', { skip }, () => {
  const script = (html) => (html.match(/<script>[\s\S]*?<\/script>/) || [''])[0];
  assert.equal(script(current), script(base.html));
});
