# 🍿 Movie Night

A watch-party web app with synchronized HTML5 video, default Persian subtitles, room links and live chat.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Add movies

Edit `data/movies.json`. Each movie can provide:

- `videoUrl`: a video URL you are authorized to stream.
- `subtitleFaUrl`: a ready-made Persian WebVTT subtitle URL.

The player automatically enables the Persian subtitle track when one is supplied. No subtitle generation/AI is used.

## Room behavior

The first person creating a room becomes the host conceptually; playback events are synchronized through Socket.IO. This MVP keeps room state in memory, so a server restart clears rooms.

For production, add authentication, persistent room state, host permissions, rate limiting, a database, and a licensed video/subtitle catalog.

Only use video and subtitle sources you have permission to stream/distribute.