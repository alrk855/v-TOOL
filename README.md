# DPLT — Distributed Performance & Localization Testing Suite

A self-hosted, Docker-ready automation platform for running distributed synthetic browser simulations with stealth anti-bot evasions, proxy-isolated execution, and a live telemetry dashboard.

---

## What it does

DPLT lets you schedule batches of automated browser sessions that each:

- Open a real Chromium browser with a full anti-bot fingerprint (no `webdriver` flag, mocked `window.chrome`, plugins, permissions)
- Use a unique locale, timezone, viewport, and User-Agent profile per thread
- Route through a proxy (when configured) with isolation verification — it refuses to run if the proxy leaks your real IP
- Click through a configurable workflow (entry → select target → confirm) on the target page
- Record a proof screenshot and full telemetry log visible in the live dashboard

---

## Architecture

```
┌─────────────────────────┐        HTTP + Socket.IO
│   dashboard-service     │◄────────────────────────────┐
│   (Express + SQLite)    │                             │
│   localhost:3000        │                             │
└────────────┬────────────┘                             │
             │  REST API (claim task / log execution)   │
             ▼                                          │
┌─────────────────────────┐                             │
│   runner-engine-service │  ──► Playwright Chromium ──►│
│   (Playwright worker)   │      (one context per task) │
└─────────────────────────┘                             │
                                                        │
                           Browser ──► Target URL ──────┘
```

---

## Modes of Operation

### 1 · Local dev (no Docker, visible browser)

Run both services from one terminal with hot-reload:

```powershell
npm run dev
```

- No proxies configured → **auto-enables Dev Mode**: browser isolation check is skipped, browser window is **visible** so you can watch it run
- After each run the dashboard logs a **proof screenshot** — click any log entry to expand it
- Hot-reloads on file save via `tsx watch`

Individual terminals if you prefer:

```powershell
npm run dev:dashboard   # Terminal 1
npm run dev:runner      # Terminal 2
```

Open `http://localhost:3000`, or `http://localhost:<DASHBOARD_PORT>` if you changed the port.

---

### 2 · Docker (full stack, production-like)

Build and start:

```powershell
npm run docker:up          # foreground (Ctrl+C to stop)
npm run docker:up:bg       # background (detached)
npm run docker:restart     # rebuild + restart in one command
npm run docker:down        # stop and remove containers
npm run docker:logs        # tail all container logs
npm run docker:build       # build images only (no start)
```

Raw Docker Compose equivalents:

```powershell
docker compose up --build
docker compose up -d
docker compose logs -f dashboard-service
docker compose logs -f runner-engine-service
docker compose ps
```

---

### 3 · Docker with CDP Chrome (control your real Chrome window)

This mode lets the runner take over a visible Chrome window you already have open — useful for debugging what the automation is doing in real-time.

**Step 1** — Start the local services (or the Docker stack):

```powershell
npm run dev
```

**Step 2** — In the dashboard at `http://localhost:3000`, click **Launch Debug Chrome**.

This opens a fresh Chrome profile on `--remote-debugging-port=9222` using an isolated temp profile so it doesn't conflict with your existing Chrome.

**Step 3** — Set the CDP endpoint in your `.env` (or environment):

```
CHROME_CDP_ENDPOINT=http://127.0.0.1:9222
```

Then restart the runner:

```powershell
npm run dev:runner
```

The runner will now connect to and control that Chrome window instead of spawning headless Chromium. Each thread opens a new tab, runs, and closes it cleanly.

---

### 4 · Push to remote repository (GitHub, GitLab, etc.)

First time:

```powershell
npm run git:push
```

The script will ask for your repo URL (e.g. `https://github.com/you/dplt.git`), create the initial commit, and push. Subsequent runs commit and push any changes.

Or manually:

```powershell
git init
git remote add origin https://github.com/you/dplt.git
git add -A
git commit -m "chore: initial commit"
git push -u origin main
```

---

### 5 · Push Docker images to a container registry

Builds images and pushes both services to your registry (Docker Hub, GHCR, etc.):

```powershell
npm run docker:push
# Interactive — asks for registry prefix and tag
```

Or non-interactively:

```powershell
REGISTRY=ghcr.io/youruser TAG=v1.0.0 npm run docker:push
```

Pull on your server:

```powershell
docker pull ghcr.io/youruser/dplt-dashboard:v1.0.0
docker pull ghcr.io/youruser/dplt-runner-engine:v1.0.0
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

| Variable | Default | Description |
|---|---|---|
| `DASHBOARD_PORT` | `3000` | Browser-facing host port in Docker Compose. The dashboard container still listens on internal port `3000`. |
| `DATABASE_PATH` | `/app/data/telemetry.sqlite` | SQLite file path (mounted volume in Docker) |
| `TZ` | `Europe/Skopje` | Local timezone used by Docker services for active-hours scheduling |
| `RUNNER_DASHBOARD_API_BASE` | `http://dashboard-service:3000` | Advanced Docker override for runner -> dashboard traffic. Do not use the host-mapped port here. |
| `DASHBOARD_API_BASE` | `http://localhost:3000` | URL the runner uses when running the runner outside Docker |
| `RUNNER_API_TOKEN` | _(none)_ | Shared bearer token used by the runner for protected internal dashboard APIs |
| `RUNNER_CONCURRENCY` | `4` | Max simultaneous browser threads |
| `RUNNER_POLL_INTERVAL_MS` | `2500` | How often the runner checks for new tasks (ms) |
| `DIAGNOSTIC_ENDPOINT` | `https://api.ipify.org?format=json` | IP lookup endpoint for proxy isolation checks |
| `PROXY_ROUTES_JSON` | _(none)_ | JSON array of proxy routes — see format below |
| `DEV_MODE` | _(auto)_ | `true` = skip proxy check + visible browser. Auto-true if no proxies set |
| `HEADLESS` | _(auto)_ | Set `false` to force a visible browser even in proxy mode |
| `CHROME_CDP_ENDPOINT` | _(none)_ | e.g. `http://127.0.0.1:9222` — connect to a running Chrome instead of launching one |
| `SCREENSHOTS_ENABLED` | `false` in Docker Compose, `true` otherwise | `false` disables proof screenshot capture in execution logs |
| `SURVEY_OPTION_SELECTOR` | _(none)_ | CSS selector for step 2 target element |
| `CONFIRMATION_SELECTOR` | _(none)_ | CSS selector for the final submit button |
| `CONFIRMATION_TEXTS` | `Vote,Submit,Гласај` | Fallback text labels for the commit button |

---

## Proxy Routes Format

```json
[
  {
    "id": "us-east-01",
    "server": "http://proxy.host:8080",
    "username": "user",
    "password": "secret",
    "maxUsages": 50
  }
]
```

Pass this JSON as `PROXY_ROUTES_JSON` env var, or add proxy routes directly in the **Proxy Pool** tab of the dashboard form.

When proxies are configured:
- Each task thread is assigned a proxy route from the pool
- The runner verifies the proxied IP differs from the host IP before visiting the target — if they match, the thread is marked `failed` and the target URL is never contacted.
- Proxy usage is tracked in the dashboard sidebar.

> **Testing without proxies:** Leave `PROXY_ROUTES_JSON` empty. The runner automatically enters Dev Mode — it uses your direct connection and a visible browser window so you can watch each run.

---

## What Was Built / Changed (Session Summary)

### Anti-Bot Stealth Evasions
- Removed `--enable-automation` Chrome flag (`ignoreDefaultArgs`)
- Added `--disable-blink-features=AutomationControlled` — natively removes `navigator.webdriver`
- Injected `window.chrome` object (app, runtime, loadTimes, csi) to pass Chrome detection
- Mocked `navigator.plugins` and `navigator.mimeTypes` (PDF Viewer spoof)
- Patched `navigator.permissions.query` to return consistent results
- Existing: canvas noise, WebGL vendor/renderer spoofing, screen dimension alignment, hardware concurrency and device memory mocking

### CDP Chrome Overtake Fix
- Chrome launch (`/api/chrome/launch`) now uses `--user-data-dir` pointing to an OS temp profile so it always starts its own CDP server on port 9222, even if Chrome is already open
- Runner threads now each open their own tab (`context.newPage()`) and close it in `finally` — previously all threads shared `context.pages()[0]` causing concurrent navigations to abort each other

### Auto Dev Mode
- No proxies configured → runner auto-enables Dev Mode: browser isolation check skipped, browser is visible by default
- `DEV_MODE=false` forces proxy enforcement even without proxy routes

### Proof Screenshots
- When `SCREENSHOTS_ENABLED=true`, each successful run captures a JPEG screenshot and stores it (base64) in the execution log metadata
- Docker Compose defaults `SCREENSHOTS_ENABLED=false` to keep logs smaller and avoid storing screenshots
- When enabled, screenshots are visible in the dashboard: expand any log row → **Proof Screenshot** appears at the top

### Rich Execution Logs
- Logs persist across page refreshes (snapshot includes last 200 logs on connect)
- Each log row is expandable — shows: HTTP status, duration, final URL, page title, IP isolation result, locale/timezone verification, WebGL graphics audit, per-step workflow results, and proof screenshot
- Filter buttons: All / Success / Failed

### Workflow Engine
- 4-stage configurable workflow: Entry → Target Selection → (optional) Selection State Check → Commit
- Each stage configurable via CSS selector or text label
- Stages skip gracefully when not configured — won't fail the run

---

## Dashboard Quick Start

1. Open `http://localhost:3000`, or `http://localhost:<DASHBOARD_PORT>` if you changed the Docker host port
2. Fill in **Target URL** and **Total executions**
3. (Optional) Add proxy routes in the **Proxy Pool** tab
4. (Optional) Configure CSS selectors in the **Workflow Selectors** tab
5. Click **Queue Simulation**
6. Watch the **Task Distribution** table and **Execution Logs** update in real time
7. Click any log row to inspect the full telemetry including the proof screenshot
