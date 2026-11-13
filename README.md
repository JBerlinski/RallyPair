# RallyPair

Aplikacja dla załogi: **nawigator** wyznacza trasę i prowadzi opis, **kierowca** widzi na swoim
telefonie mapę i nadchodzące zakręty jako ikony w stylu gier rajdowych.

## Jak to działa

1. Nawigator otwiera pokój i podaje kierowcy 6-cyfrowy kod.
2. Nawigator dodaje punkty trasy (wyszukiwarka, współrzędne, link do mapy albo przytrzymanie palca
   na mapie) i wybiera **Wyznacz trasę**.
3. Zakręty są wykrywane automatycznie z kształtu drogi i oceniane w skali `6` (szybki) → `1`
   (bardzo ostry), `Sq` (90°) i `Hp` (nawrót), z dopiskami „zacieśnia / otwiera / długi”,
   rondami, skrzyżowaniami, a tam, gdzie to możliwe, także mostami, tunelami i przejazdami kolejowymi.
4. Nawigator może każdą notatkę zmienić, przesunąć, usunąć albo dodać własną — kierowca widzi
   zmiany od razu. Ręczne poprawki przetrwają ponowne przeliczenie trasy.
5. Oba telefony pokazują tę samą aktualną notatkę, wyliczoną z pozycji GPS kierowcy.

## Struktura

| Katalog | Zawartość |
| --- | --- |
| `backend/` | Serwer Socket.IO: pokoje, przekazywanie opisu trasy i pozycji |
| `mobile/` | Aplikacja Expo (Android, iOS, web) |
| `mobile/src/utils/pacenotes.js` | Wykrywanie zakrętów i logika notatek (czyste funkcje) |
| `mobile/src/utils/paceIcons.js` | Definicje ikon — wspólne dla ekranów i mapy |
| `mobile/src/components/leafletMapHtml.js` | Mapa Leaflet osadzona w WebView / iframe |

## Uruchomienie lokalne

```bash
cd backend && npm install && npm start
```

```bash
cd mobile && npm install && EXPO_PUBLIC_BACKEND_URL=http://localhost:3000 npx expo start
```

```bash
cd mobile && npm test
```

Notatki powstają automatycznie i mogą być niedokładne — to pomoc, a nie zastępstwo dla oczu i przepisów.
