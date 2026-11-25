"use strict";

// router.js — URL deep-linking, session/auth state machine, and the password-reset view.
//
// Contents:
//  - applyDeepLink()       : reads ?goto=<target> from the URL and navigates to
//                            the matching screen. Role-aware (manager vs employee).
//  - checkAuth()           : the top-level session + 2FA state machine. Routes to
//                            login / mfa_enroll / mfa_challenge / password_reset /
//                            the main app depending on current session + AAL.
//  - viewPasswordReset()   : the one view that must run before loadAll(), because
//                            it lives on the password-reset deep link.
//
// Dependencies at call time: `S`, `sb`, `render()`, `loadAll()`, `toast()`,
// `e`/`div`/`btn`, `validatePassword`, `friendlyError`.


// ══════════════════════════════════════════════════════
// SUPABASE
// ══════════════════════════════════════════════════════
// Reads ?goto=<target> from the URL and navigates to the matching screen.
// Works for both managers and employees (routing differs by role).
import { btn, div, e, friendlyError, toast, uiAlert, validatePassword } from './utils.js';
import { isManager } from './roles.js';
import { S } from './state.js';
import { sb } from './sb.js';
import { render } from './main.js';
import { loadAll } from './data.js';
export function applyDeepLink() {
  let goto = null;
  try {
    const params = new URLSearchParams(window.location.search);
    goto = params.get("goto");
  } catch (e) { return; }
  if (!goto) return;

  const isMgr = (typeof isManager === "function") ? isManager() : (S.profile?.role !== "employee");

  // Map the goto target to the right view/tab for this role
  switch (goto) {
    case "schedule":
      if (isMgr) { S.view = "schedule"; }
      else { S.view = "empview"; S.empViewTab = "schedule"; }
      break;
    case "vacations":
      if (isMgr) { S.view = "vacations"; }
      else { S.view = "empview"; S.empViewTab = "vacation"; }
      break;
    case "swaps":
      if (isMgr) { S.view = "swaps"; }
      else { S.view = "empview"; S.empViewTab = "swaps_emp"; }
      break;
    case "blocks":
      if (isMgr) { S.view = "blocks"; }
      else { S.view = "empview"; S.empViewTab = "avail"; }
      break;
    case "join":
    case "home":
      S.view = isMgr ? "home" : "empview";
      break;
    case "shifts":
      S.view = "empview"; S.empViewTab = "shifts";
      break;
    default:
      break;
  }

  // Clean the URL so a refresh doesn't re-trigger the deep link
  try {
    const clean = window.location.origin + window.location.pathname;
    window.history.replaceState({}, "", clean);
  } catch (e) {}
}

export async function checkAuth() {
  // Check for invitation token in URL
  const params = new URLSearchParams(window.location.search);
  const inviteToken = params.get("invite");
  const bizInviteToken = params.get("biz_invite");

  if (bizInviteToken) {
    const { data, error } = await sb.rpc("validate_business_invite_token", { p_token: bizInviteToken });
    if (error || !data || data.length === 0) {
      await uiAlert({title:"לינק לא תקין", message:"הלינק שהשתמשת בו לא נמצא במערכת.", tone:"danger"});
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      const inv = data[0];
      if (!inv.is_valid) {
        const reasons = {
          invalid_token: "הלינק לא תקין",
          already_used: "ההזמנה כבר נוצלה",
          revoked: "ההזמנה בוטלה",
          expired: "ההזמנה פגה"
        };
        await uiAlert({title:"הזמנה לא תקפה", message:reasons[inv.error_reason] || "ההזמנה לא זמינה יותר.", tone:"danger"});
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        S.pendingBizInvite = { token: bizInviteToken, email: inv.email, note: inv.note };
        S.loginMode = "register";
        S.view = "login";
        render();
        return;
      }
    }
  }

  if (inviteToken) {
    // Validate the token
    const { data, error } = await sb.rpc("validate_invitation_token", { p_token: inviteToken });
    if (error || !data || data.length === 0) {
      await uiAlert({title:"לינק לא תקין", message:"הלינק שהשתמשת בו לא נמצא במערכת.", tone:"danger"});
      window.history.replaceState({}, "", window.location.pathname);
    } else {
      const inv = data[0];
      if (!inv.is_valid) {
        const reasons = {
          invalid_token: "הלינק לא תקין",
          already_used: "ההזמנה כבר נוצלה",
          revoked: "ההזמנה בוטלה",
          expired: "ההזמנה פגה"
        };
        await uiAlert({title:"הזמנה לא תקפה", message:reasons[inv.error_reason] || "ההזמנה לא זמינה יותר.", tone:"danger"});
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        // Valid - show special invitation signup
        S.pendingInvitation = {
          token: inviteToken,
          email: inv.email,
          name: inv.name,
          role: inv.role,
          businessName: inv.business_name
        };
        S.loginMode = "accept_invitation";
        S.view = "login";
        render();
        return;
      }
    }
  }
  
  // Password-reset flow — when the user clicks the link from the "forgot password"
  // email, Supabase creates a recovery session and redirects here with ?reset=true.
  // Previously we just dumped them into loadAll → MFA challenge → login WITHOUT letting
  // them pick a new password. Now we route to a dedicated password-reset view instead.
  const isResetFlow = params.get("reset") === "true" || /[?&#]type=recovery/.test(window.location.href);
  if (isResetFlow) {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      S.view = "password_reset";
      S.resetUserEmail = session.user.email || "";
      // Keep the URL clean so a refresh doesn't re-trigger the flow after they save.
      window.history.replaceState({}, "", window.location.pathname);
      render();
      return;
    }
  }

  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) { S.view="login"; render(); return; }
  await loadAll(session.user);
}

// ═══ PASSWORD RESET VIEW — shown after clicking the email reset link ═══
// User must choose a new password before we take them into the app (and before the
// MFA challenge fires). The recovery session is already AAL1; after the update, we
// let loadAll's MFA gate route them to the authenticator code screen as usual.
export function viewPasswordReset() {
  const wrap = div("app");
  const box = e("div",{style:"max-width:440px;margin:0 auto;padding:40px 24px"});

  box.appendChild(e("div",{style:"text-align:center;margin-bottom:28px"},[
    e("div",{style:"font-size:46px;margin-bottom:12px"},"🔑"),
    e("div",{style:"font-weight:900;font-size:26px;color:#F8FAFC;margin-bottom:8px"},"איפוס סיסמה"),
    e("div",{style:"font-size:13px;color:#94A3B8"},"בחר סיסמה חדשה ל-" + (S.resetUserEmail || "חשבון שלך"))
  ]));

  const card = div("card");
  const p1 = e("input",{class:"fi",type:"password",placeholder:"סיסמה חדשה (לפחות 10 תווים)",autocomplete:"new-password",style:"margin-bottom:12px"});
  const p2 = e("input",{class:"fi",type:"password",placeholder:"אישור סיסמה חדשה",autocomplete:"new-password",style:"margin-bottom:12px"});
  card.appendChild(p1);
  card.appendChild(p2);
  card.appendChild(e("div",{style:"font-size:11px;color:#64748B;margin-bottom:12px;line-height:1.5"},
    "💡 לפחות 10 תווים"));
  card.appendChild(btn("btn-primary","✓ שמור סיסמה חדשה", async () => {
    const newPass = p1.value;
    const confPass = p2.value;
    const pwErr = validatePassword(newPass);
    if (pwErr) { toast(pwErr, "err"); return; }
    if (newPass !== confPass) { toast("הסיסמאות לא תואמות", "err"); return; }
    try {
      const { error } = await sb.auth.updateUser({ password: newPass });
      if (error) { toast(friendlyError(error), "err"); return; }
      toast("סיסמה עודכנה ✓");
      // Now hand off to the normal MFA gate — the user will be asked for their
      // Authenticator code (if they have one) or to enroll (if not).
      const { data: { user } } = await sb.auth.getUser();
      if (user) await loadAll(user);
      else { S.view = "login"; render(); }
    } catch (err) {
      toast(friendlyError(err), "err");
    }
  },{style:"width:100%"}));

  box.appendChild(card);

  box.appendChild(e("div",{style:"text-align:center;margin-top:20px"},[
    e("a",{href:"#", style:"color:#64748B;font-size:13px;text-decoration:underline", onclick: async (ev) => {
      ev.preventDefault();
      await sb.auth.signOut();
      location.reload();
    }}, "ביטול והתנתקות")
  ]));

  wrap.appendChild(box);
  return wrap;
}
