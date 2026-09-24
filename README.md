# 🍿 Movie Night v4

Search uses OMDb for movie metadata and Internet Archive for allowed public-source playback. OpenRouter is optional AI enrichment only and never uses paid web search.

## Railway variables
- `OMDB_API_KEY` = OMDb API key (recommended for movie-name search)
- `OPENROUTER_API_KEY` = optional AI enrichment
- `OPENROUTER_MODEL` = `openrouter/free`
- `APP_URL` = optional public URL

Playback is only enabled for Internet Archive items whose metadata indicates a suitable public-domain/Creative-Commons/no-known-copyright status and that have a direct video file. Commercial movie metadata can be shown without a playable source.

Rooms use Socket.IO. Room state is in memory.

## Local run
```bash
npm install
npm start
``
