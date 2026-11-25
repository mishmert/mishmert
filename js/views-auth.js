// views-auth.js — the pre-logged-in and MFA screens.
// Extracted from index.html on 2026-11-24.
//
// Contains: viewLoading (the splash shown while S.view === 'loading'),
// viewLogin (email+password + sign-up toggle + password-reset entry),
// viewMfaEnroll (first-time TOTP setup — shows QR, verifies once), and
// viewMfaChallenge (returning user whose session is still AAL1).
//
// These are the only views safe to show before loadAll() has populated S,
// so they intentionally avoid any reference to employees/schedule/business
// state. Session mutations happen through sb.auth.* directly; the AAL2
// path then hands off to loadAll() in data.js.
//
// Dependencies at call time: `S` (state.js), `sb` (inline CONFIG),
// `e`/`div`/`btn`/`toast`/`uiAlert`/`uiPrompt`/`validatePassword`/
// `friendlyError` (utils.js), `render()` / `goto()` (inline).

// ══════════════════════════════════════════════════════

// ── LOADING ──
"use strict";

import { btn, div, e, skeleton, skeletonCard, skeletonSchedule, toast, uiAlert, uiPrompt } from './utils.js';
import { S } from './state.js';
import { handleAcceptInvitation, handleLogin, handleRegister } from './audit.js';
import { sb } from './sb.js';
import { render } from './main.js';
import { loadAll } from './data.js';
export function viewLoading() {
  const wrap = e("div",{style:"padding:20px;max-width:900px;margin:0 auto"});
  // Header skeleton
  wrap.appendChild(e("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:20px"}, [
    e("div",{style:"display:flex;align-items:center;gap:10px"}, [
      skeleton("skeleton-avatar"),
      e("div",{},[
        skeleton("skeleton-line medium"),
      ])
    ]),
    skeleton("skeleton-chip"),
  ]));
  // A card of placeholder content
  wrap.appendChild(skeletonCard());
  wrap.appendChild(skeletonSchedule());
  return wrap;
}

// ── LOGIN ──
export function viewLogin() {
  const isReg = S.loginMode === "register" && !!S.pendingBizInvite;
  const isInvite = S.loginMode === "accept_invitation";
  const wrap = e("div",{class:"login-wrap"});
  const card = e("div",{class:"login-card"});

  card.appendChild(div("logo-box",[
    e("div",{class:"logo-icon"},"📅"),
    e("div",{},[
      e("div",{class:"logo-name"},"ניהול משמרות"),
      e("div",{class:"logo-sub"},"מערכת ניהול משמרות קלה ושקופה")
    ])
  ]));
  card.appendChild(e("div",{class:"login-h1"},
    isInvite ? "✉️ הזמנה ל-"+(S.pendingInvitation?.businessName||"") :
    isReg ? "✉️ הזמנה לפתיחת עסק חדש" : "ברוך הבא"));
  card.appendChild(e("p",{class:"subtitle"},
    isInvite ? "השלם פרטים להצטרפות כ"+((S.pendingInvitation?.role==="admin"||S.pendingInvitation?.role==="manager")?"מנהל":"עובד") :
    isReg ? "צור חשבון מנהל לעסק החדש שלך" : "הכנס פרטים להמשך"));

  const errBox = e("div",{class:"err-box hidden",id:"lerr"});
  card.appendChild(errBox);

  const form = e("form",{onsubmit: async ev => {
    ev.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    btn.disabled=true; errBox.classList.add("hidden");
    try {
      if (isInvite) await handleAcceptInvitation(
        form.querySelector("[name=name]").value,
        form.querySelector("[name=pass]").value,
        S.pendingInvitation.token,
        S.pendingInvitation.email
      );
      else if (isReg) await handleRegister(
        form.querySelector("[name=name]").value,
        form.querySelector("[name=biz]")?.value||"",
        form.querySelector("[name=email]").value,
        form.querySelector("[name=pass]").value,
        S.pendingBizInvite.token
      );
      else await handleLogin(
        form.querySelector("[name=email]").value,
        form.querySelector("[name=pass]").value
      );
    } catch(err) {
      errBox.textContent = "⚠️ "+(err.message||"שגיאה");
      errBox.classList.remove("hidden"); btn.disabled=false;
    }
  }});

  if (isInvite) {
    // Show pre-filled email (locked) and ask for name + password only
    form.appendChild(loginField("שם מלא","name","text",S.pendingInvitation?.name || "שם מלא",true));
    const emailField = div("field",[
      e("label",{},"אימייל"),
      e("input",{name:"emailDisplay",type:"email",value:S.pendingInvitation?.email||"",disabled:"disabled",style:"opacity:0.7;cursor:not-allowed"})
    ]);
    form.appendChild(emailField);
    form.appendChild(loginField("בחר סיסמה","pass","password","לפחות 10 תווים",true));
  } else if (isReg) {
    if (S.pendingBizInvite?.note) {
      card.appendChild(e("div",{style:"background:#3B82F622;border:1px solid #3B82F644;border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#93C5FD"},"📝 "+S.pendingBizInvite.note));
    }
    form.appendChild(loginField("שם מלא","name","text","ישראל ישראלי",true));
    form.appendChild(loginField("שם העסק","biz","text","החברה שלי",true));
    form.appendChild(loginField("אימייל","email","email",S.pendingBizInvite?.email||"you@example.com",true));
    form.appendChild(loginField("סיסמה","pass","password","••••••••",true));
  } else {
    form.appendChild(loginField("אימייל","email","email","you@example.com",true));
    form.appendChild(loginField("סיסמה","pass","password","••••••••",true));
  }
  form.appendChild(e("button",{type:"submit",class:"btn-primary"},
    isInvite ? "✓ הצטרף לעסק →" :
    isReg?"צור חשבון מנהל →":"כניסה →"));
  card.appendChild(form);

  // Face ID / Touch ID tip (login mode only)
  if (!isReg && !isInvite) {
    card.appendChild(e("div",{style:"background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:12px 14px;margin-top:14px;font-size:12px;color:#93C5FD;line-height:1.6;display:flex;align-items:flex-start;gap:8px"},[
      e("span",{style:"font-size:16px;flex-shrink:0"},"🔒"),
      e("div",{},[
        e("div",{style:"font-weight:700;margin-bottom:3px"},"כניסה מהירה עם Face ID / Touch ID"),
        e("div",{style:"color:#94A3B8;font-size:11px"},"בכניסה הראשונה — אשר שמירת סיסמה בהודעה של הדפדפן. מהכניסה הבאה — תוכל להיכנס בלחיצה אחת עם זיהוי הפנים.")
      ])
    ]));
  }

  // Forgot password (login mode only)
  if (!isReg && !isInvite) {
    card.appendChild(div("switch-link",[
      e("a",{onclick:async()=>{
        const email = await uiPrompt({title:"איפוס סיסמה", message:"הכנס את כתובת המייל שלך", placeholder:"you@example.com", okLabel:"שלח לינק"});
        if (!email) return;
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin + "/?reset=true"
        });
        if (error) {
          await uiAlert({title:"שגיאה", message:error.message, tone:"danger"});
        } else {
          await uiAlert({title:"✓ לינק נשלח!", message:"לינק איפוס סיסמה נשלח אל " + email + ". בדוק את תיבת המייל שלך.", tone:"success"});
        }
      },style:"color:#94A3B8;font-size:13px"},"שכחתי סיסמה"),
    ]));
  }

  // Switch links
  if (isInvite || isReg) {
    // Don't show switch links during invite/registration flows — both require a valid token
  }
  // Note: regular employees can no longer sign up directly - they must receive an invitation
  wrap.appendChild(card);
  return wrap;
}

// ═══ 2FA ENROLLMENT — one-time TOTP setup ═══
export function viewMfaEnroll() {
  const wrap = div("app");
  const box = e("div",{style:"max-width:440px;margin:0 auto;padding:40px 24px"});

  box.appendChild(e("div",{style:"text-align:center;margin-bottom:28px"},[
    e("div",{style:"font-size:46px;margin-bottom:12px"},"🔐"),
    e("div",{style:"font-weight:900;font-size:26px;color:#F8FAFC;letter-spacing:-0.5px;margin-bottom:8px"},"אימות דו-שלבי"),
    e("div",{style:"font-size:13px;color:#94A3B8;line-height:1.6"},"להמשך השימוש במערכת יש להפעיל אימות דו-שלבי")
  ]));

  const card = div("card");

  // Load or create the TOTP factor on first render
  if (!S.mfaEnrollData) {
    S.mfaEnrollData = { loading: true };
    (async () => {
      try {
        // Clean up any orphan unverified factors from previous attempts
        const { data: existing } = await sb.auth.mfa.listFactors();
        for (const f of (existing?.all || [])) {
          if (f.status !== "verified") {
            await sb.auth.mfa.unenroll({ factorId: f.id });
          }
        }
        const { data, error } = await sb.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "משמרת — " + (S.user?.email || "device"),
        });
        if (error) throw error;
        S.mfaEnrollData = {
          factorId: data.id,
          qrCode: data.totp.qr_code,  // data:image/svg+xml;base64,...
          secret: data.totp.secret,
          uri: data.totp.uri,
        };
        render();
      } catch (err) {
        S.mfaEnrollData = { error: err.message };
        render();
      }
    })();
  }

  if (S.mfaEnrollData.loading) {
    card.appendChild(e("div",{style:"text-align:center;padding:40px;color:#94A3B8"},"טוען קוד..."));
  } else if (S.mfaEnrollData.error) {
    card.appendChild(e("div",{style:"text-align:center;padding:20px;color:#F87171"},"שגיאה: " + S.mfaEnrollData.error));
  } else {
    card.appendChild(e("div",{style:"font-size:13px;color:#CBD5E1;line-height:1.6;margin-bottom:16px"},"1. פתח אפליקציית Authenticator (Google Authenticator / Authy / 1Password)"));
    card.appendChild(e("div",{style:"font-size:13px;color:#CBD5E1;line-height:1.6;margin-bottom:12px"},"2. סרוק את ה-QR:"));

    // QR code
    card.appendChild(e("div",{style:"text-align:center;background:white;padding:16px;border-radius:14px;margin-bottom:16px"},[
      e("img",{src:S.mfaEnrollData.qrCode, style:"width:200px;height:200px;display:block;margin:0 auto"})
    ]));

    // Secret (manual entry)
    card.appendChild(e("div",{style:"font-size:12px;color:#94A3B8;margin-bottom:6px"},"או הקלד את המפתח ידנית:"));
    card.appendChild(e("div",{style:"background:#0F172A;border:1px solid #334155;border-radius:10px;padding:10px 14px;font-family:monospace;font-size:13px;color:#E2E8F0;word-break:break-all;margin-bottom:20px;direction:ltr;text-align:center;user-select:all"}, S.mfaEnrollData.secret));

    card.appendChild(e("div",{style:"font-size:13px;color:#CBD5E1;line-height:1.6;margin-bottom:10px"},"3. הקלד את הקוד שהאפליקציה מציגה:"));

    const codeInput = e("input",{
      class:"fi", type:"text", inputmode:"numeric", pattern:"[0-9]*", maxlength:"6",
      placeholder:"------", style:"width:100%;font-size:22px;letter-spacing:8px;text-align:center;font-family:monospace;direction:ltr;margin-bottom:16px",
      autocomplete:"one-time-code",
      oninput: ev => { ev.target.value = ev.target.value.replace(/\D/g,"").slice(0,6); }
    });
    card.appendChild(codeInput);

    card.appendChild(btn("btn-primary","✓ אמת והפעל", async () => {
      const code = codeInput.value.trim();
      if (code.length !== 6) return toast("קוד חייב 6 ספרות","err");
      try {
        const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: S.mfaEnrollData.factorId });
        if (chErr) throw chErr;
        const { error: vErr } = await sb.auth.mfa.verify({
          factorId: S.mfaEnrollData.factorId,
          challengeId: ch.id,
          code,
        });
        if (vErr) throw vErr;
        toast("אימות דו-שלבי הופעל ✓");
        S.mfaEnrollData = null;
        S.view = "loading";
        render();
        // Re-run the full post-login flow with elevated AAL
        await loadAll(S.user);
        render();
      } catch (err) {
        toast("קוד שגוי — נסה שוב", "err");
      }
    },{style:"width:100%"}));
  }

  box.appendChild(card);

  // Logout link
  box.appendChild(e("div",{style:"text-align:center;margin-top:20px"},[
    e("a",{href:"#", style:"color:#64748B;font-size:13px;text-decoration:underline", onclick: async (ev) => {
      ev.preventDefault();
      S.mfaEnrollData = null;
      await sb.auth.signOut();
      location.reload();
    }}, "התנתק")
  ]));

  wrap.appendChild(box);
  return wrap;
}

// ═══ 2FA CHALLENGE — enter TOTP on login ═══
export function viewMfaChallenge() {
  const wrap = div("app");
  const box = e("div",{style:"max-width:420px;margin:0 auto;padding:40px 24px"});

  box.appendChild(e("div",{style:"text-align:center;margin-bottom:28px"},[
    e("div",{style:"font-size:46px;margin-bottom:12px"},"🔐"),
    e("div",{style:"font-weight:900;font-size:26px;color:#F8FAFC;letter-spacing:-0.5px;margin-bottom:8px"},"אימות דו-שלבי"),
    e("div",{style:"font-size:13px;color:#94A3B8;line-height:1.5"},"הזן את הקוד מאפליקציית ה-Authenticator שלך")
  ]));

  const card = div("card");
  const codeInput = e("input",{
    class:"fi", type:"text", inputmode:"numeric", pattern:"[0-9]*", maxlength:"6",
    placeholder:"------", style:"width:100%;font-size:26px;letter-spacing:10px;text-align:center;font-family:monospace;direction:ltr;margin-bottom:16px;padding:16px",
    autocomplete:"one-time-code",
    oninput: ev => { ev.target.value = ev.target.value.replace(/\D/g,"").slice(0,6); }
  });
  card.appendChild(codeInput);
  // Auto-focus
  setTimeout(() => codeInput.focus(), 100);

  card.appendChild(btn("btn-primary","✓ אמת", async () => {
    const code = codeInput.value.trim();
    if (code.length !== 6) return toast("קוד חייב 6 ספרות","err");
    try {
      const { data: factors } = await sb.auth.mfa.listFactors();
      const factor = (factors?.totp || [])[0];
      if (!factor) { toast("לא נמצא גורם אימות","err"); return; }
      const { data: ch, error: chErr } = await sb.auth.mfa.challenge({ factorId: factor.id });
      if (chErr) throw chErr;
      const { error: vErr } = await sb.auth.mfa.verify({
        factorId: factor.id,
        challengeId: ch.id,
        code,
      });
      if (vErr) throw vErr;
      S.view = "loading";
      render();
      await loadAll(S.user);
      render();
    } catch (err) {
      toast("קוד שגוי", "err");
      codeInput.value = "";
      codeInput.focus();
    }
  },{style:"width:100%"}));

  box.appendChild(card);

  box.appendChild(e("div",{style:"text-align:center;margin-top:20px"},[
    e("a",{href:"#", style:"color:#64748B;font-size:13px;text-decoration:underline", onclick: async (ev) => {
      ev.preventDefault();
      await sb.auth.signOut();
      location.reload();
    }}, "התנתק")
  ]));

  wrap.appendChild(box);
  return wrap;
}

export function loginField(lbl, name, type, ph, req=false) {
  // Map to standard autocomplete tokens so iOS Keychain / 1Password / Chrome offer the
  // right suggestion in the right field. Without these hints browsers guess and often miss.
  let ac = null;
  if (type === "email") ac = "email";
  else if (type === "password") ac = name === "pass" ? "current-password" : "new-password";
  else if (name === "name") ac = "name";
  // iOS auto-capitalizes the first letter of a field by default, which breaks email entry
  // ("Raz@..." instead of "raz@..." → confuses the server) and password entry.
  const autocap = (type === "email" || type === "password") ? "off" : null;
  const spellcheck = (type === "email" || type === "password") ? "false" : null;
  return div("field",[
    e("label",{},lbl+(req?" *":"")),
    e("input",{name,type,placeholder:ph,required:req?"required":null,autocomplete:ac,inputmode:type==="email"?"email":null,autocapitalize:autocap,spellcheck})
  ]);
}
