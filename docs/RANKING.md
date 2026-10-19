# ELITE ranking module

Individual-player ranking for the ELITE beach volleyball season, integrated into the existing static site
(GitHub Pages). Public pages are in Lithuanian; this document is the technical/owner guide.

| Page | Purpose |
|---|---|
| `reitingai.html` | Public rankings: **BENDRAS REITINGAS**, **ELITE**, **CHALLENGE**, **FUTURE**, **TURNYRŲ REZULTATAI**, season selector, "Reitingavimo taisyklės" |
| `reitingai-admin.html` | Administration (login required): players, results entry, drafts, publish, corrections, merges, audit, CSV |
| `index.html` | Existing calendar. Only change: a **REITINGAI** navigation row and a link replacing the old "will be connected later" text. Events, dates and registration links are untouched. |

## Architecture

```
ranking/config.js          single source of truth: scoring tables, categories, event types, statuses, tie policy
ranking/events.js          2026–2027 calendar events (kept in sync with index.html by a test)
ranking/engine.js          the ONE deterministic calculation engine (points, validation, rankings, tie-breakers)
ranking/domain.js          reference lifecycle: draft → finalize (once) → correct (audited) → merge players
ranking/config-check.js    validates runtime-config.js (missing / invalid / privileged key → clear message, no requests)
ranking/api.js             dependency-free Supabase REST client (public key only; admin calls need a session)
ranking/admin-controller.js  admin workflow logic (DOM-free, tested)
ranking/public-app.js, admin-app.js, render.js, view.js, ranking.css   UI
ranking/memory-backend.js, dev/demo-data.js   local demo/testing only – never loaded in production
supabase/schema.sql        tables, RLS, privileges, and the admin_* / public_ranking_data functions
supabase/seed.sql          season + 19 calendar events (generated: `npm run seed`). No players, no results.
tests/                     automated tests (`npm test`)
```

**Rankings are never stored.** Only standings (a final position per team) are stored. Points and every table are
computed by `engine.js` from finalized standings and the scoring table, so the overall and category tables can never
disagree and there is no second manually-editable copy of results.

## Points and rules

Defined once in `ranking/config.js` (`SCORING_TABLES.v1`) and rendered into the public "Reitingavimo taisyklės"
section from that same config.

* Points go to **each player** by the team's final position; both partners get the **full** points (no splitting).
* Only **finalized** tournaments count. Planned / in progress / draft / awaiting confirmation → 0 points.
* Overall = ELITE + CHALLENGE + FUTURE points of the selected season. Category tables count only their category.
  Seasons are never mixed; an all-time block is shown separately ("Visų sezonų statistika", not a ranking).
* **BEACH LEAGUE FINAL** has no scoring table (`scoringKey: null`): results can be recorded and shown, but no points
  go to any ranking. To define its scoring later, add a table to `SCORING_TABLES` and set `scoringKey`/`category`
  for `final` in `EVENT_TYPES`.
* **Tie-breakers (overall):** 1) more ELITE wins, 2) more wins overall, 3) more ELITE 2nd places, 4) more tournaments
  played, 5) otherwise the **same position** is shown with a `=` marker. **Categories:** wins in the category, 2nd
  places in the category, tournaments played, then shared position. Names are never a sporting tie-breaker
  (alphabetical order inside a tied group is presentation only).
* **Tied places inside a tournament:** by default not allowed (positions must be exactly 1..N). If a tournament is
  flagged "allow shared places", positions follow `1-2-2-4` (e.g. `5,5,7,7`) and the teams sharing a place occupy
  ALL places of the group and each gets the **average** of those places' points, rounded to 2 decimals (ELITE 5–6:
  (22+20)/2 = **21**; CHALLENGE 5–8: (18+16+14+12)/4 = **15**). Both teammates get the full amount. The group size is
  the number of teams entered with that position, so the group must be complete before publishing (3 teams sharing
  place 5 would give (18+16+14)/3 = 16, not 15). Places 9–12 and 13–16 have equal points anyway.
* **Movement** compares the table with the table before the latest finalized tournament (derived, no snapshots
  stored). Hidden until two tournaments are finalized.

### Changing the scoring table

Do **not** edit `v1` once results are published. Add `v2` to `SCORING_TABLES`, set the season's `scoringVersion`
(admin → Sezonai ir turnyrai). Each tournament stores the scoring version at finalization, so already published
tournaments keep their points.

## Player identity

Players have stable UUIDs independent of names and teams. A team is just a participation record linking two player
IDs to a tournament and a final position. Changing partners never moves points. Correcting a spelling edits the
existing player (no duplicate). Duplicates are merged with the admin "Sujungti dublikatus" tool: all history moves
to the kept record, the duplicate is marked `merged_into` + inactive, and the merge is audited. A merge is refused if
both records played in the same tournament. The database physically enforces `unique (tournament_id, player_id)`,
so one player cannot be in two teams of a tournament.

## Deployment / setup (required once – persistence needs a backend)

> A click-by-click guide in Lithuanian for a non-programmer is in **[`docs/SUPABASE-DIEGIMAS.md`](SUPABASE-DIEGIMAS.md)**;
> `supabase/make-admin.sql` is the ready-made admin-authorisation script (edit only the e-mail).

GitHub Pages is static, so shared persistence and admin login need a backend. This module uses
**Supabase** (free plan; no paid dependency is introduced – check Supabase's current free-plan terms, e.g. inactive
free projects can be paused). Nothing below has been done for you: it needs your Supabase account.

1. Create a Supabase project.
2. SQL Editor → run `supabase/schema.sql`, then `supabase/seed.sql` (both are safe to re-run).
3. Authentication → add your admin user (email + password). Then **turn off public sign-ups**
   (Authentication → Sign In / Providers → disable "Allow new users to sign up"; menu wording may differ slightly by Supabase version).
4. Make that user an admin: run `supabase/make-admin.sql` in the SQL Editor after replacing the placeholder e-mail
   (it inserts into `public.admins` and shows the result).
5. Project Settings → API Keys: copy the **Project URL** and the **publishable** key (`sb_publishable_…`; the legacy
   `anon` JWT also works) into `ranking/runtime-config.js`. The key is meant to be public; the database rules protect the data.
   **Never** put a `secret` / `service_role` key (or any password) in the repository — `npm test` fails if one is detected,
   and the site itself refuses to use such a key (`ranking/config-check.js`), shows a clear warning, and sends no request.
6. Merge to `main` (GitHub Pages redeploys). Open `reitingai-admin.html` and sign in.

**Configuration mechanism.** `ranking/runtime-config.js` is the only place. It ships empty (no placeholder credentials).
`ranking/config-check.js` classifies it: `missing` (public page: "Reitingai dar neprijungti"), `incomplete`, `bad_url`,
`bad_key`, `secret_key` or `ok`; the public and admin pages show the specific reason. A publishable key is sent only in the
`apikey` header (it is not a JWT, so never as `Authorization: Bearer`, per Supabase's API-key docs); a legacy anon JWT may
also go as Bearer; after sign-in the Bearer is the user's session JWT. Build-time injection (GitHub Actions) was
deliberately **not** added: the site has no build step, two public values are not secrets, and changing the Pages
deployment method is a bigger risk than benefit.

Until step 5 is done the public page shows the calendar and the "not connected" message – it never shows invented data.

### Test mode (safe real-project verification)

Admin tab **BANDYMAS** creates a separate *test season* (`bandymas`, `seasons.is_test`) with three test tournaments;
players created with the "Bandomasis žaidėjas" box get `players.is_test` (settable only at creation). Test data can be
published and viewed at `reitingai.html#bendras?s=bandymas` (with a warning banner) but is excluded from the default
season, the season selector and the all-time statistics. The database refuses test players in official tournaments
(`test_player_in_official`), refuses merging test with official players, locks the test season and refuses moving
official tournaments into it. `admin_delete_test_data()` removes only `is_test` rows (stops without deleting anything if
a test player sits in an official tournament); the audit log is retained. No hand-written SQL reset is ever needed.

## Admin workflow (`reitingai-admin.html`)

1. **ŽAIDĖJAI** – enter *Vardas* and *Pavardė* separately (both required; the database computes `full_name`), duplicate warning (case-, Lithuanian-diacritic- and word-order-insensitive; a deliberate separate record needs an explicit confirmation), search by name/ID, edit names (ID and history preserved), activate/deactivate, merge duplicates.
2. **REZULTATŲ SUVEDIMAS** – choose season and an existing calendar tournament, add teams (two existing players + final place). The table `Vieta | Žaidėjas 1 | Žaidėjas 2 | Taškai kiekvienam` shows each player's points instantly; players already used in another team of the tournament are disabled.
3. **Peržiūrėti taškus** – validation and points preview per team/player. **Išsaugoti juodraštį** keeps it private.
4. **Patvirtinti ir paskelbti** – validates (client and server), publishes once. A second publish is rejected.
5. **Pataisymas** – on a published tournament edit the rows, give a reason (required), save. Rankings recalculate
   automatically; the old version, new version, reason, user and time go to the audit log. An invalid correction is
   rolled back and leaves the published result untouched.
6. **Sezonai ir turnyrai** – add seasons / tournaments for future seasons (no code changes needed).
7. **Eksportas / Auditas** – CSV (UTF-8, `;`) for rankings and a tournament; audit log viewer.

Validation: ≥2 teams; two valid, distinct, non-merged players per team; a player/team at most once per tournament;
integer positions 1..N; no duplicate positions unless shared places are enabled (then `1-2-2-4`).

## Security model

* Public visitors can call exactly one database function, `public_ranking_data()`, which returns **finalized**
  tournaments only. Drafts, unpublished players and the audit log are not readable by the public.
* Tables have RLS enabled and no `anon` privileges. Admin changes happen only through `admin_*` functions that check
  `admins` membership on the server. There is no direct write access to results tables, even for admins.
* The audit log cannot be updated or deleted.
* The browser holds only the public key; the admin session token lives in `sessionStorage`; passwords are never stored.
  An expired access token is refreshed once and the request retried; if the session can no longer be refreshed the page
  returns to the login form.
* All `SECURITY DEFINER` functions pin `search_path = public, pg_temp`; internal helpers (`_apply_entries`,
  `_validate_results`, `_log_audit`, `assert_admin`, …) have no client EXECUTE rights; sequences have no client rights.
* `make-admin.sql` authorises only a **confirmed** e-mail. Admin rights cannot be granted by any API call – only by the project
  owner in the SQL Editor. Test `tests/sql.test.mjs` audits table/column/function/sequence privileges structurally.
* Not verified: the hosted Supabase service itself (Auth, PostgREST gateway, API-key handling, dashboard settings such as
  disabled sign-ups). `docs/SUPABASE-DIEGIMAS.md` steps 10 and 12 are the manual checks for the real project.

## Tests

```
npm test                       # all tests; DB tests are skipped unless a PostgreSQL is configured
npm run check                  # deployment + calendar-sync checks only
```

Browser end-to-end tests (`tests/e2e-browser.test.mjs`, real Chromium via Playwright) run the full admin and public flow
against real PostgreSQL through `tests/support/local-supabase.mjs`. That helper is a **test double** for PostgREST/GoTrue
(HTTP contract, JWT check, role switching, RLS), not Supabase itself. Playwright is not a project dependency – it is
looked up globally or via `ELITE_TEST_PLAYWRIGHT=/path/to/playwright`; without it (or without PostgreSQL) these tests
are skipped. `ELITE_TEST_SCREENSHOTS=/dir` saves screenshots.

DB tests (RLS, privileges, finalize-once, corrections/rollback, merges, tie rules, persistence across a server restart)
run against a real PostgreSQL when configured:

```
ELITE_TEST_PG_HOST=/path/to/socket-or-host ELITE_TEST_PG_PORT=5432 [ELITE_TEST_PG_USER=postgres] \
[ELITE_TEST_PG_RESTART='command that restarts the server'] npm test
```

They use `tests/sql/supabase-shim.sql` to imitate Supabase's `auth` schema and permissive default grants. That proves
the schema's rules and functions, but it is **not** a Supabase project: Supabase Auth, PostgREST and the hosted
service itself are only covered by the setup checklist above and a manual smoke test after you configure it
(sign in, save a draft, publish, check the public page from another browser, try publishing while signed out) —
see steps 10–12 of `docs/SUPABASE-DIEGIMAS.md` (the BANDYMAS tab makes this safe to do on the real project).

## Local development

Serve the folder with any static server (ES modules do not work from `file://`), e.g. `npx serve` or
`python3 -m http.server`, then open `reitingai.html?demo` or `reitingai-admin.html?demo`. Demo mode works **only**
on `localhost`/`127.0.0.1`, is marked with a warning banner, uses clearly fake "Demo …" players and keeps data only
in memory.

## Known limitations

* The ranking is computed in the visitor's browser from the public data (fine at this scale; deterministic, and the
  same data always yields the same table).
* No automatic Pages-path CI is added (workflow files need extra token scope); `npm test` covers the path check.
* `aciu.html` (existing) links to `/`, which points to the domain root under the GitHub Pages project path. This was
  pre-existing and left unchanged.


## Public results without Supabase (static file) and local admin mode

While `ranking/runtime-config.js` is **empty**:

* **Official results are a static file**: `data/official-results.json`, committed to the repository and loaded by
  `reitingai.html` (`ranking/static-results.js`). Every visitor on every device sees the same data. The file holds
  players, tournaments (ids of the existing calendar events), teams and positions – **never points**; points are always
  calculated by `ranking/engine.js` (shared places = average of the occupied places, both teammates get the full amount).
  The loader validates the file (unknown players/tournaments, invalid or duplicate positions, bad `groupSize` are rejected
  and the page shows an error instead of wrong results) and ignores duplicate ids, so reloading or listing a record twice
  never doubles points. `localStorage` is never used by the public page.
* **Incomplete data is flagged, not invented.** A team record may carry `groupSize` (the size of its shared-place group as
  written in the source, e.g. "5–8" = 4). If fewer teams are known, the page shows "Duomenys nepilni … trūksta N" and
  points use the declared group (CHALLENGE 5–8 = 15); the missing team is never created. Adding it later (a new
  participation with the same `position` and `groupSize`) changes nobody else's points.
* **To publish or correct results**: edit `data/official-results.json` (add players/teams, change `status`), run
  `npm test`, commit to `main`; GitHub Pages deploys it. `status: "finalized"` counts; anything else (draft/planned)
  is ignored by the ranking.
* `reitingai-admin.html` runs **without login** in **local mode** (`ranking/local-backend.js`, `ranking/local-store.js`):
  same rules and engine, data kept only in that browser's `localStorage`, permanent warning banner, button labelled
  "PATVIRTINTI (TIK ŠIOJE NARŠYKLĖJE)". These are private drafts: they never appear on the public page. The BANDYMAS tab
  is hidden in local mode.
* If the config is filled but wrong (bad URL/key, secret key), neither mode is used – the specific problem is shown.
* With Supabase configured, the database is the single source and the static file is not used. Local drafts are not
  migrated to Supabase (re-enter, or use the CSV export); `groupSize` is a static-file feature (the database path
  counts only entered teams).
