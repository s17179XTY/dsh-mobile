# dsh-mobile

Use **DeepSeek Harness** from your phone. `dsh-mobile` adds the official-style
**phone connect** experience to the DSH web GUI: a LAN pairing bridge, a
mobile-optimized DSH client for your phone, and a phone entry in the settings
row of the desktop UI — a faithful port of the [dsh-desktop](https://github.com/dataelement/dsh-desktop)
phone-connect feature.

手机连接 DSH 的官方体验：局域网配对桥 + 手机端 DSH 客户端 + 桌面端「连接手机」入口（dsh-desktop phone connect 的忠实移植）。

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
                    │  bridge snapshot: port/status/connected
                    ▼
                /desktop* loopback endpoints (CORS for the GUI origin)
```

| Piece | File | Role |
| --- | --- | --- |
| Bridge | `lan-bridge.mjs` | Standalone Node HTTP server on `0.0.0.0` (random port): pairing, mobile client, RPC forwarding, `/desktop*` JSON/QR endpoints with CORS. |
| Pages | `pages.mjs` | Verbatim ports of dsh-desktop's mobile client and pairing pages (brand name parameterized). |
| Host plugin | `lib/index.js` | Spawns/monitors the bridge (auto-restart, capped), exposes `/phone-connect/bridge` + `/phone-connect/config`. |
| Client plugin | `lib/client.js` | `__ModuleLoader__` bundle: settings-row phone entry (green dot), pairing dialog, copy/countdown/approve UI. |

## Install

Requires a DeepSeek Harness web profile.

```bash
dsh plugin --profile web add https://github.com/s17179XTY/dsh-mobile
# or via the DSH plugin market / dshmarket UI
```

Then restart the harness (or re-boot the profile) so the `cordis.patch.yml`
row mounts. The package depends on `qrcode`, installed automatically by the
profile's package manager.

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
