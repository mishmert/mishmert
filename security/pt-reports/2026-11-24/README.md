# Weekly PT Report — 2026-11-24 (Engagement 2026-W48)

**Executive summary.** 16 findings. One new CRITICAL (`MSH-202647-001`) and one new HIGH (`MSH-202647-002`), both regressions from last week's partial remediations. 8 of 14 2026-W47 findings are confirmed resolved.

## Highest severity

| ID | Sev | CVSS | Title | Fix in |
|---|---|---|---|---|
| `MSH-202647-001` | CRITICAL | 9.1 | `_internal_cron_headers()` grants EXECUTE to `anon` — discloses internal cron secret, bypasses rapid-action auth gate | 24h |
| `MSH-202647-002` | HIGH | 6.3 | Admin MFA-reset feature broken — client still calls retired `admin---reset---mfa` slug | 24h |

## Files
- `mishmert-pt-report-2026-11-24.pdf` — full report (48 pages)
- `findings.json` — machine-readable findings (used for next week's diff)

## Posture: **D** (was **C** last week)

The two new regressions outweigh this week's eight remediation wins. Both are easily fixed:
1. `REVOKE EXECUTE ON FUNCTION public._internal_cron_headers() FROM anon, authenticated, PUBLIC;` and rotate `internal_cron_secret`.
2. Change one string in `index.html:9448` from `"admin---reset---mfa"` to `"admin-reset-mfa"`.

See the PDF for full remediation guidance.

## Addendum (2026-11-24 12:35 UTC)

**MSH-202647-002 was remediated during the engagement window.** Commit `a3c2f28` (2026-11-24 10:14 UTC) updated `index.html` to call the clean `admin-reset-mfa` slug, and the triple-hyphen stub at the `admin---reset---mfa` slug was re-populated (v4) with the real MFA-reset logic so cached clients continue to work. The PDF is a point-in-time snapshot (data collected 10:11 UTC) and remains the authoritative deliverable; `findings.json` has been updated so next week's diff treats this finding as `fixed_during_engagement`.

**MSH-202647-001 (CRITICAL) was re-verified at 12:34 UTC and is still live** — `anon` still has EXECUTE on `public._internal_cron_headers()`, so the secret-disclosure chain described in the PDF is still exploitable. Fix per the PDF's §MSH-202647-001 remediation section.
