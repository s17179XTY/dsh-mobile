/**
 * dsh-mobile — server half.
 *
 * Starts the phone-connect LAN bridge (lan-bridge.mjs) as a managed child
 * process and exposes one same-origin route for the web UI:
 *
 *   GET  /phone-connect/bridge            — bridge snapshot {status, port,
 *                                           lanAddress, pairingUrl, expiresAt,
 *                                           connected, locale, appName}
 *   GET  /phone-connect/config?locale=..  — set locale/appName for the phone
 *                                           pages (restarts the bridge when
 *                                           changed)
 *
 * The web UI discovers the bridge port through /phone-connect/bridge and then
 * talks to the bridge's loopback /desktop* endpoints directly (CORS is
 * enabled for the GUI origin by the bridge). The phone side never touches the
 * harness: it pairs with a QR token, is approved from the desktop, and then
 * uses an allowlisted RPC subset forwarded by the bridge.
 *
 * Security: the bridge only accepts private-network clients; /desktop* is
 * loopback-only; pairing uses a timing-safe 30-minute token; phone sessions
 * use an HttpOnly SameSite=Strict cookie.
 *
 * @module dsh-mobile
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE_PATH = join(PACKAGE_ROOT, "lan-bridge.mjs");

/** Stable Cordis plugin name. */
const name = "dsh-mobile";
/** Services this row needs before apply runs. */
const inject = ["subprocess", "timer", "webServer"];

function loopbackPort(ctx) {
  return ctx.webServer && typeof ctx.webServer.port === "number" ? ctx.webServer.port : 0;
}

function harnessUrl(ctx) {
  return `http://127.0.0.1:${loopbackPort(ctx) || 6730}`;
}

function guiOrigin(ctx) {
  const port = loopbackPort(ctx);
  return port ? `http://127.0.0.1:${port}` : "";
}

/**
 * Start the bridge process and keep its state in sync.
 * @param ctx - host context (webServer/subprocess/timer injected).
 */
function apply(ctx) {
  const state = {
    status: "stopped", // stopped | starting | running | error
    error: null,
    port: null,
    lanAddress: null,
    pairingUrl: null,
    expiresAt: null,
    connected: false,
    locale: "en",
    appName: "DSH",
    handle: null,
    readOffset: 0,
    retries: 0,
  };

  const json = (res, status, body) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  };

  /** Read the bridge's stdout event stream (READY/connected/disconnected). */
  const pump = () => {
    const handle = state.handle;
    if (!handle || !handle.collected || !handle.collected.stdout) return;
    let read;
    try {
      read = handle.collected.stdout.readFrom(state.readOffset);
    } catch {
      return;
    }
    state.readOffset = read.nextOffset;
    for (const raw of read.text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!message || typeof message !== "object") continue;
      if (message.event === "ready") {
        state.port = message.port;
        state.lanAddress = message.lanAddress;
        state.pairingUrl = message.pairingUrl;
        state.expiresAt = message.expiresAt;
        state.status = "running";
        state.retries = 0;
        continue;
      }
      if (message.event === "connected") {
        state.connected = true;
        continue;
      }
      if (message.event === "disconnected") {
        state.connected = false;
        continue;
      }
    }
  };

  const snapshot = () => ({
    status: state.status,
    error: state.error,
    port: state.port,
    lanAddress: state.lanAddress,
    pairingUrl: state.pairingUrl,
    expiresAt: state.expiresAt,
    connected: state.connected,
    locale: state.locale,
    appName: state.appName,
  });

  const startBridge = async () => {
    if (state.status === "running" || state.status === "starting") return;
    state.status = "starting";
    state.error = null;
    try {
      const nodePath = await ctx.subprocess.resolveExecutable("node");
      const handle = ctx.subprocess.spawn({
        argv: [
          nodePath,
          BRIDGE_PATH,
          "--harness-url", harnessUrl(ctx),
          "--gui-origin", guiOrigin(ctx),
          "--locale", state.locale,
          "--port", "0",
          "--app-name", state.appName,
        ],
        cwd: PACKAGE_ROOT,
        env: {},
        stdio: {
          stdin: "ignore",
          stdout: { maxBytes: 1048576 },
          stderr: { maxBytes: 65536 },
        },
        graceMs: 2000,
      });
      state.handle = handle;
      state.readOffset = 0;
      handle.done.then((outcome) => {
        if (state.handle !== handle) return;
        state.handle = null;
        state.status = "error";
        state.connected = false;
        let tail = "";
        try {
          const stderr = handle.collected.stderr;
          if (stderr) tail = stderr.finalize().text.trim().slice(-1500);
        } catch {}
        state.error = `bridge exited (code ${outcome.exitCode}${outcome.signal ? `, signal ${outcome.signal}` : ""})` + (tail ? ` — ${tail.split("\n").pop()}` : "");
        // Auto-restart (capped) so a transient crash does not kill phone access.
        state.retries += 1;
        if (state.retries <= 5) {
          ctx.timeout(() => {
            if (state.status === "error" && !state.handle) void startBridge();
          }, 3000);
        }
      }).catch((error) => {
        if (state.handle !== handle) return;
        state.handle = null;
        state.status = "error";
        state.error = String(error instanceof Error ? error.message : error);
      });
    } catch (error) {
      state.status = "error";
      state.error = String(error instanceof Error ? error.message : error);
    }
  };

  const stopBridge = async () => {
    const handle = state.handle;
    state.handle = null;
    if (handle) {
      try {
        handle.terminate();
      } catch {}
    }
    state.status = "stopped";
    state.port = null;
    state.lanAddress = null;
    state.pairingUrl = null;
    state.expiresAt = null;
    state.connected = false;
  };

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/phone-connect/bridge",
    handler: (req, res) => {
      pump();
      json(res, 200, snapshot());
    },
  }), "dsh-mobile: bridge status route");

  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/phone-connect/config",
    handler: (req, res) => {
      let input = {};
      if (req.url) {
        const query = req.url.split("?")[1] ?? "";
        for (const pair of query.split("&")) {
          if (!pair) continue;
          const [key, value] = pair.split("=");
          input[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
        }
      }
      const locale = typeof input.locale === "string" && input.locale.startsWith("zh") ? "zh" : "en";
      const appName = typeof input.appName === "string" && input.appName.trim() ? input.appName.trim() : "DSH";
      const changed = locale !== state.locale || appName !== state.appName;
      state.locale = locale;
      state.appName = appName;
      if (changed && (state.status === "running" || state.status === "starting")) {
        void stopBridge().then(() => startBridge());
      } else if (state.status === "stopped" || state.status === "error") {
        void startBridge();
      }
      pump();
      json(res, 200, snapshot());
    },
  }), "dsh-mobile: config route");

  ctx.interval(() => pump(), 500);
  ctx.effect(() => () => {
    void stopBridge();
  }, "dsh-mobile: bridge lifecycle");
  void startBridge();
}

export { apply, inject, name };
