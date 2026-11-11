# Wunschzettel 🎁

Gemeinsame Wunschlisten für Gruppen: Alle Mitglieder sehen alle Listen, können Items reservieren oder als gekauft markieren.

## Funktionen

- **Gruppen** mit Einladungscode (oder Einladungslink) – keine Registrierung nötig
- **Items** mit Titel, Link, Bild (Link oder Upload) und Notizen
- **Reservieren** und **als gekauft markieren** – mit Namen sichtbar für alle außer dem Listeneigentümer (Verdeckt-Prinzip)
- Eigene Items können jederzeit gelöscht werden

## Voraussetzungen

- Node.js **22 oder höher** (nutzt das eingebaute `node:sqlite`)

## Starten

```bash
npm install
npm start
```

Die App läuft dann unter `http://localhost:3000`.

## Konfiguration

| Variable  | Standard            | Bedeutung                        |
|-----------|---------------------|----------------------------------|
| `PORT`    | `3000`              | HTTP-Port                        |
| `DATA_DIR`| `./data`            | Ablage für SQLite-DB und Uploads |

## Hinweise

- Die SQLite-Datenbank (`data/wunschzettel.db`) enthält alle Gruppen, Mitglieder und Items – regelmäßig sichern.
- Hochgeladene Bilder liegen in `data/uploads/`.
- Der Zugriff erfolgt über den Einladungscode; ein "Login" ist nur der Code plus Anzeigename. Für öffentlich erreichbare Installationen daher einen zufälligen, nicht weitergegebenen Basis-Pfad oder einen Reverse-Proxy mit Auth vor die App schalten.
