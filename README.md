# Dostawca+ — Asystent Dostawcy na iPhone

Dostawca+ to mobilna aplikacja PWA zaprojektowana pod pracę dostawcy RTV/AGD. Nie wymaga App Store — po umieszczeniu folderu na HTTPS możesz otworzyć ją w Safari i wybrać **Udostępnij → Dodaj do ekranu początkowego**.

## Co działa

- dodawanie zleceń i adresów,
- skanowanie adresu aparatem (OCR Tesseract.js; rozpoznawanie odbywa się w przeglądarce),
- inteligentna kolejność trasy z uwzględnieniem okien czasowych i czasu pracy na miejscu,
- geokodowanie adresów przez OpenStreetMap Nominatim,
- drogowa macierz czasu/dystansu przez publiczny OSRM, z awaryjnym algorytmem odległości,
- start nawigacji w Google Maps lub Apple Maps z aktualnej lokalizacji,
- statusy: do zrobienia / na miejscu / gotowe,
- telefon do klienta i gotowy SMS ETA,
- kolejność załadunku odwrotna do trasy,
- GPS-owa kilometrówka podczas aktywnej zmiany,
- ręczny licznik auta jako zabezpieczenie, gdy iOS uśpi aplikację w tle,
- checklist przed wyjazdem,
- dzienne statystyki i eksport CSV,
- tryb jasny/ciemny,
- lokalne przechowywanie danych i offline shell PWA.

## Najszybsze uruchomienie

### Wariant A — pełna wersja PWA (zalecane)

1. Wgraj cały folder na dowolny hosting HTTPS (np. GitHub Pages, Netlify, Cloudflare Pages lub własny serwer).
2. Otwórz adres strony w **Safari na iPhonie**.
3. W Safari: **Udostępnij → Dodaj do ekranu początkowego**.
4. Przy pierwszym uruchomieniu zmiany zezwól na lokalizację. Przy skanowaniu zezwól na aparat/zdjęcia.

### Wariant B — pojedynczy plik

Plik `DostawcaPlus_iPhone_standalone.html` zawiera HTML, CSS i JavaScript w jednym pliku. Nadaje się do szybkiego podglądu/testu, ale pełny GPS/PWA na iPhonie najlepiej działa po HTTPS.

Do testu na komputerze możesz uruchomić w katalogu:

```bash
python3 -m http.server 8080
```

i wejść na `http://localhost:8080`.

## Ważne ograniczenia iOS / wersji webowej

- iOS może ograniczać działanie GPS, gdy PWA jest długo w tle lub ekran jest zablokowany. Dlatego dodano ręczny stan licznika auta.
- Integracja z historią przejazdów Google Maps nie jest dostępna bezpośrednio dla zwykłej aplikacji webowej. Kilometry są liczone własnym GPS-em.
- Skanowanie OCR przy pierwszym użyciu pobiera bibliotekę/model językowy z internetu.
- Publiczne Nominatim/OSRM są dobre do prywatnego, lekkiego użycia. Jeśli aplikacja miałaby być wdrożona dla wielu kierowców, należy podpiąć własny lub komercyjny backend mapowy.

## Prywatność

Adresy, numery telefonów, notatki, historia i dystans są zapisywane lokalnie w `localStorage` urządzenia. Przy optymalizacji trasy adresy są wysyłane do usługi geokodującej, a współrzędne do silnika trasowania. Zdjęcie użyte przez OCR nie jest wysyłane przez kod aplikacji na serwer aplikacji; Tesseract działa po stronie przeglądarki.
