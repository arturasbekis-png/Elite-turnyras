# ELITE reitingai – Supabase paruošimas (žingsnis po žingsnio)

Šio dokumento tikslas – kad galėtumėte patys prijungti duomenų bazę be programavimo. Kodo keisti **nereikia**,
išskyrus vieną failą (`ranking/runtime-config.js`) – jame reikia įrašyti du viešus duomenis. Visi veiksmai atliekami
naršyklėje. Viskas nemokama (Supabase „Free“ planas).

> **Svarbu.** Šį sąrašą parengiau neturėdamas prieigos prie jūsų Supabase paskyros, todėl pats projekto nesukūriau ir
> nepatikrinau. Supabase meniu pavadinimai kartais keičiasi – jei žodis kiek kitoks, ieškokite panašios reikšmės.
> Po paskutinio žingsnio padarykite 3 minučių patikrą (apačioje), kad įsitikintumėte, jog viskas veikia.

## Ką reikės turėti
- el. pašto adresą administratoriui (galite naudoti savo),
- stiprų slaptažodį administratoriui (sugalvokite patys; **niekam jo nesiųskite ir nerašykite į failus**).

## 1. Sukurkite projektą
1. Atidarykite <https://supabase.com> → **Start your project** → prisijunkite (galima per GitHub).
2. **New project**. Pasirinkite organizaciją, įveskite pavadinimą (pvz. `elite-reitingai`).
3. **Database Password** – sugeneruokite ir **išsaugokite slaptažodžių tvarkyklėje**. Jo svetainei nereikia.
4. **Region** – parinkite artimiausią (pvz. Frankfurt / Europe). Planas – **Free**.
5. **Create new project** ir palaukite 1–2 min., kol projektas bus paruoštas.

## 2. Sukurkite lenteles (SQL)
1. Kairėje spauskite **SQL Editor** → **New query**.
2. Atidarykite savo repozitorijoje failą `supabase/schema.sql`, nukopijuokite **visą** turinį, įklijuokite → **Run**.
   Turi atsirasti „Success“. (Failą galima paleisti pakartotinai – nieko nesugadins.)
3. Dar kartą **New query** → įklijuokite `supabase/seed.sql` → **Run**. Tai įrašo sezoną ir 19 kalendoriaus turnyrų.
   **Žaidėjų ir rezultatų jis neįrašo** – jų nėra, kol patys neįvesite.

## 3. Sukurkite administratoriaus paskyrą
1. Kairėje **Authentication** → **Users** → **Add user** → **Create new user**.
2. Įveskite el. paštą ir slaptažodį; pažymėkite **Auto Confirm User** (jei yra). **Create user**.

## 4. Išjunkite viešą registraciją
Kad niekas kitas negalėtų susikurti paskyros:
1. **Authentication** → **Sign In / Providers** (arba **Settings**) → raskite **Allow new users to sign up**
   (kai kuriose versijose – „Enable sign ups“) → **išjunkite** → **Save**.
2. Net jei kas nors ir susikurtų paskyrą, administratoriumi ji netaptų – teises suteikia tik 5 žingsnis.

## 5. Suteikite administratoriaus teises
1. **SQL Editor** → **New query**.
2. Atidarykite `supabase/make-admin.sql`, nukopijuokite, **pakeiskite** `PAKEISKITE@JUSU-PASTAS.lt` į savo administratoriaus
   el. paštą (tą patį kaip 3 žingsnyje) → **Run**.
3. Apačioje turi pasirodyti eilutė su jūsų el. paštu. Jei lentelė tuščia – el. paštas neatitiko; pataisykite ir paleiskite iš naujo.

## 6. Į svetainę įrašykite du VIEŠUS duomenis
1. Supabase kairėje **Project Settings** → **API** (arba **API Keys**).
2. Nukopijuokite:
   - **Project URL** (atrodo kaip `https://xxxxxxxx.supabase.co`),
   - **anon** arba **publishable** raktą (viešas, skirtas naršyklei).
3. **Nenaudokite ir niekur nekopijuokite** `service_role` / `secret` rakto. Jo svetainei nereikia, o viešai paskelbtas jis
   atvertų visą duomenų bazę.
4. GitHub svetainėje atidarykite failą `ranking/runtime-config.js` → pieštuko ikona (Edit) → tarp kabučių įrašykite
   URL ir anon raktą:
   ```js
   export const RUNTIME = {
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'jūsų-viešas-anon-raktas',
   };
   ```
   → **Commit changes**.
   Anon raktas yra skirtas būti viešas: duomenis saugo duomenų bazės taisyklės (RLS), o ne rakto slaptumas.

## 7. Paskelbkite svetainėje (reikalingas jūsų sutikimas)
Pakeitimai yra šakoje `feature/reitingai`, pull request **#1**. Jis **nesujungtas**. Kai būsite pasiruošę:
GitHub → **Pull requests** → **#1** → **Merge pull request**. Po ~1 min. GitHub Pages atnaujins svetainę.
(Konfigūracijos failą 6 žingsnyje redaguokite toje pačioje šakoje arba po sujungimo `main` šakoje.)

## Kaip naudotis kasdien (be kodo)
1. Atidarykite `https://arturasbekis-png.github.io/Elite-turnyras/reitingai-admin.html` ir prisijunkite.
2. **ŽAIDĖJAI** – įrašykite **Vardą** ir **Pavardę** → **PRIDĖTI ŽAIDĖJĄ**. Sistema perspės, jei toks vardas jau yra.
   Klaidą vardyje taisykite **Redaguoti** (ID ir taškai išlieka). Dublikatus sujunkite „Sujungti dublikatus“.
3. **REZULTATŲ SUVEDIMAS** – pasirinkite turnyrą, **Pridėti komandą**, parinkite du žaidėjus ir įveskite galutinę vietą.
   Dešinėje iškart matote taškus kiekvienam žaidėjui.
4. **Peržiūrėti taškus ir patikrinti** → **Išsaugoti juodraštį** (viešai nerodomas) → **PASKELBTI OFICIALIUS REZULTATUS**.
5. Klaidą po paskelbimo taisykite tame pačiame puslapyje: pakeiskite vietas, įrašykite priežastį, **Išsaugoti pataisymą**.
   Taškai perskaičiuojami (nedubliuojami), o pakeitimas lieka skiltyje **Auditas**.
6. **Eksportas** – CSV failai atsarginei kopijai (rekomenduoju atsisiųsti po kiekvieno turnyro).

## 3 minučių patikra po diegimo
Atlikite šiuos veiksmus (aš jų nepatikrinau realiame Supabase – tik su imitacija):
1. Atidarykite `reitingai-admin.html`, prisijunkite. Jei rodo „nėra administratoriaus“ – pakartokite 5 žingsnį.
2. Pridėkite bandomąjį žaidėją, perkraukite puslapį (F5) – jis turi likti. Atidarykite puslapį kitoje naršyklėje / telefone,
   prisijunkite – jis turi būti matomas.
3. Atsijunkite (**Atsijungti**) – turi vėl rodyti prisijungimo formą.
4. Įveskite kurio nors turnyro rezultatus kaip **juodraštį** (nespauskite „Paskelbti“) ir patikrinkite `reitingai.html`
   kitoje naršyklėje – reitingas turi likti tuščias. Juodraštis viešai nematomas, todėl jį galite palikti ir vėliau užbaigti.
5. **Skelbimo (publish) neišbandykite su išgalvotais žaidėjais oficialiame turnyre** – paskelbtų rezultatų ištrinti per puslapį
   negalima, galima tik pataisyti. Skelbimą jau išbandžiau imitacijoje; pirmą kartą paskelbus tikrus rezultatus pažiūrėkite
   `reitingai.html` (turi atsirasti abu žaidėjai su pilnais taškais) ir, jei kas nors neteisinga, pataisykite per
   „Išsaugoti pataisymą“. Bandomąjį žaidėjų įrašą galima pažymėti „Deaktyvuoti“.
6. Patikrinkite, kad registracijos nuorodos `index.html` veikia kaip anksčiau.

## Saugumo santrauka
- Naršyklėje yra tik viešas anon raktas. Jokių slaptažodžių ar `service_role` rakto repozitorijoje nėra (tai tikrina testai).
- Lankytojai gali skaityti tik **paskelbtus** rezultatus. Juodraščių, nepaskelbtų žaidėjų ir audito žurnalo jie nemato.
- Rašyti gali tik prisijungę ir `admins` lentelėje esantys naudotojai; tai tikrina duomenų bazė, o ne naršyklė.
- Audito žurnalo ištrinti ar pakeisti negalima.
- Slaptas administravimo adresas nėra apsauga – apsauga yra prisijungimas ir duomenų bazės taisyklės.

## Žinomi apribojimai
- Supabase „Free“ projektai gali būti sustabdyti dėl neaktyvumo – prieš sezoną patikrinkite, ar projektas veikia; naujausios
  sąlygos – Supabase svetainėje. Reguliariai eksportuokite CSV.
- Slaptažodžio atkūrimas / dviejų veiksnių prisijungimas šioje versijoje nesukonfigūruoti (galima įjungti Supabase nustatymuose).
