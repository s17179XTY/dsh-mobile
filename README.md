# dsh-mobile — Phone Connect for DeepSeek Harness

`dsh-mobile` is a **DeepSeek Harness (DSH) plugin** that brings the official
phone-connect experience to any DSH web profile: a LAN pairing bridge, a
mobile-optimized DSH client for your phone, and a phone entry in the
settings row of the web GUI. It is a faithful port of the
[dsh-desktop](https://github.com/dataelement/dsh-desktop) phone-connect
feature.

**This plugin is built for DeepSeek Harness, not for any specific shell
app.** It works in every deployment that runs a DSH web profile — plain
`dsh web` from the CLI, Bigfish, DSH Desktop-style desktop shells, or any
other wrapper. It contains no Bigfish- or DSH Desktop-specific code.

`dsh-mobile` 是面向 **DeepSeek Harness 本体** 的插件：任何运行 DSH web profile
的部署（命令行 `dsh web`、Bigfish、类 DSH Desktop 的桌面壳、或任何封装）都可以
安装使用，不绑定任何特定应用。

## Features

- **QR pairing with desktop approval** — your phone scans a QR code (30-minute
  rotating token, timing-safe), the desktop confirms, and the phone gets an
  HttpOnly session cookie.
- **Mobile DSH client** — workspaces, session list, chat history, send prompts,
  stop generation; served by the bridge and fully usable over the LAN.
- **Settings-row phone entry** — a phone icon sits at the right end of the
  settings row; it shows a **green connection dot** while a phone is paired,
  and opens the pairing/manage dialog (QR + copy + countdown + approve/deny +
  disconnect).
- **Safe by default** — private-network-only listener on a random port,
  loopback-only desktop endpoints, RPC allowlist (`workspace.list`,
  `session.list`, `session.history`, `session.create`, `session.prompt`,
  `session.cancel`), strict CSP headers.

## Architecture

```
Phone ──HTTP──▶ lan-bridge.mjs (LAN, random port)
                    │  QR pairing / mobile client / allowlisted RPC
                    │  (RPC forwarded to the harness /api with the
                    │   client-request envelope)
                    ▼
Harness web UI ──▶ /phone-connect/bridge  (host plugin, same-origin)
                    │  bridge snapshot: port/status/connected/desktopUrl
                    ▼
                /desktop* loopback endpoints (CORS for the GUI origin)
```

| Piece | File | Role |
| --- | --- | --- |
| Bridge | `lan-bridge.mjs` | Standalone Node HTTP server on `0.0.0.0` (random port): pairing, mobile client, RPC forwarding, `/desktop*` JSON/QR endpoints with CORS. |
| Pages | `pages.mjs` | Verbatim ports of dsh-desktop's mobile client and pairing pages (brand name parameterized). |
| Host plugin | `lib/index.js` | Spawns/monitors the bridge (auto-restart, capped), exposes `/phone-connect/bridge` + `/phone-connect/config`. |
| Client plugin | `lib/client.js` | `__ModuleLoader__` bundle: settings-row phone entry (green dot), pairing dialog, copy/countdown/approve UI. |

## Install (安装)

Requires a **DeepSeek Harness web profile** (any deployment — the profile
mechanism is core DSH, so this works on plain `dsh web`, Bigfish, desktop
shells that mount a web profile, etc.).

```bash
dsh plugin --profile web add https://github.com/s17179XTY/dsh-mobile
# or via the DSH plugin market / dshmarket UI
```

Then restart the harness (or re-boot the profile) so the `cordis.patch.yml`
row mounts. The package depends on `qrcode`, installed automatically by the
profile's package manager.

## Shell integration (壳侧整合)

"Shell" here means the app that hosts the harness around the web profile. The
plugin integrates with the shell at two levels:

### 1. Web GUI shell — built in (无需额外工作)

The plugin's browser half registers into the web profile's own slot system:
the **settings-row phone entry** (with the connected-status dot) and the
**pairing dialog** appear in any DSH web GUI automatically. A browser-only
deployment needs nothing else.

### 2. Native desktop shells — integration hook provided by the plugin

For a desktop shell with its own chrome (e.g., a DSH Desktop-style Electron
app), the shell can add a native entry — a **"Connect Phone…" menu item or
tray action** — that opens the bridge's desktop pairing page:

- The host plugin publishes the bridge snapshot at `GET /phone-connect/bridge`,
  including `desktopUrl` (`http://127.0.0.1:<port>/desktop`, loopback-only).
- That page is the full pairing/manage UI (QR, auto-refresh, approve/deny,
  disconnect) — exactly what dsh-desktop shows in its own Electron window.
- A shell can therefore discover the URL with one same-origin HTTP call and
  open it in a small window — **no configuration, no credentials**.

```
Shell (native chrome) ──GET /phone-connect/bridge──▶ desktopUrl
        │                                              │
        └──── open http://127.0.0.1:<port>/desktop ◀───┘   (loopback-only page)
```

### Can DeepSeek Harness do this? / DeepSeek Harness 能做到吗？

**Yes.** Every runtime piece the plugin needs is core DeepSeek Harness
capability available to any profile: the profile-plugin mechanism
(`cordis.patch.yml` + `dsh plugin add`), `webServer` route registration,
the `subprocess` service, the standalone LAN bridge, and the browser-side
slot system. Nothing in this plugin depends on a particular shell app.

The **one** thing a plugin cannot do from inside the harness is inject native
menu items into a desktop shell's own menu bar — that chrome belongs to the
shell's code (it is exactly how dsh-desktop ships its "Harness → Connect
Phone…" item natively). For that case the plugin provides the
`desktopUrl` hook above, and the shell wires a menu/tray item to it.

## Usage

1. Open the web GUI and find the **phone icon** at the right end of the
   **settings row** (bottom-left sidebar).
2. Click it → the pairing dialog opens with a **QR code** (valid 30 minutes;
   auto-refreshes on expiry; **Copy** button next to the URL).
3. On your phone, keep it on the **same trusted Wi-Fi**, scan the QR with the
   camera (or open the copied URL).
4. The dialog shows the pending phone — click **允许 / Allow**.
5. The phone opens the mobile DSH client. The connection stays active in the
   background; the icon shows a **green dot** while connected. Reopen the
   dialog to **disconnect** or refresh the QR.

> The pairing URL stays valid across dialog sessions for its full lifetime —
> only an expired token is rotated.

## Security

- The bridge binds `0.0.0.0` on a **random port** and rejects non-private
  clients (`10/8`, `172.16/12`, `192.168/16`, ULA/link-local IPv6).
- `/desktop*` endpoints are **loopback-only**; CORS is granted only to the
  harness GUI origin.
- Pairing token: 32 random bytes, **timing-safe** comparison, 30-minute TTL.
- Phone sessions: HttpOnly, SameSite=Strict cookie.
- The mobile client can only call the **allowlisted** RPC methods.
- **Keep it on a network you trust.** Remove the `dsh-mobile` row from
  `cordis.patch.yml` (or uninstall) when you do not need phone access.

## Troubleshooting

- **Dialog stuck on "桥已停止，正在自动重试…" (bridge stopped, retrying).**
  Refresh the page first. If it persists, verify the bridge is actually up:
  `GET /phone-connect/bridge` on the harness origin should return
  `{"status":"running", ..., "port": <n>}`; the bridge's own
  `http://127.0.0.1:<port>/desktop/snapshot` should return
  `{"running": true, ...}`. The dialog accepts both liveness fields.
- **The browser tab no longer shows the plugin.** The web shell picks a
  random port on each start, so a hand-opened tab keeps pointing at a dead
  port. Reopen the current harness URL (desktop shells reopen their own
  window automatically).
- **Pairing URL says "invalid or expired".** The token lives 30 minutes and
  is only rotated when actually expired — a copied URL stays usable for its
  full lifetime. A URL from an older rotation (or before a plugin update
  restarted the bridge) is intentionally dead; open the dialog to get a
  fresh one.
- **Bridge keeps restarting.** The host auto-restarts a crashed bridge up to
  5 times (3 s apart); the `error` field of `/phone-connect/bridge` carries
  the last exit reason and stderr tail.

## Configuration

- `--locale zh|en` and `--app-name` are passed to the bridge by the host; the
  web UI posts its locale automatically to `/phone-connect/config`.
- The harness URL is derived from `webServer.port`, so a changed GUI port
  needs no configuration.

## Development

```bash
npm install        # dev deps (qrcode etc.)
npm run check      # node --check on all sources
npm test           # end-to-end bridge test (HARNESS_URL overrides the target)
```

The bridge can also be run standalone:

```bash
node lan-bridge.mjs --harness-url http://127.0.0.1:6730 \
                    --gui-origin http://127.0.0.1:6730 \
                    --locale zh --port 0
```

## License

MIT — see [LICENSE](LICENSE). The phone/mobile pages are ports of code from
[dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop)
(MIT).
