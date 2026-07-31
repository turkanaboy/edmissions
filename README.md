# EDMissions

The rave console for higher ed: open-source EDM with an audio-reactive visualizer,
an enrollment-ranked news feed, a research chat plus subject-tagged notes, a messaging-campaign
builder with persistent campus context and optional HTML templates, and a task list — one login-gated page.

## Quick start (local "lite" run)

Requires Node 24+.

```sh
npm install
cp .env.example .env    # set EDMISSIONS_USERS and EDMISSIONS_SESSION_SECRET
npm start               # http://localhost:3000
```

That's the complete lite experience: no API keys needed. The feed polls live RSS,
notes/campaigns/tasks all work, and the player uses your local music folder
(`data/music/` — drop mp3/ogg/flac files in it).

On Windows PowerShell, set env vars instead of using `.env`:
`$env:EDMISSIONS_USERS="you:pass"; $env:EDMISSIONS_SESSION_SECRET="..."; npm start`

### Add streaming (Jamendo)

Register a free client id at [devportal.jamendo.com](https://devportal.jamendo.com)
and set `EDMISSIONS_JAMENDO_CLIENT_ID`. Each intensity mode then streams from its
genre pool (see `config/content.json` → `modes`). If Jamendo is ever unreachable,
the player falls back to the local folder automatically.

### Add AI (research chat, summaries + campaigns)

Set `EDMISSIONS_OPENAPI_KEY` (an OpenAI API key) and restart. Research chat,
summaries, and text/HTML campaign writing appear; without the key those controls stay
hidden and everything else works. AI requests use the Responses API with
`gpt-5.6-luna`, high reasoning effort, capped output, and response storage disabled.
SUNY Delhi campus knowledge is seeded from approved official pages and reused in
campaigns and research answers.

## The modes

| Mode | Music | Visuals |
|---|---|---|
| Intense Focus | techno / hard electronic | full reactive spectrum |
| Vibing | house / melodic | radial pulse |
| Chill | lofi / ambient / bluegrass | slow drifting ambient |
| Off | silence | static background |

Genre pools, feed sources, ranking keywords, note subjects, and the campaign
template all live in `config/content.json` — edit and restart, no code changes.

## Deploying (Docker, behind a reverse proxy)

```sh
cp .env.example .env    # fill in the required values
docker compose up -d --build
```

The compose file binds to `127.0.0.1:3000` and mounts `./data` (SQLite + music)
and `./config` as volumes, so redeploys keep your notes, stars, tasks, and
tweaks. `EDMISSIONS_TRUST_PROXY=1` is set for you.

Point a TLS subdomain at it. If your reverse proxy is a **container on its own
Docker network** (e.g. an existing nginx/Caddy stack from another project),
`docker-compose.yml` already joins that network via the external
`chiefofstaff_default` network — edit that name in `docker-compose.yml` if
your proxy's network is called something else (`docker network ls` to check),
then proxy to `http://edmissions:3000` (the compose service name) instead of a
`127.0.0.1:PORT` host address.

**Caddy**

```
edm.example.com {
    reverse_proxy edmissions:3000
}
```

**nginx**

```nginx
server {
    server_name edm.example.com;
    listen 443 ssl http2;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://edmissions:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Forward `X-Forwarded-For` (Caddy does it by default), which the login rate
limiter needs to see real client IPs.

## Tests

```sh
npm test
```

Node's built-in test runner; no live network calls (Jamendo, feeds, and
OpenAI are all stubbed).

## Env reference

Every variable is `EDMISSIONS_`-prefixed so nothing collides in a shared env
file — see [.env.example](.env.example) for the full annotated list.
