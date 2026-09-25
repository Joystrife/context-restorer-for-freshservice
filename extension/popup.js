"use strict";

const DEBUG_KEY = "debugLog";
const PORTALS_KEY = "portalRegistry";
const STATS_KEY = "restoreStats";
const stateKey = (tabId) => `tabState:${tabId}`;
let currentTabId = null;

async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function el(id) { return document.getElementById(id); }
function setText(id, value) { el(id).textContent = value; }

function fmtDateTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function portalSourceLabel(source) {
  if (source === "manual") return "Manual";
  if (source === "standard_freshservice_domain") return "Auto · freshservice.com";
  if (source === "freshid_auth_signature") return "Auto · FreshID";
  if (source === "freshservice_route_signature") return "Auto · route signature";
  if (source === "auth_route_plus_app_context") return "Auto · auth + context";
  return "Automatic";
}

function lastRestoreLabel(state) {
  if (!state?.lastRestoreSuccessAt) return "Never";
  return `Successful · ${fmtDateTime(state.lastRestoreSuccessAt)}`;
}

function renderPortals(registry) {
  const list = el("portalList");
  const portals = Object.values(registry || {}).sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  setText("portalCount", String(portals.length));
  list.replaceChildren();

  if (!portals.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No portal detected yet. Open Freshservice normally; compatible portals are added automatically.";
    list.appendChild(empty);
    return;
  }

  for (const portal of portals) {
    const row = document.createElement("div");
    row.className = "portal-item";
    row.dataset.origin = portal.origin;

    const info = document.createElement("div");
    const host = document.createElement("div");
    host.className = "portal-host";
    host.textContent = portal.host || portal.origin;
    const meta = document.createElement("div");
    meta.className = "portal-meta";
    meta.textContent = `${portalSourceLabel(portal.source)} · ${portal.restoreCount || 0} restore${portal.restoreCount === 1 ? "" : "s"}`;
    info.append(host, meta);

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "portal-toggle";
    toggle.checked = portal.enabled !== false;
    toggle.title = toggle.checked ? "Disable portal" : "Enable portal";
    toggle.addEventListener("change", async () => {
      await chrome.runtime.sendMessage({ type: "set-portal-enabled", origin: portal.origin, enabled: toggle.checked });
      await refresh();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button";
    remove.textContent = "×";
    remove.title = "Remove portal";
    remove.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "remove-portal", origin: portal.origin });
      await refresh();
    });

    row.append(info, toggle, remove);
    list.appendChild(row);
  }
}

async function refresh() {
  const tab = await currentTab();
  if (!tab || !Number.isInteger(tab.id)) {
    setText("message", "Unable to identify the current tab.");
    return;
  }

  currentTabId = tab.id;

  // Inspect the currently displayed page so a Freshservice portal can be
  // detected immediately even when the tab was already open before the
  // extension was installed or reloaded.
  try {
    await chrome.runtime.sendMessage({ type: "inspect-current-tab", tabId: tab.id });
  } catch {
    // The popup can still render previously stored state if inspection fails.
  }

  const key = stateKey(tab.id);
  const [sessionData, localData] = await Promise.all([
    chrome.storage.session.get([key, DEBUG_KEY]),
    chrome.storage.local.get([PORTALS_KEY, STATS_KEY])
  ]);

  const state = sessionData[key];
  const registry = localData[PORTALS_KEY] || {};
  const stats = localData[STATS_KEY] || {};

  setText("portal", state?.portalOrigin ? new URL(state.portalOrigin).hostname : state?.candidateOrigin ? `${new URL(state.candidateOrigin).hostname} (candidate)` : "Not detected");
  setText("phase", state?.phase || "normal");
  setText("pending", state?.pendingRestore ? "Yes" : "No");
  setText("lastRestore", lastRestoreLabel(state));
  setText("sessionCount", String(state?.sessionRestoreCount || 0));
  setText("lastUrl", state?.lastUsefulUrl || state?.candidateUsefulUrl || "No URL saved.");

  el("lastRestore").className = state?.lastRestoreSuccessAt ? "success" : "";
  el("pending").className = state?.pendingRestore ? "warn" : "";
  el("restore").disabled = !state?.lastUsefulUrl;

  setText("totalRestores", String(stats.totalAutomaticRestores || 0));
  setText(
    "globalLastRestore",
    stats.lastSuccessfulRestoreAt
      ? `Last success: ${fmtDateTime(stats.lastSuccessfulRestoreAt)}${stats.lastSuccessfulRestoreOrigin ? ` · ${new URL(stats.lastSuccessfulRestoreOrigin).hostname}` : ""}`
      : "No automatic restore recorded yet."
  );

  renderPortals(registry);

  const debug = (sessionData[DEBUG_KEY] || [])
    .filter((item) => item.tabId === tab.id || item.tabId === -1)
    .slice(-28)
    .map((item) => {
      const extra = item.detail ? ` ${JSON.stringify(item.detail)}` : "";
      return `${item.at}  ${item.event}\n${item.url || ""}${extra}`;
    })
    .join("\n\n");
  setText("debug", debug || "No events for this tab.");

  if (state?.lastUsefulAt) setText("message", `Context saved: ${fmtDateTime(state.lastUsefulAt)}`);
  else if (state?.candidateAt) setText("message", "Potential Freshservice context detected; waiting for confirmation.");
  else setText("message", "");
}

async function send(type) {
  if (!Number.isInteger(currentTabId) && type !== "clear-debug-log") return null;
  return chrome.runtime.sendMessage({ type, tabId: currentTabId });
}

el("restore").addEventListener("click", async () => {
  const result = await send("restore-now");
  setText("message", result?.ok ? "Restore requested." : `Restore failed: ${result?.reason || "unknown"}`);
  await refresh();
});

el("clearState").addEventListener("click", async () => {
  await send("clear-tab-state");
  setText("message", "Current tab state cleared.");
  await refresh();
});

el("clearLog").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-debug-log" });
  setText("message", "Debug log cleared.");
  await refresh();
});

el("addPortalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = el("portalInput");
  const raw = input.value.trim();
  if (!raw) return;
  const result = await chrome.runtime.sendMessage({ type: "add-portal", url: raw });
  if (result?.ok) {
    input.value = "";
    setText("message", `Portal added: ${result.portal.host}`);
  } else {
    setText("message", "Enter a valid HTTPS domain or URL.");
  }
  await refresh();
});

void refresh();
