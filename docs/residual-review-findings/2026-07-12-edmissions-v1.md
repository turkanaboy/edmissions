# Accepted residual review findings — EDMissions v1

From the multi-agent code review of `feat/edmissions-v1` (run 20260712-182511-e5a58890).
All P0/P1 and the material P2 findings were fixed in commit `fix(review): …`. The items
below were consciously accepted as low-severity or negligible-at-scale for a two-user
personal deployment. Recorded here so they aren't lost with the session.

| # | Sev | Location | Finding | Why accepted |
|---|-----|----------|---------|--------------|
| 1 | P2 | public/js/notes.js | A slow save/summarize that resolves after the editor is closed and a new draft opened can overwrite the new draft's state. | Same class as the fixed races but far narrower trigger (requires a slow AI call + specific close/reopen timing). Add an editor session token if it ever bites. |
| 2 | P3 | public/js/campaigns.js | Campaign form fields stay editable during an in-flight submit; completion navigates to the result view. | Cosmetic; the buttons already disable during submit. |
| 3 | P3 | server/routes/music.js | `/api/music/local/:idx` re-scans the folder per request, so adding/removing files mid-session shifts indices (TOCTOU). | Local library is expected to be static; a page reload resyncs. |
| 4 | P3 | server/routes/music.js, server/auth.js | `trackCache` and the rate-limit `attempts` Map are process-lifetime (attempts now self-evicts expired entries; trackCache does not). | Negligible growth at two-user scale. |
| 5 | P3 | server/anthropic.js | No explicit per-request timeout; relies on the SDK default (10 min, 2 retries). | Gated feature, two users; a hung call surfaces as a 502 eventually. Add `AbortSignal` if latency matters. |
| 6 | P3 | server/config.js | `EDMISSIONS_FEED_POLL_MINUTES` isn't validated for NaN/negative. | Misconfiguration self-limits via the in-flight guard; Node clamps the interval. |
| 7 | — | server/routes/campaigns.js, tasks.js | `campaignRoutes()`/`taskRoutes()` singularize the stem while the other route factories match the plural filename. | Cosmetic naming; no functional impact, no codified standard. |

Testing gaps left open (documented, not blocking): no browser/jsdom harness for `public/js/*`
(client races verified manually + via live browser this session); `server/anthropic.js` real
SDK path is stubbed in tests; session HMAC tamper/expiry rejection paths untested.
