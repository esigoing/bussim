# BusSim — Scania Citywide Simulator

Ein vollständig prozeduraler 3D-Bussimulator im Browser. **Keine externen
Assets**: alle Modelle, Texturen und Sounds werden zur Laufzeit generiert
(Three.js-Geometrie, Canvas-Texturen mit Noise, Web-Audio-Synthese,
handgeschriebene Fahrzeugphysik).

## Starten

```bash
npm install
npm run dev        # → http://localhost:5173
```

> **Hinweis:** Vite ist ein Node.js-Tool und kommt über `npm` —
> nicht über `pip` installieren.

## Features

- **Scania Citywide LF 12 m** mit DC09-Fünfzylinder-Diesel und
  ZF-EcoLife-Automatik (Drehmomentwandler, Lockup, Retarder)
- **Raycast-Fahrzeugphysik** bei 240 Hz: Federung, Pacejka-Reifen,
  Druckluftbremse mit Kompressor/Governor, Kneeling
- **3D-Cockpit**: Tacho, Tank, Kühlmittel, 2× Luftdruck, ICU-Display,
  klickbare Taster (Türen 1–3, Kneeling, Warnblinker, Licht,
  Haltestellenbremse, Wischer, D/N/R), Blinkerhebel, Feststellbremshebel,
  drei Echtzeit-Spiegel
- **Fahrscheindrucker**: Fahrgäste wünschen Tickets — Typ am Gerät wählen,
  Druck-Animation, Ticket per Klick übergeben, Münzgeld klimpert
- **Fahrgäste**: warten, winken, steigen ein, kaufen/zeigen Tickets,
  setzen sich, drücken den Haltewunsch („Wagen hält"), steigen aus
- **Prozedurale Stadt**: hügeliges Terrain, geschwungene Straßen,
  Fassaden-Stile mit nachts erleuchteten Fenstern, Parks mit Wegen und
  Teich, Ampeln, ~60 KI-Fahrzeuge (IDM-Folgemodell), Linie 73 mit
  9 Haltestellen, Minimap
- **Prozeduraler Sound**: Dieselmotor (Oszillatorbank + Halbordnungen),
  Turbo, Retarder, Druckluft, Türen, Blinkrelais, Regen, Wischer,
  Fahrgastgemurmel — alles Web Audio API
- **Tag/Nacht/Wetter**: Tageszeit-Slider, klar/bedeckt/Regen/Nebel,
  nasse Fahrbahn mit Pfützen und reduziertem Grip, Scheibentropfen,
  die die Wischer real wegwischen

## Steuerung

| Taste | Funktion |
| --- | --- |
| `W` / `S` | Gas / Bremse (erste 15 % Pedalweg = Retarder) |
| `A` / `D` | Lenken |
| Rechtsklick ziehen | Umsehen im Cockpit |
| Linksklick | Cockpit-Taster & Fahrscheindrucker bedienen |
| `1` `2` `3` | Türen |
| `K` | Kneeling |
| `R` / `F` | Blinker rechts / links |
| `H` | Warnblinker |
| `L` | Fahrlicht |
| `U` | Scheibenwischer |
| `P` | Feststellbremse |
| `M` | Wählhebel D / N / R |
| Leertaste | Haltestellenbremse |
| `F1`–`F4` | Kamera (Cockpit, Verfolger, Außen, Fahrgastraum) |
| `Esc` | Menü / Pause |

## URL-Parameter

- `?seed=42` — reproduzierbare Stadt
- `?debug=physics,lanes,perf` — Debug-Overlays

## Architektur (src/)

`core/` Spiel-Loop (240-Hz-Akkumulator), Input, Events ·
`physics/` RigidBody, Raycast-Vehicle, Pacejka, Kollision ·
`vehicle/` Motor, Getriebe, Druckluft, Türen, Busmodell ·
`cockpit/` Instrumente, Taster, Lenksäule, Fahrscheindrucker ·
`city/` Terrain, Straßennetz + Lane-Graph, Gebäude, Props, Natur, Route ·
`traffic/` IDM-Autos, Ampeln · `passengers/` Figuren, FSM, Ticketverkauf ·
`audio/` Synthese-Engine · `graphics/` Renderer, Himmel, CSM, PostFX,
Spiegel, Wetter · `ui/` Menü, HUD, Minimap

`scripts/` enthält Headless-Tests (puppeteer-core + Chrome):
`smoke.mjs`, `soak.mjs`, `boarding.mjs`, `visual.mjs`.
