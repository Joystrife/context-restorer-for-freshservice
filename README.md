# Context Restorer for Freshservice

**Current version: v0.2.2 (public beta)**

Context Restorer for Freshservice is a lightweight browser extension that restores the Freshservice page a user was working on after session expiry and reauthentication.

## Why it exists

Freshservice reauthentication can sometimes return users to a generic home page or dashboard instead of the page they were using before the session expired. The extension preserves that navigation context locally and restores the previous Freshservice page once authentication succeeds.

## Key features

- Automatic Freshservice portal detection
- Support for multiple Freshservice portals and custom domains
- Per-tab context restoration
- Automatic restoration after FreshID / SSO reauthentication
- Manual restore fallback
- Portal enable/disable controls
- Local restoration counters and status
- No session extension or authentication bypass
- No credential, cookie, token, ticket-content or form-content access
- Local browser storage only
- No external telemetry or analytics

## Source code

The Chrome/Chromium extension source for the current version is available in:

[`/extension`](./extension)

The `main` branch contains **v0.2.2**, including long-idle recovery, Freshservice Login recovery, F5 recovery, per-tab recovery with **Reload All Tabs**, Freshservice workspace/admin route detection, and current-tab detection when the popup is opened.

## Installation for development

1. Clone or download this repository.
2. Open `chrome://extensions` or the equivalent Chromium extension page.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the `extension` folder.

## Privacy

See the public privacy notice:

[Privacy and Security Notice](./privacy.html)

## Version history

See [CHANGELOG.md](./CHANGELOG.md).

## Developer

Developed by **Leo Naloufi**.

Freshservice and Freshworks are trademarks of Freshworks Inc. This is an independent utility and is not affiliated with, sponsored by, or endorsed by Freshworks Inc.
