-- SUGENERUOTA: npm run seed (nuo ranking/events.js). Rankiniu būdu nekeisti.
-- Sėkloje nėra žaidėjų ar rezultatų. Paleidžiama po schema.sql; pakartotinai paleisti saugu.

insert into public.seasons (id, label, is_current, scoring_version)
values ('2026-2027', '2026–2027', true, 'v2')
on conflict (id) do nothing;

insert into public.tournaments (id, season_id, event_type, number, name, event_date, start_time, status, allow_ties) values
  ('2026-2027-elite-1', '2026-2027', 'elite', 1, 'ELITE #1', '2026-10-11', '11:00', 'planned', false),
  ('2026-2027-challenge-1', '2026-2027', 'challenge', 1, 'CHALLENGE #1', '2026-10-18', '11:00', 'planned', false),
  ('2026-2027-future-1', '2026-2027', 'future', 1, 'FUTURE #1', '2026-10-25', '11:00', 'planned', false),
  ('2026-2027-elite-2', '2026-2027', 'elite', 2, 'ELITE #2', '2026-11-08', '11:00', 'planned', false),
  ('2026-2027-challenge-2', '2026-2027', 'challenge', 2, 'CHALLENGE #2', '2026-11-15', '11:00', 'planned', false),
  ('2026-2027-future-2', '2026-2027', 'future', 2, 'FUTURE #2', '2026-11-22', '11:00', 'planned', false),
  ('2026-2027-elite-3', '2026-2027', 'elite', 3, 'ELITE #3', '2026-11-29', '11:00', 'planned', false),
  ('2026-2027-challenge-3', '2026-2027', 'challenge', 3, 'CHALLENGE #3', '2026-12-06', '11:00', 'planned', false),
  ('2026-2027-future-3', '2026-2027', 'future', 3, 'FUTURE #3', '2026-12-13', '11:00', 'planned', false),
  ('2026-2027-elite-4', '2026-2027', 'elite', 4, 'ELITE #4', '2027-01-10', '11:00', 'planned', false),
  ('2026-2027-challenge-4', '2026-2027', 'challenge', 4, 'CHALLENGE #4', '2027-01-17', '11:00', 'planned', false),
  ('2026-2027-future-4', '2026-2027', 'future', 4, 'FUTURE #4', '2027-01-24', '11:00', 'planned', false),
  ('2026-2027-elite-5', '2026-2027', 'elite', 5, 'ELITE #5', '2027-01-31', '11:00', 'planned', false),
  ('2026-2027-challenge-5', '2026-2027', 'challenge', 5, 'CHALLENGE #5', '2027-02-07', '11:00', 'planned', false),
  ('2026-2027-future-5', '2026-2027', 'future', 5, 'FUTURE #5', '2027-02-14', '11:00', 'planned', false),
  ('2026-2027-elite-6', '2026-2027', 'elite', 6, 'ELITE #6', '2027-02-28', '11:00', 'planned', false),
  ('2026-2027-challenge-6', '2026-2027', 'challenge', 6, 'CHALLENGE #6', '2027-03-07', '11:00', 'planned', false),
  ('2026-2027-future-6', '2026-2027', 'future', 6, 'FUTURE #6', '2027-03-14', '11:00', 'planned', false),
  ('2026-2027-final', '2026-2027', 'final', null, 'BEACH LEAGUE FINAL', '2027-04-11', '11:00', 'planned', false)
on conflict (id) do nothing;
