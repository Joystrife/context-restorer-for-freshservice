(() => {
  "use strict";

  const FRESHSERVICE_SUFFIX = ".freshservice.com";
  const MYFRESHWORKS_SUFFIX = ".myfreshworks.com";

  function parseHttpsUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:") return null;
      return url;
    } catch {
      return null;
    }
  }

  function normalizeOrigin(rawUrl) {
    const url = parseHttpsUrl(rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`);
    return url ? url.origin : null;
  }

  function hasPrefix(pathname, prefix) {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  }

  function isStandardFreshserviceHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host.endsWith(FRESHSERVICE_SUFFIX) && host.length > FRESHSERVICE_SUFFIX.length;
  }

  function isMyFreshworksHost(hostname) {
    const host = String(hostname || "").toLowerCase();
    return host === "myfreshworks.com" || host.endsWith(MYFRESHWORKS_SUFFIX);
  }

  function isExternalFreshworksAuthUrl(rawUrl) {
    const url = parseHttpsUrl(rawUrl);
    if (!url || !isMyFreshworksHost(url.hostname)) return false;
    return hasPrefix(url.pathname, "/org/login");
  }

  function isFreshIdPath(pathname) {
    return hasPrefix(pathname, "/freshid");
  }

  function isStrongAuthPath(pathname) {
    return hasPrefix(pathname, "/freshid/logout") || hasPrefix(pathname, "/freshid/authorize_callback");
  }

  function isLogoutPath(pathname) {
    return hasPrefix(pathname, "/freshid/logout");
  }

  function isAuthSurfacePath(pathname) {
    return (
      isFreshIdPath(pathname) ||
      hasPrefix(pathname, "/support/login") ||
      pathname === "/support/home" ||
      pathname === "/support/home/"
    );
  }

  function isIntermediatePath(pathname) {
    return (
      pathname === "/" ||
      hasPrefix(pathname, "/helpdesk/dashboard") ||
      pathname === "/a/dashboard" ||
      pathname === "/a/dashboard/"
    );
  }

  function isFallbackAfterAuthPath(pathname) {
    return (
      pathname === "/a/dashboard" ||
      pathname === "/a/dashboard/" ||
      hasPrefix(pathname, "/helpdesk/dashboard") ||
      pathname === "/"
    );
  }

  function isHighConfidenceFreshservicePath(pathname) {
    return (
      /^\/ws\/\d+(?:\/|$)/.test(pathname) ||
      /^\/a\/tickets\/\d+(?:\/|$)/.test(pathname) ||
      /^\/a\/problems\/\d+(?:\/|$)/.test(pathname) ||
      /^\/a\/changes\/\d+(?:\/|$)/.test(pathname) ||
      /^\/a\/releases\/\d+(?:\/|$)/.test(pathname) ||
      /^\/a\/assets(?:\/|$)/.test(pathname) ||
      /^\/a\/requesters(?:\/|$)/.test(pathname) ||
      /^\/a\/admin(?:\/|$)/.test(pathname) ||
      pathname === "/a/dashboard" ||
      pathname === "/a/dashboard/"
    );
  }

  function isAuthenticatedAppPath(pathname) {
    return (
      isHighConfidenceFreshservicePath(pathname) ||
      hasPrefix(pathname, "/helpdesk/dashboard")
    );
  }

  function isCandidateFreshservicePath(pathname) {
    return (
      pathname === "/a" ||
      pathname.startsWith("/a/") ||
      hasPrefix(pathname, "/support/tickets") ||
      hasPrefix(pathname, "/support/requests") ||
      hasPrefix(pathname, "/support/catalog") ||
      hasPrefix(pathname, "/support/solutions")
    );
  }

  function inspectUnknownUrl(rawUrl) {
    const url = parseHttpsUrl(rawUrl);
    if (!url) {
      return {
        url: null,
        origin: null,
        isStandardPortal: false,
        isStrongAuthSignal: false,
        isLogout: false,
        isWeakAuthSignal: false,
        isExternalAuthSurface: false,
        isHighConfidenceApp: false,
        isCandidateApp: false
      };
    }

    const p = url.pathname;
    const isTechnicalContext = isAuthSurfacePath(p) || isIntermediatePath(p);

    return {
      url,
      origin: url.origin,
      isStandardPortal: isStandardFreshserviceHost(url.hostname),
      isStrongAuthSignal: isStrongAuthPath(p),
      isLogout: isLogoutPath(p),
      isWeakAuthSignal:
        hasPrefix(p, "/support/login") ||
        p === "/support/home" ||
        p === "/support/home/" ||
        hasPrefix(p, "/helpdesk/dashboard"),
      isExternalAuthSurface: isExternalFreshworksAuthUrl(rawUrl),
      isHighConfidenceApp: isHighConfidenceFreshservicePath(p),
      isCandidateApp: isCandidateFreshservicePath(p) && !isTechnicalContext
    };
  }

  function classifyPortalUrl(rawUrl, portalOrigin) {
    const url = parseHttpsUrl(rawUrl);
    if (!url || url.origin !== portalOrigin) {
      return {
        isPortal: false,
        isUseful: false,
        isTechnical: false,
        isLogout: false,
        isAuthSurface: false,
        isFallbackAfterAuth: false,
        isIntermediate: false,
        isAuthConfirmedSurface: false,
        url: null
      };
    }

    const p = url.pathname;
    const isLogout = isLogoutPath(p);
    const isAuthSurface = isAuthSurfacePath(p);
    const isIntermediate = isIntermediatePath(p);
    const isTechnical = isAuthSurface || isIntermediate;

    return {
      isPortal: true,
      isUseful: !isTechnical,
      isTechnical,
      isLogout,
      isAuthSurface,
      isFallbackAfterAuth: isFallbackAfterAuthPath(p),
      isIntermediate,
      isAuthConfirmedSurface: isAuthenticatedAppPath(p),
      url
    };
  }

  function canonical(rawUrl, portalOrigin = null) {
    const url = parseHttpsUrl(rawUrl);
    if (!url) return null;
    if (portalOrigin && url.origin !== portalOrigin) return null;
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  }

  function isExactSameDestination(a, b) {
    const ua = parseHttpsUrl(a);
    const ub = parseHttpsUrl(b);
    if (!ua || !ub || ua.origin !== ub.origin) return false;
    return canonical(a) === canonical(b);
  }

  function isSamePath(a, b) {
    const ua = parseHttpsUrl(a);
    const ub = parseHttpsUrl(b);
    return Boolean(ua && ub && ua.origin === ub.origin && ua.pathname === ub.pathname);
  }

  globalThis.ContextRestorerRules = {
    FRESHSERVICE_SUFFIX,
    MYFRESHWORKS_SUFFIX,
    parseHttpsUrl,
    normalizeOrigin,
    isStandardFreshserviceHost,
    isMyFreshworksHost,
    isExternalFreshworksAuthUrl,
    isFreshIdPath,
    isStrongAuthPath,
    isLogoutPath,
    isAuthSurfacePath,
    isIntermediatePath,
    isFallbackAfterAuthPath,
    isHighConfidenceFreshservicePath,
    isAuthenticatedAppPath,
    isCandidateFreshservicePath,
    inspectUnknownUrl,
    classifyPortalUrl,
    canonical,
    isExactSameDestination,
    isSamePath
  };
})();
