# News Daily: a daily newspaper template for n8n

A static, newspaper-style daily site. **n8n** commits one JSON file per day, and **Cloudflare Pages** (Git integration) builds and deploys it. Fork it, edit `site.config.json`, and you have your own paper.

**Live demo:** https://daily-paper-template.pages.dev (built with `DEMO_VOTES=1`, so 👍 / 👎 send nothing).

- No framework, no dependencies. One Node 20 build script, plain HTML and CSS, a few lines of JS for dark mode.
- No external trackers. Fonts (Noto Serif / Noto Sans) load from Google Fonts with system-font fallbacks.
- Mobile-first, dark mode (follows the system, manual toggle), basic SEO and Open Graph tags.

> `data/issues/` holds three **fictional sample issues** (marked "[Sample]") and one real example issue (2026-11-13) produced by the n8n workflow, with its vote links removed. They power the live demo. Delete them before going live.

## Architecture

```mermaid
flowchart LR
  N8N["n8n<br/>RSS → scoring → LLM rewrite"] -- "PUT Contents API<br/>data/issues/YYYY-MM-DD.json" --> GH[GitHub repo]
  GH -- "push to main (Git integration)" --> CF["Cloudflare Pages<br/>npm run build (validate + build) → dist/"]
  N8N -. "poll the Cloudflare<br/>check run on the commit" .-> GH
  N8N -- "once live, send the URL" --> TG[Telegram]
```

| Part | Responsibility |
| --- | --- |
| n8n (not in this repo) | Fetch RSS, score importance, rewrite with an LLM, commit the JSON, check the deploy via the GitHub check run, notify Telegram |
| This repo | Validate, render, archive, expose a public `/latest.json` endpoint. Deployment is handled by Cloudflare's Git integration |

## Layout

```
site.config.json          paper name, tagline, URL, timezone, sections (order / name / color), per-section limit, primary color, footer
data/issues/*.json        one file per day; the file name is the issue date
schema/issue.schema.json  data format
scripts/validate.mjs      runs before every build (bad data → exit 1 → the Cloudflare build fails, the live site stays on the previous version)
scripts/build.mjs         the single build script, zero dependencies, writes dist/
src/style.css, theme.js   styles and the dark-mode toggle
```

Output: `/` (latest issue), `/YYYY-MM-DD/`, `/archive/`, `/feed.xml`, `/latest.json`, `/404.html`, `sitemap.xml`, `robots.txt`.
Every page has `<meta name="issue-date">`: issue pages carry their own date, other pages carry the latest issue's date.

## Local use

Node 20+. There are no dependencies, so no `npm install` is needed.

```bash
npm run validate   # validate site.config.json and data/issues/*.json
npm run build      # validate, then write dist/
npm run dev        # build, then serve dist/ at http://localhost:3000 with npx serve
```

> Links are root-relative (`/archive/`), so preview with `npm run dev` rather than opening `dist/index.html` directly.

## Setup

1. **Fork** this repo.
2. **Create a Cloudflare Pages project**: Workers & Pages → Create → Pages → **Connect to Git**, and pick your fork. Settings:
   - Production branch: `main`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable (recommended): `NODE_VERSION` = `20`
3. **Custom domain** (optional): project → Custom domains.
4. No GitHub Secrets, Variables or Cloudflare API token are needed.
5. **Create a fine-grained PAT for n8n**: Settings → Developer settings → Fine-grained tokens. Limit repository access to this repo and grant `Contents: Read and write` and `Checks: Read` (the latter is used to confirm the deploy).
6. **Edit `site.config.json`**: name, tagline, `url` (your `*.pages.dev` or custom domain), sections, primary color, footer.
7. Delete the sample issues (keep a `.gitkeep` in `data/issues/`) and push to `main`. With no issues the site shows a "Coming soon" page.

> Every push to `main` triggers a Cloudflare build. If `validate` fails, that deploy fails and the previous version stays live; the error shows up under Deployments in Cloudflare.

## Committing from n8n

`PUT /repos/{owner}/{repo}/contents/data/issues/{date}.json` with a base64 `content`. **When you re-run the same day you must send the existing file's `sha`**, otherwise GitHub answers 422.

```bash
OWNER=you REPO=daily-paper-template DATE=2026-11-10
API=https://api.github.com/repos/$OWNER/$REPO/contents/data/issues/$DATE.json

# 1) get the sha of the existing file (empty if it does not exist)
SHA=$(curl -s -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" "$API" | jq -r '.sha // empty')

# 2) create or update
curl -X PUT "$API" \
  -H "Authorization: Bearer $GH_PAT" -H "Accept: application/vnd.github+json" \
  -d "$(jq -n --arg m "issue $DATE" --arg c "$(base64 -w0 issue.json)" --arg s "$SHA" \
        '{message:$m, content:$c, branch:"main"} + (if $s != "" then {sha:$s} else {} end)')"
```

In n8n, use an HTTP Request node: GET first (treat 404 as "no file yet", e.g. with `Never Error`), then PUT.

## Confirming the deploy

A Cloudflare build usually finishes within a few minutes after the push, but it may sit in a queue for longer. Don't poll the site; use the **check run** that Cloudflare's Git integration posts on each commit. The same fine-grained PAT can read it (it needs `Checks: Read` in addition to `Contents: Read and write`).

1. After the `PUT` to `/contents`, take `commit.sha` from the response.
2. Wait about 45 seconds, then `GET https://api.github.com/repos/OWNER/REPO/commits/SHA/check-runs` with the same token.
3. Find the Cloudflare check run (its `name` or `app.slug` contains "cloudflare"; look at your repo's checks once to confirm the exact name). If it isn't there yet, treat it as still pending.
4. Every 30 seconds, check its `status`. When it is `completed`, look at `conclusion`:
   - `success` → the site is live.
   - anything else (`failure`, `cancelled`, `timed_out`, …) → the build failed. `details_url` links to the Cloudflare build log.
5. Give up after `deployTimeoutMinutes` (default `20`) and treat it as a timeout.
6. **Success:** send the issue URL to Telegram. **Failure or timeout:** send the reason and the build link (`details_url`).

```
GET https://api.github.com/repos/OWNER/REPO/commits/{{ commit.sha }}/check-runs
Authorization: Bearer <PAT>
Accept: application/vnd.github+json

→ { "check_runs": [ { "name": "Cloudflare Pages", "status": "completed",
                      "conclusion": "success", "details_url": "https://dash.cloudflare.com/…" } ] }

loop:    wait 45 s, then every 30 s
done:    status == "completed"   (success only if conclusion == "success")
timeout: deployTimeoutMinutes (default 20)
```

`/latest.json` is still published as a public endpoint for other uses (dashboards, monitors, other tools). It is not the deploy check: `{"date":"2026-11-10","edition":123,"url":"https://…/2026-11-10/"}`, or `{"date":null,"edition":0,...}` when there are no issues yet. The site sends `Cache-Control: no-store` for it.

## Data format

See `schema/issue.schema.json`. Required top-level fields: `date`, `generated_at`, `edition`, `headline`, `brief`, `sections`, `stats`. Each item requires `title`, `summary`, `why`, `importance` (1–5), `source_name` and `source_url`. Optional: `original_title`, `original_lang` (`en` | `zh`), `published_at`, `tags`, `image` (https URL), `image_alt`, `feedback` (`{ "up": URL, "down": URL }`). Optional top level: `notices` (array of strings, shown as "Source health").

```json
{
  "date": "2026-11-10",
  "generated_at": "2026-11-10T07:00:00+08:00",
  "edition": 123,
  "headline": { "title": "…", "summary": "…", "why": "…", "importance": 5,
                "source_name": "…", "source_url": "https://…" },
  "brief": "Three sentences. One. Two. Three.",
  "sections": [ { "id": "ai", "items": [ { "...": "same fields as headline" } ] } ],
  "stats": { "feeds": 39, "fetched": 812, "kept": 36, "jev_cost_usd": 0.0012, "llm_cost_usd": 0.03 }
}
```

Section `id`s should match `site.config.json`; an unknown id is appended at the end in the primary color (validation prints a warning). Items are sorted by `importance` (5 = large type) and capped at `max_items_per_section`. The `brief` is shown as a numbered list when it has 2–5 sentences.

## Reader votes (👍 / 👎)

When an item has `feedback.up` / `feedback.down`, each story gets 👍 / 👎 links. Each click is one GET to your n8n vote webhook (the workflow fills these links when its `feedbackWebhookUrl` setting is set), and the workflow uses the votes to re-weight sources and sections. Items without `feedback` show no buttons.

For a public preview with no webhook, build with `DEMO_VOTES=1` (Cloudflare Pages: Settings → Variables) or set `"demo_votes": true` in `site.config.json`. Items without `feedback` then show inert 👍 / 👎 buttons that send nothing and only explain what they would do.

## License

MIT
