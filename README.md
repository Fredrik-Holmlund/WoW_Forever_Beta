# Forever Talents

Ett litet verktyg för att utforska talangträden i **World of Warcraft: Forever**
(planerat släpp 4 nov 2026, beta väntas öppna ~17 sep 2026) och få en
**grov, heuristisk** rekommendation för vilka talanger som ger mest valuta
per poäng — samt en förslags-build för ett valfritt antal poäng (0–51).

Spelet är inte ute än. All data nedan är **preliminär och kan ändras** fram
till beta/release.

## Stack

- **Python 3** för datapipeline och scoring (`data/`, `scoring/`). Inga
  tunga beroenden (endast standardbiblioteket) — datan är liten (9 klasser
  × 3 träd) så det finns inget behov av pandas/numpy etc.
- **Statisk HTML/CSS/vanilla JS** för UI (`app/`). Ingen backend behövs
  eftersom all data är förberäknad JSON. Inget byggsteg, inga ramverk —
  räcker gott för en grid av ~20 noder per träd och håller det enkelt att
  hosta (GitHub Pages, `python3 -m http.server`, etc.).
- Datan checkas in som en **snapshot** (`data/out/*.json`) i repot,
  eftersom källan (Wowheads interna endpoint) kan ändra `db`-token och
  själva talangdatan när som helst innan release. Pipelinen (`scoring/generate_scored_data.py`)
  regenererar `app/data/scored.json` från snapshoten.

## Datakälla och status

Talangdatan hämtas från Wowheads backend-endpoint bakom deras talent-
calculator för Forever (`wowhead.com/forever/talent-calc/<class>`):

```
https://nether.wowhead.com/forever/data/talents-classic?dv=<dv>&db=<db>
```

Trots att URL:en och interna filnamn innehåller "classic" innehåller
svaret faktiska Forever-specifika talanger (verifierat manuellt, t.ex.
"Weaponmaster" och "Bastion" som inte finns i vanilla Classic).

**`db`-parametern är en cache/version-token som Wowhead byter då och då.**
Om `data/fetch_forever_talents.py` börjar ge tomma/gamla resultat:

1. Öppna talent-calculatorn på wowhead.com för valfri klass.
2. Öppna DevTools → Network → filtrera på XHR.
3. Ladda om sidan, hitta requesten mot `talents-classic`.
4. Kopiera den nya `dv`/`db` från query-strängen och uppdatera `DATA_URL`
   i `data/fetch_forever_talents.py`.
5. Kör om `python3 data/fetch_forever_talents.py` och committa den nya
   snapshoten i `data/out/`.

**Obs:** i den här (sandboxade) utvecklingsmiljön är utgående nätverk till
`nether.wowhead.com` blockerat av miljöns egress-policy, så scriptet kunde
inte köras live här. Snapshoten i `data/out/` kommer istället från ett
körning gjord utanför sandboxen. Kör scriptet själv lokalt (där du har
vanlig internetåtkomst) för att uppdatera datan.

### Osäkra spec-namn

`TREE_NAME_MAP` i `data/fetch_forever_talents.py` mappar Wowheads interna
träd-`description` (t.ex. `"WarlockCurses"`) till klass/spec-namn. Följande
är placeholder-namn hämtade från Classic-eran och kan avvika från vad
Forever faktiskt kallar specen i UI:t:

- **Warlock**: `WarlockCurses` → "Affliction", `WarlockSummoning` →
  "Demonology" (Classic-namnen var "Curses"/"Summoning"-trädet snarare än
  moderna spec-namn — verifiera mot Foreverd talent-calc UI när den är
  tillgänglig).
- **Paladin**: `PaladinCombat` → "Retribution" (samma sak — Classic kallade
  det inte formellt en "spec" på samma sätt).

Allt annat i `TREE_NAME_MAP` är rimligt raka mappningar (t.ex.
`MageFire` → Mage/Fire) men bör också dubbelkollas när spelet väl är ute.

## Struktur

```
data/
  fetch_forever_talents.py   # hämtar + normaliserar rådata från Wowhead
  out/                       # normaliserad snapshot, en fil per klass + all.json
scoring/
  scorer.py                  # Scorer-protokoll + HeuristicScorer (grov approximation)
  builder.py                 # "bästa build för N poäng" — DP som respekterar rad-lås + requires
  generate_scored_data.py    # kör scoring över data/out/all.json -> app/data/scored.json
app/
  index.html / app.js / style.css   # statisk UI, läser app/data/scored.json
README.md
```

## Köra pipelinen

```bash
python3 data/fetch_forever_talents.py       # uppdaterar data/out/*.json (kräver nätåtkomst)
python3 scoring/generate_scored_data.py     # skriver app/data/scored.json
```

## Köra UI:t

Data hämtas via `fetch()`, så filen måste servas över http (inte öppnas
som `file://`):

```bash
cd app
python3 -m http.server 8000
# öppna http://localhost:8000
```

## Scoring — hur det fungerar (och hur du byter ut det)

Se `scoring/scorer.py` för fullständig dokumentation. Kort sammanfattning:

- `Scorer` är ett `Protocol` med en metod: `score_talent(talent) -> TalentScore`.
- `HeuristicScorer` är **den enda implementationen just nu** och är en
  **grov approximation, inte en simulering**. Den läser talangens
  text-beskrivning per rank, plockar ut siffror (%, sekunder, flat stats
  etc.) och viktar dem efter kategori (skade/heal-ökning väger tyngst,
  ren stat-ökning väger lägst, etc.) — se konstanterna högst upp i filen.
- Allt annat i appen (builder, UI) pratar bara med `Scorer`-gränssnittet.
  Efter release, byt ut `HeuristicScorer` mot t.ex. en `SimcScorer` som
  läser riktiga DPS/HPS-resultat från SimulationCraft, kör om
  `generate_scored_data.py`, och resten av appen behöver inte ändras.

`scoring/builder.py` löser "bästa build för N poäng" som ett rad-för-rad
grupperat knapsack-DP: talangträdet är litet (max 7 rader × 4 kolumner,
51 poäng), så brute-force/DP per rad är fullt tillräckligt snabbt. Den
respekterar både rad-låset (rad *r* kräver ≥5*r* investerade poäng i
trädet) och `requires`-fältet (specifik talang måste ha ≥ N ranks innan en
beroende talang kan få poäng).
