#!/usr/bin/env node
/**
 * dsh-mobile phone-connect bridge (standalone Node process).
 *
 * A faithful port of dsh-desktop's `LanMobileBridge` (Electron main process
 * implementation) into a self-contained process, plus:
 *   - /desktop/* JSON endpoints with CORS for the GUI origin
 *     (--gui-origin), so the harness web UI can drive pairing natively;
 *   - /desktop/qr  (QR SVG for embedding);
 *   - /desktop/rotate (refresh the pairing token without dropping the phone);
 *   - a stdout READY line:  PHONE_BRIDGE_READY {"port":N,"lanAddress":"x"}
 *     consumed by the host plugin half.
 *
 * Usage:
 *   node lan-bridge.mjs --harness-url http://127.0.0.1:6730 \
 *                       --gui-origin http://127.0.0.1:6730 \
 *                       --locale zh --port 0 --app-name DSH
 *
 * Security model (identical to dsh-desktop):
 *   - server only accepts private-network clients;
 *   - /desktop* endpoints are loopback-only (the GUI runs on loopback);
 *   - pairing uses a timing-safe 30-minute token; phone sessions use an
 *     HttpOnly SameSite=Strict cookie;
 *   - /api/rpc is allowlisted and verifies same-origin;
 *   - response headers: no-store, nosniff, DENY framing, strict CSP.
 */
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { deflateSync } from "node:zlib";
import QRCode from "qrcode";
import { mobilePage, desktopPairingPage, pairingWaitPage } from "./pages.mjs";

const MAX_BODY_BYTES = 64 * 1024;
// 30-minute pairing window: long enough that a copied/scanned pairing URL
// stays usable, while the desktop-approval gate keeps the flow secure.
const PAIRING_TTL_MS = 30 * 60 * 1000;
const RPC_ALLOWLIST = new Set([
  "workspace.list",
  "session.list",
  "session.history",
  "session.create",
  "session.prompt",
  "session.cancel",
]);

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const options = { harnessUrl: "", guiOrigin: "", locale: "zh", port: 0, appName: "DSH" };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--harness-url") options.harnessUrl = next();
    else if (arg === "--gui-origin") options.guiOrigin = next();
    else if (arg === "--locale") options.locale = next().startsWith("zh") ? "zh" : "en";
    else if (arg === "--port") options.port = Number(next()) || 0;
    else if (arg === "--app-name") options.appName = next() || "DSH";
  }
  return options;
}

function isHarnessUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- brand assets (zero deps)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Procedural app icon: brand-blue rounded square + white chat bubble + three dots. */
function appIconPng(size = 180) {
  const px = Buffer.alloc(size * size * 4);
  const edge = 1 / size;
  const sdRoundRect = (x, y, hx, hy, r) => {
    const qx = Math.abs(x) - (hx - r);
    const qy = Math.abs(y) - (hy - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;
  const cov = (sdf) => Math.min(1, Math.max(0, 0.5 - sdf / edge));
  const blue = [79, 107, 254];
  const white = [255, 255, 255];
  const over = (dst, src, c) => [
    dst[0] + (src[0] - dst[0]) * c,
    dst[1] + (src[1] - dst[1]) * c,
    dst[2] + (src[2] - dst[2]) * c,
    dst[3] + (1 - dst[3]) * c,
  ];
  for (let y = 0; y < size; y++) {
    const ny = (y + 0.5) / size - 0.5;
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size - 0.5;
      let c = [0, 0, 0, 0];
      const bg = cov(sdRoundRect(nx, ny, 0.5, 0.5, 0.22));
      if (bg > 0) c = over(c, [...blue, 1], bg);
      const bubble = cov(Math.min(sdCircle(nx, ny, 0, -0.02, 0.3), Math.abs(nx) + Math.abs(ny + 0.02) - 0.42));
      if (bubble > 0) c = over(c, [...white, 1], bubble);
      for (const dx of [-0.115, 0, 0.115]) {
        const dot = cov(sdCircle(nx, ny, dx, -0.02, 0.04));
        if (dot > 0) c = over(c, [...blue, 1], dot);
      }
      const idx = (y * size + x) * 4;
      px[idx] = Math.round(c[0]);
      px[idx + 1] = Math.round(c[1]);
      px[idx + 2] = Math.round(c[2]);
      px[idx + 3] = Math.round(c[3] * 255);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", (() => {
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(size, 0);
      ihdr.writeUInt32BE(size, 4);
      ihdr[8] = 8;
      ihdr[9] = 6;
      return ihdr;
    })()),
    pngChunk("IDAT", deflateSync(px, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function brandLogoSvg(variant) {
  const dark = variant === "dark";
  const fill = dark ? "#f5f5f6" : "#18191c";
  const bg = dark ? "#19191b" : "#f2f3f5";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="76" height="40" viewBox="0 0 76 40">` +
    `<rect width="76" height="40" rx="9" fill="${bg}"/>` +
    `<text x="38" y="26" text-anchor="middle" font-family="-apple-system,'Segoe UI',sans-serif" font-size="16" font-weight="700" fill="${fill}">DSH</text></svg>`;
}

// ---------------------------------------------------------------- network helpers
function preferredLanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && isPrivateAddress(entry.address)) return entry.address;
    }
  }
  return undefined;
}

function normalizeRemoteAddress(address) {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isLoopbackAddress(address) {
  return address === "::1" || address === "127.0.0.1";
}

function isPrivateAddress(address) {
  if (isLoopbackAddress(address)) return true;
  if (/^10\./.test(address) || /^192\.168\./.test(address)) return true;
  const match = /^172\.(\d+)\./.exec(address);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(address) || /^fe8[0-9a-f]:/i.test(address);
}

async function readBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ---------------------------------------------------------------- bridge
class LanMobileBridge {
  constructor(options) {
    this.options = options;
    this.now = () => Date.now();
    this.sessions = new Map();
    this.pendingPairings = new Map();
  }

  async start() {
    if (this.server) {
      this.rotatePairingToken();
      this.pendingPairings.clear();
      return this.snapshot();
    }
    this.rotatePairingToken();
    this.server = createServer((request, response) => {
      void this.handle(request, response).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.json(response, 500, { ok: false, error: message });
      });
    });
    this.server.on("error", (error) => {
      console.error(JSON.stringify({ event: "error", message: error instanceof Error ? error.message : String(error) }));
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port ?? 0, "0.0.0.0", resolve);
    });
    this.port = this.server.address().port;
    return this.snapshot();
  }

  async stop() {
    const server = this.server;
    this.server = undefined;
    this.port = undefined;
    this.pairingToken = undefined;
    this.pairingExpiresAt = undefined;
    this.sessions.clear();
    this.pendingPairings.clear();
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  snapshot() {
    const address = preferredLanAddress();
    if (!this.server || !this.port || !this.pairingToken || !this.pairingExpiresAt || !address) {
      return { running: Boolean(this.server), connected: this.sessions.size > 0 };
    }
    const pairingUrl = `http://${address}:${this.port}/pair?token=${this.pairingToken}`;
    return {
      running: true,
      connected: this.sessions.size > 0,
      port: this.port,
      pairingUrl,
      desktopUrl: `http://127.0.0.1:${this.port}/desktop`,
      expiresAt: this.pairingExpiresAt,
      locale: this.options.locale,
      appName: this.options.appName,
    };
  }

  rotatePairingToken() {
    this.pairingToken = randomBytes(32).toString("base64url");
    this.pairingExpiresAt = this.now() + PAIRING_TTL_MS;
  }

  async handle(request, response) {
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
    );

    // CORS for the harness GUI origin (the native web UI drives /desktop*).
    const requestOrigin = request.headers.origin;
    const guiOrigin = this.options.guiOrigin;
    const corsAllowed = Boolean(requestOrigin && guiOrigin && requestOrigin === guiOrigin);
    if (corsAllowed) {
      response.setHeader("access-control-allow-origin", requestOrigin);
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("access-control-max-age", "600");
      response.setHeader("vary", "Origin");
    }

    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress ?? "");
    if (!isPrivateAddress(remoteAddress)) return this.text(response, 403, "Private network only.");
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "OPTIONS" && corsAllowed) {
      response.statusCode = 204;
      response.end();
      return;
    }

    // Brand assets (needed by the phone pages).
    if (request.method === "GET" && url.pathname === "/brand-logo/light") {
      return this.raw(response, 200, "image/svg+xml; charset=utf-8", brandLogoSvg("light"));
    }
    if (request.method === "GET" && url.pathname === "/brand-logo/dark") {
      return this.raw(response, 200, "image/svg+xml; charset=utf-8", brandLogoSvg("dark"));
    }
    if (request.method === "GET" && url.pathname === "/app-icon") {
      return this.raw(response, 200, "image/png", appIconPng(180));
    }

    // Desktop endpoints: loopback only (the GUI runs on loopback).
    if (request.method === "GET" && url.pathname === "/desktop") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      const snapshot = this.snapshot();
      if (!snapshot.pairingUrl || !snapshot.expiresAt) return this.text(response, 503, "Bridge unavailable.");
      const qrSvg = await QRCode.toString(snapshot.pairingUrl, { type: "svg", margin: 1, width: 260 });
      return this.html(
        response,
        desktopPairingPage({
          qrSvg,
          pairingUrl: snapshot.pairingUrl,
          expiresAt: snapshot.expiresAt,
          locale: this.options.locale,
          connected: this.sessions.size > 0,
          appName: this.options.appName,
        })
      );
    }
    if (request.method === "GET" && url.pathname === "/desktop/snapshot") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      return this.json(response, 200, this.snapshot());
    }
    if (request.method === "GET" && url.pathname === "/desktop/qr") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      const snapshot = this.snapshot();
      if (!snapshot.pairingUrl) return this.text(response, 503, "Pairing token unavailable.");
      const qrSvg = await QRCode.toString(snapshot.pairingUrl, { type: "svg", margin: 1, width: 260 });
      return this.raw(response, 200, "image/svg+xml; charset=utf-8", qrSvg);
    }
    if (request.method === "GET" && url.pathname === "/desktop/pending") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      const pending = [...this.pendingPairings.values()].find(
        (item) => item.decision === undefined && item.expiresAt >= this.now()
      );
      return this.json(response, 200, pending ? { id: pending.id, remoteAddress: pending.remoteAddress } : {});
    }
    if (request.method === "GET" && url.pathname === "/desktop/status") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      return this.json(response, 200, { connected: this.sessions.size > 0 });
    }
    if (request.method === "POST" && url.pathname === "/desktop/disconnect") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      this.sessions.clear();
      this.pendingPairings.clear();
      this.rotatePairingToken();
      this.emit({ event: "disconnected" });
      return this.json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/desktop/rotate") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      this.rotatePairingToken();
      this.pendingPairings.clear();
      return this.json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/desktop/decide") {
      if (!isLoopbackAddress(remoteAddress)) return this.text(response, 403, "Desktop only.");
      const input = JSON.parse(await readBody(request));
      const pending = typeof input.id === "string" ? this.pendingPairings.get(input.id) : undefined;
      if (!pending || typeof input.approved !== "boolean") return this.text(response, 404, "Pairing request not found.");
      pending.decision = input.approved;
      return this.json(response, 200, { ok: true });
    }

    // Pairing flow.
    if (request.method === "GET" && url.pathname === "/pair") {
      if (this.authorized(request)) {
        response.statusCode = 302;
        response.setHeader("location", "/");
        response.end();
        return;
      }
      if (!this.validPairingToken(url.searchParams.get("token"))) {
        return this.text(response, 401, "This pairing link is invalid or expired.");
      }
      const id = randomUUID();
      this.pendingPairings.set(id, { id, remoteAddress, expiresAt: this.pairingExpiresAt });
      this.emit({ event: "pairing", id, remoteAddress });
      return this.html(response, pairingWaitPage(id, this.options.locale));
    }
    if (request.method === "GET" && url.pathname === "/pair/status") {
      const id = url.searchParams.get("id");
      const pending = id ? this.pendingPairings.get(id) : undefined;
      if (!pending) return this.json(response, 200, { expired: true });
      if (pending.expiresAt < this.now()) {
        this.pendingPairings.delete(pending.id);
        return this.json(response, 200, { expired: true });
      }
      if (pending.decision === false) {
        this.pendingPairings.delete(pending.id);
        return this.json(response, 200, { denied: true });
      }
      if (pending.decision !== true) return this.json(response, 200, { pending: true });
      const token = randomBytes(32).toString("base64url");
      this.sessions.clear();
      this.sessions.set(token, { token });
      this.pendingPairings.delete(pending.id);
      this.pairingToken = undefined;
      this.pairingExpiresAt = undefined;
      response.setHeader("set-cookie", `dsh_mobile=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      this.emit({ event: "connected" });
      return this.json(response, 200, { approved: true });
    }

    // Mobile client (authorized only).
    if (!this.authorized(request)) return this.text(response, 401, "Pair your phone again.");
    if (request.method === "GET" && url.pathname === "/api/status") {
      return this.json(response, 200, { connected: true });
    }
    if (request.method === "GET" && url.pathname === "/") {
      return this.html(response, mobilePage({ locale: this.options.locale, appName: this.options.appName }));
    }
    if (request.method === "POST" && url.pathname === "/api/rpc") {
      this.verifySameOrigin(request);
      const input = JSON.parse(await readBody(request));
      if (typeof input.method !== "string" || !RPC_ALLOWLIST.has(input.method)) {
        return this.json(response, 403, { ok: false, error: "RPC method is not available on mobile." });
      }
      const result = await this.forwardRpc(input.method, input.payload ?? {});
      return this.json(response, result.ok ? 200 : 400, result);
    }
    this.text(response, 404, "Not found.");
  }

  validPairingToken(candidate) {
    if (!candidate || !this.pairingToken || !this.pairingExpiresAt) return false;
    if (this.now() > this.pairingExpiresAt) return false;
    const left = Buffer.from(candidate);
    const right = Buffer.from(this.pairingToken);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  authorized(request) {
    const cookie = request.headers.cookie ?? "";
    const match = /(?:^|;\s*)dsh_mobile=([^;]+)/.exec(cookie);
    if (!match) return false;
    return this.sessions.has(match[1]);
  }

  verifySameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin && host && new URL(origin).host !== host) throw new Error("Cross-origin request rejected.");
  }

  async forwardRpc(method, payload) {
    const base = this.options.harnessUrl;
    if (!base) return { ok: false, error: "Harness is not ready." };
    const rpcId = randomUUID();
    const response = await fetch(new URL(`/api/${method}`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return { ok: false, error: `Harness transport returned HTTP ${response.status}.` };
    const envelope = await response.json();
    if (envelope.rpcId !== rpcId) return { ok: false, error: "Harness RPC response did not match the request." };
    if (envelope.result?.ok !== true) {
      const message = envelope.result?.error?.message;
      return { ok: false, error: typeof message === "string" ? message : "Harness rejected the request." };
    }
    return { ok: true, value: envelope.result.value };
  }

  emit(message) {
    console.log(JSON.stringify(message));
  }

  html(response, body) {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(body);
  }

  text(response, status, body) {
    response.statusCode = status;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(body);
  }

  raw(response, status, contentType, body) {
    response.statusCode = status;
    response.setHeader("content-type", contentType);
    response.end(body);
  }

  json(response, status, body) {
    if (response.headersSent) {
      response.end();
      return;
    }
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(body));
  }
}

// ---------------------------------------------------------------- main
const options = parseArgs(process.argv);
if (!isHarnessUrl(options.harnessUrl)) {
  console.error(`invalid --harness-url (must be http://127.0.0.1:<port> or http://localhost:<port>): ${options.harnessUrl}`);
  process.exit(2);
}

const bridge = new LanMobileBridge(options);
const snapshot = await bridge.start();
const lanAddress = preferredLanAddress() ?? "";
console.log(
  JSON.stringify({
    event: "ready",
    port: snapshot.port,
    lanAddress,
    locale: options.locale,
    appName: options.appName,
    pairingUrl: snapshot.pairingUrl,
    expiresAt: snapshot.expiresAt,
  })
);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    void bridge.stop().then(() => process.exit(0));
  });
}
