-- Administratoriaus įgaliojimas.
-- Paleiskite Supabase → SQL Editor PO to, kai sukūrėte naudotoją (Authentication → Users → Add user).
-- Pakeiskite TIK el. pašto adresą žemiau (tarp kabučių, palikite kabutes) – jokių slaptažodžių čia nerašykite.
--
-- Įgaliojamas tik PATVIRTINTO el. pašto naudotojas, kad niekas negalėtų tapti administratoriumi
-- užsiregistravęs svetimu adresu.
insert into public.admins (user_id, note)
select id, 'Pagrindinis administratorius'
from auth.users
where lower(email) = lower('PAKEISKITE@JUSU-PASTAS.lt')
  and email_confirmed_at is not null
on conflict (user_id) do nothing;

-- Patikra: turi būti matoma bent viena eilutė su jūsų el. paštu.
-- Jei tuščia – el. paštas neatitiko naudotojo, arba naudotojas nepatvirtintas
-- (Authentication → Users: sukurkite su „Auto Confirm User“ arba patvirtinkite rankiniu būdu).
select u.email, a.created_at
from public.admins a
join auth.users u on u.id = a.user_id;
