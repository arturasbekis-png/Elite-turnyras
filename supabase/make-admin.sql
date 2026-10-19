-- Administratoriaus įgaliojimas. Paleiskite Supabase → SQL Editor PO to, kai sukūrėte naudotoją
-- (Authentication → Users). Pakeiskite TIK el. pašto adresą žemiau (tarp kabučių) – jokių slaptažodžių čia nerašykite.
insert into public.admins (user_id, note)
select id, 'Pagrindinis administratorius'
from auth.users
where lower(email) = lower('PAKEISKITE@JUSU-PASTAS.lt')
on conflict (user_id) do nothing;

-- Patikra: turi būti matoma bent viena eilutė su jūsų el. paštu. Jei tuščia – el. paštas neatitiko naudotojo.
select u.email, a.created_at
from public.admins a
join auth.users u on u.id = a.user_id;
