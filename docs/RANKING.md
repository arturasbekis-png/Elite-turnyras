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
ranking/api.js             dependency-free Supabase REST client (anon key only; admin calls need a session)
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
  flagged "allow shared places", the `1-2-2-4` rule applies: all teams sharing a place get the points of the best
  place of the group and the next place is skipped (e.g. `5,5,7,7`). Places 9–12 and 13–16 have equal points anyway.
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

GitHub Pages is static, so shared persistence and admin login need a backend. This module uses
**Supabase** (free plan; no paid dependency is introduced – check Supabase's current free-plan terms, e.g. inactive
free projects can be paused). Nothing below has been done for you: it needs your Supabase account.

1. Create a Supabase project.
2. SQL Editor → run `supabase/schema.sql`, then `supabase/seed.sql` (both are safe to re-run).
3. Authentication → add your admin user (email + password). Then **turn off public sign-ups**
   (Authentication → Sign In / Providers → disable "Allow new users to sign up"; menu wording may differ slightly by Supabase version).
4. Make that user an admin (SQL Editor):
   ```sql
   insert into public.admins (user_id, note)
   select id, 'Owner' from auth.users where email = 'YOUR_ADMIN_EMAIL';
   ```
5. Project Settings → API: copy the **Project URL** and the **anon / publishable** key into
   `ranking/runtime-config.js`. The anon key is meant to be public; the database rules protect the data.
   **Never** put the `service_role` key (or any password) in the repository — `npm test` fails if one is detected.
6. Merge to `main` (GitHub Pages redeploys). Open `reitingai-admin.html` and sign in.

Until step 5 is done the public page shows the calendar and an empty ranking ("Oficialių rezultatų dar nėra") – it
never shows invented data.

## Admin workflow (`reitingai-admin.html`)

1. **Žaidėjai** – create players (duplicate-name warning), fix names, activate/deactivate, merge duplicates.
2. **Rezultatai** – choose season and an existing calendar tournament, add teams (2 players each + final place).
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
* The browser holds only the public anon key; the admin session token lives in `sessionStorage`; passwords are never stored.

## Tests

```
npm test                       # all tests; DB tests are skipped unless a PostgreSQL is configured
npm run check                  # deployment + calendar-sync checks only
```

DB tests (RLS, privileges, finalize-once, corrections/rollback, merges, tie rules, persistence across a server restart)
run against a real PostgreSQL when configured:

```
ELITE_TEST_PG_HOST=/path/to/socket-or-host ELITE_TEST_PG_PORT=5432 [ELITE_TEST_PG_USER=postgres] \
[ELITE_TEST_PG_RESTART='command that restarts the server'] npm test
```

They use `tests/sql/supabase-shim.sql` to imitate Supabase's `auth` schema and permissive default grants. That proves
the schema's rules and functions, but it is **not** a Supabase project: Supabase Auth, PostgREST and the hosted
service itself are only covered by the setup checklist above and a manual smoke test after you configure it
(sign in, save a draft, publish, check the public page from another browser, try publishing while signed out).

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
