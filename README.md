# Hardstyle Tunez

A private Discord music bot with YouTube search, queues, pause/resume, skip/stop, and shared volume control. Each Discord server gets an isolated player, queue, connection, and saved volume.

The bot joins voice as a normal participant. Every listener can independently right-click **Hardstyle Tunez** in Discord and adjust its local user volume; `/volume` changes the shared stream volume for everyone.

## Important YouTube warning

This project uses Lavalink's unofficial `youtube-source` plugin. YouTube does not provide an official API for rebroadcasting audio into Discord, and its terms/API policies prohibit relevant extraction, audio separation, and background-playback patterns. Playback may break when YouTube changes its clients, and a VPS IP may encounter bot checks or blocking.

This implementation is intentionally isolated behind Lavalink, accepts only exact trusted YouTube hostnames, and should remain private. Private use reduces scale, not policy risk. Never connect your primary Google account to an extractor. If you cannot accept this boundary, use a licensed bot or Discord's official Watch Together Activity instead.

- [YouTube terms](https://www.youtube.com/static?template=terms)
- [YouTube API policies](https://developers.google.com/youtube/terms/developer-policies)
- [Lavalink YouTube source and operational warnings](https://github.com/lavalink-devs/youtube-source)

## Commands

| Command           | Behavior                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `/play <query>`   | Plays the top YouTube Music search result or queues a YouTube video, playlist, or livestream URL. |
| `/pause`          | Pauses playback.                                                                                  |
| `/resume`         | Resumes playback.                                                                                 |
| `/queue`          | Shows ten queued tracks per page with owner-bound buttons.                                        |
| `/volume <0-100>` | Changes and saves the server's shared volume.                                                     |
| `/skip`           | Skips the current track.                                                                          |
| `/stop`           | Stops playback and clears the queue.                                                              |
| `/now-playing`    | Shows the current track.                                                                          |

Playback controls require the user to be in the bot's current voice channel. `/queue` and `/now-playing` are read-only and work from any text channel in the server. All listeners have equal playback control.

The queue is FIFO, holds at most 500 tracks, preserves duplicates, and imports at most 100 tracks from one playlist. A failed track is retried once, announced, and skipped. The bot disconnects ten minutes after the queue empties or the last human leaves. Queues are intentionally ephemeral; only each server's 0–100 shared volume survives restarts.

## Discord application setup

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. On **Bot**, create/reset the token and keep **Public Bot** disabled. No privileged intents are required.
3. Copy the application ID from **General Information** and the token from **Bot**.
4. Create the local environment file:

   ```bash
   cp .env.example .env
   openssl rand -base64 32
   ```

5. Put the application ID, bot token, and generated Lavalink password in `.env`. During development, set `DISCORD_GUILD_ID` to your test server ID for immediate command updates. Leave it empty for global production commands.
6. Install the bot with this URL after replacing `YOUR_CLIENT_ID`:

   ```text
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=3165184
   ```

The requested permission set is deliberately small: View Channel, Send Messages, Embed Links, Connect, and Speak. Channel overrides can still deny one of these permissions.

## Deploy on a VPS

Requirements: Docker Engine with the Compose plugin, an outbound internet connection, and roughly 1 GB of available memory. No inbound port is published.

```bash
docker compose build
docker compose run --rm bot npm run register
docker compose up -d
docker compose ps
docker compose logs -f --tail=100
```

Guild-scoped commands update immediately. Global command registration may take time to appear throughout Discord. Re-run the registration command whenever command definitions change.

The Compose stack contains:

- `bot`: Node 24, Discord.js, and Shoukaku. Its health endpoint stays healthy when Discord is connected even if playback is degraded.
- `lavalink`: pinned Lavalink 4.2.2 with `youtube-source` 1.18.2.
- `bot-data`: the named volume containing only `settings.json`.

Both containers restart unless stopped and rotate JSON logs at three 10 MB files. Inspect playback outages with:

```bash
docker compose logs --tail=200 lavalink
docker compose restart lavalink
```

YouTube extraction requires maintenance. Review upstream releases before changing the pinned Lavalink or plugin versions, then rebuild and test search, a direct video, a playlist, and a livestream. Do not blindly enable OAuth or proof-of-origin workarounds; upstream explicitly warns they are not reliable and may put accounts at risk.

To update the app after pulling reviewed changes:

```bash
docker compose build --pull
docker compose up -d
docker image prune
```

The final prune command removes unused image layers, not bot data. The `bot-data` volume remains intact.

## Local development

Node.js 24.17 or newer is required.

```bash
npm ci
docker compose up -d lavalink
npm run build
npm run register:dev
npm run dev
```

Quality checks:

```bash
npm run check
npm run format:check
npm test
npm run build
docker compose config --quiet
```

Do not commit `.env`, `data/`, tokens, passwords, OAuth credentials, or generated proof-of-origin tokens.

## Architecture notes

- Slash interactions are the only command surface; message-content intent is not requested.
- `MusicManager` owns one `GuildPlayer` per server and serializes player creation/enqueue mutations per guild.
- Playlist resolution completes before its tracks are appended as one FIFO batch.
- Search and exact URL parsing live in the YouTube source adapter so the provider can be disabled or replaced.
- URL input must use HTTPS and an exact `youtube.com`, `music.youtube.com`, or `youtu.be` hostname. Lookalike and credential-bearing URLs are rejected before Lavalink sees them.
- Settings use an atomic temporary-file rename in `/data`; no database or queue restoration is involved.
- Logs include command names, guild IDs, error categories, and timings, but intentionally omit usernames and raw searches/URLs.

## License

Hardstyle Tunez is available under the [MIT License](LICENSE).
