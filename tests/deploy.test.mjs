// TEST M — diegimas. Statinė svetainė neturi „build“ žingsnio, todėl tikriname tai, kas galėtų sugesti GitHub Pages:
// ar visi failai pasiekiami po projekto keliu /Elite-turnyras/, ar JS moduliai turi teisingą MIME, ar nėra absoliučių kelių
// ar paslapčių, ir ar visi JS failai sintaksiškai teisingi.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, posix, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/Elite-turnyras/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.sql': 'text/plain' };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(PREFIX)) { res.writeHead(404); res.end('nerasta'); return; }
    let rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('nerasta'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}${PREFIX}` })));
}

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  if (name === '.git' || name === 'node_modules') return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const PAGES = ['index.html', 'reitingai.html', 'reitingai-admin.html', 'privatumas.html'];

test('M: visi puslapiai, stiliai ir JS moduliai pasiekiami po /Elite-turnyras/ keliu', async () => {
  const { server, base } = await startServer();
  try {
    const seen = new Set();
    const queue = [];
    for (const page of PAGES) {
      assert.ok(existsSync(join(root, page)), `${page} egzistuoja`);
      const res = await fetch(base + page);
      assert.equal(res.status, 200, page);
      const body = await res.text();
      for (const m of body.matchAll(/(?:href|src)="([^"#?]+\.(?:css|js))"/g)) queue.push(posix.join(posix.dirname(page), m[1]));
    }
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      const res = await fetch(base + path);
      assert.equal(res.status, 200, `${path} turi būti pasiekiamas po projekto keliu`);
      const type = res.headers.get('content-type');
      if (path.endsWith('.js')) {
        assert.match(type, /javascript/, `${path} MIME`);
        const code = await res.text();
        for (const m of code.matchAll(/(?:from\s+|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) queue.push(posix.join(posix.dirname(path), m[1]));
      }
    }
    assert.ok(seen.size >= 10, `patikrinta ${seen.size} failų`);
    assert.ok([...seen].some((p) => p === 'ranking/engine.js'));
  } finally {
    server.close();
  }
});

test('M: naujuose puslapiuose nėra absoliučių kelių, kurie sulūžtų po projekto keliu', () => {
  for (const page of ['reitingai.html', 'reitingai-admin.html']) {
    const html = readFileSync(join(root, page), 'utf8');
    assert.ok(!/(?:href|src|action)="\/(?!\/)/.test(html), `${page}: absoliutūs keliai`);
  }
  for (const file of walk(join(root, 'ranking'))) {
    const code = readFileSync(file, 'utf8');
    assert.ok(!/fetch\(\s*['"`]\//.test(code), `${relative(root, file)}: fetch su absoliučiu keliu`);
    assert.ok(!/from\s+['"]\//.test(code), `${relative(root, file)}: import su absoliučiu keliu`);
  }
});

test('M: visi JS failai sintaksiškai teisingi', () => {
  const files = [...walk(join(root, 'ranking')), ...walk(join(root, 'dev')), ...walk(join(root, 'scripts'))].filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
  assert.ok(files.length >= 8);
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${relative(root, file)}: ${r.stderr}`);
  }
});

test('M: saugumas – repozitorijoje nėra paslapčių, o runtime-config tik su viešais duomenimis', () => {
  const textFiles = walk(root).filter((f) => /\.(js|mjs|html|css|sql|md|json|txt)$/.test(f) && !f.includes(`${join(root, 'tests')}`));
  const jwt = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
  const secretPrefixes = /(sb_secret_[A-Za-z0-9_-]{16,}|sbp_[a-f0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_|sk-ant-)/;
  for (const file of textFiles) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!secretPrefixes.test(text), `${relative(root, file)}: panašu į slaptą raktą`);
    const m = jwt.exec(text);
    if (m) {
      const payload = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString());
      assert.notEqual(payload.role, 'service_role', `${relative(root, file)}: service_role raktas!`);
    }
  }
  const config = readFileSync(join(root, 'ranking', 'runtime-config.js'), 'utf8');
  assert.match(config, /supabaseUrl:\s*['"][^'"]*['"]/);
  assert.ok(!/password|secret|service_role\s*[:=]/i.test(config.replace(/\/\/.*$/gm, '')), 'runtime-config be slaptų reikšmių');
  // Kliento kodas niekur nenaudoja service_role. Vienintelė išimtis – config-check.js, kuris tik ATPAŽĮSTA
  // per klaidą įrašytą privilegijuotą raktą ir jį atmeta; jis negali siųsti jokių užklausų.
  for (const file of walk(join(root, 'ranking'))) {
    const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (file.endsWith(join('ranking', 'config-check.js'))) {
      assert.ok(!/\b(fetch|XMLHttpRequest|Authorization|apikey|localStorage|sessionStorage)\b/.test(code), 'config-check.js tik tikrina – niekur nesiunčia ir nesaugo raktų');
      for (const line of code.split('\n').filter((l) => l.includes('service_role'))) {
        assert.match(line, /===\s*'service_role'|service_role|„service_role“/, line);
      }
      continue;
    }
    assert.ok(!/service_role/.test(code), `${relative(root, file)} neturi naudoti service_role`);
  }
  // Repozitorijoje nėra .env failų
  assert.deepEqual(walk(root).filter((f) => /(^|[\\/])\.env(\.|$)/.test(f)).map((f) => relative(root, f)), []);
});

test('M: demonstraciniai duomenys įkeliami tik lokaliai', () => {
  const app = readFileSync(join(root, 'ranking', 'public-app.js'), 'utf8');
  assert.match(app, /isLocal && new URLSearchParams\(location\.search\)\.has\('demo'\)/);
  const admin = readFileSync(join(root, 'ranking', 'admin-app.js'), 'utf8');
  assert.match(admin, /isLocal/);
});

test('M: SQL seed sutampa su ranking/events.js (sugeneruota iš to paties šaltinio)', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'gen-seed.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'), r.stdout, 'paleiskite: npm run seed');
});
