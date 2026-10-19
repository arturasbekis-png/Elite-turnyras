-- ============================================================================
-- ELITE reitingų modulis – PostgreSQL / Supabase schema
-- ----------------------------------------------------------------------------
-- Saugumo modelis:
--   * Lentelės apsaugotos RLS ir NEATVERTOS anoniminiams lankytojams.
--   * Viešą reitingą lankytojai gauna TIK per funkciją public_ranking_data(),
--     kuri grąžina išimtinai PATVIRTINTŲ turnyrų duomenis (juodraščiai niekada neviešinami).
--   * Visi oficialių rezultatų pakeitimai vyksta per admin_* funkcijas, kurios patikrina,
--     ar vartotojas yra lentelėje `admins`. Tiesioginio rašymo į rezultatų lenteles nėra.
--   * Niekada nenaudokite service_role rakto naršyklėje. Svetainėje naudojamas tik viešas anon raktas.
-- Paleidimas: Supabase → SQL Editor → įklijuokite visą failą → Run. Failas pakartotinai paleidžiamas saugiai.
-- ============================================================================

-- ───────────────────────── Lentelės ─────────────────────────

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.seasons (
  id text primary key,
  label text not null,
  is_current boolean not null default false,
  scoring_version text not null default 'v1',
  created_at timestamptz not null default now()
);
create unique index if not exists seasons_single_current on public.seasons (is_current) where is_current;

create table if not exists public.tournaments (
  id text primary key,
  season_id text not null references public.seasons (id),
  event_type text not null check (event_type in ('elite', 'challenge', 'future', 'final')),
  number integer,
  name text not null,
  event_date date not null,
  start_time time,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'draft', 'awaiting_confirmation', 'finalized')),
  allow_ties boolean not null default false,
  scoring_version text,
  revision integer not null default 0,
  finalized_at timestamptz,
  finalized_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) > 0),
  gender text check (gender in ('M', 'F')),
  bio text,
  is_active boolean not null default true,
  merged_into uuid references public.players (id),
  created_at timestamptz not null default now(),
  check (merged_into is null or merged_into <> id)
);

-- Vardas ir pavardė saugomi atskirai; full_name visada apskaičiuojamas serveryje (trigeris žemiau),
-- todėl viešas reitingas ir variklis toliau naudoja vieną full_name lauką.
alter table public.players add column if not exists first_name text;
alter table public.players add column if not exists last_name text;

-- Bandymo režimas: sezonai ir žaidėjai gali būti pažymėti kaip BANDOMIEJI. Tik jie (ir niekas kitas) pašalinami
-- funkcija admin_delete_test_data(). Bandomasis sezonas negali būti „dabartinis“, o bandomųjų žaidėjų
-- požymio vėliau pakeisti negalima (tik nustatomas kuriant žaidėją).
alter table public.seasons add column if not exists is_test boolean not null default false;
alter table public.players add column if not exists is_test boolean not null default false;
alter table public.seasons drop constraint if exists seasons_test_not_current;
alter table public.seasons add constraint seasons_test_not_current check (not (is_test and is_current));

create or replace function public._players_sync_name() returns trigger
language plpgsql as $$
begin
  if new.first_name is not null or new.last_name is not null then
    new.first_name := btrim(regexp_replace(coalesce(new.first_name, ''), '\s+', ' ', 'g'));
    new.last_name := btrim(regexp_replace(coalesce(new.last_name, ''), '\s+', ' ', 'g'));
    if new.first_name = '' or new.last_name = '' then
      raise exception 'invalid_name';
    end if;
    new.full_name := new.first_name || ' ' || new.last_name;
  elsif new.full_name is null or btrim(new.full_name) = '' then
    raise exception 'invalid_name';
  end if;
  return new;
end $$;

drop trigger if exists players_sync_name on public.players;
create trigger players_sync_name before insert or update on public.players
  for each row execute function public._players_sync_name();

-- Komandos dalyvavimas turnyre (dalyvavimo įrašas). Komandos vardas NĖRA žaidėjo tapatybė.
create table if not exists public.participations (
  id uuid primary key default gen_random_uuid(),
  tournament_id text not null references public.tournaments (id) on delete cascade,
  team_name text,
  final_position integer check (final_position is null or final_position >= 1),
  created_at timestamptz not null default now(),
  unique (id, tournament_id)
);
create index if not exists participations_tournament_idx on public.participations (tournament_id);

-- Du poros žaidėjai. unique (tournament_id, player_id) fiziškai neleidžia žaidėjui
-- dalyvauti dviejose komandose tame pačiame turnyre (taškai negali būti skiriami dukart).
create table if not exists public.participation_players (
  participation_id uuid not null,
  tournament_id text not null,
  player_id uuid not null references public.players (id),
  slot smallint not null check (slot in (1, 2)),
  primary key (participation_id, slot),
  unique (tournament_id, player_id),
  foreign key (participation_id, tournament_id)
    references public.participations (id, tournament_id) on delete cascade
);
create index if not exists participation_players_player_idx on public.participation_players (player_id);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text,
  action text not null,
  tournament_id text,
  reason text,
  before jsonb,
  after jsonb
);

-- Audito žurnalas nekeičiamas.
create or replace function public.audit_log_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log_immutable';
end $$;
drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ───────────────────────── Pagalbinės funkcijos ─────────────────────────

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;

create or replace function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
end $$;

create or replace function public._log_audit(p_action text, p_tournament_id text, p_reason text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (actor, actor_email, action, tournament_id, reason, before, after)
  values (auth.uid(), auth.jwt() ->> 'email', p_action, p_tournament_id, p_reason, p_before, p_after);
end $$;

create or replace function public._tournament_snapshot(p_tournament_id text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'teamName', p.team_name, 'position', p.final_position,
    'playerIds', (select coalesce(jsonb_agg(pp.player_id order by pp.slot), '[]'::jsonb)
                  from public.participation_players pp where pp.participation_id = p.id)
  ) order by p.final_position nulls last, p.id), '[]'::jsonb)
  from public.participations p where p.tournament_id = p_tournament_id
$$;

-- Rezultatų validacija (ta pati logika kaip ranking/engine.js validateResults).
create or replace function public._validate_results(p_tournament_id text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t public.tournaments%rowtype;
  n integer;
  errs jsonb := '[]'::jsonb;
begin
  select * into t from public.tournaments where id = p_tournament_id;
  if not found then raise exception 'tournament_not_found'; end if;
  select count(*) into n from public.participations where tournament_id = t.id;

  if n < 2 then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'too_few_teams'));
  end if;
  if exists (select 1 from public.participations p where p.tournament_id = t.id
             and (select count(*) from public.participation_players pp where pp.participation_id = p.id) <> 2) then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'team_needs_two_players'));
  end if;
  if exists (select 1 from public.participation_players pp join public.players pl on pl.id = pp.player_id
             where pp.tournament_id = t.id and pl.merged_into is not null) then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'merged_player'));
  end if;
  if exists (select 1 from public.participations where tournament_id = t.id and final_position is null) then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'missing_position'));
  end if;
  if exists (select 1 from public.participations where tournament_id = t.id and final_position > n) then
    errs := errs || jsonb_build_array(jsonb_build_object('code', 'position_out_of_range'));
  end if;

  if not exists (select 1 from public.participations where tournament_id = t.id
                 and (final_position is null or final_position > n)) then
    if not t.allow_ties then
      if exists (select 1 from public.participations where tournament_id = t.id
                 group by final_position having count(*) > 1) then
        errs := errs || jsonb_build_array(jsonb_build_object('code', 'duplicate_position'));
      end if;
    else
      if exists (select 1 from public.participations p where p.tournament_id = t.id
                 and p.final_position <> 1 + (select count(*) from public.participations q
                                              where q.tournament_id = t.id and q.final_position < p.final_position)) then
        errs := errs || jsonb_build_array(jsonb_build_object('code', 'invalid_tie_positions'));
      end if;
    end if;
  end if;
  return errs;
end $$;

-- Vidinė funkcija: pakeičia turnyro dalyvavimo įrašus. Nėra prieinama klientams.
create or replace function public._apply_entries(p_tournament_id text, p_entries jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  new_id uuid;
  ids jsonb;
  pid uuid;
  slot_no integer;
  pos integer;
  cnt integer := 0;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'invalid_entries';
  end if;
  delete from public.participations where tournament_id = p_tournament_id;
  for e in select * from jsonb_array_elements(p_entries) loop
    pos := null;
    if e ? 'position' and jsonb_typeof(e -> 'position') = 'number' then
      if (e ->> 'position')::numeric <> trunc((e ->> 'position')::numeric) or (e ->> 'position')::numeric < 1 then
        raise exception 'invalid_position';
      end if;
      pos := (e ->> 'position')::integer;
    elsif e ? 'position' and jsonb_typeof(e -> 'position') not in ('null', 'number') then
      raise exception 'invalid_position';
    end if;
    insert into public.participations (tournament_id, team_name, final_position)
    values (p_tournament_id, nullif(btrim(coalesce(e ->> 'teamName', '')), ''), pos)
    returning id into new_id;
    ids := coalesce(e -> 'playerIds', '[]'::jsonb);
    slot_no := 0;
    for pid in select nullif(value, '')::uuid from jsonb_array_elements_text(ids) loop
      slot_no := slot_no + 1;
      if pid is null then continue; end if;
      if slot_no > 2 then raise exception 'team_needs_two_players'; end if;
      if exists (select 1 from public.players where id = pid and merged_into is not null) then
        raise exception 'merged_player';
      end if;
      -- Bandomasis žaidėjas negali patekti į OFICIALŲ turnyrą (net juodraštyje).
      if exists (select 1 from public.players where id = pid and is_test)
         and not coalesce((select s.is_test from public.tournaments t join public.seasons s on s.id = t.season_id
                           where t.id = p_tournament_id), false) then
        raise exception 'test_player_in_official';
      end if;
      begin
        insert into public.participation_players (participation_id, tournament_id, player_id, slot)
        values (new_id, p_tournament_id, pid, slot_no);
      exception
        when unique_violation then raise exception 'player_in_two_teams';
        when foreign_key_violation then raise exception 'unknown_player';
      end;
    end loop;
    cnt := cnt + 1;
  end loop;
  return cnt;
end $$;

-- ───────────────────────── Viešas skaitymas ─────────────────────────
-- Vienintelė anoniminiams lankytojams prieinama funkcija. Grąžina tik PATVIRTINTŲ turnyrų rezultatus.

create or replace function public.public_ranking_data() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'generatedAt', now(),
    'seasons', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'label', s.label, 'isCurrent', s.is_current,
                                          'scoringVersion', s.scoring_version, 'isTest', s.is_test) order by s.id)
      from public.seasons s), '[]'::jsonb),
    'tournaments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'seasonId', t.season_id, 'type', t.event_type, 'number', t.number, 'name', t.name,
        'date', t.event_date, 'startTime', to_char(t.start_time, 'HH24:MI'), 'status', t.status,
        'allowTies', t.allow_ties,
        'scoringVersion', case when t.status = 'finalized' then t.scoring_version end,
        'revision', t.revision, 'finalizedAt', t.finalized_at
      ) order by t.event_date, t.id)
      from public.tournaments t), '[]'::jsonb),
    'participations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'tournamentId', p.tournament_id, 'teamName', p.team_name, 'position', p.final_position,
        'playerIds', (select jsonb_agg(pp.player_id order by pp.slot)
                      from public.participation_players pp where pp.participation_id = p.id)
      ))
      from public.participations p join public.tournaments t on t.id = p.tournament_id
      where t.status = 'finalized'), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', pl.id, 'fullName', pl.full_name, 'gender', pl.gender,
                                          'bio', pl.bio, 'isActive', pl.is_active) order by pl.full_name)
      from public.players pl
      where pl.merged_into is null and exists (
        select 1 from public.participation_players pp join public.tournaments t on t.id = pp.tournament_id
        where pp.player_id = pl.id and t.status = 'finalized')), '[]'::jsonb)
  )
$$;

-- ───────────────────────── Administratoriaus funkcijos ─────────────────────────

create or replace function public.admin_save_results(p_tournament_id text, p_entries jsonb, p_status text default 'draft')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tournaments%rowtype; cnt integer;
begin
  perform public.assert_admin();
  if p_status not in ('in_progress', 'draft', 'awaiting_confirmation') then raise exception 'invalid_status'; end if;
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if t.status = 'finalized' then raise exception 'tournament_finalized'; end if;
  cnt := public._apply_entries(t.id, p_entries);
  update public.tournaments set status = p_status, updated_at = now() where id = t.id;
  perform public._log_audit('save_draft', t.id, null, null, jsonb_build_object('status', p_status, 'teams', cnt));
  return jsonb_build_object('status', p_status, 'teams', cnt);
end $$;

create or replace function public.admin_finalize_tournament(p_tournament_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tournaments%rowtype; errs jsonb; snap jsonb;
begin
  perform public.assert_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if t.status = 'finalized' then raise exception 'already_finalized'; end if;
  errs := public._validate_results(t.id);
  if jsonb_array_length(errs) > 0 then
    raise exception 'validation_failed' using detail = errs::text;
  end if;
  update public.tournaments
     set status = 'finalized', revision = 1, finalized_at = now(), finalized_by = auth.uid(),
         scoring_version = (select s.scoring_version from public.seasons s where s.id = t.season_id),
         updated_at = now()
   where id = t.id;
  snap := public._tournament_snapshot(t.id);
  perform public._log_audit('finalize', t.id, null, null, snap);
  return jsonb_build_object('status', 'finalized', 'revision', 1);
end $$;

create or replace function public.admin_correct_results(p_tournament_id text, p_entries jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tournaments%rowtype; errs jsonb; before_snap jsonb; rev integer;
begin
  perform public.assert_admin();
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if t.status <> 'finalized' then raise exception 'not_finalized'; end if;
  if p_reason is null or length(btrim(p_reason)) < 5 then raise exception 'reason_required'; end if;
  before_snap := public._tournament_snapshot(t.id);
  perform public._apply_entries(t.id, p_entries);
  errs := public._validate_results(t.id);
  if jsonb_array_length(errs) > 0 then
    -- Šis išimties metimas atšaukia visą operaciją: oficialūs rezultatai lieka nepakeisti.
    raise exception 'validation_failed' using detail = errs::text;
  end if;
  rev := t.revision + 1;
  update public.tournaments set revision = rev, updated_at = now() where id = t.id;
  perform public._log_audit('correct', t.id, btrim(p_reason), before_snap, public._tournament_snapshot(t.id));
  return jsonb_build_object('status', 'finalized', 'revision', rev);
end $$;

create or replace function public.admin_set_tournament_status(p_tournament_id text, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.tournaments%rowtype;
begin
  perform public.assert_admin();
  if p_status not in ('planned', 'in_progress', 'draft', 'awaiting_confirmation') then raise exception 'invalid_status'; end if;
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'tournament_not_found'; end if;
  if t.status = 'finalized' then raise exception 'tournament_finalized'; end if;
  update public.tournaments set status = p_status, updated_at = now() where id = t.id;
  perform public._log_audit('set_status', t.id, null, jsonb_build_object('status', t.status), jsonb_build_object('status', p_status));
  return jsonb_build_object('status', p_status);
end $$;

create or replace function public.admin_merge_players(p_keep uuid, p_drop uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare keep_row public.players%rowtype; drop_row public.players%rowtype; conflicts text;
begin
  perform public.assert_admin();
  if p_keep = p_drop then raise exception 'merge_same'; end if;
  select * into keep_row from public.players where id = p_keep for update;
  select * into drop_row from public.players where id = p_drop for update;
  if keep_row.id is null or drop_row.id is null then raise exception 'player_not_found'; end if;
  if keep_row.merged_into is not null or drop_row.merged_into is not null then raise exception 'already_merged'; end if;
  -- Bandomojo ir oficialaus žaidėjo jungti negalima (kitaip bandymo duomenų valymas paliestų oficialius duomenis).
  if keep_row.is_test <> drop_row.is_test then raise exception 'merge_test_mismatch'; end if;
  select string_agg(t.name, ', ') into conflicts
    from public.participation_players a
    join public.participation_players b on a.tournament_id = b.tournament_id
    join public.tournaments t on t.id = a.tournament_id
   where a.player_id = p_keep and b.player_id = p_drop;
  if conflicts is not null then
    raise exception 'merge_conflict' using detail = conflicts;
  end if;
  update public.participation_players set player_id = p_keep where player_id = p_drop;
  update public.players set merged_into = p_keep, is_active = false where id = p_drop;
  perform public._log_audit('merge_players', null, p_reason,
    jsonb_build_object('id', p_drop, 'name', drop_row.full_name),
    jsonb_build_object('id', p_keep, 'name', keep_row.full_name));
  return jsonb_build_object('kept', p_keep, 'merged', p_drop);
end $$;

create or replace function public.admin_upsert_season(p_id text, p_label text, p_is_current boolean, p_scoring_version text default 'v1')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_admin();
  if p_id is null or btrim(p_id) = '' or p_label is null or btrim(p_label) = '' then raise exception 'invalid_season'; end if;
  if exists (select 1 from public.seasons where id = btrim(p_id) and is_test) then raise exception 'test_season_locked'; end if;
  if p_is_current then
    update public.seasons set is_current = false where is_current and id <> p_id;
  end if;
  insert into public.seasons (id, label, is_current, scoring_version)
  values (btrim(p_id), btrim(p_label), p_is_current, coalesce(nullif(btrim(p_scoring_version), ''), 'v1'))
  on conflict (id) do update
    set label = excluded.label, is_current = excluded.is_current, scoring_version = excluded.scoring_version;
  perform public._log_audit('upsert_season', null, null, null, jsonb_build_object('id', p_id, 'label', p_label, 'current', p_is_current));
  return jsonb_build_object('id', p_id);
end $$;

create or replace function public.admin_upsert_tournament(
  p_id text, p_season_id text, p_event_type text, p_number integer, p_name text,
  p_event_date date, p_start_time time default '11:00', p_allow_ties boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.tournaments%rowtype; was_found boolean; target_test boolean; current_test boolean;
begin
  perform public.assert_admin();
  select * into existing from public.tournaments where id = p_id for update;
  was_found := found;
  if was_found and existing.status = 'finalized' then raise exception 'tournament_finalized'; end if;
  -- Turnyro negalima perkelti tarp oficialaus ir bandomojo sezono (apsauga nuo bandymo duomenų valymo klaidų).
  select coalesce((select is_test from public.seasons where id = p_season_id), false) into target_test;
  if was_found then
    select coalesce((select is_test from public.seasons where id = existing.season_id), false) into current_test;
    if current_test <> target_test then raise exception 'test_season_locked'; end if;
  end if;
  insert into public.tournaments (id, season_id, event_type, number, name, event_date, start_time, allow_ties)
  values (p_id, p_season_id, p_event_type, p_number, p_name, p_event_date, p_start_time, p_allow_ties)
  on conflict (id) do update
    set season_id = excluded.season_id, event_type = excluded.event_type, number = excluded.number,
        name = excluded.name, event_date = excluded.event_date, start_time = excluded.start_time,
        allow_ties = excluded.allow_ties, updated_at = now();
  perform public._log_audit('upsert_tournament', p_id, null, null, jsonb_build_object('name', p_name, 'date', p_event_date));
  return jsonb_build_object('id', p_id);
end $$;

-- ───────────────────────── Bandymo režimas ─────────────────────────
-- Leidžia saugiai išbandyti visą kelią (žaidėjai → komandos → paskelbimas → viešas reitingas) NELIESIANT oficialių
-- duomenų, o paskui pašalinti VISĄ bandymą viena komanda. Valymas liečia tik eilutes su is_test = true
-- (bandomasis sezonas „bandymas“, jo turnyrai ir žaidėjai, sukurti su bandomojo žaidėjo požymiu).
-- Oficialaus sezono turnyrų ir žaidėjų ši funkcija niekada netrina. Audito žurnalas (nekeičiamas) išlieka.

create or replace function public.admin_create_test_season() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := current_date;
begin
  perform public.assert_admin();
  insert into public.seasons (id, label, is_current, scoring_version, is_test)
  values ('bandymas', 'BANDOMASIS SEZONAS (neoficialus)', false, 'v1', true)
  on conflict (id) do nothing;
  if not exists (select 1 from public.seasons where id = 'bandymas' and is_test) then
    raise exception 'invalid_season';
  end if;
  insert into public.tournaments (id, season_id, event_type, number, name, event_date, start_time)
  values ('bandymas-elite-1', 'bandymas', 'elite', 1, 'BANDOMASIS ELITE #1', d, '11:00'),
         ('bandymas-challenge-1', 'bandymas', 'challenge', 1, 'BANDOMASIS CHALLENGE #1', d, '11:00'),
         ('bandymas-future-1', 'bandymas', 'future', 1, 'BANDOMASIS FUTURE #1', d, '11:00')
  on conflict (id) do nothing;
  perform public._log_audit('create_test_season', null, null, null, jsonb_build_object('season', 'bandymas'));
  return jsonb_build_object('seasonId', 'bandymas');
end $$;

create or replace function public.admin_delete_test_data() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  blocking text;
  n_parts integer; n_tournaments integer; n_seasons integer; n_players integer;
begin
  perform public.assert_admin();

  -- Sustojame, jei bandomasis žaidėjas dalyvauja OFICIALIAME turnyre: jo trynimas sugadintų oficialius duomenis.
  select string_agg(distinct pl.full_name, ', ') into blocking
    from public.players pl
    join public.participation_players pp on pp.player_id = pl.id
    join public.tournaments t on t.id = pp.tournament_id
    join public.seasons s on s.id = t.season_id
   where pl.is_test and not s.is_test;
  if blocking is not null then
    raise exception 'test_player_in_real_tournament' using detail = blocking;
  end if;
  -- ... arba jei oficialus žaidėjas buvo sujungtas į bandomąjį įrašą.
  if exists (select 1 from public.players a join public.players b on a.merged_into = b.id where b.is_test and not a.is_test) then
    raise exception 'merge_test_mismatch';
  end if;

  select count(*) into n_parts from public.participations p
    join public.tournaments t on t.id = p.tournament_id join public.seasons s on s.id = t.season_id where s.is_test;
  select count(*) into n_tournaments from public.tournaments t join public.seasons s on s.id = t.season_id where s.is_test;
  select count(*) into n_seasons from public.seasons where is_test;
  select count(*) into n_players from public.players where is_test;

  delete from public.participations
   where tournament_id in (select t.id from public.tournaments t join public.seasons s on s.id = t.season_id where s.is_test);
  delete from public.tournaments where season_id in (select id from public.seasons where is_test);
  delete from public.seasons where is_test;
  delete from public.players where is_test;

  perform public._log_audit('delete_test_data', null, null, null,
    jsonb_build_object('seasons', n_seasons, 'tournaments', n_tournaments, 'teams', n_parts, 'players', n_players));
  return jsonb_build_object('seasons', n_seasons, 'tournaments', n_tournaments, 'teams', n_parts, 'players', n_players);
end $$;

-- ───────────────────────── RLS ir teisės ─────────────────────────

alter table public.admins enable row level security;
alter table public.seasons enable row level security;
alter table public.tournaments enable row level security;
alter table public.players enable row level security;
alter table public.participations enable row level security;
alter table public.participation_players enable row level security;
alter table public.audit_log enable row level security;

-- Pirmiausia atimame visas numatytąsias teises (Supabase jas pagal nutylėjimą suteikia anon/authenticated).
revoke all on public.admins, public.seasons, public.tournaments, public.players,
  public.participations, public.participation_players, public.audit_log from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Skaitymas: tik administratoriams (lankytojai naudoja public_ranking_data()).
drop policy if exists admins_read on public.admins;
create policy admins_read on public.admins for select to authenticated using (public.is_admin());
drop policy if exists seasons_read on public.seasons;
create policy seasons_read on public.seasons for select to authenticated using (public.is_admin());
drop policy if exists tournaments_read on public.tournaments;
create policy tournaments_read on public.tournaments for select to authenticated using (public.is_admin());
drop policy if exists participations_read on public.participations;
create policy participations_read on public.participations for select to authenticated using (public.is_admin());
drop policy if exists participation_players_read on public.participation_players;
create policy participation_players_read on public.participation_players for select to authenticated using (public.is_admin());
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());
drop policy if exists players_read on public.players;
create policy players_read on public.players for select to authenticated using (public.is_admin());

grant select on public.admins, public.seasons, public.tournaments, public.participations,
  public.participation_players, public.audit_log, public.players to authenticated;

-- Žaidėjų įrašus administratoriai gali kurti ir taisyti tiesiogiai (bet NE merged_into – tam yra sujungimo funkcija).
drop policy if exists players_insert on public.players;
create policy players_insert on public.players for insert to authenticated with check (public.is_admin());
drop policy if exists players_update on public.players;
create policy players_update on public.players for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- full_name klientas rašyti negali: jį apskaičiuoja trigeris iš vardo ir pavardės.
revoke insert, update on public.players from authenticated;
grant insert (first_name, last_name, gender, bio, is_test) on public.players to authenticated;
grant update (first_name, last_name, gender, bio, is_active) on public.players to authenticated;

-- Funkcijų teisės.
grant execute on function public.is_admin() to authenticated;
grant execute on function public.public_ranking_data() to anon, authenticated;
grant execute on function public.admin_save_results(text, jsonb, text) to authenticated;
grant execute on function public.admin_finalize_tournament(text) to authenticated;
grant execute on function public.admin_correct_results(text, jsonb, text) to authenticated;
grant execute on function public.admin_set_tournament_status(text, text) to authenticated;
grant execute on function public.admin_merge_players(uuid, uuid, text) to authenticated;
grant execute on function public.admin_upsert_season(text, text, boolean, text) to authenticated;
grant execute on function public.admin_upsert_tournament(text, text, text, integer, text, date, time, boolean) to authenticated;
grant execute on function public.admin_create_test_season() to authenticated;
grant execute on function public.admin_delete_test_data() to authenticated;
-- _apply_entries, _validate_results, _log_audit, _tournament_snapshot, assert_admin lieka be klientų teisių.
