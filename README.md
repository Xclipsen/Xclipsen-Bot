# Hypixel Mayor Discord Bot

Ein einfacher Discord-Bot, der die Hypixel SkyBlock Election API prueft, bei Elections und Mayor-Wechseln pingt und regelmaessige Statusupdates mit den aktuellen Perks postet.

## Was der Bot macht

- Fragt `https://api.hypixel.net/v2/resources/skyblock/election` in einem festen Intervall ab.
- Prueft den aktuell aktiven SkyBlock Mayor.
- Pingt die Rolle, wenn die Election Booth offen ist.
- Pingt die Rolle, sobald ein neuer Mayor aktiv wird.
- Sendet regelmaessig ein Update mit aktuellem Mayor und dessen Perks.

## Vorbereitung

1. Erstelle im [Discord Developer Portal](https://discord.com/developers/applications) einen Bot.
2. Aktiviere fuer den Bot mindestens die Berechtigung, Nachrichten im Zielkanal zu senden.
3. Lade den Bot auf deinen Server ein.
4. Kopiere `.env.example` nach `.env`.
5. Trage deine Werte ein.

## Konfiguration

- `DISCORD_TOKEN` - Bot-Token aus dem Discord Developer Portal
- `DISCORD_CHANNEL_ID` - Kanal, in den gepostet werden soll
- `DISCORD_ROLE_ID` - Rolle, die bei Election und Mayor-Wechsel gepingt wird
- `CHECK_INTERVAL_MINUTES` - Intervall fuer Election- und Mayor-Pruefungen
- `STATUS_UPDATE_MINUTES` - Intervall fuer Statusupdates mit den aktuellen Perks
- `EMOJI_*` - optionale Custom-Emojis fuer einzelne Mayors, z. B. `<:diaz:123...>`
- Wenn dein Server Emojis mit Namen wie `diaz`, `cole` oder `mayor_diaz` hat, erkennt der Bot sie jetzt automatisch.

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_ROLE_ID=123456789012345678
CHECK_INTERVAL_MINUTES=5
STATUS_UPDATE_MINUTES=30
EMOJI_DIAZ=<:diaz:123456789012345678>
```

## Starten

```bash
npm install
npm start
```

## Hinweise

- Fuer diesen Election-Endpunkt ist aktuell kein Hypixel API-Key noetig.
- Wenn du spaeter andere Hypixel-Endpunkte nutzen willst, kannst du leicht einen API-Key erweitern.
- Der Bot braucht nur den `Guilds` Intent, weil er keine Nachrichten lesen muss.
- Fuer Custom-Emojis musst du die Emojis zuerst auf deinem Discord-Server hochladen und dann den kompletten Emoji-Tag in `.env` eintragen.
- Alternativ reicht es jetzt auch, die Emojis auf dem Server passend zu benennen, z. B. `diaz`, `cole`, `foxy` oder `mayor_diaz`.
