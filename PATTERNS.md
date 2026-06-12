# PATTERNS.md — jak działa pattern engine (`tracker.js`)

## Dane wejściowe

Każdy dzień to jeden klucz `life:d:YYYY-MM-DD` w `localStorage`:

```json
{
  "sleep":  { "start": "23:30", "end": "07:00", "hours": 7.5, "quality": 7 },
  "meals":  [{ "t": "13:00", "name": "kurczak z ryżem", "fastfood": false, "alcohol": false }],
  "moods":  [{ "t": "10:15", "mood": 7, "energy": 5, "tags": ["stres"] }],
  "moves":  [{ "t": "17:30", "type": "siłownia", "min": 60, "kind": "strength" }],
  "supps":  [{ "t": "08:10", "name": "witamina D3" }],
  "prod":   { "deepWork": 2.5, "pomodoro": 4 },
  "weight": 82.3
}
```

Schema jest wersjonowana w `life:meta.version`. Przy starcie `tracker.js` przechodzi
przez `MIGRATIONS[v]` od zapisanej wersji do `SCHEMA_VERSION` — dodanie pola w
przyszłości to bump wersji + jedna funkcja migrująca, stare dane nigdy nie giną.

## Krok 1 — podsumowania dzienne

Przed analizą każdy dzień jest spłaszczany do jednego wiersza (`summary()`):

| Pole | Definicja |
|---|---|
| `sleepH`, `sleepQ` | godziny i jakość snu |
| `bedMin` | pora zaśnięcia w minutach od północy |
| `mood`, `energy` | **średnia** ze wszystkich wpisów nastroju danego dnia |
| `fastfood`, `alcohol` | `true`, jeśli *którykolwiek* posiłek miał flagę |
| `strength`, `cardio` | `true`, jeśli był trening danego typu |
| `moveMin`, `deepWork`, `pomodoro`, `weight`, `mealsN`, `suppsN` | sumy / wartości |

To celowo gruba agregacja: korelacje na poziomie dnia są odporne na to,
że ktoś zaloguje nastrój raz albo trzy razy.

## Krok 2 — bramka ilości danych

Nic nie jest pokazywane przed **14 zalogowanymi dniami** (`MIN_DAYS_FOR_PATTERNS`).
Dodatkowo każde pojedyncze porównanie wymaga **min. 4 dni w każdym koszyku**
(`MIN_BUCKET_N`) — inaczej finding jest pomijany. Chroni to przed "wzorcami"
z dwóch punktów danych.

## Krok 3 — porównania warunkowe (split-mean)

Podstawowa technika: podziel dni na dwa koszyki warunkiem A i porównaj
średnią metryki B.

```
delta = mean(B | A=true) − mean(B | A=false)
```

Zaimplementowane pary (`findings()`):

| # | Warunek (A) | Metryka (B) | Uwagi |
|---|---|---|---|
| 1 | sen ≥ 7.5 h vs < 6.5 h | nastrój tego dnia | środkowy przedział (6.5–7.5 h) odrzucany, żeby wyostrzyć kontrast; fallback: ≥7.5 vs reszta |
| 2 | sen ≥ 7.5 h | energia tego dnia | |
| 3 | alkohol w dniu D | energia w dniu **D+1** | przesunięcie o 1 dzień — efekt kaca |
| 4 | alkohol w dniu D | jakość snu tej nocy | |
| 5 | fastfood | energia tego dnia | |
| 6 | trening siłowy | nastrój tego dnia | |
| 7 | zaśnięcie po północy (`bedMin < 720`) | energia w dniu **D+1** | pora 00:00–11:59 traktowana jako "po północy" |

Przesunięcia D+1 realizuje mapa `byKey` + `addDays(key, 1)` — dzień następny
musi być faktycznie zalogowany, inaczej para wypada z próby.

## Krok 4 — korelacja Pearsona (zmienne ciągłe)

Dla par ciągłych (obecnie: **godziny snu ↔ deep work**) liczony jest
klasyczny współczynnik Pearsona:

```
r = Σ(xᵢ−x̄)(yᵢ−ȳ) / √(Σ(xᵢ−x̄)² · Σ(yᵢ−ȳ)²)
```

Wynik pokazywany tylko gdy `|r| ≥ 0.3` (słabsze korelacje to przy tej
wielkości próby zwykle szum) i `n ≥ 5`.

## Krok 5 — ranking i prezentacja

Findingi sortowane malejąco po `|delta|` — najpierw najsilniejsze efekty.
Każdy pokazuje `n` (łączną liczbę dni w próbie), żeby było widać, na ilu
danych opiera się wniosek.

## Sugestia dnia (`suggestToday()`)

Niezależny mechanizm: profil dnia tygodnia.

1. Dni grupowane po `Date.getDay()`, liczona średnia energia per dzień tygodnia.
2. Wymagane ≥ 14 dni łącznie i ≥ 3 obserwacje dla *dzisiejszego* dnia tygodnia.
3. Progi: średnia ≤ 4.5 → "planuj light work"; ≥ 7 → "dobry dzień na deep work";
   pomiędzy → neutralna informacja.

Ten sam profil zasila wykres słupkowy "Energia wg dnia tygodnia" w `life.html`
(słupki ≤ 4.5 podświetlane na żółto).

## Domyślne wartości z historii (autouzupełnianie)

- **Posiłki / suplementy / ruch**: częstotliwość nazw z ostatnich 45 dni;
  top pozycje stają się chipami w formularzu. Dla posiłków liczona jest też
  średnia pora (`typicalTime`) — kliknięcie chipa ustawia i nazwę, i godzinę.
- **Sen**: **mediana** pory zaśnięcia/pobudki i długości z ostatnich 30 nocy
  (mediana zamiast średniej — odporna na pojedyncze zarwane noce).
  Pory po północy mapowane na zakres >24 h przed liczeniem mediany,
  żeby 23:30 i 00:30 nie uśredniały się do południa.

## Świadome ograniczenia

- **Korelacja ≠ przyczynowość.** Engine raportuje współwystępowanie;
  "po siłowni nastrój +1.1" może równie dobrze znaczyć "w dobre dni chodzę na siłownię".
- Brak testów istotności statystycznej — progi `MIN_BUCKET_N` i `|r| ≥ 0.3`
  to pragmatyczne filtry, nie p-value. Przy ~30 dniach danych formalne testy
  i tak miałyby znikomą moc.
- Confoundery nieuwzględniane (np. alkohol i późne zaśnięcie współwystępują —
  oba findingi mogą opisywać ten sam mechanizm).

## Dane demo (`seedDemo(30)`)

Deterministyczny PRNG (mulberry32, stały seed) generuje 30 dni z **wbudowanymi
wzorcami**, żeby analytics miały co pokazać: sen→nastrój/energia, alkohol
pt/sob → gorszy sen i energia D+1, niska energia we wtorki, siłownia
pn/śr/pt → wyższy nastrój, deep work skorelowany z energią, powolny dryf wagi.
Flaga `life:meta.demo` oznacza dane jako demo; "Wyczyść wszystko" usuwa je
przed prawdziwym trackingiem.
