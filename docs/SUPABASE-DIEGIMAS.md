# ELITE reitingai – Supabase paruošimas (žingsnis po žingsnio)

Šis vadovas skirtas žmogui be programavimo patirties. Visi veiksmai atliekami **naršyklėje**: Supabase svetainėje ir
GitHub svetainėje. Viskas nemokama (Supabase „Free“ planas). Kodo keisti nereikia – tik į vieną failą
(`ranking/runtime-config.js`) įrašysite du **vieši** duomenys.

> **Svarbu – kas patikrinta, o kas ne.**
> Visą sistemą (duomenų bazės taisykles, administravimo puslapį, viešą puslapį) išbandžiau automatiniais testais
> **ant imitacijos**: tikra PostgreSQL duomenų bazė su ta pačia `schema.sql`, bet ne tikras Supabase projektas.
> **Su tikru Supabase projektu nebandžiau** – neturiu prieigos prie jūsų paskyros. Todėl 10 ir 12 žingsniai
> („Patikrinkite“) yra privalomi: jie parodo, ar tikras projektas elgiasi taip pat. Supabase meniu pavadinimai
> kartais keičiasi – jei žodis kiek kitoks, ieškokite panašios reikšmės.

## Ką reikės turėti
- el. pašto adresą administratoriui (galite naudoti savo),
- stiprų slaptažodį administratoriui (sugalvokite patys; **niekam jo nesiųskite, nerašykite į failus ar pokalbius**).

## Du aiškūs skirtukai: BANDOMIEJI ir OFICIALŪS duomenys

| | Bandomieji duomenys | Oficialūs duomenys |
|---|---|---|
| Kur | tik **bandomasis sezonas** „BANDOMASIS SEZONAS (neoficialus)“ | sezonas 2026–2027 ir jo 19 kalendoriaus turnyrų |
| Žaidėjai | su varnele „Bandomasis žaidėjas“ (ženklinami **BANDOMASIS**) | įprasti žaidėjai |
| Viešai | matomi tik tiesioginiu adresu, su geltonu perspėjimu; **neįeina** į pagrindinį reitingą ir istorinę statistiką | pagrindinis reitingas |
| Ištrynimas | skiltis **BANDYMAS → Ištrinti VISUS bandymo duomenis** | oficialių rezultatų ištrinti negalima – tik pataisyti su priežastimi |

Sistema **neleidžia** bandomojo žaidėjo įrašyti į oficialų turnyrą ir nesujungia bandomojo žaidėjo su oficialiu.
Todėl bandymo valymas fiziškai neliečia oficialių duomenų. Jokių SQL „išvalymo“ komandų vykdyti **nereikia ir nesiūloma**.

---

## 1. Sukurkite Supabase projektą
1. Atidarykite <https://supabase.com> → **Start your project** → prisijunkite (galima per GitHub).
2. **New project**. Pasirinkite organizaciją, įveskite pavadinimą (pvz. `elite-reitingai`).
3. **Database Password** – sugeneruokite ir **išsaugokite slaptažodžių tvarkyklėje**. Svetainei jo nereikia.
4. **Region** – artimiausias (pvz. Frankfurt / Europe). Planas – **Free**.
5. Jei klausia apie „Automatically expose new tables and functions“ – palikite numatytą reikšmę.
   (`schema.sql` pati nurodo, ką galima matyti ir kam – nuo šio nustatymo nepriklauso.)
6. **Create new project** ir palaukite 1–2 min.

## 2. Atidarykite SQL Editor
Kairiajame meniu spauskite **SQL Editor** (kodo ikona `</>` arba užrašas „SQL Editor“) → **New query**.

## 3. Paleiskite SQL failus – tokia tvarka
Failus rasite GitHub repozitorijoje, aplanke `supabase/`. Atidarykite failą → **Raw** (arba kopijavimo mygtukas)
→ nukopijuokite **visą** turinį → įklijuokite SQL Editor → **Run**.

| Eilė | Failas | Ką daro | Kada |
|---|---|---|---|
| 1 | `supabase/schema.sql` | sukuria lenteles, apsaugą (RLS), funkcijas | dabar |
| 2 | `supabase/seed.sql` | įrašo sezoną ir 19 kalendoriaus turnyrų (be žaidėjų ir rezultatų) | dabar |
| 3 | `supabase/make-admin.sql` | suteikia administratoriaus teises | po 4 žingsnio |

- Kiekvienas failas – **atskira „New query“**. Po „Run“ turi būti „Success“.
- `schema.sql` galima paleisti pakartotinai – nieko nesugadins.
- **Nepaleiskite** `tests/sql/supabase-shim.sql` – tai tik automatiniams testams.

## 4. Sukurkite pirmąjį administratoriaus paskyrą
1. Kairėje **Authentication** → **Users** → **Add user** → **Create new user**.
2. Įveskite savo el. paštą ir slaptažodį. **Pažymėkite „Auto Confirm User“** (jei yra). **Create user**.
   Jei varnelės nėra, paskyra turi būti patvirtinta kitaip (naudotojo meniu → patvirtinti el. paštą) – kitaip 5 žingsnis nieko neįgalios.

## 5. Saugiai suteikite administratoriaus teises
1. **SQL Editor** → **New query**.
2. Atidarykite `supabase/make-admin.sql`, nukopijuokite, **pakeiskite tik** `PAKEISKITE@JUSU-PASTAS.lt` į savo
   administratoriaus el. paštą (tą patį kaip 4 žingsnyje; palikite kabutes) → **Run**.
3. Apačioje turi pasirodyti eilutė su jūsų el. paštu. Jei lentelė **tuščia** – el. paštas neatitiko arba paskyra
   nepatvirtinta; pataisykite ir paleiskite iš naujo.

Kodėl tai saugu: teises suteikia **tik jūs** šiame SQL Editor (kaip Supabase savininkas). Joks lankytojas ar net
prisijungęs paprastas naudotojas negali pasidaryti administratoriumi – duomenų bazė to neleidžia. Įgaliojami tik
patvirtinto el. pašto naudotojai. Daugiau administratorių pridėsite tuo pačiu būdu (kitas el. paštas).

## 6. Išjunkite viešą registraciją
1. **Authentication** → **Sign In / Providers** (kai kuriose versijose **Settings**).
2. Raskite **Allow new users to sign up** → **išjunkite** → **Save**.

Taip niekas kitas negali susikurti paskyros. Net jei kas nors ir susikurtų, administratoriumi ji netaptų (teises suteikia
tik 5 žingsnis) ir nieko nematytų. Išjungimas – papildoma apsauga.
Pastaba: išjungus registraciją, naujus naudotojus galite kurti tik jūs per **Authentication → Users → Add user**.

## 7. Suraskite Project URL ir viešą raktą
1. **Project URL** – atrodo kaip `https://xxxxxxxx.supabase.co`. Rasite viršuje paspaudę **Connect**, arba
   **Project Settings → Data API** (kai kuriose versijose **API**).
2. **Viešas raktas** – **Project Settings → API Keys**:
   - **Publishable key** (prasideda `sb_publishable_…`) – **naudokite šį**;
   - jei matote tik senąjį skirtuką „Legacy“ – raktas **`anon`** (prasideda `eyJ…`) irgi tinka
     (Supabase planuoja senąsias rakto rūšis nutraukti iki 2026 m. pabaigos, todėl geriau naudoti publishable).
3. **Niekada nekopijuokite** raktų, pažymėtų **`secret`** arba **`service_role`**. Svetainei jų nereikia, o paviešintas toks
   raktas atvertų visą duomenų bazę. Jei per klaidą įklijuosite – svetainė jį **atpažins, nenaudos** ir parodys
   raudoną perspėjimą; tada tą raktą Supabase skiltyje **API Keys** pakeiskite (rotuokite).

Viešas raktas **skirtas būti viešas**: duomenis saugo duomenų bazės taisyklės (RLS), o ne rakto slaptumas.

## 8. Įrašykite šiuos du viešus duomenis į svetainę
Tik šioje vietoje – failas **`ranking/runtime-config.js`** (jokių kitų failų redaguoti nereikia):
1. GitHub → jūsų repozitorija → `ranking` → `runtime-config.js` → pieštuko ikona (**Edit**).
2. Tarp kabučių įrašykite (savo reikšmes):
   ```js
   export const RUNTIME = {
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'sb_publishable_...',
   };
   ```
3. **Commit changes**.

Tvarka (žr. 9): geriausia šį failą redaguoti **po** to, kai pakeitimai sujungti į pagrindinę šaką (`main`). Kol failas tuščias,
svetainė saugiai rodo „Reitingai dar neprijungti“. Jei reikšmės neteisingos, viešas ir administravimo puslapiai
parodo **konkrečią priežastį** (pvz. „Tai ne projekto adresas“, „Netinkamas raktas“, „Įrašytas PRIVILEGIJUOTAS raktas“).

> Kodėl ne automatinis (GitHub Actions) konfigūravimas: šis projektas – paprasta statinė svetainė be „build“ žingsnio.
> Veikiantį GitHub Pages diegimo būdą keisti dėl dviejų viešų reikšmių būtų didesnė rizika nei nauda. Dvi viešos reikšmės
> repozitorijoje yra saugios (tai ne paslaptys), o failas aiškiai apsaugotas nuo privilegijuotų raktų.

## 9. Paskelbkite atnaujintą svetainę (reikalingas jūsų sutikimas)
Pakeitimai yra šakoje `feature/reitingai`, **pull request #1**. Jis **nesujungtas** – be jūsų leidimo nieko nepublikuoju.
1. GitHub → **Pull requests** → **#1** → peržiūrėkite → **Merge pull request** → **Confirm merge**.
2. Palaukite 1–2 min. GitHub **Actions** skiltyje turi baigtis „pages build and deployment“ (žalia varnelė).
3. Atlikite 8 žingsnį (įrašykite URL ir raktą į `ranking/runtime-config.js` šakoje `main`) ir vėl palaukite 1–2 min.
4. Atidarykite:
   - viešą reitingą: <https://arturasbekis-png.github.io/Elite-turnyras/reitingai.html>
   - administravimą (čia pridedami žaidėjai): <https://arturasbekis-png.github.io/Elite-turnyras/reitingai-admin.html>
   - kalendorius (nepakitęs): <https://arturasbekis-png.github.io/Elite-turnyras/> – viršuje turi būti nuoroda **REITINGAI**.
   Jei po perkrovimo vaizdas senas – paspauskite Ctrl+F5 (telefone – uždarykite ir vėl atidarykite naršyklę).

## 10. Patikrinkite su bandomuoju žaidėju ir bandomuoju turnyru
Atidarykite administravimo puslapį ir prisijunkite. **Prieš** tai neįvedinėkite jokių tikrų rezultatų.
Visa tai – **bandomieji** duomenys, viską ištrinsite 11 žingsnyje.

1. Atsidarykite skiltį **BANDYMAS** → **1. Sukurti bandomąjį sezoną**.
2. Skiltis **ŽAIDĖJAI**: įrašykite **Vardą** ir **Pavardę**, **pažymėkite „Bandomasis žaidėjas“**, **PRIDĖTI ŽAIDĖJĄ**.
   Pridėkite 4 žaidėjus (pvz. „Bandymas Pirmas“, „Bandymas Antras“, „Bandymas Trečias“, „Bandymas Ketvirtas“).
   Perkraukite puslapį (F5) – žaidėjai turi likti. Atidarykite administravimą **kitame įrenginyje ar naršyklėje**,
   prisijunkite – turi matyti tuos pačius žaidėjus (tai įrodo, kad jie saugomi duomenų bazėje, o ne naršyklėje).
3. Skiltis **BANDYMAS** → **Atidaryti bandomąjį turnyrą** → **Pridėti komandą** (du kartus). Kiekvienai komandai parinkite
   du žaidėjus ir įrašykite vietą 1 ir 2. Dešinėje iškart matote taškus kiekvienam (1 vieta – po 50, 2 vieta – po 40).
4. **Išsaugoti juodraštį.** Atidarykite viešą puslapį kitame įrenginyje: bandomojo sezono reitingas **turi būti tuščias**
   (juodraštis viešai nematomas).
5. **PASKELBTI OFICIALIUS REZULTATUS.** Atidarykite
   `https://arturasbekis-png.github.io/Elite-turnyras/reitingai.html#bendras?s=bandymas`
   (arba nuorodą skiltyje BANDYMAS). Turi matytis geltonas perspėjimas „BANDOMASIS SEZONAS“ ir **abu** komandos nariai
   su **pilnais** taškais (po 50 / po 40).
6. Atidarykite įprastą `reitingai.html` – bandomųjų žaidėjų **ten nėra** (pagrindinis reitingas nepaliestas).
7. Atsijunkite (**Atsijungti**) – turi vėl rodyti tik prisijungimo formą.
8. (Neprivaloma) Pataisykite bandomąjį rezultatą: pakeiskite vietas, įrašykite priežastį, **Išsaugoti pataisymą** –
   taškai turi persiskaičiuoti, o ne susidubliuoti; įrašas atsiranda skiltyje **Auditas**.
9. Patikrinkite telefone ir kalendoriuje, kad registracijos nuorodos veikia kaip anksčiau.

Jei kuris nors žingsnis nepavyksta – **nepereikite prie oficialių rezultatų**, parašykite man, ką matote ekrane.

## 11. Saugiai pašalinkite bandymo duomenis prieš oficialų naudojimą
1. Skiltis **BANDYMAS** → **Ištrinti VISUS bandymo duomenis** → patvirtinkite.
2. Turi pasirodyti žinutė „Bandymo duomenys ištrinti (sezonų: 1, turnyrų: 3, komandų: 2, žaidėjų: 4). Oficialūs duomenys
   nepaliesti.“ Skaičiai gali skirtis pagal tai, ką bandėte.
3. Patikrinkite: skiltis **ŽAIDĖJAI** – bandomųjų žaidėjų nebėra; `reitingai.html#bendras?s=bandymas` – bandomojo
   sezono nebėra; įprastas `reitingai.html` nepasikeitė.

Ką trynimas daro, o ko ne: ištrina **tik** bandomąjį sezoną, jo turnyrus ir žaidėjus su žyma BANDOMASIS. **Nieko** iš oficialių
sezonų, turnyrų, žaidėjų ar paskelbtų rezultatų netrina. Jei bandomasis žaidėjas kažkokiu būdu pateko į oficialų turnyrą,
trynimas **sustoja ir nieko neištrina**. Audito žurnalas (nekeičiamas) išlieka – jame liks užrašas, kad bandymas buvo atliktas.
Jei tikrą žaidėją per klaidą pažymėjote kaip bandomąjį, jis rodomas su ženklu BANDOMASIS ir į oficialų turnyrą jo sistema neįleis;
tokį įrašą ištrinkite per BANDYMAS ir sukurkite iš naujo be varnelės.

**Nenaudokite** jokių SQL „viską išvalyti“ komandų realiame projekte – jos neišbandytos jūsų duomenų bazėje ir gali sunaikinti
oficialius rezultatus.

## 12. Patikrinkite, kad anoniminis lankytojas negali rašyti
Tai patikrina, ar **tikras** projektas atmeta neleistinus veiksmus (testai tai patikrino tik imitacijoje).

**A. Paprasta patikra.** Atsijungus (arba naujame „Incognito“ lange) atidarykite `reitingai-admin.html` – matoma tik
prisijungimo forma. Prisijungus **ne administratoriaus** paskyra (jei tokią turite) rodoma „Ši paskyra nėra administratoriaus“.

**B. Tiesioginė patikra (rekomenduojama).** Atidarykite `reitingai.html` **Incognito** lange → paspauskite F12 →
skirtukas **Console** → įklijuokite ir paspauskite Enter. Čia naudojami tik jūsų viešos reikšmės; nieko neįrašoma į
duomenų bazę, nes visi trys bandymai turi būti **atmesti** (jei kuris nors pavyktų – tai bandomasis žaidėjas, kurį ištrinsite 11 žingsniu):
```js
const { RUNTIME: R } = await import('./ranking/runtime-config.js');
const h = { apikey: R.supabaseAnonKey, 'Content-Type': 'application/json',
  ...(R.supabaseAnonKey.startsWith('eyJ') ? { Authorization: 'Bearer ' + R.supabaseAnonKey } : {}) };
for (const [m, p, b] of [
  ['POST', '/rest/v1/players', { first_name: 'Hakeris', last_name: 'Bandymas', is_test: true }],
  ['GET', '/rest/v1/players?select=*'],
  ['POST', '/rest/v1/rpc/admin_delete_test_data', {}],
  ['POST', '/rest/v1/rpc/public_ranking_data', {}],
]) {
  const r = await fetch(R.supabaseUrl + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined });
  console.log(m, p, '→', r.status);
}
```
**Teisingas rezultatas:** pirmi trys kreipiniai grąžina **401 arba 403** (atmesta); ketvirtas (viešas skaitymas) –
**200**. Jei pirmi trys grąžina 200 / 201 / 204 – **nedelsdami nustokite naudoti sistemą** ir parašykite man.
Šio patikrinimo aš tikrame projekte nepaleidau.

---

## Kaip naudotis kasdien (be kodo)
1. Atidarykite `https://arturasbekis-png.github.io/Elite-turnyras/reitingai-admin.html` ir prisijunkite.
2. **ŽAIDĖJAI** – įrašykite **Vardą** ir **Pavardę** → **PRIDĖTI ŽAIDĖJĄ**. Sistema perspės, jei toks vardas jau yra
   (net su kitomis didžiosiomis raidėmis ar be lietuviškų rašmenų). Klaidą vardyje taisykite **Redaguoti** (ID ir taškai išlieka).
   Dublikatus sujunkite „Sujungti dublikatus“.
3. **REZULTATŲ SUVEDIMAS** – pasirinkite sezoną **2026–2027**, turnyrą iš kalendoriaus, **Pridėti komandą**, parinkite du
   žaidėjus ir galutinę vietą. Dešinėje iškart matote taškus kiekvienam. Tas pats žaidėjas dviejose komandose neleidžiamas.
4. **Peržiūrėti taškus ir patikrinti** → **Išsaugoti juodraštį** (viešai nerodomas) → **PASKELBTI OFICIALIUS REZULTATUS**.
5. Klaidą po paskelbimo taisykite tame pačiame puslapyje: pakeiskite vietas, įrašykite priežastį, **Išsaugoti pataisymą**.
   Taškai perskaičiuojami (nedubliuojami), o pakeitimas lieka skiltyje **Auditas**.
6. **Eksportas** – CSV failai atsarginei kopijai (rekomenduoju atsisiųsti po kiekvieno turnyro).

Jei prisijungimas pasibaigia (po ilgesnės pertraukos), puslapis grąžina į prisijungimo formą – neišsaugoti pakeitimai gali
dingti, todėl dažniau spauskite **Išsaugoti juodraštį**.

## Dažniausios žinutės
| Matote | Reiškia | Ką daryti |
|---|---|---|
| „Reitingai dar neprijungti“ | `runtime-config.js` tuščias | 8 žingsnis |
| „Tai ne projekto adresas“ / „Adresas per ilgas“ | blogas `supabaseUrl` | įrašykite tik `https://….supabase.co` |
| „Netinkamas raktas“ / „Raktas iš kito projekto“ | blogas `supabaseAnonKey` | nukopijuokite publishable raktą iš to paties projekto |
| „Įrašytas PRIVILEGIJUOTAS raktas“ | įklijuotas `secret` / `service_role` | pakeiskite jį Supabase (rotuokite), čia įrašykite tik publishable |
| „Duomenų bazė atmetė svetainės viešą raktą“ | URL ir raktas neatitinka arba raktas atšauktas | patikrinkite 7–8 žingsnius |
| „Nerasta reikiamų funkcijų“ | nepaleistas `schema.sql` | 3 žingsnis |
| „Ši paskyra nėra administratoriaus“ | nepaleistas / nepavykęs `make-admin.sql` | 5 žingsnis |
| „Šio el. pašto adresas dar nepatvirtintas“ | paskyra sukurta be „Auto Confirm User“ | Authentication → Users → patvirtinkite |

## Saugumo santrauka (ką tikrina testai, o ko ne)
- Naršyklėje yra **tik** viešas raktas. Jokių slaptažodžių ar `secret` / `service_role` rakto repozitorijoje nėra (tai tikrina testai);
  jei toks raktas būtų įklijuotas, svetainė jo nenaudotų.
- Lankytojai gali kviesti **tik** funkciją `public_ranking_data()`, kuri grąžina **tik paskelbtus** rezultatus. Juodraščių komandų,
  nepaskelbtų žaidėjų ir audito žurnalo jie nemato. Viešai matoma tik turnyro būsena (pvz. „Rezultatų juodraštis“), ne komandos ar taškai.
- Rašyti gali tik prisijungę ir `admins` lentelėje esantys naudotojai; tai tikrina duomenų bazė (RLS ir funkcijos), o ne naršyklė.
  Nė viena lentelė neturi tiesioginio rašymo teisių klientams, išskyrus žaidėjų vardus (tik administratoriams).
- Audito žurnalo ištrinti ar pakeisti negalima. Slaptas administravimo adresas nėra apsauga – apsauga yra prisijungimas ir taisyklės.
- **Neištirta tikrame Supabase:** viską išbandžiau tikroje PostgreSQL, bet su imituotu Supabase prisijungimo ir API sluoksniu.
  Todėl 10 ir 12 žingsniai – privalomi. Tik jie patvirtina, kad tikras projektas veikia taip pat.

## Žinomi apribojimai
- Supabase „Free“ projektai gali būti sustabdyti dėl neaktyvumo – prieš sezoną patikrinkite, ar projektas veikia; naujausios
  sąlygos – Supabase svetainėje. Reguliariai eksportuokite CSV.
- Slaptažodžio atkūrimas ir dviejų veiksnių prisijungimas šioje versijoje nesukonfigūruoti (galima įjungti Supabase nustatymuose;
  slaptažodį pakeisite Authentication → Users).
- Paskelbtų rezultatų ištrinti puslapyje negalima – tik pataisyti (tai sąmoningas apsaugos sprendimas).
