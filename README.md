# 🍿 Movie Night v3

Movie Night is a watch-party app with synchronized playback, live chat, public-source movie discovery, and optional free AI enrichment.

## What changed

The movie search no longer uses OpenRouter's paid web-search tool.

Search flow:
1. **TMDB** searches movie metadata when `TMDB_API_KEY` is configured.
2. **Internet Archive** is searched directly for public-domain/Creative-Commons style movie items.
3. The server only enables playback for an Internet Archive item when its metadata indicates a suitable public-domain/Creative Commons/no-known-copyright status and a direct video file exists.
4. **OpenRouter `openrouter/free` is optional**. If configured, it only analyzes the results already collected by the server. It does **not** browse the web.
5. Persian subtitles/dubs are never invented or generated.

TMDB documents its movie search endpoint and API authentication in its official developer docs. The API is available for non-commercial use subject to TMDB's terms and attribution requirements.

## Railway variables

### Recommended
- `TMDB_API_KEY` = your TMDB API key

### Optional
- `OPENROUTER_API_KEY` = OpenRouter key for free AI enrichment
- `OPENROUTER_MODEL` = `openrouter/free`
- `APP_URL` = public Movie Night URL

**Important:** OpenRouter web search is intentionally not used. OpenRouter's web-search tool is a separately priced service, while `openrouter/free` is for free model inference.

## Playback

A normal streaming-service webpage is not automatically a playable HTML5 video URL. Movie Night only puts a direct video file into the player when the server has verified an allowed public-source item.

For copyrighted commercial movies, this means the search can show metadata but may correctly say **"منبع مستقیم قابل پخش پیدا نشد"**.

## Rooms

Rooms use Socket.IO for synchronized host playback and live chat. Room state is in memory, so a Railway restart clears active rooms.

## Local run

```bash
npm install
npm start
```
