# דוח תחזוקה שבועי — 2026-11-26

_מופק אוטומטית ע"י agent התחזוקה. השבוע הראשון שבו מופק הדוח — אין baseline קודם להשוות אליו._

## TL;DR

- אין פגיעויות npm (0 security advisories). שתי חבילות outdated: `@sentry/browser` (patch — נפתח PR אוטומטי) ו-`vite` (major — דורש בדיקה ידנית).
- שני אדמינים עדיין חיים בחלון grace של MFA ללא factor מאומת — galpeer3 ו-elitehadaroz. ממשיך את ה-backlog שנפתח ב-PT 2026-11-25.
- Advisor security חדש: הפונקציה הטריגרית `prevent_self_mfa_grace_extension()` חשופה ל-RPC גם ל-anon וגם ל-authenticated. צריך `REVOKE EXECUTE` — זו פונקציה שאמורה לרוץ רק כטריגר.
- בריאות DB תקינה: 0 חופשות או swaps תקועים, גדלי טבלאות סבירים (schedules הכי גדולה, 752KB).
- CI יציב: 50/59 ריצות הצליחו ב-7 ימים (85%); רוב הכשלים מרפקטור Phase 7 של 2026-11-24/25.

## נדרשת פעולה

| פריט | פרטים | דחיפות |
| --- | --- | --- |
| MSH-202646-001 follow-up | `galpeer3@gmail.com` (נרשם 2026-05-13) ו-`elitehadaroz@gmail.com` (נרשם 2026-06-14) עדיין בלי MFA factor מאומת. הטריגר החדש חוסם כבר הארכה עצמית, אבל ה-grace שלהם צריך reset ידני דרך ה-admin function אחרי שהם ירשמו ל-MFA. | MED |
| Advisor חדש | `public.prevent_self_mfa_grace_extension()` נגיש ל-anon ול-authenticated דרך `/rest/v1/rpc/`. זו פונקציית טריגר ללא צורך ב-RPC — יש להריץ `REVOKE EXECUTE ON FUNCTION public.prevent_self_mfa_grace_extension() FROM anon, authenticated;`. | LOW |
| Vite major | `vite` 7.3.8 → 8.4.0 זמין. major bump; דורש בדיקה ידנית של breaking changes. לא נכלל ב-PR האוטומטי. | LOW |
| CSP drift check | הסוכן לא הצליח לאמת את ה-CSP שמוגש מ-Cloudflare (`mishmert.com` חסום ברשת ה-agent). המטה-tag ב-`index.html` נקרא ברפו ותקין (`base-uri 'self'; form-action 'self'; object-src 'none';`). ה-CSP הראשי שמוגש ע"י Cloudflare לא נבדק live. | INFO |

## שינויים מהשבוע הקודם

זה הדוח הראשון — אין baseline קודם. מה-PT האחרון (2026-11-25):

- **נסגר**: MSH-202646-001 (טריגר נוסף), MSH-202646-011 (anon EXECUTE הוסר). שני אלה מאושרים: הטריגר קיים, ו-`is_admin_aal2`/`check_rate_limit` כבר לא מופיעים ב-anon-executable list.
- **עדיין פתוח**: MSH-202646-002 (meta CSP נוסף — מאושר ב-`index.html`), 004 (legacy JWT anon), 005 (HIBP), 003 (CORS v5 של admin---reset---mfa), 006–013.

## Sentry (7 ימים אחרונים)

לא נבדק — אין `SENTRY_AUTH_TOKEN` ב-`.env` של ה-agent, ואין secret זמין לקריאה. כדי להפעיל: להוסיף token קריאה-בלבד לפרויקט לsecret של GitHub Actions ולהזרים ל-agent דרך סביבת ה-run. השבוע לא היו issues דווחו ע"י המשתמשים לפי לוג הפעילות.

## Supabase Advisors

**Security (16 ממצאים, כולם WARN)**:

- **anon-executable SECURITY DEFINER (5)**: `consume_invitation`, `create_business_via_invite`, `validate_business_invite_token`, `validate_invitation_token` — תוכננו להיות נגישים ל-anon עבור קבלת הזמנות ללא login (intentional).
- **`prevent_self_mfa_grace_extension()` — חדש השבוע** (נוצר 2026-11-25 בטריגר). חשוף לגם anon וגם authenticated ללא סיבה — זו פונקציית טריגר. פעולה נדרשת.
- **authenticated-executable SECURITY DEFINER (11)**: `check_rate_limit`, `is_admin`, `is_admin_aal2`, `get_my_business_id`, `publish_initial_schedule`, `set_initial_preview_until`, ועוד invitation-related. רובן תוכננו להיות נגישות ל-authenticated. `is_admin` (ללא AAL2) עלול להיות legacy — לבדוק אם ניתן להסיר.
- **`auth_leaked_password_protection` disabled** — MSH-202646-005 פתוח.

**Performance (20 unused indexes)** — ללא שינוי מ-PT; MSH-202646-007 ממתין לאישור destructive-op.

## בריאות DB

- **MFA grace חלון מסכן**: 2 משתמשים (`galpeer3@gmail.com`, `elitehadaroz@gmail.com`). שניהם אדמינים לפי ה-backlog של PT 2026-11-25.
- **חופשות pending מעל 7 ימים**: 0 ✓
- **Swaps תקועים (pending_manager/pending_peer מעל 3 ימים)**: 0 ✓ (הערה: הטבלה הפעילה לbuilt-in queue היא `swap_requests`, לא `swaps` — ה-query עבד על `swaps` כפי שצוין בפרומפט, ושם אין פריטים תקועים).
- **גדלי טבלאות (top 5)**:
  - `cron.job_run_details`: 3.2 MB (לוג cron מצטבר — אפשר להוסיף רוטציה)
  - `auth.audit_log_entries`: 2.6 MB (מנוהל ע"י Supabase)
  - `auth.refresh_tokens`: 1.7 MB
  - `public.schedules`: 752 KB
  - `public.audit_log`: 584 KB
- **Audit activity השבוע**: 2 auto_schedule, 2 schedule_published_initial, 1 admin_reset_mfa, 1 invitation_sent, 1 schedule_published_final, 1 shift_hours_updated. פעילות תקינה, בלי scripted abuse patterns.

## תלויות (npm)

- **Security advisories**: 0 ✓
- **Patch updates available (auto-PR)**:
  - `@sentry/browser`: 11.17.0 → 11.19.0
- **Major updates (manual review)**:
  - `vite`: 7.3.8 → 8.4.0 — בדוק את ה-release notes של Vite 8 לפני upgrade; יש breaking changes ידועים ב-build config.

## CI

- **סה"כ ריצות 2026-11-19 → 2026-11-26**: 59
- **success**: 50 (85%)
- **failure**: 9
- רוב הכשלים ממוקמים ב-2026-11-24/25 בזמן refactor Phase 7 (ES Modules) ו-smoke suite stabilization. מאז 2026-11-25 12:31 (db6a35e) כל הריצות הצליחו.
- **Deploy אחרון מוצלח**: `737091d` ב-2026-11-25 15:22:45Z — זהה ל-HEAD של `main` → פרוד מעודכן.

## CSP

- **Meta tag ב-`index.html`**: `base-uri 'self'; form-action 'self'; object-src 'none';` — זה הגרסה אחרי MSH-202646-002.
- **CSP ראשי (Cloudflare header)**: לא ניתן היה לאמת live בריצה הזו — `mishmert.com` חסום ברשת ה-agent (403 מה-proxy). נסמן זאת כ-baseline שלא נבדק; בשבוע הבא אם יש שינוי meta CSP, הדוח יסמן אותו.

## מצב deploy

- **Last successful deploy**: 2026-11-25 15:22:45Z
- **Latest commit on main**: `737091dc` ("CLAUDE.md: translate to Hebrew") — אותו SHA
- **Delta**: 0 (פרוד מסונכרן עם main)

## פעולות אוטומטיות שבוצעו

- נפתח PR `chore/deps-weekly-2026-11-26` לעדכון patch של `@sentry/browser`.
- לא בוצעו resolves ב-Sentry (אין גישה).
- לא בוצעו שינויים ב-DB או בפונקציות.
