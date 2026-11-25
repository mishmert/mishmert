# Weekly PT Report — 2026-11-25 (Engagement 2026-W48 re-audit)

**Executive summary.** 13 open findings (0 Critical, 1 High, 4 Medium, 5 Low, 3 Info) vs. last week's 16. The CRITICAL `_internal_cron_headers` disclosure (`MSH-202647-001`) and both HIGHs (`MSH-202648-001` rapid-action unauth relay, `MSH-202648-002` audit_log cross-tenant insert) are **confirmed closed** at the DB grant / RLS / BEFORE-INSERT-trigger level. 12 of the 16 prior findings resolved. One new HIGH takes their place.

## Highest severity

| ID               | Sev  | CVSS | Title                                                                                                            | Fix in |
| ---------------- | ---- | ---- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| `MSH-202646-001` | HIGH | 7.1  | Admin can self-extend `mfa_grace_until` → retains AAL2 without MFA. 4 of 4 live admins currently in this state.  | 24h    |
| `MSH-202646-011` | LOW  | 3.1  | `check_rate_limit()` + `is_admin_aal2()` executable by `anon` → rate-limit poisoning DoS                         | 24h    |

## Posture: **C+** (was **D** last week)

A full-grade improvement: the critical and both highs from last week are closed; six mediums are resolved. The new HIGH is a subtle self-extend that an already-logged-in admin needs to exploit, and the empirical finding "4 of 4 admins have 0 MFA factors" reframes the AAL2 control as advisory in production today. One patch (trigger + MFA enroll) closes this in under two hours.

## Engagement constraint this week

Live DAST against `mishmert.com` could not run — the scheduled-task execution environment denied HTTPS egress to the production hostname, the Supabase host, and the DNS resolver. See `MSH-202646-013` for the probe transcripts and remediation (either allowlist the environment, or run a workstation-side `live-verify.sh` pre-audit). Three carryover findings (HTTP headers, legacy anon key, server-side password minimum) are marked `open_unverified` for this reason.

## Files

- `mishmert-pt-report-2026-11-25.pdf` — full report (41 pages, A4, ≈ 365 KB)
- `findings.json` — machine-readable findings (next week's diff source)

## Resolved since 2026-11-24 (12)

`MSH-202647-001` (CRITICAL cron secret), `-002` (MFA slug), `-003` (global_settings), `-006` (SDK AAL accessor), `-008` (mutable search_path ×3), `-011` (pg_temp), `MSH-202648-001` (rapid-action auth gate), `-002` (audit_log impersonation), `-003` (super-admin RPC grants), `-005` (SRI), `-006` (business_invitations table), `-010` (password min — reclassified to info-unverified).

## Still open (consolidated as MSH-202646-NNN)

`-002` headers (carryover, unverified), `-003` admin---reset---mfa shim CORS wildcard, `-004` legacy anon key (carryover, unverified), `-005` HIBP off, `-006` sr_insert InitPlan, `-007` 20 unused indexes (regression +5), `-008` push_debug_log classification, `-009` SW integrity, `-010` password min (unverified), `-013` live-DAST blocked.

See the PDF for full remediation guidance.
