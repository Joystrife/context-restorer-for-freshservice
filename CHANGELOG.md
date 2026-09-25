# Changelog

## v0.2.1 — Pending restoration fix

### Fixed

- Removed the 30-minute internal expiration applied to a pending restoration after Freshservice session loss.
- A saved Freshservice page now remains eligible for restoration for the lifetime of the browser extension session, including long laptop sleep/idle periods, until the tab is closed, the browser restarts, the extension reloads/updates, the portal is disabled, or the state is cleared.
- Prevents a delayed reauthentication from replacing the saved ticket context with the Freshservice dashboard.


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
