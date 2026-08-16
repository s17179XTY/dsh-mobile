/**
 * End-to-end test for the dsh-mobile bridge: spawns lan-bridge.mjs, verifies
 * the READY line, the pairing flow over HTTP, the RPC allowlist forwarding,
 * and the CORS contract for the GUI origin.
 *
 * Run: node scripts/test-bridge.mjs
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIDGE = join(ROOT, "lan-bridge.mjs");
const HARNESS = "http://127.0.0.1:6730"; // override with HARNESS_URL env for another port
const HARNESS_URL = process.env.HARNESS_URL ?? HARNESS;
const GUI_ORIGIN = "http://127.0.0.1:6730";

const child = spawn(process.execPath, [BRIDGE, "--harness-url", HARNESS_URL, "--gui-origin", GUI_ORIGIN, "--locale", "zh", "--port", "0", "--app-name", "DSH"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuf = "";
let stderrBuf = "";
let ready = null;
const events = [];

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => (stderrBuf += chunk));
child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk;
  let index;
  while ((index = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.slice(0, index).trim();
    stdoutBuf = stdoutBuf.slice(index + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.event === "ready") ready = msg;
    else if (msg.event) events.push(msg);
  }
});

function http(method, url, options = {}) {
  return fetch(url, {
    method,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
    body: options.body,
    redirect: "manual",
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!condition) failures++;
};

try {
  for (let i = 0; i < 50 && !ready; i++) await sleep(100);
  if (!ready) throw new Error("bridge did not become ready; stderr: " + stderrBuf.slice(-1000));
  const port = ready.port;
  const base = `http://127.0.0.1:${port}`;

  // 1. CORS for the GUI origin
  const cors = await http("GET", `${base}/desktop/snapshot`, { origin: GUI_ORIGIN });
  check("CORS allows GUI origin", cors.headers.get("access-control-allow-origin") === GUI_ORIGIN);
  const preflight = await http("OPTIONS", `${base}/desktop/decide`, { origin: GUI_ORIGIN });
  check("OPTIONS preflight 204", preflight.status === 204 && preflight.headers.get("access-control-allow-methods")?.includes("POST"));
  const foreign = await http("GET", `${base}/desktop/snapshot`, { origin: "http://evil.example" });
  check("foreign origin gets no CORS", foreign.headers.get("access-control-allow-origin") === null);

  // 2. pairing flow
  const snap = await (await http("GET", `${base}/desktop/snapshot`)).json();
  check("snapshot running + pairingUrl", snap.running === true && snap.pairingUrl.includes("/pair?token="));
  const pairPage = await http("GET", snap.pairingUrl);
  const pairHtml = await pairPage.text();
  check("pair page 200 + zh heading", pairPage.status === 200 && pairHtml.includes("批准此手机"));
  const id = pairHtml.match(/const id="([^"]+)"/)?.[1];
  const pending = await (await http("GET", `${base}/desktop/pending`)).json();
  check("pending visible", pending.id === id);
  await http("POST", `${base}/desktop/decide`, { body: JSON.stringify({ id, approved: true }) });
  const statusRes = await http("GET", `${base}/pair/status?id=${id}`);
  const status = await statusRes.json();
  const cookie = (statusRes.headers.get("set-cookie") || "").split(";")[0];
  check("pair approved + cookie", status.approved === true && cookie.length > 10);
  check("connected event emitted", events.some((e) => e.event === "connected"));

  // 3. mobile client + RPC forwarding
  const mobile = await (await http("GET", `${base}/`, { cookie })).text();
  check("mobile page ok", mobile.includes('id="workspace"') && mobile.includes("DSH"));
  const rpc = await (await http("POST", `${base}/api/rpc`, { cookie, body: JSON.stringify({ method: "workspace.list", payload: {} }) })).json();
  check("rpc workspace.list forwards", rpc.ok === true && Array.isArray(rpc.value.items));
  const rpcBad = await (await http("POST", `${base}/api/rpc`, { cookie, body: JSON.stringify({ method: "session.delete", payload: {} }) })).json();
  check("rpc allowlist enforced", rpcBad.ok === false);

  // 4. disconnect + rotate
  await http("POST", `${base}/desktop/disconnect`);
  const after = await (await http("GET", `${base}/desktop/snapshot`)).json();
  check("disconnected after disconnect", after.connected === false);
  const rot = await (await http("POST", `${base}/desktop/rotate`)).json();
  const snap2 = await (await http("GET", `${base}/desktop/snapshot`)).json();
  check("rotate refreshes token", rot.ok === true && snap2.pairingUrl !== snap.pairingUrl);
  check("token TTL is 30 minutes", snap2.expiresAt - Date.now() > 25 * 60 * 1000);
} catch (error) {
  console.error("TEST ERROR:", error);
  failures++;
} finally {
  child.kill();
  await sleep(200);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
