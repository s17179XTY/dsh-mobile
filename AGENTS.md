# AGENTS.md

Guidance for AI agents (and humans) working on this repository.

## What this is

`dsh-mobile` is a DeepSeek Harness (DSH) web-profile plugin that ports
dsh-desktop's phone-connect feature: a standalone LAN bridge process plus a
host plugin that manages it and a browser-side UI in the settings row.

Three runtimes coexist here — keep them straight:

1. **`lan-bridge.mjs`** — a standalone Node process. Full Node.js. Serves the
   phone (pairing + mobile client + allowlisted RPC) and the desktop UI
   (`/desktop*`, loopback-only). Runs in the package directory so `import
   "qrcode"` resolves from the package's `node_modules`.
2. **`lib/index.js`** — the host Cordis plugin (ESM, exports `name`, `inject`,
   `apply`). Runs inside the harness with full Node access. Spawns the bridge
   via the `subprocess` service, parses its stdout event stream, and exposes
   `/phone-connect/bridge` + `/phone-connect/config` on the harness
   `webServer`.
3. **`lib/client.js`** — the browser half, a hand-written
   `window.__ModuleLoader__.load({ id, factory })` bundle (NO build step).
   Uses `require("react")`, plain `React.createElement` (no JSX), the client
   `slots`/`timer`/`locale` services, and `fetch`. There is **no
   client→host RPC**: the client discovers the bridge port via the same-origin
   `/phone-connect/bridge` route and then talks to the bridge's `/desktop*`
   endpoints (CORS-enabled for the GUI origin).

## Security invariants (do not weaken)

- The bridge rejects non-private remote addresses (`isPrivateAddress`).
- `/desktop*` endpoints require a loopback client; CORS only ever echoes the
  exact `--gui-origin` value (never `*`).
- Pairing token: `randomBytes(32)` base64url, timing-safe comparison, TTL
  `PAIRING_TTL_MS` (30 minutes). Rotating the token invalidates old URLs —
  that is intentional; the UI rotates only when the token is actually
  expired.
- Phone sessions use an HttpOnly, SameSite=Strict `dsh_mobile` cookie.
- `/api/rpc` is allowlisted (`RPC_ALLOWLIST`) and same-origin verified.
- Security headers on every response: `no-store`, `nosniff`, DENY framing,
  strict CSP.

## Conventions

- Plain JavaScript everywhere. No TypeScript, no JSX, no imports in
  `lib/client.js` (it is a hand-written module-loader bundle).
- `pages.mjs` is generated from the dsh-desktop bundle
  (`build-pages.mjs` in the original workspace); keep the templates verbatim
  and only parameterize brand strings through `appName`.
- Changes to the pairing/token flow must keep the 30-minute lifetime and the
  "rotate only when expired" UX (copied URLs must stay usable).
- All UI additions must be additive: `settings.trigger` is a *single* slot —
  the phone entry replaces the shipped trigger content, so it must replicate
  the gear + label and preserve the row's click-to-open-settings behavior
  (`stopPropagation` on the phone control only).
- `settings.trigger` MUST be registered with an explicit `priority: -1`.
  Static plugins do not receive the automatic shadowing priority that
  dynamic plugin runs get, so registering at the default priority 0 collides
  with the shipped settings shell (`single slot "settings.trigger" already
  has a registration at priority 0 ... register at a different priority to
  shadow it`). Lowest priority renders; removal of the plugin restores the
  shipped trigger untouched.
- Snapshot field contract: the **bridge's** `/desktop/snapshot` reports
  liveness as `running: true`; the **host's** `/phone-connect/bridge` route
  reports `status: "running"`. The client must accept BOTH
  (`snap.status === "running" || snap.running === true`) — mixing them up
  makes the dialog permanently show the "bridge stopped" state.

## Testing

```bash
npm run check            # node --check on all sources
npm test                 # end-to-end bridge test
HARNESS_URL=http://127.0.0.1:6730 npm test   # point at a live harness
```

`scripts/test-bridge.mjs` spawns the real bridge and covers: CORS contract
(GUI origin allowed, foreign origin denied, OPTIONS preflight), the full
pairing flow (pair → pending → decide → approved + cookie), the mobile page,
RPC allowlist enforcement, disconnect, rotate, and the 30-minute TTL. Add a
check there for any behavior you change.

Manual smoke: run `lan-bridge.mjs` standalone (see README), open
`http://127.0.0.1:<port>/desktop` from the host for the pairing page, and
`http://<lan-ip>:<port>/` after approving a pairing for the mobile client.

## Package shape

- `package.json` — `dsh.bundle.patch` → `cordis.patch.yml`; `dsh.client` →
  `{ platform: "web", inject: [] }`; the client entry is the `"./client"`
  export (`lib/client.js`); runtime dependency: `qrcode`.
- `cordis.patch.yml` — inserts the `dsh-mobile` loader row. Removing the row
  (or uninstalling the package) disables phone access entirely.
- `LICENSE` — MIT, matching the repository.
