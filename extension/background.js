"use strict";

importScripts("rules.js");

const R = globalThis.ContextRestorerRules;
const VERSION = "0.2.4";
const STATE_PREFIX = "tabState:";
const DEBUG_KEY = "debugLog";
const PORTALS_KEY = "portalRegistry";
const STATS_KEY = "restoreStats";
const MAX_RESTORE_ATTEMPTS = 1;
const AUTH_STABILIZATION_MS = 1500;
const DEBUG_LIMIT = 160;

let portalCache = null;
const authRecoveryTimers = new Map();
const authRecoveryInFlight = new Set();

function stateKey(tabId) {
  return `${STATE_PREFIX}${tabId}`;
}

function blankState(tabId) {
  return {
    tabId,
    phase: "normal",
    portalOrigin: null,
    candidateOrigin: null,
    candidateUsefulUrl: null,
    candidateAt: null,
    lastUsefulUrl: null,
    lastUsefulAt: null,
    lastObservedUrl: null,
    pendingRestore: false,
    pendingSince: null,
    recoveryEligible: false,
    recoveryCause: null,
    externalAuthObservedAt: null,
    restoreAttempts: 0,
    restoringUrl: null,
    restoreMode: null,
    restoreReason: null,
    restoreRequestedAt: null,
    automaticAttemptCount: 0,
    recoveryAttemptMode: null,
    recoveryAttemptReason: null,
    waitingDebugLogged: false,
    lastRestoreSuccessAt: null,
    lastRestoreStatus: null,
    lastRestoreUrl: null,
    sessionRestoreCount: 0,
    lastReason: null
  };
}

async function getState(tabId) {
  const key = stateKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data[key] || blankState(tabId);
}

async function putState(state) {
  await chrome.storage.session.set({ [stateKey(state.tabId)]: state });
}

async function removeState(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
}

async function getAllTabStates() {
  const all = await chrome.storage.session.get(null);
  return Object.entries(all)
    .filter(([key, value]) => key.startsWith(STATE_PREFIX) && value)
    .map(([, value]) => value);
}

async function appendDebug(tabId, event, url = null, detail = null) {
  const data = await chrome.storage.session.get(DEBUG_KEY);
  const log = Array.isArray(data[DEBUG_KEY]) ? data[DEBUG_KEY] : [];
  log.push({ at: new Date().toISOString(), tabId, event, url, detail });
  if (log.length > DEBUG_LIMIT) log.splice(0, log.length - DEBUG_LIMIT);
  await chrome.storage.session.set({ [DEBUG_KEY]: log });
}

async function getPortals() {
  if (portalCache) return portalCache;
  const data = await chrome.storage.local.get(PORTALS_KEY);
  portalCache = data[PORTALS_KEY] && typeof data[PORTALS_KEY] === "object" ? data[PORTALS_KEY] : {};
  return portalCache;
}

async function savePortals(portals) {
  portalCache = portals;
  await chrome.storage.local.set({ [PORTALS_KEY]: portals });
}

async function getPortal(origin) {
  const portals = await getPortals();
  return portals[origin] || null;
}

async function ensurePortal(origin, source, confidence = "high") {
  const parsed = R.parseHttpsUrl(origin);
  if (!parsed || parsed.origin !== origin) return null;

  const portals = { ...(await getPortals()) };
  const existing = portals[origin];
  const now = Date.now();

  if (existing) {
    portals[origin] = { ...existing, lastSeenAt: now };
    await savePortals(portals);
    return portals[origin];
  }

  const portal = {
    origin,
    host: parsed.hostname,
    enabled: true,
    source,
    confidence,
    detectedAt: now,
    lastSeenAt: now,
    restoreCount: 0,
    lastRestoreAt: null
  };
  portals[origin] = portal;
  await savePortals(portals);
  await appendDebug(-1, "portal_detected", origin, { source, confidence });
  return portal;
}

async function updatePortal(origin, patch) {
  const portals = { ...(await getPortals()) };
  if (!portals[origin]) return null;
  portals[origin] = { ...portals[origin], ...patch };
  await savePortals(portals);
  return portals[origin];
}

async function removePortal(origin) {
  const portals = { ...(await getPortals()) };
  delete portals[origin];
  await savePortals(portals);
  await clearStatesForOrigin(origin);
}

async function clearStatesForOrigin(origin) {
  const all = await chrome.storage.session.get(null);
  const keys = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STATE_PREFIX) || !value) continue;
    if (value.portalOrigin === origin || value.candidateOrigin === origin) keys.push(key);
  }
  if (keys.length) await chrome.storage.session.remove(keys);
}

async function setPortalEnabled(origin, enabled) {
  const portal = await updatePortal(origin, { enabled: Boolean(enabled), lastSeenAt: Date.now() });
  if (!enabled) await clearStatesForOrigin(origin);
  return portal;
}

async function getStats() {
  const data = await chrome.storage.local.get(STATS_KEY);
  return data[STATS_KEY] || {
    totalAutomaticRestores: 0,
    totalManualRestores: 0,
    lastSuccessfulRestoreAt: null,
    lastSuccessfulRestoreOrigin: null
  };
}

async function recordSuccessfulRestore(state) {
  const now = Date.now();
  const completedMode = state.restoreMode || state.recoveryAttemptMode || "automatic";
  const completedReason = state.restoreReason || state.recoveryAttemptReason || "context_recovered";
  const attemptCount = (state.automaticAttemptCount || 0) + (completedMode === "manual" ? 1 : 0);

  state.restoreMode = completedMode;
  state.restoreReason = completedReason;
  state.lastRestoreSuccessAt = now;
  state.lastRestoreStatus = "success";
  state.lastRestoreUrl = state.lastUsefulUrl;
  state.sessionRestoreCount = (state.sessionRestoreCount || 0) + 1;

  const portal = await getPortal(state.portalOrigin);
  if (portal) {
    await updatePortal(state.portalOrigin, {
      restoreCount: (portal.restoreCount || 0) + 1,
      lastRestoreAt: now,
      lastSeenAt: now
    });
  }

  const stats = await getStats();
  if (state.restoreMode === "manual") stats.totalManualRestores += 1;
  else stats.totalAutomaticRestores += 1;
  stats.lastSuccessfulRestoreAt = now;
  stats.lastSuccessfulRestoreOrigin = state.portalOrigin;
  await chrome.storage.local.set({ [STATS_KEY]: stats });

  await appendDebug(state.tabId, "restore_success", state.lastUsefulUrl, {
    mode: state.restoreMode,
    reason: state.restoreReason,
    attempts: attemptCount
  });
}

async function saveCandidateUrl(tabId, rawUrl) {
  const inspected = R.inspectUnknownUrl(rawUrl);
  if (!inspected.url || !inspected.isCandidateApp) return;
  const state = await getState(tabId);
  state.candidateOrigin = inspected.origin;
  state.candidateUsefulUrl = R.canonical(rawUrl);
  state.candidateAt = Date.now();
  state.lastObservedUrl = rawUrl;
  await putState(state);
}

async function promoteCandidate(state, origin) {
  state.portalOrigin = origin;
  if (state.candidateOrigin === origin && state.candidateUsefulUrl) {
    state.lastUsefulUrl = state.candidateUsefulUrl;
    state.lastUsefulAt = state.candidateAt || Date.now();
  }
  state.candidateOrigin = null;
  state.candidateUsefulUrl = null;
  state.candidateAt = null;
  await putState(state);
  return state;
}

async function resolvePortalForNavigation(tabId, rawUrl) {
  const inspected = R.inspectUnknownUrl(rawUrl);
  if (!inspected.url) return { portal: null, state: await getState(tabId), inspected };

  let state = await getState(tabId);
  const existing = await getPortal(inspected.origin);

  if (existing) {
    if (!existing.enabled) return { portal: existing, state, inspected };
    if (state.portalOrigin !== inspected.origin) state = await promoteCandidate(state, inspected.origin);
    return { portal: existing, state, inspected };
  }

  let portal = null;
  if (inspected.isStandardPortal) {
    portal = await ensurePortal(inspected.origin, "standard_freshservice_domain", "high");
  } else if (inspected.isHighConfidenceApp) {
    portal = await ensurePortal(inspected.origin, "freshservice_route_signature", "high");
  } else if (inspected.isStrongAuthSignal) {
    portal = await ensurePortal(inspected.origin, "freshid_auth_signature", "very_high");
  } else if (inspected.isWeakAuthSignal && state.candidateOrigin === inspected.origin) {
    portal = await ensurePortal(inspected.origin, "auth_route_plus_app_context", "high");
  }

  if (portal) state = await promoteCandidate(state, inspected.origin);
  return { portal, state, inspected };
}

function isRedirectedNavigation(details) {
  const qualifiers = Array.isArray(details.transitionQualifiers) ? details.transitionQualifiers : [];
  return qualifiers.includes("server_redirect") || qualifiers.includes("client_redirect");
}

function isConfirmationEvent(sourceEvent) {
  return sourceEvent === "committed" || sourceEvent === "history_state";
}

async function saveUsefulUrl(tabId, rawUrl, portalOrigin, reason) {
  const url = R.canonical(rawUrl, portalOrigin);
  if (!url) return;

  const state = await getState(tabId);
  state.portalOrigin = portalOrigin;
  state.lastUsefulUrl = url;
  state.lastUsefulAt = Date.now();
  state.lastObservedUrl = url;
  state.phase = "normal";
  state.pendingRestore = false;
  state.pendingSince = null;
  state.recoveryEligible = false;
  state.recoveryCause = null;
  state.externalAuthObservedAt = null;
  state.restoreAttempts = 0;
  state.restoringUrl = null;
  state.restoreMode = null;
  state.restoreReason = null;
  state.restoreRequestedAt = null;
  state.automaticAttemptCount = 0;
  state.recoveryAttemptMode = null;
  state.recoveryAttemptReason = null;
  state.waitingDebugLogged = false;
  state.lastReason = reason;
  await putState(state);
  await updatePortal(portalOrigin, { lastSeenAt: Date.now() });
  await appendDebug(tabId, "remember", url, reason);
}

async function markSessionLost(tabId, rawUrl, portalOrigin, reason) {
  let state = await getState(tabId);
  if (state.portalOrigin !== portalOrigin) state = await promoteCandidate(state, portalOrigin);

  const wasPending = state.pendingRestore;

  if (state.pendingRestore && state.phase === "restoring") {
    state.restoreAttempts = 0;
    state.restoringUrl = null;
    state.restoreMode = null;
    state.restoreReason = null;
    state.restoreRequestedAt = null;
    state.lastRestoreStatus = "waiting_for_auth";
  }

  if (!state.lastUsefulUrl) {
    if (!wasPending) await appendDebug(tabId, "logout_without_saved_context", rawUrl, reason);
    return state;
  }

  state.pendingRestore = true;
  state.pendingSince = state.pendingSince || Date.now();
  state.recoveryEligible = true;
  state.recoveryCause = state.recoveryCause || reason;
  if (!wasPending) state.waitingDebugLogged = false;
  state.phase = "auth_lost";
  state.lastObservedUrl = rawUrl;
  state.lastReason = reason;
  await putState(state);

  if (!wasPending) {
    await appendDebug(tabId, "auth_lost", rawUrl, {
      reason,
      saved: state.lastUsefulUrl,
      portal: portalOrigin
    });
  }

  return state;
}

async function clearPending(state, reason, currentUrl) {
  state.pendingRestore = false;
  state.pendingSince = null;
  state.recoveryEligible = false;
  state.recoveryCause = null;
  state.externalAuthObservedAt = null;
  state.restoreAttempts = 0;
  state.restoringUrl = null;
  state.restoreMode = null;
  state.restoreReason = null;
  state.restoreRequestedAt = null;
  state.automaticAttemptCount = 0;
  state.recoveryAttemptMode = null;
  state.recoveryAttemptReason = null;
  state.waitingDebugLogged = false;
  state.phase = "normal";
  state.lastObservedUrl = currentUrl || state.lastObservedUrl;
  state.lastReason = reason;
  await putState(state);
  await appendDebug(state.tabId, "pending_cleared", currentUrl, reason);
}

async function waitForAuthentication(state, rawUrl, reason) {
  const shouldLogWaiting = !state.waitingDebugLogged;

  if (state.restoringUrl || state.phase === "restoring") {
    state.restoreAttempts = 0;
    state.restoringUrl = null;
    state.restoreMode = null;
    state.restoreReason = null;
    state.restoreRequestedAt = null;
  }

  state.phase = "waiting_for_auth";
  state.lastObservedUrl = rawUrl;
  state.lastReason = reason;
  state.lastRestoreStatus = "waiting_for_auth";
  if (shouldLogWaiting) state.waitingDebugLogged = true;
  await putState(state);

  if (shouldLogWaiting) {
    await appendDebug(state.tabId, "waiting_for_auth", rawUrl, {
      reason,
      saved: state.lastUsefulUrl
    });
  }
}

async function observeExternalAuthentication(tabId, rawUrl, sourceEvent) {
  let state = await getState(tabId);
  if (!state.portalOrigin || !state.lastUsefulUrl) return false;

  const portal = await getPortal(state.portalOrigin);
  if (!portal || !portal.enabled) return false;

  if (!state.pendingRestore || state.phase === "restoring") {
    await markSessionLost(tabId, rawUrl, state.portalOrigin, "external_freshworks_auth");
    state = await getState(tabId);
  }

  state.externalAuthObservedAt = Date.now();
  await putState(state);
  await waitForAuthentication(state, rawUrl, sourceEvent === "committed" ? "external_freshworks_auth" : "external_auth_navigation");
  return true;
}

async function restoreTab(state, reason, force = false) {
  if (!state.lastUsefulUrl || !state.portalOrigin) return { ok: false, reason: "no_saved_url" };

  if (state.phase === "restoring" && state.restoringUrl) {
    return { ok: false, reason: "restore_in_progress" };
  }

  const portal = await getPortal(state.portalOrigin);
  if (!portal || !portal.enabled) return { ok: false, reason: "portal_disabled" };

  if (!force && !state.recoveryEligible) {
    return { ok: false, reason: "not_recovery_eligible" };
  }

  if (!force && state.restoreAttempts >= MAX_RESTORE_ATTEMPTS) {
    return { ok: false, reason: "max_restore_attempts" };
  }

  state.pendingRestore = true;
  state.pendingSince = state.pendingSince || Date.now();
  state.phase = "restoring";
  state.restoreAttempts += 1;
  state.restoringUrl = state.lastUsefulUrl;
  state.restoreMode = force ? "manual" : "automatic";
  state.restoreReason = reason;
  state.restoreRequestedAt = Date.now();
  state.recoveryAttemptMode = force ? "manual" : "automatic";
  state.recoveryAttemptReason = reason;
  state.lastRestoreStatus = "pending";
  state.lastReason = reason;
  if (!force) state.automaticAttemptCount = (state.automaticAttemptCount || 0) + 1;
  await putState(state);

  if (force) {
    await appendDebug(state.tabId, "restore", state.lastUsefulUrl, { reason, force: true });
  }

  try {
    await chrome.tabs.update(state.tabId, { url: state.lastUsefulUrl });
    return { ok: true, url: state.lastUsefulUrl };
  } catch (error) {
    state.phase = "restore_failed";
    state.lastRestoreStatus = "failed";
    state.lastReason = String(error?.message || error);
    await putState(state);
    await appendDebug(state.tabId, "restore_failed", state.lastUsefulUrl, state.lastReason);
    return { ok: false, reason: state.lastReason };
  }
}

async function getRecoverableStatesForOrigin(origin) {
  const states = await getAllTabStates();
  return states.filter((state) =>
    state.portalOrigin === origin &&
    state.pendingRestore === true &&
    state.recoveryEligible === true &&
    Boolean(state.lastUsefulUrl) &&
    state.phase !== "restoring"
  );
}

async function restorePendingTabsForOrigin(origin) {
  if (authRecoveryInFlight.has(origin)) return;
  authRecoveryInFlight.add(origin);

  try {
    const states = await getRecoverableStatesForOrigin(origin);
    for (const state of states) {
      await restoreTab(state, "portal_auth_confirmed");
    }
  } finally {
    authRecoveryInFlight.delete(origin);
  }
}

async function schedulePortalRecovery(origin, sourceTabId, sourceUrl, reason) {
  if (!origin || authRecoveryTimers.has(origin) || authRecoveryInFlight.has(origin)) return;

  const recoverable = await getRecoverableStatesForOrigin(origin);
  if (!recoverable.length) return;

  await appendDebug(-1, "auth_confirmed", sourceUrl, {
    portal: origin,
    reason,
    pendingTabs: recoverable.length,
    sourceTabId
  });

  const timer = setTimeout(() => {
    authRecoveryTimers.delete(origin);
    void restorePendingTabsForOrigin(origin);
  }, AUTH_STABILIZATION_MS);

  authRecoveryTimers.set(origin, timer);
}

function isPositiveAuthenticationSignal(state, classified, details, sourceEvent) {
  if (!isConfirmationEvent(sourceEvent)) return false;
  if (classified.isAuthConfirmedSurface) return true;

  return Boolean(
    state.pendingRestore &&
    state.externalAuthObservedAt &&
    sourceEvent === "committed" &&
    isRedirectedNavigation(details) &&
    classified.isPortal &&
    !classified.isLogout
  );
}

async function handleBeforeNavigate(details) {
  if (details.frameId !== 0) return;
  const resolved = await resolvePortalForNavigation(details.tabId, details.url);
  const { portal, state, inspected } = resolved;

  if (inspected.isExternalAuthSurface) {
    await observeExternalAuthentication(details.tabId, details.url, "before_navigate");
    return;
  }

  if (!portal) {
    if (inspected.isCandidateApp) await saveCandidateUrl(details.tabId, details.url);
    return;
  }
  if (!portal.enabled) return;

  const c = R.classifyPortalUrl(details.url, portal.origin);
  if (!c.isPortal) return;

  if (c.isLogout) {
    await markSessionLost(details.tabId, details.url, portal.origin, "freshid_logout");
    return;
  }

  if (!state.pendingRestore) return;
  if (c.isAuthSurface || c.isIntermediate) {
    await waitForAuthentication(state, details.url, "auth_navigation");
  }
}

async function handlePortalNavigation(details, sourceEvent) {
  if (details.frameId !== 0) return;
  const resolved = await resolvePortalForNavigation(details.tabId, details.url);
  const { portal, inspected } = resolved;

  if (inspected.isExternalAuthSurface) {
    await observeExternalAuthentication(details.tabId, details.url, sourceEvent);
    return;
  }

  if (!portal) {
    if (inspected.isCandidateApp) await saveCandidateUrl(details.tabId, details.url);
    return;
  }
  if (!portal.enabled) return;

  const c = R.classifyPortalUrl(details.url, portal.origin);
  if (!c.isPortal) return;

  if (c.isLogout) {
    await markSessionLost(details.tabId, details.url, portal.origin, `${sourceEvent}:freshid_logout`);
    return;
  }

  let state = await getState(details.tabId);
  if (state.portalOrigin !== portal.origin) state = await promoteCandidate(state, portal.origin);

  if (
    !state.pendingRestore &&
    state.lastUsefulUrl &&
    sourceEvent === "committed" &&
    c.isAuthSurface &&
    isRedirectedNavigation(details)
  ) {
    await markSessionLost(details.tabId, details.url, portal.origin, "redirected_to_auth_surface");
    state = await getState(details.tabId);
  }

  if (!state.pendingRestore) {
    if (c.isUseful) {
      await saveUsefulUrl(details.tabId, details.url, portal.origin, sourceEvent);
      state = await getState(details.tabId);
    }

    if (isPositiveAuthenticationSignal(state, c, details, sourceEvent)) {
      await schedulePortalRecovery(portal.origin, details.tabId, details.url, "authenticated_app_navigation");
    }
    return;
  }

  if (c.isUseful && R.isExactSameDestination(details.url, state.lastUsefulUrl)) {
    state.lastUsefulUrl = R.canonical(details.url, portal.origin);
    state.lastUsefulAt = Date.now();

    if (
      (state.restoringUrl && R.isExactSameDestination(details.url, state.restoringUrl)) ||
      state.recoveryAttemptMode
    ) {
      await recordSuccessfulRestore(state);
      await clearPending(state, "extension_restore_success", details.url);
    } else {
      await clearPending(state, "native_exact_restore", details.url);
    }

    await schedulePortalRecovery(portal.origin, details.tabId, details.url, "context_restored");
    return;
  }

  const returnedFromExternalAuth = Boolean(
    state.externalAuthObservedAt &&
    sourceEvent === "committed" &&
    isRedirectedNavigation(details) &&
    !c.isLogout
  );

  if (returnedFromExternalAuth) {
    state.externalAuthObservedAt = null;
    await putState(state);
    await schedulePortalRecovery(portal.origin, details.tabId, details.url, "returned_from_external_auth");
    return;
  }

  if (isPositiveAuthenticationSignal(state, c, details, sourceEvent)) {
    await schedulePortalRecovery(portal.origin, details.tabId, details.url, "authenticated_app_navigation");
    return;
  }

  if (c.isAuthSurface || c.isIntermediate) {
    await waitForAuthentication(state, details.url, sourceEvent);
    return;
  }

  // While recovery is pending, a different page must never replace the saved
  // context. Only a confirmed authentication signal may release restoration.
  state.lastObservedUrl = details.url;
  await putState(state);
}

const httpsFilter = { url: [{ schemes: ["https"] }] };

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => void handleBeforeNavigate(details).catch((error) => appendDebug(details.tabId, "handler_error", details.url, String(error))),
  httpsFilter
);

chrome.webNavigation.onCommitted.addListener(
  (details) => void handlePortalNavigation(details, "committed").catch((error) => appendDebug(details.tabId, "handler_error", details.url, String(error))),
  httpsFilter
);

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => void handlePortalNavigation(details, "history_state").catch((error) => appendDebug(details.tabId, "handler_error", details.url, String(error))),
  httpsFilter
);

chrome.webNavigation.onReferenceFragmentUpdated.addListener(
  (details) => void handlePortalNavigation(details, "fragment_updated").catch((error) => appendDebug(details.tabId, "handler_error", details.url, String(error))),
  httpsFilter
);

chrome.tabs.onRemoved.addListener((tabId) => void removeState(tabId));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[PORTALS_KEY]) portalCache = changes[PORTALS_KEY].newValue || {};
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "inspect-current-tab" && Number.isInteger(message.tabId)) {
    void (async () => {
      try {
        const frame = await chrome.webNavigation.getFrame({ tabId: message.tabId, frameId: 0 });
        if (!frame?.url || !R.parseHttpsUrl(frame.url)) {
          sendResponse({ ok: false, reason: "no_https_frame" });
          return;
        }
        await handlePortalNavigation(
          { tabId: message.tabId, frameId: 0, url: frame.url },
          "popup_inspection"
        );
        sendResponse({ ok: true, url: frame.url });
      } catch (error) {
        sendResponse({ ok: false, reason: String(error?.message || error) });
      }
    })();
    return true;
  }

  if (message.type === "restore-now" && Number.isInteger(message.tabId)) {
    void (async () => sendResponse(await restoreTab(await getState(message.tabId), "manual_restore", true)))();
    return true;
  }

  if (message.type === "clear-tab-state" && Number.isInteger(message.tabId)) {
    void (async () => {
      await removeState(message.tabId);
      await appendDebug(message.tabId, "state_cleared", null, "manual");
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "clear-debug-log") {
    void (async () => {
      await chrome.storage.session.set({ [DEBUG_KEY]: [] });
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "add-portal") {
    void (async () => {
      const origin = R.normalizeOrigin(String(message.url || "").trim());
      if (!origin) return sendResponse({ ok: false, reason: "invalid_https_url" });
      const portal = await ensurePortal(origin, "manual", "manual");
      sendResponse({ ok: true, portal });
    })();
    return true;
  }

  if (message.type === "set-portal-enabled") {
    void (async () => {
      const origin = R.normalizeOrigin(String(message.origin || ""));
      if (!origin) return sendResponse({ ok: false, reason: "invalid_origin" });
      const portal = await setPortalEnabled(origin, Boolean(message.enabled));
      sendResponse({ ok: Boolean(portal), portal });
    })();
    return true;
  }

  if (message.type === "remove-portal") {
    void (async () => {
      const origin = R.normalizeOrigin(String(message.origin || ""));
      if (!origin) return sendResponse({ ok: false, reason: "invalid_origin" });
      await removePortal(origin);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

void appendDebug(-1, "service_worker_started", null, { version: VERSION });
