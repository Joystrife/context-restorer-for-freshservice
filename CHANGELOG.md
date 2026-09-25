# Changelog

## v0.2.2 — Workspace and existing-tab detection

### Fixed

- Freshservice workspace routes such as `/ws/<workspace-id>/admin/...` are now recognized as high-confidence Freshservice routes on custom portal domains.
- Admin and workspace pages can therefore be saved as the current tab context, not only ticket-oriented pages.
- On extension/service-worker startup, already-open browser tabs are inspected through `webNavigation` in two passes: first to discover Freshservice portal origins, then to remember every useful page already open on those portals.
- No additional browser permission is required.


## v0.2.1 — Pending restoration fix

### Fixed

- Removed the 30-minute internal expiration applied to a pending restoration after Freshservice session loss.
- A saved Freshservice page now remains eligible for restoration for the lifetime of the browser extension session, including long laptop sleep/idle periods, until the tab is closed, the browser restarts, the extension reloads/updates, the portal is disabled, or the state is cleared.
- Prevents a delayed reauthentication from replacing the saved ticket context with the Freshservice dashboard.
- Reloading `/support/home` while a restore is pending now retries the saved Freshservice page.
- If that retry reaches FreshID because authentication is still unavailable, the saved context remains armed for the next login instead of being blocked.
- Duplicate restore events are ignored while a restore is already in progress.
- Browser-wide or third-party **Reload All Tabs** actions are handled tab by tab: every pending Freshservice tab retries its own saved context independently.
- Clicking Freshservice **Login** while a restore is pending preserves the saved context through authentication; if Freshservice returns to a dashboard/home fallback, the tab is restored to its saved page.


## v0.2.0 — Public beta

Initial generic multi-company version prepared for Chrome Web Store submission.

### Added

- Automatic detection of standard `*.freshservice.com` portals
- Automatic detection of Freshservice custom/vanity domains through Freshservice route signatures and FreshID authentication behavior
- Multi-portal registry
- Per-tab navigation context storage
- Automatic restoration after Freshservice session expiry and reauthentication
- Manual **Restore now** fallback
- Portal enable/disable and removal controls
- Local restoration statistics
- Last successful restoration indicator
- Recent local debug log
- Developer attribution: Leo Naloufi
- Generic Freshservice branding suitable for multi-company use

### Privacy and security

- No cookie access
- No password or credential access
- No SAML, OAuth, Entra ID or Freshworks token access
- No Freshservice ticket-content inspection
- No external telemetry or analytics
- No external network requests performed by the extension
- Session-specific page URLs stored in browser session storage
- Portal registry and non-content restoration statistics stored locally

### Validation

The restoration mechanism was validated against a real Freshservice session-expiration flow. The extension detected the FreshID logout, preserved the previous Freshservice context, waited through reauthentication, and restored the original page after Freshservice returned to a generic fallback page.
