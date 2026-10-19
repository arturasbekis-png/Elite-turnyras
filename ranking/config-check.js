// Viešų duomenų bazės nuostatų (ranking/runtime-config.js) patikra.
// Tikslas: kad klaida būtų aiškiai pasakyta, o ne „tyliai nieko nerodytų“, ir kad per klaidą įklijuotas
// PRIVILEGIJUOTAS raktas (service_role / secret) niekada nebūtų naudojamas ir siunčiamas iš naršyklės.
//
// Čia jokie raktai nekuriami ir neišvedami į ekraną – grąžinami tik tekstai apie tai, kas netinka.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Perskaito JWT „role“ (ir „ref“) be parašo tikrinimo – tik tam, kad atpažintume neteisingą raktą. */
function readJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) {
    return null;
  }
}

const problem = (status, title, text) => ({ ok: false, status, title, text, url: '', anonKey: '', keyKind: null });

/**
 * Patikrina {supabaseUrl, supabaseAnonKey}. Būsenos:
 *   missing     – abu laukai tušti (svetainė dar neprijungta)
 *   incomplete  – užpildytas tik vienas laukas
 *   bad_url     – adresas netinkamas (ne https, ne projekto URL, dashboard adresas ir pan.)
 *   bad_key     – raktas netinkamo formato arba iš kito projekto
 *   secret_key  – įklijuotas PRIVILEGIJUOTAS raktas (service_role / secret) – NENAUDOJAMAS
 *   ok          – galima naudoti; keyKind: 'publishable' (sb_publishable_…) arba 'anon-jwt' (senasis anon)
 */
export function inspectRuntime(runtime = {}) {
  const rawUrl = String(runtime.supabaseUrl ?? '').trim();
  const rawKey = String(runtime.supabaseAnonKey ?? '').trim();

  if (!rawUrl && !rawKey) {
    return problem('missing', 'Reitingai dar neprijungti',
      'Į failą ranking/runtime-config.js dar neįrašyti Supabase projekto URL ir viešasis (publishable / anon) raktas. Žingsniai – docs/SUPABASE-DIEGIMAS.md.');
  }
  if (!rawUrl || !rawKey) {
    return problem('incomplete', 'Nuostatos neužbaigtos',
      `Faile ranking/runtime-config.js trūksta ${!rawUrl ? 'projekto URL (supabaseUrl)' : 'viešojo rakto (supabaseAnonKey)'}. Reikia abiejų reikšmių.`);
  }

  // ── Raktas pirmiausia: privilegijuotas raktas niekada neturi būti naudojamas, nesvarbu, koks URL ──
  if (/^sb_secret_/i.test(rawKey)) {
    return problem('secret_key', 'Įrašytas PRIVILEGIJUOTAS raktas',
      'Faile ranking/runtime-config.js yra „secret“ tipo raktas. Jis NIEKADA neturi būti svetainėje. Svetainė jo nenaudoja. Supabase skiltyje Settings → API Keys sukurkite naują raktą (senąjį atšaukite), o čia įrašykite tik „publishable“ raktą.');
  }
  const jwt = readJwt(rawKey);
  if (jwt && String(jwt.role).toLowerCase() === 'service_role') {
    return problem('secret_key', 'Įrašytas PRIVILEGIJUOTAS raktas',
      'Faile ranking/runtime-config.js yra „service_role“ raktas. Jis NIEKADA neturi būti svetainėje. Svetainė jo nenaudoja. Supabase skiltyje Settings → API Keys atšaukite / pakeiskite šį raktą, o čia įrašykite tik viešą „publishable“ (arba „anon“) raktą.');
  }

  // ── URL ──
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { parsed = null; }
  const local = parsed && LOCAL_HOSTS.includes(parsed.hostname);
  if (!parsed || !(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local))) {
    return problem('bad_url', 'Netinkamas projekto adresas',
      'supabaseUrl turi būti pilnas adresas, prasidedantis https:// (pvz. https://jusu-projektas.supabase.co). Jį rasite Supabase: Connect arba Project Settings.');
  }
  if (/(^|\.)supabase\.com$/i.test(parsed.hostname)) {
    return problem('bad_url', 'Tai ne projekto adresas',
      'Įrašytas Supabase svetainės (dashboard) adresas. Reikia PROJEKTO adreso, kuris baigiasi .supabase.co.');
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    return problem('bad_url', 'Adresas per ilgas',
      'supabaseUrl turi būti tik projekto adresas, be papildomų dalių (be /rest/v1, be klaustukų ir #). Pavyzdžio forma: https://jusu-projektas.supabase.co');
  }
  const url = parsed.origin;

  // ── Viešo rakto formatas ──
  if (/[\s'"`]/.test(rawKey)) {
    return problem('bad_key', 'Netinkamas raktas', 'Raktas turi būti viena eilutė be tarpų ir kabučių. Nukopijuokite jį iš naujo.');
  }
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(rawKey)) {
    return { ok: true, status: 'ok', title: '', text: '', url, anonKey: rawKey, keyKind: 'publishable' };
  }
  if (jwt) {
    const role = String(jwt.role || '').toLowerCase();
    if (role !== 'anon') {
      return problem('bad_key', 'Netinkamas raktas', 'Šis raktas nėra viešas „anon“ raktas. Naudokite „publishable“ (arba „anon“) raktą iš Supabase: Settings → API Keys.');
    }
    const host = parsed.hostname;
    if (jwt.ref && /\.supabase\.(co|in)$/i.test(host) && host.split('.')[0] !== String(jwt.ref)) {
      return problem('bad_key', 'Raktas iš kito projekto', 'Raktas nepriklauso šiam projekto adresui. Patikrinkite, ar URL ir raktas paimti iš to paties Supabase projekto.');
    }
    return { ok: true, status: 'ok', title: '', text: '', url, anonKey: rawKey, keyKind: 'anon-jwt' };
  }
  return problem('bad_key', 'Netinkamas raktas',
    'Raktas neatpažintas. Viešas raktas prasideda „sb_publishable_…“ (naujas) arba „eyJ…“ (senas „anon“). Nukopijuokite jį iš Supabase: Settings → API Keys.');
}
