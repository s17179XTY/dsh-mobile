/**
 * dsh-mobile — browser half.
 *
 * Hand-written `__ModuleLoader__` bundle (no build step): replaces the
 * settings-row trigger content with [gear 设置 ··· 📱], opens a pairing
 * dialog (QR + copy + countdown + approve/deny + manage), and shows a green
 * connection dot on the phone icon while a phone is paired.
 *
 * Data flow: the bridge port comes from the server half's same-origin route
 * `/phone-connect/bridge`; everything else talks to the LAN bridge's
 * loopback `/desktop*` endpoints directly (CORS-enabled for the GUI origin
 * by the bridge). No harness RPC is involved.
 */
window.__ModuleLoader__.load({
	id: "dsh-mobile",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");

		//#region css
		const CSS = [
			".dsh-pc-trigger{display:flex;align-items:center;gap:8px;flex:1;min-width:0;width:100%}",
			".dsh-pc-trigger-label{font-size:14px;color:var(--dsw-alias-label-primary,currentColor);white-space:nowrap}",
			".dsh-pc-entry{cursor:pointer;position:relative;width:30px;height:30px;color:var(--dsw-alias-label-secondary,currentColor);background:transparent;border:none;border-radius:8px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex;vertical-align:middle;margin:0 4px 0 auto;transition:background .12s ease}",
			".dsh-pc-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.18))}",
			".dsh-pc-entry:focus-visible{outline:2px solid var(--dsw-alias-focus-ring,#4d6bfe);outline-offset:1px}",
			".dsh-pc-dot{position:absolute;top:1px;right:2px;width:8px;height:8px;border-radius:50%;background:#35a867;box-shadow:0 0 0 1.5px var(--dsw-specific-sidebar-fill,#141416)}",
			"button[data-dsh-pc-no-hover]{background:transparent !important}",
			".dsh-pc-scrim{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(10,12,16,.5);padding:16px}",
			".dsh-pc-card{width:min(420px,100%);max-height:min(640px,calc(100vh - 40px));overflow:auto;background:#fff;color:#18191c;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28)}",
			".dsh-pc-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #eceef1}",
			".dsh-pc-title{font-size:15px;font-weight:600}",
			".dsh-pc-close{border:none;background:transparent;color:inherit;font-size:14px;cursor:pointer;padding:4px 6px;border-radius:6px}",
			".dsh-pc-close:hover{background:rgba(128,128,128,.18)}",
			".dsh-pc-body{display:flex;flex-direction:column;gap:12px;padding:18px 16px 20px;text-align:center}",
			".dsh-pc-muted{color:#81858c;font-size:13px;line-height:1.55;margin:0}",
			".dsh-pc-error{color:#e34d59;font-size:13px;margin:0}",
			".dsh-pc-qr{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:14px;display:inline-flex;margin:0 auto}",
			".dsh-pc-qr svg{width:220px;height:220px;display:block}",
			".dsh-pc-row{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 auto;max-width:100%}",
			".dsh-pc-url{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f7f8fa;border-radius:9px;padding:8px 10px;word-break:break-all;text-align:left;user-select:all;max-width:100%;min-width:0;flex:0 1 auto}",
			".dsh-pc-countdown{color:#81858c;font-size:12px;margin:0}",
			".dsh-pc-actions{display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap}",
			".dsh-pc-btn{min-width:92px;border:1px solid #e5e7eb;border-radius:9px;background:#fff;color:#18191c;padding:8px 14px;cursor:pointer;font-size:13px}",
			".dsh-pc-btn:hover{background:#f2f3f5}",
			".dsh-pc-btn:disabled{opacity:.5;cursor:default}",
			".dsh-pc-copy{min-width:0;flex:none;padding:8px 12px}",
			".dsh-pc-primary{background:#4d6bfe;color:#fff;border-color:#4d6bfe}",
			".dsh-pc-primary:hover{background:#3f5ce8}",
			".dsh-pc-connected{display:flex;flex-direction:column;align-items:center;gap:8px;margin:0 auto;max-width:360px;background:#f2f8f4;color:#277347;border-radius:14px;padding:18px}",
			".dsh-pc-connected-title{font-size:15px;font-weight:600}",
			".dsh-pc-pending{display:flex;flex-direction:column;align-items:center;gap:8px;margin:0 auto;max-width:360px;background:#fff8ec;color:#8a5a00;border-radius:14px;padding:18px}",
			".dsh-pc-pending-title{font-size:15px;font-weight:600}",
			"@media (prefers-color-scheme: dark){",
			".dsh-pc-card{background:#1d1d20;color:#f5f5f6;border-color:#303034}",
			".dsh-pc-header{border-bottom-color:#303034}",
			".dsh-pc-muted,.dsh-pc-countdown{color:#95979d}",
			".dsh-pc-url{background:#19191b}",
			".dsh-pc-btn{background:#1d1d20;color:#f5f5f6;border-color:#3a3a3f}",
			".dsh-pc-btn:hover{background:#29292d}",
			".dsh-pc-primary{background:#4d6bfe;color:#fff;border-color:#4d6bfe}",
			".dsh-pc-qr{background:#fff}",
			"}"
		].join("");
		(function injectCss() {
			const tagId = "dsh-mobile/dsh-mobile.css";
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-mobile";
				tag.dataset.pluginCss = tagId;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}
		})();
		//#endregion

		//#region texts
		function textOf(zh) {
			return {
				entry: zh ? "连接手机" : "Connect Phone",
				settings: zh ? "设置" : "Settings",
				title: zh ? "连接手机" : "Connect Phone",
				close: zh ? "关闭" : "Close",
				starting: zh ? "桥正在启动…" : "Starting bridge…",
				failed: zh ? "启动失败" : "Failed to start",
				disconnected: zh ? "桥已停止，正在自动重试…" : "Bridge stopped, retrying…",
				connected: zh ? "手机已连接" : "Phone connected",
				connectedHint: zh ? "连接会在后台保持，现在可以关闭此弹窗。" : "The connection stays active in the background. You can close this dialog now.",
				disconnect: zh ? "断开连接" : "Disconnect",
				waiting: zh ? "手机正在等待批准" : "Phone waiting for approval",
				device: zh ? "设备地址" : "Device address",
				decline: zh ? "拒绝" : "Decline",
				allow: zh ? "允许" : "Allow",
				hint: zh ? "请确保手机与电脑连接到同一个可信 Wi-Fi，然后用手机相机扫描二维码。" : "Keep your phone and this computer on the same trusted Wi-Fi, then scan the QR code with your phone camera.",
				refresh: zh ? "二维码将在 " : "QR refreshes in ",
				seconds: zh ? " 秒后刷新" : "s",
				expired: zh ? "二维码已过期，正在自动刷新…" : "QR expired, refreshing automatically…",
				refreshNow: zh ? "刷新二维码" : "Refresh QR",
				copy: zh ? "复制" : "Copy",
				copied: zh ? "已复制" : "Copied",
				phone: zh ? "手机" : "Phone",
			};
		}
		//#endregion

		//#region data layer (same-origin discovery + loopback bridge calls)
		const conn = { port: null, status: "stopped", error: null, connected: false };

		async function refreshBridgeInfo() {
			try {
				const res = await fetch("/phone-connect/bridge", { cache: "no-store" });
				if (!res.ok) throw new Error("bridge info HTTP " + res.status);
				const info = await res.json();
				conn.status = typeof info.status === "string" ? info.status : "stopped";
				conn.error = typeof info.error === "string" ? info.error : null;
				conn.port = typeof info.port === "number" ? info.port : null;
				conn.connected = info.connected === true;
				return info;
			} catch (error) {
				conn.status = "error";
				conn.error = String(error && error.message ? error.message : error);
				return null;
			}
		}

		async function bridgeFetch(path, options) {
			if (!conn.port) {
				const info = await refreshBridgeInfo();
				if (!info || !conn.port) throw new Error("bridge is not running");
			}
			try {
				return await fetch("http://127.0.0.1:" + conn.port + path, options);
			} catch (error) {
				await refreshBridgeInfo();
				throw error;
			}
		}

		async function bridgeJson(path, options) {
			const res = await bridgeFetch(path, options);
			if (!res.ok) throw new Error("HTTP " + res.status);
			return res.json();
		}
		//#endregion

		//#region plugin body
		/** Services required by the client plugin body. */
		const inject = ["slots", "timer", "locale"];

		/**
		 * Client plugin body: settings-row phone entry + pairing dialog.
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			const store = { open: false, connected: false, listeners: new Set() };
			const notify = () => {
				for (const listener of store.listeners) listener();
			};
			const setOpen = (value) => {
				store.open = value;
				notify();
			};
			const subscribeStore = (listener) => {
				store.listeners.add(listener);
				return () => store.listeners.delete(listener);
			};

			const isZh = () => {
				try {
					const locale = ctx.get("locale");
					if (!locale || typeof locale.getLocale !== "function") return true;
					const snapshot = locale.getLocale();
					const id = snapshot && typeof snapshot.id === "string" ? snapshot.id : "";
					if (!id) return true;
					return /^zh/i.test(id);
				} catch {
					return true;
				}
			};
			const T = () => textOf(isZh());

			const fallbackCopy = (value) => {
				try {
					const textarea = document.createElement("textarea");
					textarea.value = value;
					textarea.style.position = "fixed";
					textarea.style.opacity = "0";
					document.body.appendChild(textarea);
					textarea.select();
					const ok = document.execCommand("copy");
					document.body.removeChild(textarea);
					return ok;
				} catch {
					return false;
				}
			};
			const copyText = (value) => {
				try {
					if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
						return navigator.clipboard.writeText(value).then(() => true).catch(() => fallbackCopy(value));
					}
				} catch {}
				return Promise.resolve(fallbackCopy(value));
			};

			// While the mouse is over the phone control, suppress the settings-row
			// highlight (the phone lives inside the settings trigger button).
			const suppressRowHover = (event) => {
				const button = event && event.currentTarget ? event.currentTarget.closest("button") : null;
				if (button) button.setAttribute("data-dsh-pc-no-hover", "1");
			};
			const restoreRowHover = (event) => {
				const button = event && event.currentTarget ? event.currentTarget.closest("button") : null;
				if (button) button.removeAttribute("data-dsh-pc-no-hover");
			};

			function TriggerWithPhone(props) {
				const wide = Boolean(props && props.wide);
				const t = T();
				const [connected, setConnected] = React.useState(store.connected);
				React.useEffect(() => subscribeStore(() => setConnected(store.connected)), []);
				const openPhone = (event) => {
					if (event) event.stopPropagation();
					setOpen(true);
				};
				return React.createElement(
					"span",
					{ className: "dsh-pc-trigger" },
					React.createElement(
						"svg",
						{ width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
						React.createElement("circle", { cx: 12, cy: 12, r: 3 }),
						React.createElement("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" }),
					),
					wide ? React.createElement("span", { className: "dsh-pc-trigger-label" }, t.settings) : null,
					React.createElement(
						"span",
						{
							role: "button",
							tabIndex: 0,
							className: "dsh-pc-entry",
							title: t.entry,
							"aria-label": t.entry,
							onClick: openPhone,
							onMouseEnter: suppressRowHover,
							onMouseLeave: restoreRowHover,
							onFocus: suppressRowHover,
							onBlur: restoreRowHover,
							onKeyDown: (event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									openPhone(event);
								}
							},
						},
						React.createElement(
							"svg",
							{ width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
							React.createElement("rect", { x: 5.5, y: 2.5, width: 13, height: 19, rx: 2.5 }),
							React.createElement("line", { x1: 10.2, y1: 18.4, x2: 13.8, y2: 18.4 }),
						),
						connected ? React.createElement("span", { className: "dsh-pc-dot", "aria-hidden": true }) : null,
					),
				);
			}

			function DialogCard() {
				const [snap, setSnap] = React.useState(null);
				const [pending, setPending] = React.useState(null);
				const [qr, setQr] = React.useState(null);
				const [now, setNow] = React.useState(Date.now());
				const [busy, setBusy] = React.useState(false);
				const [actionError, setActionError] = React.useState("");
				const [copied, setCopied] = React.useState(false);
				const t = T();

				const refresh = async () => {
					try {
						const info = await refreshBridgeInfo();
						if (info && conn.port) {
							const s = await bridgeJson("/desktop/snapshot");
							setSnap(s);
							const p = await bridgeJson("/desktop/pending");
							setPending(p && p.id ? p : null);
						} else {
							setSnap({ status: conn.status, error: conn.error });
							setPending(null);
						}
					} catch (error) {
						setSnap({ status: "error", error: String(error && error.message ? error.message : error) });
						setPending(null);
					}
				};

				// Keep a still-valid pairing URL alive: rotate only when the
				// current token is actually expired (30-minute lifetime).
				React.useEffect(() => {
					let cancelled = false;
					const ensureFresh = async () => {
						try {
							await refreshBridgeInfo();
							if (conn.port) {
								const s = await bridgeJson("/desktop/snapshot");
								const remaining = s && s.expiresAt ? s.expiresAt - Date.now() : 0;
								if (s && s.pairingUrl && remaining <= 0) {
									await bridgeFetch("/desktop/rotate", { method: "POST" });
								}
							}
						} catch {}
						if (!cancelled) refresh();
					};
					ensureFresh();
					const stopPoll = ctx.interval(() => refresh(), 2000);
					const stopTick = ctx.interval(() => setNow(Date.now()), 1000);
					return () => { cancelled = true; stopPoll(); stopTick(); };
				}, []);

				const pairingUrl = snap && snap.status === "running" && snap.pairingUrl ? snap.pairingUrl : null;
				React.useEffect(() => {
					if (!pairingUrl) {
						setQr(null);
						return undefined;
					}
					let cancelled = false;
					bridgeFetch("/desktop/qr")
						.then((res) => res.text())
						.then((svg) => { if (!cancelled) setQr(svg); })
						.catch(() => { if (!cancelled) setQr(null); });
					return () => { cancelled = true; };
				}, [pairingUrl]);

				const remaining = snap && snap.expiresAt ? snap.expiresAt - now : 0;
				const expired = Boolean(pairingUrl) && remaining <= 0;
				React.useEffect(() => {
					if (expired && !busy) {
						bridgeFetch("/desktop/rotate", { method: "POST" })
							.then(() => refresh())
							.catch((error) => setActionError(String(error && error.message ? error.message : error)));
					}
				}, [expired]);

				const act = (operation) => {
					if (busy) return;
					setBusy(true);
					setActionError("");
					Promise.resolve()
						.then(() => operation())
						.then(() => refresh())
						.catch((error) => setActionError(String(error && error.message ? error.message : error)))
						.finally(() => setBusy(false));
				};

				const doCopy = (value) => {
					copyText(value).then((ok) => {
						if (ok) {
							setCopied(true);
							ctx.timeout(() => setCopied(false), 1600);
						} else {
							setActionError(t.failed);
						}
					});
				};

				const running = snap && snap.status === "running";
				const content = [];
				if (!snap || snap.status === "starting") {
					content.push(React.createElement("p", { className: "dsh-pc-muted" }, t.starting));
				} else if (!running) {
					content.push(React.createElement("p", { className: "dsh-pc-error" }, String((snap && snap.error) || t.disconnected)));
				} else if (snap.connected) {
					content.push(
						React.createElement("div", { className: "dsh-pc-connected" },
							React.createElement("div", { className: "dsh-pc-connected-title" }, "✓ " + t.connected),
							React.createElement("p", { className: "dsh-pc-muted" }, t.connectedHint),
						),
						React.createElement("div", { className: "dsh-pc-row" },
							React.createElement("span", { className: "dsh-pc-muted" }, t.device + ":"),
							React.createElement("code", { className: "dsh-pc-url" }, "http://" + (snap.lanAddress || "?") + ":" + snap.port),
						),
						React.createElement("button", { className: "dsh-pc-btn", type: "button", disabled: busy, onClick: () => act(() => bridgeFetch("/desktop/disconnect", { method: "POST" })) }, t.disconnect),
					);
				} else if (pending) {
					content.push(
						React.createElement("div", { className: "dsh-pc-pending" },
							React.createElement("div", { className: "dsh-pc-pending-title" }, t.waiting),
							React.createElement("p", { className: "dsh-pc-muted" }, t.device + ": " + (pending.remoteAddress || t.phone)),
						),
						React.createElement("div", { className: "dsh-pc-actions" },
							React.createElement("button", { className: "dsh-pc-btn", type: "button", disabled: busy, onClick: () => act(() => bridgeFetch("/desktop/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: pending.id, approved: false }) })) }, t.decline),
							React.createElement("button", { className: "dsh-pc-btn dsh-pc-primary", type: "button", disabled: busy, onClick: () => act(() => bridgeFetch("/desktop/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: pending.id, approved: true }) })) }, t.allow),
						),
					);
				} else if (qr) {
					content.push(
						React.createElement("p", { className: "dsh-pc-muted" }, t.hint),
						React.createElement("div", { className: "dsh-pc-qr", dangerouslySetInnerHTML: { __html: qr } }),
						React.createElement("div", { className: "dsh-pc-row" },
							React.createElement("code", { className: "dsh-pc-url" }, pairingUrl),
							React.createElement("button", { className: "dsh-pc-btn dsh-pc-copy", type: "button", onClick: () => doCopy(pairingUrl) }, copied ? t.copied : t.copy),
						),
						expired
							? React.createElement("div", { className: "dsh-pc-actions" },
								React.createElement("span", { className: "dsh-pc-muted" }, t.expired),
								React.createElement("button", { className: "dsh-pc-btn", type: "button", disabled: busy, onClick: () => act(() => bridgeFetch("/desktop/rotate", { method: "POST" })) }, t.refreshNow),
							)
							: React.createElement("p", { className: "dsh-pc-countdown" }, t.refresh + String(Math.max(0, Math.ceil(remaining / 1000))) + t.seconds),
					);
				} else {
					content.push(React.createElement("p", { className: "dsh-pc-muted" }, t.starting));
				}

				if (actionError) content.push(React.createElement("p", { className: "dsh-pc-error" }, actionError));

				return React.createElement(
					"div",
					{ className: "dsh-pc-scrim", onClick: () => setOpen(false) },
					React.createElement(
						"div",
						{ className: "dsh-pc-card", onClick: (event) => event.stopPropagation() },
						React.createElement(
							"div",
							{ className: "dsh-pc-header" },
							React.createElement("div", { className: "dsh-pc-title" }, "📱 " + t.title),
							React.createElement("button", { className: "dsh-pc-close", type: "button", "aria-label": t.close, onClick: () => setOpen(false) }, "✕"),
						),
						React.createElement("div", { className: "dsh-pc-body" }, content),
					),
				);
			}

			function DialogHost() {
				const [open, setOpenState] = React.useState(store.open);
				React.useEffect(() => subscribeStore(() => setOpenState(store.open)), []);
				if (!open) return null;
				return React.createElement(DialogCard, null);
			}

			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("settings.trigger", () => slots.register(
				{ name: "settings.trigger" },
				(props) => React.createElement(TriggerWithPhone, { wide: Boolean(props && props.wide) }),
			));
			slots.inject("shell.overlay", () => slots.register(
				{ name: "shell.overlay", id: "dsh-mobile-dialog", order: 100 },
				() => React.createElement(DialogHost, null),
			));

			// Tell the server half which locale/app name the phone pages should use.
			void fetch("/phone-connect/config?locale=" + encodeURIComponent(isZh() ? "zh" : "en") + "&appName=" + encodeURIComponent("DSH"), { cache: "no-store" }).catch(() => {});

			// Keep the settings-row connection dot in sync with the bridge.
			const syncConnection = async () => {
				const before = conn.connected;
				await refreshBridgeInfo();
				if (conn.connected !== before) notify();
			};
			void syncConnection();
			ctx.interval(() => syncConnection(), 2500);
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
