-- TIK TESTAMS: imituoja Supabase `auth` schemą ir roles ant paprasto PostgreSQL.
-- Realiame Supabase projekte šito failo NEPALEISTI – ten visa tai jau yra.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant select on auth.users to authenticated;

-- Supabase pagal nutylėjimą suteikia VISAS teises naujiems objektams. Imituojame tai,
-- kad testai įrodytų, jog schema.sql šias teises tinkamai atima.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
