# Changelog

## v0.2.4 — Authentication-aware recovery

### Fixed

- Pending Freshservice contexts now wait passively while authentication is unavailable. Freshservice home/login/FreshID/fallback pages no longer trigger automatic navigation back to the saved page.
- Removed the automatic retry loop/cooldown behavior introduced in v0.2.3. Reloading a waiting authentication page no longer forces a restore attempt.
- Added explicit recovery eligibility per tab. Only tabs that actually lost their context through a session/authentication redirect are automatically restored.
- Tabs that remain intact, including workflow editors or in-progress forms that were not redirected, are left untouched.
- Added support for external Freshworks authentication pages matching `*.myfreshworks.com/org/login`. These pages preserve the original Freshservice portal association and saved context.
- A successful navigation to an authenticated Freshservice application route confirms authentication for that portal.
- A context that is restored natively or manually in one tab also confirms authentication for that portal and can release the other pending tabs.
- Authentication confirmation is scoped to the Freshservice portal origin. A successful login on one portal does not automatically restore pending tabs belonging to another portal.
- After authentication is confirmed, the extension waits approximately 1.5 seconds for the session to stabilize, then restores only eligible pending tabs to their own saved URLs.
- Technical authentication/fallback pages never replace `lastUsefulUrl`.
- Shared debug now records a single `auth_confirmed` event for the portal, followed by per-tab restore results.

### Privacy and permissions

- No cookie permission added.
- No host permission added.
- No token inspection.
- No Freshservice/Freshworks authentication API polling.
- Existing permissions remain limited to `storage` and `webNavigation`.

### Behavior

- **Restore now** remains an explicit manual fallback and may intentionally trigger the normal SSO flow if authentication is still unavailable.
- A normal refresh while waiting for authentication preserves the saved context but does not force navigation.
- External Freshworks errors such as `error=bad_credentials` keep the tab in `waiting_for_auth` until a later positive authentication signal is observed.

## v0.2.3 — Fully automatic authentication recovery

### Fixed

- Pending Freshservice contexts now restore automatically from authentication and fallback waiting states without requiring the user to click **Restore now**, refresh the page, or use the browser Back button.
- `/support/home`, `/support/login`, `/freshid/...`, `/`, `/a/dashboard`, and `/helpdesk/dashboard` are treated as technical/authentication/fallback surfaces and are never stored as the useful restore destination.
- Freshservice home/login/dashboard recovery surfaces now actively retry the saved page when a restore is pending.
- Automatic retry uses a 2-second cooldown and remains event-driven; the extension does not poll in the background.
- Explicit F5 / Reload All Tabs remains an immediate retry trigger for each pending tab.
- If an automatic restore reaches authentication again, the saved context remains armed until authentication succeeds.
- Redirects to Freshservice authentication surfaces can arm recovery even when a session-expiry path does not expose `/freshid/logout`.
- Automatic retry attempts are kept quiet in the debug log. The log focuses on meaningful state changes, successful restores, manual restore requests, and real failures.
- Successful restore debug entries include the number of attempts used during the recovery cycle.

### Behavior

- **Restore now** remains available as a manual fallback. It does not bypass SSO; it simply forces an immediate navigation to the saved Freshservice page and lets the normal authentication flow run if required.
- Native Freshservice deep-link restoration is still accepted: when Freshservice itself returns directly to the saved page, the pending context is cleared without an unnecessary second navigation.
- Functional Freshservice pages such as `/ws/<workspace-id>/admin/home` remain valid restore destinations.

## v0.2.2 — Workspace and existing-tab detection

### Fixed

- Freshservice workspace routes such as `/ws/<workspace-id>/admin/...` are now recognized as high-confidence Freshservice routes on custom portal domains.
- Admin and workspace pages can therefore be saved as the current tab context, not only ticket-oriented pages.
- When the popup is opened, the current tab is inspected through `webNavigation`, allowing a Freshservice page that was already open before installation/reload to be detected immediately.
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
