// views-secondary.js — settings and the secondary logged-in screens.
// Extracted from index.html on 2026-11-24.
//
// Contents:
//  - viewSettings              : admin-side settings (security/2FA toggle,
//                                business profile, notification prefs,
//                                deep-link to Supabase Dashboard flows).
//  - viewEmpVacations          : employee self-service vacation history.
//  - viewCalendar              : month-view calendar, assignments overlaid.
//  - viewEmpSettings           : employee-side settings.
//  - viewManagerBlocks         : manager view of team availability blocks.
//  - loadQualificationHistory  : the async loader backing viewQualifications.
//  - viewAnalytics             : analytics dashboard + loadAnalyticsData.
//  - viewQualifications        : per-system/per-shift qualifications matrix.
//
// Dependencies at call time: same set as views-main.js plus the export
// helpers from export.js and the push helpers from data.js.

// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// SETTINGS VIEW
// ══════════════════════════════════════════════════════
function viewSettings() {
  const wrap = e("div");
  wrap.appendChild(div("page-title",["⚙️ הגדרות"],{style:"margin-bottom:16px"}));

  // ═══ אבטחה — 2FA ═══
  const secCard = div("card",[e("div",{class:"card-title"},"🔐 אבטחה")]);

  // Load MFA state once per settings-view mount
  if (S.securityCardState === undefined) {
    S.securityCardState = "loading";
    (async () => {
      try {
        const { data: factors } = await sb.auth.mfa.listFactors();
        S.securityCardState = { hasMfa: (factors?.totp || []).length > 0 };
      } catch (err) {
        S.securityCardState = { error: err.message };
      }
      render();
    })();
  }

  if (S.securityCardState === "loading") {
    secCard.appendChild(e("div",{style:"padding:10px;color:#94A3B8;font-size:13px"},"טוען..."));
  } else if (S.securityCardState?.error) {
    secCard.appendChild(e("div",{style:"padding:10px;color:#F87171;font-size:13px"},"שגיאה: " + S.securityCardState.error));
  } else {
    const hasMfa = S.securityCardState.hasMfa;
    secCard.appendChild(e("div",{style:"display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap"},[
      e("div",{style:"flex:1;min-width:180px"},[
        e("div",{style:"font-size:14px;font-weight:700;color:#E2E8F0;margin-bottom:4px"},"אימות דו-שלבי (2FA)"),
        hasMfa
          ? e("div",{style:"font-size:12px;color:#34D399"}, "✓ מופעל — Authenticator")
          : e("div",{style:"font-size:12px;color:#F87171"}, "⚠ לא מופעל")
      ]),
      hasMfa
        ? btn("btn-sm btn-sm-red","🔁 הגדר מחדש", async () => {
            const ok = await uiConfirm({title:"הגדר מחדש 2FA?", message:"פעולה זו תמחק את ה-Authenticator הנוכחי ותחייב סריקה מחדש של QR.", confirmText:"כן, הגדר מחדש", tone:"danger"});
            if (!ok) return;
            try {
              const { data: factors } = await sb.auth.mfa.listFactors();
              for (const f of (factors?.totp || [])) {
                await sb.auth.mfa.unenroll({ factorId: f.id });
              }
              toast("2FA נוטרל. יופעל שוב בכניסה הבאה.");
              S.securityCardState = { hasMfa: false };
              S.mfaEnrollData = null;
              S.view = "mfa_enroll";
              render();
            } catch (err) {
              toast(friendlyError(err), "err");
            }
          },{style:"padding:8px 14px"})
        : e("div",{style:"font-size:11px;color:#94A3B8"}, "נדרש לפעולות רגישות")
    ]));
  }
  wrap.appendChild(secCard);

  // ═══ איפוס 2FA לעובד (מנהל בלבד) ═══
  if (isManager()) {
    const resetCard = div("card",[e("div",{class:"card-title"},"🔓 איפוס 2FA לעובד")]);
    resetCard.appendChild(e("div",{style:"font-size:12px;color:#94A3B8;margin-bottom:12px;line-height:1.5"},
      "אם עובד איבד את הטלפון או החליף מכשיר — אפס את ה-2FA שלו. בכניסה הבאה הוא יסרוק QR חדש."));
    const empSel = e("select",{class:"fi",style:"margin-bottom:10px",
      onchange: ev => { S.resetMfaEmpId = ev.target.value; }
    });
    empSel.appendChild(e("option",{value:""},"— בחר עובד —"));
    S.employees.filter(em => em.id !== S.user.id).sort((a,b) => a.name.localeCompare(b.name,"he")).forEach(em => {
      empSel.appendChild(e("option",{value:em.id, selected: S.resetMfaEmpId === em.id ? "selected" : null}, em.name));
    });
    resetCard.appendChild(empSel);
    resetCard.appendChild(btn("btn-sm btn-sm-red","🔓 אפס 2FA", async () => {
      if (!S.resetMfaEmpId) return toast("בחר עובד","err");
      const emp = getEmp(S.resetMfaEmpId);
      const ok = await uiConfirm({
        title:"אפס 2FA של "+emp.name+"?",
        message:"הוא יצטרך לסרוק QR חדש בכניסה הבאה. אל תעשה את זה אם אתה לא בטוח שבאמת הוא זה שביקש.",
        confirmText:"כן, אפס",
        tone:"danger"
      });
      if (!ok) return;
      try {
        const { data, error } = await sb.functions.invoke("admin-reset-mfa", { body: { empId: S.resetMfaEmpId } });
        if (error) throw error;
        toast("2FA של " + emp.name + " אופס ✓");
        S.resetMfaEmpId = "";
        render();
      } catch (err) {
        toast(friendlyError(err), "err");
      }
    },{style:"width:100%;padding:12px"}));
    wrap.appendChild(resetCard);
  }

  if (!S.settingsData) S.settingsData = {
    morningStart: SHIFTS[0].start, morningEnd: SHIFTS[0].end,
    morning2Start: SHIFTS[1].start, morning2End: SHIFTS[1].end,
    afternoonStart: SHIFTS[2].start, afternoonEnd: SHIFTS[2].end,
    nightStart: SHIFTS[3].start, nightEnd: SHIFTS[3].end,
    emailNotify: true,
  };
  const sd = S.settingsData;

  // Shift hours settings
  const shiftCard = div("card",[e("div",{class:"card-title"},"🕐 שעות משמרות")]);
  // Which shift types are relevant for THIS business — self-service (any admin), not just the platform super admin.
  const SHIFT_TYPE_LABELS = { morning:"בוקר", morning2:"בוקר ב׳", afternoon:"צהריים", night:"לילה" };
  const weekdaySelSet = new Set(S.business?.shift_config?.weekday_shifts || ["morning","morning2","afternoon","night"]);
  const weekendSelSet = new Set(S.business?.shift_config?.weekend_shifts || ["morning","night"]);
  const shiftTypesCard = div("card",[e("div",{class:"card-title"},"🎛️ אילו משמרות רלוונטיות לעסק שלכם")]);
  shiftTypesCard.appendChild(e("div",{style:"font-size:12px;color:#94A3B8;margin-bottom:12px"},
    "לא כל עסק צריך את כל סוגי המשמרות (למשל: אין משמרת לילה), ובסופ״ש לפעמים רלוונטיות פחות משמרות מאשר בימי חול."));

  shiftTypesCard.appendChild(e("div",{style:"font-size:11px;color:#64748B;margin-bottom:6px"},"ימי חול (א׳-ה׳)"));
  const wdTypesWrap = e("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px"});
  Object.keys(SHIFT_TYPE_LABELS).forEach(key=>{
    const isOn = weekdaySelSet.has(key);
    wdTypesWrap.appendChild(e("label",{style:`display:flex;align-items:center;gap:6px;background:#0F172A;border:1px solid ${isOn?"#3B82F6aa":"#334155"};border-radius:10px;padding:8px 12px;cursor:pointer`},[
      e("input",{type:"checkbox",checked:isOn?"checked":null,
        onchange:(ev)=>{ if(ev.target.checked) weekdaySelSet.add(key); else weekdaySelSet.delete(key); }
      }),
      e("span",{style:"font-size:13px;color:#E2E8F0"}, SHIFT_TYPE_LABELS[key])
    ]));
  });
  shiftTypesCard.appendChild(wdTypesWrap);

  shiftTypesCard.appendChild(e("div",{style:"font-size:11px;color:#64748B;margin-bottom:6px"},"שישי-שבת"));
  const weTypesWrap = e("div",{style:"display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px"});
  Object.keys(SHIFT_TYPE_LABELS).forEach(key=>{
    const isOn = weekendSelSet.has(key);
    weTypesWrap.appendChild(e("label",{style:`display:flex;align-items:center;gap:6px;background:#0F172A;border:1px solid ${isOn?"#F59E0Baa":"#334155"};border-radius:10px;padding:8px 12px;cursor:pointer`},[
      e("input",{type:"checkbox",checked:isOn?"checked":null,
        onchange:(ev)=>{ if(ev.target.checked) weekendSelSet.add(key); else weekendSelSet.delete(key); }
      }),
      e("span",{style:"font-size:13px;color:#E2E8F0"}, SHIFT_TYPE_LABELS[key])
    ]));
  });
  shiftTypesCard.appendChild(weTypesWrap);

  shiftTypesCard.appendChild(btn("btn-add","💾 שמור אילו משמרות רלוונטיות",async()=>{
    if (weekdaySelSet.size === 0) { toast("בחר לפחות סוג משמרת אחד לימי חול", "err"); return; }
    const shiftConfig = { weekday_shifts: Array.from(weekdaySelSet), weekend_shifts: Array.from(weekendSelSet) };
    const { error } = await sb.from("businesses").update({ shift_config: shiftConfig }).eq("id", S.profile.business_id);
    if (error) { toast("שמירה נכשלה — " + friendlyError(error), "err"); return; }
    S.business.shift_config = shiftConfig;
    toast("✓ נשמר — ייכנס לתוקף בכניסה הבאה למערכת");
    render();
  },{style:"width:100%"}));
  wrap.appendChild(shiftTypesCard);

  const shiftDefs = [
    {id:"morning",label:"בוקר",sk:"morning"},
    {id:"morning2",label:"בוקר ב׳",sk:"morning2"},
    {id:"afternoon",label:"צהריים",sk:"afternoon"},
    {id:"night",label:"לילה",sk:"night"},
  ];
  shiftDefs.forEach(sh=>{
    const shColor = SHIFT_BY_ID[sh.id]?.color || "#94A3B8";
    shiftCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid "+shColor+"33"},[
      e("div",{style:"font-weight:700;font-size:12px;color:"+shColor+";min-width:55px"},sh.label),
      // Explicit visual layout: START field on the right (with "מ-" label), END on the left (with "עד" label)
      e("div",{style:"flex:1;display:flex;flex-direction:column;gap:2px"},[
        e("div",{style:"font-size:10px;color:#64748B;text-align:center"},"מ־"),
        e("input",{type:"time",value:sd[sh.sk+"Start"]||SHIFT_BY_ID[sh.id]?.start||"07:00",class:"fi",style:"padding:8px 10px;font-size:14px;text-align:center",onchange:ev=>{sd[sh.sk+"Start"]=ev.target.value}})
      ]),
      e("div",{style:"flex:1;display:flex;flex-direction:column;gap:2px"},[
        e("div",{style:"font-size:10px;color:#64748B;text-align:center"},"עד"),
        e("input",{type:"time",value:sd[sh.sk+"End"]||SHIFT_BY_ID[sh.id]?.end||"15:00",class:"fi",style:"padding:8px 10px;font-size:14px;text-align:center",onchange:ev=>{sd[sh.sk+"End"]=ev.target.value}})
      ])
    ]));
  });
  shiftCard.appendChild(btn("btn-add","שמור שעות",async()=>{
    // Update in-memory SHIFTS arrays (correct indices: 0=morning, 1=morning2, 2=afternoon, 3=night)
    if(sd.morningStart && sd.morningEnd) { SHIFTS[0].start=sd.morningStart; SHIFTS[0].end=sd.morningEnd; }
    if(sd.morning2Start && sd.morning2End) { SHIFTS[1].start=sd.morning2Start; SHIFTS[1].end=sd.morning2End; }
    if(sd.afternoonStart && sd.afternoonEnd) { SHIFTS[2].start=sd.afternoonStart; SHIFTS[2].end=sd.afternoonEnd; }
    if(sd.nightStart && sd.nightEnd) { SHIFTS[3].start=sd.nightStart; SHIFTS[3].end=sd.nightEnd; }
    if(sd.weMorningStart && sd.weMorningEnd) { WEEKEND_SHIFTS[0].start=sd.weMorningStart; WEEKEND_SHIFTS[0].end=sd.weMorningEnd; }
    if(sd.weNightStart && sd.weNightEnd) { WEEKEND_SHIFTS[1].start=sd.weNightStart; WEEKEND_SHIFTS[1].end=sd.weNightEnd; }
    
    // Persist to DB so it survives refresh + other managers see it
    const shiftHours = {
      morning:  { start: SHIFTS[0].start, end: SHIFTS[0].end },
      morning2: { start: SHIFTS[1].start, end: SHIFTS[1].end },
      afternoon:{ start: SHIFTS[2].start, end: SHIFTS[2].end },
      night:    { start: SHIFTS[3].start, end: SHIFTS[3].end },
      weMorning:{ start: WEEKEND_SHIFTS[0].start, end: WEEKEND_SHIFTS[0].end },
      weNight:  { start: WEEKEND_SHIFTS[1].start, end: WEEKEND_SHIFTS[1].end }
    };
    const { error } = await sb.from("businesses").update({shift_hours: shiftHours}).eq("id", S.profile.business_id);
    if (error) { toast("שמירה נכשלה — " + friendlyError(error),"err"); return; }
    S.business.shift_hours = shiftHours;
    if (typeof logAction === "function") logAction("shift_hours_updated", shiftHours);
    toast("שעות עודכנו ✓");
    render();
  }));
  wrap.appendChild(shiftCard);

  // Weekend shift hours
  const weCard = div("card",[e("div",{class:"card-title"},"🕐 שעות שישי — שבת")]);
  weCard.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:12px"},"בסופ״ש יש רק 2 משמרות: בוקר ולילה"));
  if(!sd.weMorningStart) sd.weMorningStart = WEEKEND_SHIFTS[0].start;
  if(!sd.weMorningEnd) sd.weMorningEnd = WEEKEND_SHIFTS[0].end;
  if(!sd.weNightStart) sd.weNightStart = WEEKEND_SHIFTS[1].start;
  if(!sd.weNightEnd) sd.weNightEnd = WEEKEND_SHIFTS[1].end;

  weCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid #F59E0B33"},[
    e("div",{style:"font-weight:700;font-size:12px;color:#F59E0B;min-width:55px"},"בוקר"),
    e("div",{style:"flex:1;display:flex;flex-direction:column;gap:2px"},[
      e("div",{style:"font-size:10px;color:#64748B;text-align:center"},"מ־"),
      e("input",{type:"time",value:sd.weMorningStart,class:"fi",style:"padding:8px 10px;font-size:14px;text-align:center",onchange:ev=>{sd.weMorningStart=ev.target.value}})
    ]),
    e("div",{style:"flex:1;display:flex;flex-direction:column;gap:2px"},[
      e("div",{style:"font-size:10px;color:#64748B;text-align:center"},"עד"),
      e("input",{type:"time",value:sd.weMorningEnd,class:"fi",style:"padding:8px 10px;font-size:14px;text-align:center",onchange:ev=>{sd.weMorningEnd=ev.target.value}})
    ])
  ]));
  weCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:8px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid #6366F133"},[
    e("div",{style:"font-weight:700;font-size:12px;color:#6366F1;min-width:55px"},"לילה"),
    e("div",{style:"flex:1;display:flex;flex-direction:column;gap:2px"},[
      e("div",{style:"font-size:10px;color:#64748B;text-align:center"},"מ־"),
      e("input",{type:"time",value:sd.weNightStart,class:"fi",style:"padding:8px 10px;font-size:14px;text-align:center",onchange:ev=>{sd.weNightStart=ev.target.value}})
    ]),
    e("div",{style:"flex:1;display:flex;flex-direction:column;gap:2px"},[
      e("div",{style:"font-size:10px;color:#64748B;text-align:center"},"עד"),
      e("input",{type:"time",value:sd.weNightEnd,class:"fi",style:"padding:8px 10px;font-size:14px;text-align:center",onchange:ev=>{sd.weNightEnd=ev.target.value}})
    ])
  ]));
  weCard.appendChild(btn("btn-add","שמור שעות סופ״ש",async()=>{
    if(sd.weMorningStart && sd.weMorningEnd) { WEEKEND_SHIFTS[0].start=sd.weMorningStart; WEEKEND_SHIFTS[0].end=sd.weMorningEnd; }
    if(sd.weNightStart && sd.weNightEnd) { WEEKEND_SHIFTS[1].start=sd.weNightStart; WEEKEND_SHIFTS[1].end=sd.weNightEnd; }
    // Persist all shift hours together
    const shiftHours = {
      morning:  { start: SHIFTS[0].start, end: SHIFTS[0].end },
      morning2: { start: SHIFTS[1].start, end: SHIFTS[1].end },
      afternoon:{ start: SHIFTS[2].start, end: SHIFTS[2].end },
      night:    { start: SHIFTS[3].start, end: SHIFTS[3].end },
      weMorning:{ start: WEEKEND_SHIFTS[0].start, end: WEEKEND_SHIFTS[0].end },
      weNight:  { start: WEEKEND_SHIFTS[1].start, end: WEEKEND_SHIFTS[1].end }
    };
    const { error } = await sb.from("businesses").update({shift_hours: shiftHours}).eq("id", S.profile.business_id);
    if (error) { toast("שמירה נכשלה — " + friendlyError(error),"err"); return; }
    S.business.shift_hours = shiftHours;
    if (typeof logAction === "function") logAction("shift_hours_updated", shiftHours);
    toast("שעות סופ״ש עודכנו ✓");
    render();
  }));
  wrap.appendChild(weCard);

  // Shift targets (how many employees per shift)
  const targetsCard = div("card",[e("div",{class:"card-title"},"👥 כמות עובדים למשמרת")]);
  targetsCard.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:12px"},"כמה עובדים לשבץ בכל משמרת בשיבוץ האוטומטי"));
  if(!sd.targets) sd.targets = S.business?.shift_targets || {morning:2,morning2:1,afternoon:1,night:1};
  const targetShifts = [
    {id:"morning",label:"בוקר",color:"#F59E0B"},
    {id:"morning2",label:"בוקר ב׳",color:"#F97316"},
    {id:"afternoon",label:"צהריים",color:"#10B981"},
    {id:"night",label:"לילה",color:"#6366F1"},
  ];
  targetShifts.forEach(sh => {
    targetsCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid "+sh.color+"33"},[
      e("div",{style:"font-weight:700;font-size:12px;color:"+sh.color+";min-width:65px"},sh.label),
      e("input",{type:"number",min:0,max:10,value:sd.targets[sh.id]||0,class:"fi",style:"width:60px;text-align:center;padding:8px 10px;font-size:14px",
        oninput:ev=>{sd.targets[sh.id]=parseInt(ev.target.value)||0;}}),
      e("span",{style:"font-size:12px;color:#64748B"},"עובדים")
    ]));
  });
  targetsCard.appendChild(btn("btn-add","שמור כמויות",async()=>{
    await sb.from("businesses").update({shift_targets:sd.targets}).eq("id",S.profile.business_id);
    S.business.shift_targets = sd.targets;
    toast("כמויות עודכנו ✓");render();
  },{style:"width:100%;margin-top:8px"}));
  wrap.appendChild(targetsCard);

  // Weekend shift targets
  const weTargetsCard = div("card",[e("div",{class:"card-title"},"👥 כמות עובדים — שישי שבת")]);
  weTargetsCard.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:12px"},"בסופ״ש יש רק בוקר ולילה"));
  if(!sd.weTargets) sd.weTargets = S.business?.weekend_targets || {morning:2,night:1};
  const weTargetShifts = [
    {id:"morning",label:"בוקר",color:"#F59E0B"},
    {id:"night",label:"לילה",color:"#6366F1"},
  ];
  weTargetShifts.forEach(sh => {
    weTargetsCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid "+sh.color+"33"},[
      e("div",{style:"font-weight:700;font-size:12px;color:"+sh.color+";min-width:65px"},sh.label),
      e("input",{type:"number",min:0,max:10,value:sd.weTargets[sh.id]||0,class:"fi",style:"width:60px;text-align:center;padding:8px 10px;font-size:14px",
        oninput:ev=>{sd.weTargets[sh.id]=parseInt(ev.target.value)||0;}}),
      e("span",{style:"font-size:12px;color:#64748B"},"עובדים")
    ]));
  });
  weTargetsCard.appendChild(btn("btn-add","שמור כמויות סופ״ש",async()=>{
    await sb.from("businesses").update({weekend_targets:sd.weTargets}).eq("id",S.profile.business_id);
    S.business.weekend_targets = sd.weTargets;
    toast("כמויות סופ״ש עודכנו ✓");render();
  },{style:"width:100%;margin-top:8px"}));
  wrap.appendChild(weTargetsCard);

  // Deadline
  const dlCard = div("card",[e("div",{class:"card-title"},"⏰ דדליין להגשת חסימות")]);
  dlCard.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:12px"},"עובדים לא יוכלו להגיש חסימות אחרי הדדליין"));
  if (!sd.deadlineDay) sd.deadlineDay = S.business?.deadline_day != null ? String(S.business.deadline_day) : "";
  if (!sd.deadlineTime) sd.deadlineTime = S.business?.deadline_time || "20:00";

  const dlDaySelect = e("select",{class:"fi",onchange:ev=>{sd.deadlineDay=ev.target.value}});
  dlDaySelect.appendChild(e("option",{value:"",selected:sd.deadlineDay===""?"selected":null},"ללא דדליין"));
  DAYS.forEach((d,i)=>{
    dlDaySelect.appendChild(e("option",{value:String(i),selected:sd.deadlineDay===String(i)?"selected":null},"יום "+d));
  });

  dlCard.appendChild(div("form-row",[
    div("form-col",[e("label",{class:"form-label"},"יום סגירה"),dlDaySelect]),
    div("form-col",[e("label",{class:"form-label"},"שעת סגירה"),e("input",{class:"fi",type:"time",value:sd.deadlineTime,oninput:ev=>{sd.deadlineTime=ev.target.value}})])
  ]));

  // Show current deadline status
  if (sd.deadlineDay !== "") {
    dlCard.appendChild(e("div",{style:"background:#F59E0B18;border:1px solid #F59E0B33;border-radius:10px;padding:10px 14px;margin-top:12px;font-size:12px;color:#FCD34D"},
      "⏰ דדליין נוכחי: יום " + DAYS[parseInt(sd.deadlineDay)] + " בשעה " + sd.deadlineTime));
  }

  dlCard.appendChild(btn("btn-add","שמור דדליין",async()=>{
    await sb.from("businesses").update({
      deadline_day: sd.deadlineDay==="" ? null : parseInt(sd.deadlineDay),
      deadline_time: sd.deadlineTime
    }).eq("id",S.profile.business_id);
    S.business.deadline_day = sd.deadlineDay==="" ? null : parseInt(sd.deadlineDay);
    S.business.deadline_time = sd.deadlineTime;
    toast("דדליין עודכן ✓"); render();
  },{style:"width:100%;margin-top:12px"}));
  wrap.appendChild(dlCard);

  // Reminder to submit blocks
  const remCard = div("card",[e("div",{class:"card-title"},"🔔 תזכורת הגשת חסימות")]);
  // If the manager sends the reminder on Saturday (end of the week, Israel time),
  // the "next week" is probably already scheduled — target the week after that instead.
  const reminderOffset = (israelNow().getDay() === 6) ? 2 : 1;
  remCard.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:14px"},
    "שלח תזכורת לעובדים שעדיין לא הגישו חסימות ל" + (reminderOffset===2 ? "שבוע הבא-הבא" : "שבוע הבא")));
  const nextWeekDates2 = getWeekDates(reminderOffset);
  const allEmps = S.employees.filter(emp => emp.email);

  // Inline deadline picker — ONLY for the reminder message (shown in WhatsApp/email).
  // Independent from the enforced deadline (business.deadline_day) in settings — this
  // one is purely informational, so the manager can suggest a deadline in the message
  // without actually blocking submissions after that time.
  if (sd.remDeadlineDay === undefined) sd.remDeadlineDay = S.business?.reminder_deadline_day != null ? String(S.business.reminder_deadline_day) : "";
  if (sd.remDeadlineTime === undefined) sd.remDeadlineTime = S.business?.reminder_deadline_time || "20:00";
  const remDlDaySelect = e("select",{class:"fi",onchange:ev=>{sd.remDeadlineDay=ev.target.value}});
  remDlDaySelect.appendChild(e("option",{value:"",selected:sd.remDeadlineDay===""?"selected":null},"ללא דדליין בהודעה"));
  DAYS.forEach((d,i)=>{
    remDlDaySelect.appendChild(e("option",{value:String(i),selected:sd.remDeadlineDay===String(i)?"selected":null},"יום "+d));
  });
  const dlBox = e("div",{style:"background:#0F172A66;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:14px"},[
    e("div",{style:"font-size:12px;color:#94A3B8;font-weight:700;margin-bottom:4px"},"⏰ דדליין שיוצג בהודעת התזכורת"),
    e("div",{style:"font-size:10px;color:#64748B;margin-bottom:8px;line-height:1.4"},"רק להצגה בלבד — לא חוסם הגשה. לחסימה אוטומטית, שנה בכרטיס ההגדרות הראשי."),
    div("form-row",[
      div("form-col",[e("label",{class:"form-label",style:"font-size:11px"},"יום"),remDlDaySelect]),
      div("form-col",[e("label",{class:"form-label",style:"font-size:11px"},"שעה"),e("input",{class:"fi",type:"time",value:sd.remDeadlineTime,oninput:ev=>{sd.remDeadlineTime=ev.target.value}})])
    ]),
    btn("btn-sm btn-sm-blue","שמור דדליין להודעה",async()=>{
      const dayVal = sd.remDeadlineDay==="" ? null : parseInt(sd.remDeadlineDay);
      await sb.from("businesses").update({reminder_deadline_day: dayVal, reminder_deadline_time: sd.remDeadlineTime}).eq("id",S.profile.business_id);
      S.business.reminder_deadline_day = dayVal;
      S.business.reminder_deadline_time = sd.remDeadlineTime;
      toast("דדליין להודעה עודכן ✓"); render();
    },{style:"width:100%;margin-top:8px"}),
    (sd.remDeadlineDay !== "" && S.business?.reminder_deadline_day != null) ? e("div",{style:"font-size:11px;color:#FCD34D;margin-top:8px;text-align:center"},
      "📌 יוצג בהודעה: יום " + DAYS[S.business.reminder_deadline_day] + " בשעה " + (S.business.reminder_deadline_time||"20:00")) : null
  ]);
  remCard.appendChild(dlBox);

  remCard.appendChild(e("button",{
    style:"width:100%;padding:14px;background:linear-gradient(135deg,#F59E0B,#F97316);color:#0F172A;border:none;border-radius:12px;font-weight:800;font-size:15px;font-family:inherit;cursor:pointer;margin-bottom:12px",
    onclick:async()=>{
      if(allEmps.length===0){toast("אין עובדים עם מייל","err");return;}
      for(const emp of allEmps){
        // Use the reminder-only deadline if set, otherwise fall back to the enforced one
        const dlDay2 = S.business?.reminder_deadline_day ?? S.business?.deadline_day;
        const dlTime2 = S.business?.reminder_deadline_time || S.business?.deadline_time || "20:00";
        const dlText = dlDay2 != null ? "יום " + DAYS[dlDay2] + " בשעה " + dlTime2 : "";
        await sendEmail("reminder",emp.email,{weekLabel:fmtDate(nextWeekDates2[0])+" — "+fmtDate(nextWeekDates2[6]),deadline:dlText});
      }
      toast("תזכורת נשלחה ל-"+allEmps.length+" עובדים ✓");
    }
  },"📧 שלח תזכורת לכל העובדים במייל ("+allEmps.length+")"));
  remCard.appendChild(e("button",{
    style:"width:100%;padding:14px;background:#25D366;color:white;border:none;border-radius:12px;font-weight:800;font-size:15px;font-family:inherit;cursor:pointer;margin-bottom:12px",
    onclick:()=>{
      // Use the reminder-only deadline if set, otherwise fall back to the enforced one
      const dlDay3 = S.business?.reminder_deadline_day ?? S.business?.deadline_day;
      const dlTime3 = S.business?.reminder_deadline_time || S.business?.deadline_time || "20:00";
      const dlLine = dlDay3 != null ? "⏰ *דדליין: יום " + DAYS[dlDay3] + " בשעה " + dlTime3 + "*\n\n" : "";
      const msg = "📢 *תזכורת הגשת חסימות*\n\n"
        + "שלום לכולם,\n"
        + "נא להגיש חסימות לשבוע *" + fmtDate(nextWeekDates2[0]) + " — " + fmtDate(nextWeekDates2[6]) + "*\n\n"
        + dlLine
        + "היכנסו למערכת והגישו בהקדם:\n"
        + (APP_URL||"https://mishmert.com/");
      window.open("https://wa.me/?text="+encodeURIComponent(msg));
      toast("נפתח WhatsApp ✓");
    }
  },"📲 שלח תזכורת ב-WhatsApp"));

  remCard.appendChild(e("div",{style:"border-top:1px solid #334155;padding-top:14px;margin-top:14px"},[
    e("div",{style:"font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:10px"},"⏰ תזכורת אוטומטית")
  ]));
  if(!sd.reminderDay) sd.reminderDay = S.business?.reminder_day!=null ? String(S.business.reminder_day) : "";
  if(!sd.reminderTime) sd.reminderTime = S.business?.reminder_time || "09:00";
  const remDaySelect = e("select",{class:"fi",style:"flex:1",onchange:ev=>{sd.reminderDay=ev.target.value}});
  remDaySelect.appendChild(e("option",{value:"",selected:sd.reminderDay===""?"selected":null},"ללא תזכורת אוטומטית"));
  DAYS.forEach((d,i)=>{remDaySelect.appendChild(e("option",{value:String(i),selected:sd.reminderDay===String(i)?"selected":null},"יום "+d));});
  remCard.appendChild(div("form-row",[
    div("form-col",[e("label",{class:"form-label"},"יום שליחה"),remDaySelect]),
    div("form-col",[e("label",{class:"form-label"},"שעה"),e("input",{class:"fi",type:"time",value:sd.reminderTime,oninput:ev=>{sd.reminderTime=ev.target.value}})])
  ]));
  remCard.appendChild(e("div",{style:"font-size:11px;color:#475569;margin-top:6px;margin-bottom:12px"},"התזכורת תישלח אוטומטית לעובדים שטרם הגישו"));
  remCard.appendChild(btn("btn-add","שמור הגדרות תזכורת",async()=>{
    await sb.from("businesses").update({reminder_day:sd.reminderDay===""?null:parseInt(sd.reminderDay),reminder_time:sd.reminderTime}).eq("id",S.profile.business_id);
    S.business.reminder_day=sd.reminderDay===""?null:parseInt(sd.reminderDay);
    S.business.reminder_time=sd.reminderTime;
    toast("הגדרות תזכורת נשמרו ✓");render();
  },{style:"width:100%"}));
  if(sd.reminderDay!==""){
    remCard.appendChild(e("div",{style:"background:#3B82F618;border:1px solid #3B82F633;border-radius:10px;padding:10px 14px;margin-top:12px;font-size:12px;color:#60A5FA"},"⏰ תזכורת כל יום "+DAYS[parseInt(sd.reminderDay)]+" בשעה "+sd.reminderTime));
  }
  wrap.appendChild(remCard);

  // ─── Qualifications Config ───
  const qualCard = div("card",[e("div",{class:"card-title"},"🎯 הגדרות כשירות")]);
  qualCard.appendChild(e("div",{style:"color:#64748B;font-size:13px;margin-bottom:14px"},"הגדר כמה ימים עובד נחשב כשיר על מערכת/משמרת לפני שפג"));
  
  if (!S.qualifications) S.qualifications = {systems:{},shifts:{}};
  if (!S.qualifications.systems) S.qualifications.systems = {};
  if (!S.qualifications.shifts) S.qualifications.shifts = {};
  
  // Systems quals
  if ((S.systems||[]).length === 0) {
    qualCard.appendChild(e("div",{style:"color:#475569;font-size:12px;padding:8px;text-align:center;background:#0F172A;border-radius:8px;margin-bottom:12px"},"💡 הוסף קודם מערכות בכרטיס מתחת"));
  } else {
    qualCard.appendChild(e("div",{style:"font-weight:700;font-size:13px;color:#94A3B8;margin-bottom:8px"},"🏷️ מערכות"));
    S.systems.forEach(sys => {
      if (!S.qualifications.systems[sys]) S.qualifications.systems[sys] = 30;
      const curVal = S.qualifications.systems[sys];
      qualCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid #3B82F633"},[
        e("div",{style:"font-weight:700;font-size:12px;color:#60A5FA;flex:1"},"🏷️ "+sys),
        e("input",{
          type:"number",min:1,max:365,value:curVal,
          style:"background:#1E293B;border:1px solid #334155;border-radius:8px;color:#E2E8F0;padding:6px 10px;font-size:14px;font-family:inherit;width:70px;text-align:center",
          oninput:ev=>{S.qualifications.systems[sys]=parseInt(ev.target.value)||30;}
        }),
        e("span",{style:"font-size:12px;color:#64748B"},"ימים")
      ]));
    });
  }
  
  // Morning shifts quals
  qualCard.appendChild(e("div",{style:"font-weight:700;font-size:13px;color:#94A3B8;margin-bottom:8px;margin-top:14px"},"🌅 משמרות בוקר"));
  [{id:"morning",label:"בוקר",color:"#F59E0B"},{id:"morning2",label:"בוקר ב׳",color:"#F97316"}].forEach(sh => {
    if (!S.qualifications.shifts[sh.id]) S.qualifications.shifts[sh.id] = 21;
    const curVal = S.qualifications.shifts[sh.id];
    qualCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:8px;margin-bottom:6px;background:#0F172A;border-radius:10px;padding:8px 12px;border:1px solid "+sh.color+"33"},[
      e("div",{style:"font-weight:700;font-size:12px;color:"+sh.color+";flex:1"},sh.label),
      e("input",{
        type:"number",min:1,max:365,value:curVal,
        style:"background:#1E293B;border:1px solid #334155;border-radius:8px;color:#E2E8F0;padding:6px 10px;font-size:14px;font-family:inherit;width:70px;text-align:center",
        oninput:ev=>{S.qualifications.shifts[sh.id]=parseInt(ev.target.value)||21;}
      }),
      e("span",{style:"font-size:12px;color:#64748B"},"ימים")
    ]));
  });
  
  qualCard.appendChild(btn("btn-add","שמור הגדרות כשירות",async()=>{
    await sb.from("businesses").update({qualifications:S.qualifications}).eq("id",S.profile.business_id);
    S.business.qualifications = S.qualifications;
    if (typeof logAction === "function") logAction("qualifications_updated", S.qualifications);
    toast("הגדרות נשמרו ✓");render();
  },{style:"width:100%;margin-top:8px"}));
  wrap.appendChild(qualCard);

  // ─── Systems / Tags Management ───
  const sysCard = div("card",[e("div",{class:"card-title"},"🏷️ מערכות / תגיות להערות")]);
  sysCard.appendChild(e("div",{style:"color:#64748B;font-size:13px;margin-bottom:14px"},"הגדר רשימת מערכות שתופיע באפשרות לבחירה כשמוסיפים הערה לשיבוץ"));
  
  // Existing systems list
  const sysListDiv = e("div",{style:"display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;min-height:32px"});
  if ((S.systems||[]).length === 0) {
    sysListDiv.appendChild(e("div",{style:"color:#475569;font-size:12px;padding:8px;text-align:center;width:100%"},"אין מערכות עדיין — הוסף מערכת ראשונה למטה"));
  } else {
    S.systems.forEach((sys, i) => {
      sysListDiv.appendChild(e("div",{
        style:"display:inline-flex;align-items:center;gap:6px;background:#3B82F622;border:1px solid #3B82F644;color:#60A5FA;border-radius:20px;padding:5px 10px;font-size:12px;font-weight:600"
      },[
        e("span",{},"🏷️ "+sys),
        e("button",{
          style:"background:none;border:none;color:#EF4444;cursor:pointer;font-size:16px;line-height:1;padding:0 2px;font-family:inherit",
          title:"מחק",
          onclick:async()=>{
            if(!(await uiConfirm({title:"למחוק תג?", message:"התג \"" + sys + "\" יוסר לצמיתות.", tone:"danger", okLabel:"מחק תג"}))) return;
            S.systems.splice(i,1);
            await sb.from("businesses").update({systems:S.systems}).eq("id",S.profile.business_id);
            S.business.systems = S.systems;
            toast("המערכת נמחקה");
            render();
          }
        },"×")
      ]));
    });
  }
  sysCard.appendChild(sysListDiv);
  
  // Add new system input
  const sysInputRow = e("div",{style:"display:flex;gap:6px"});
  const sysInput = e("input",{
    class:"fi",
    placeholder:"שם מערכת (לדוגמה: Cortex XDR, Firewall...)",
    style:"flex:1",
    id:"sysAddInput"
  });
  sysInputRow.appendChild(sysInput);
  sysInputRow.appendChild(e("button",{
    style:"padding:10px 16px;background:#3B82F6;color:white;border:none;border-radius:8px;font-weight:700;font-family:inherit;font-size:13px;cursor:pointer",
    onclick:async()=>{
      const inp = document.getElementById("sysAddInput");
      const val = (inp?.value||"").trim();
      if (!val) return;
      if ((S.systems||[]).includes(val)) { toast("המערכת כבר קיימת","err"); return; }
      S.systems = [...(S.systems||[]), val];
      await sb.from("businesses").update({systems:S.systems}).eq("id",S.profile.business_id);
      S.business.systems = S.systems;
      toast("✓ נוספה");
      render();
    }
  },"+ הוסף"));
  sysCard.appendChild(sysInputRow);
  wrap.appendChild(sysCard);

  // Export
  const expCard = div("card",[e("div",{class:"card-title"},"📤 ייצוא סידור")]);
  expCard.appendChild(e("div",{style:"color:#64748B;font-size:13px;margin-bottom:14px"},"ייצא את הסידור השבועי הנוכחי"));
  expCard.appendChild(div("form-actions",[
    btn("btn-green","🖨️ ייצוא PDF / הדפסה",()=>{S.showExportModal="pdf";render();},{style:"flex:1"}),
    btn("btn-sm btn-sm-blue","📊 ייצוא CSV",()=>{S.showExportModal="csv";render();},{style:"flex:1"})
  ]));
  expCard.appendChild(e("button",{
    style:"width:100%;padding:12px;background:#25D366;color:white;border:none;border-radius:10px;font-weight:800;font-size:14px;font-family:inherit;cursor:pointer;margin-top:10px",
    onclick:()=>{S.showExportModal="whatsapp";render();}
  },"📲 שלח סידור כתמונה ב-WhatsApp"));
  wrap.appendChild(expCard);

  // PWA install
  const pwaCard = div("card",[e("div",{class:"card-title"},"📱 התקנה על הטלפון")]);
  pwaCard.appendChild(e("div",{style:"font-size:13px;color:#94A3B8;margin-bottom:12px"},"התקן את משמרת כאפליקציה על מסך הבית שלך"));

  if (S.pwaPrompt) {
    pwaCard.appendChild(btn("btn-purple","📱 התקן אפליקציה",async()=>{
      S.pwaPrompt.prompt();
      const {outcome}=await S.pwaPrompt.userChoice;
      if(outcome==="accepted"){S.pwaPrompt=null;toast("אפליקציה הותקנה ✓");}
      render();
    },{style:"width:100%"}));
  } else {
    pwaCard.appendChild(e("div",{style:"background:#1E3A5F;border-radius:10px;padding:14px"},[
      e("div",{style:"font-weight:700;font-size:13px;color:#60A5FA;margin-bottom:8px"},"כיצד להתקין:"),
      e("div",{style:"font-size:12px;color:#94A3B8;line-height:1.8"},[
        e("div",{},"📱 iPhone: לחץ על שתף ← הוסף למסך הבית"),
        e("div",{},"🤖 Android: לחץ על תפריט ← הוסף למסך הבית"),
        e("div",{},"💻 Chrome: לחץ על + בשורת הכתובת")
      ])
    ]));
  }
  wrap.appendChild(pwaCard);

  // Change password
  const passCard = div("card",[e("div",{class:"card-title"},"🔐 שינוי סיסמה")]);
  const newPassInp = e("input",{class:"fi",type:"password",placeholder:"סיסמה חדשה (לפחות 10 תווים)",style:"margin-bottom:12px"});
  const confPassInp = e("input",{class:"fi",type:"password",placeholder:"אשר סיסמה חדשה",style:"margin-bottom:12px"});
  passCard.appendChild(div("form-col",[e("label",{class:"form-label"},"סיסמה חדשה"),newPassInp],{style:"margin-bottom:10px"}));
  passCard.appendChild(div("form-col",[e("label",{class:"form-label"},"אישור סיסמה"),confPassInp],{style:"margin-bottom:12px"}));
  passCard.appendChild(e("div",{style:"font-size:11px;color:#64748B;margin-bottom:10px;line-height:1.6"},
    "💡 לפחות 10 תווים"));
  passCard.appendChild(btn("btn-add","🔐 שמור סיסמה חדשה",async()=>{
    const newPass = newPassInp.value;
    const confPass = confPassInp.value;
    const pwErr = validatePassword(newPass);
    if (pwErr) { toast(pwErr, "err"); return; }
    if (newPass !== confPass) { toast("הסיסמאות לא תואמות","err"); return; }
    const {error} = await sb.auth.updateUser({password: newPass});
    if (error) { toast(friendlyError(error),"err"); return; }
    newPassInp.value=""; confPassInp.value="";
    toast("סיסמה עודכנה בהצלחה ✓");
  },{style:"width:100%"}));
  wrap.appendChild(passCard);

  // Transfer ownership — only the actual owner, not just any admin
  if (S.business?.owner_id === S.user?.id) {
    const transCard = div("card",[e("div",{class:"card-title"},"👑 העברת בעלות")]);
    transCard.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:12px"},"העבר את תפקיד המנהל הראשי לעובד אחר. לאחר ההעברה תהפוך לעובד רגיל."));

    const empSelect = e("select",{class:"fi",style:"margin-bottom:12px",id:"transfer-select"});
    empSelect.appendChild(e("option",{value:""},"בחר עובד..."));
    S.employees.filter(emp => emp.id !== S.user.id).forEach(emp => {
      empSelect.appendChild(e("option",{value:emp.id},emp.name + " (" + (emp.email||"ללא מייל") + ")"));
    });
    transCard.appendChild(empSelect);

    transCard.appendChild(btn("btn-sm btn-sm-red","👑 העבר בעלות",async()=>{
      const targetId = document.getElementById("transfer-select")?.value;
      if (!targetId) { toast("בחר עובד","err"); return; }
      const targetEmp = getEmp(targetId);
      if (!(await uiConfirm({title:"להעביר בעלות?", message:"לאחר ההעברה:\n• " + targetEmp?.name + " יהפוך למנהל ראשי\n• אתה תהפוך לעובד רגיל\n• הפעולה לא ניתנת לביטול", tone:"danger", okLabel:"המשך להעברה"}))) return;
      if (!(await uiConfirm({title:"אישור סופי", message:"להעביר את כל ההרשאות ל-" + targetEmp?.name + "? הפעולה בלתי הפיכה.", tone:"danger", okLabel:"העבר בעלות"}))) return;

      // Update owner in businesses table
      await sb.from("businesses").update({owner_id: targetId}).eq("id", S.profile.business_id);
      // Make target admin
      await sb.from("profiles").update({role: "admin"}).eq("id", targetId);
      // Demote self to employee
      await sb.from("profiles").update({role: "employee"}).eq("id", S.user.id);

      // Send email to new owner
      if (targetEmp?.email) {
        sendEmail("swap_request", targetEmp.email, {
          requesterName: "מערכת משמרת",
          targetDate: new Date().toLocaleDateString("he-IL"),
          shiftLabel: "👑 הועברה אליך בעלות על המערכת",
          note: S.profile.name + " העביר אליך את ניהול המערכת. כעת יש לך גישת מנהל מלאה."
        });
      }

      toast("הבעלות הועברה ל-" + targetEmp?.name + " ✓");
      await loadAll(S.user);
    },{style:"width:100%"}));
    wrap.appendChild(transCard);
  }

  // Push notifications (personal — this device)
  const pushCard2 = div("card",[e("div",{class:"card-title"},"🔔 התראות Push (למכשיר הזה)")]);
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushCard2.appendChild(e("div",{style:"font-size:13px;color:#64748B"},"הדפדפן הזה לא תומך בהתראות Push."));
  } else if (Notification.permission === "denied") {
    pushCard2.appendChild(e("div",{style:"font-size:13px;color:#EF4444"},"ההתראות נחסמו בהגדרות הדפדפן/הטלפון. יש לאפשר אותן מחדש בהגדרות כדי לקבל עדכונים."));
  } else {
    pushCard2.appendChild(e("div",{style:"font-size:13px;color:#94A3B8;margin-bottom:12px"},"קבל התראה אישית על אירועים שנוגעים אליך (למשל אישור חופשה שביקשת, החלטה על חילוף)."));
    pushCard2.appendChild(btn("btn-purple","🔔 הפעל התראות Push",enablePushNotifications,{style:"width:100%;margin-bottom:8px"}));
    pushCard2.appendChild(btn("btn-sm btn-sm-gray","כבה התראות במכשיר הזה",disablePushNotifications,{style:"width:100%"}));
  }
  if (isFeatureEnabled("push_notifications")) wrap.appendChild(pushCard2);

  // Who receives notifications — owner only
  if (S.business?.owner_id === S.user?.id) {
    const allMgrsForCard = S.employees.filter(e => (e.role === "admin" || e.role === "manager") && e.email);
    const configuredIds = S.business?.notified_manager_ids;
    const usingAll = !Array.isArray(configuredIds) || configuredIds.length === 0;
    const selectedSet = new Set(usingAll ? allMgrsForCard.map(m=>m.id) : configuredIds);

    const notifCard = div("card",[e("div",{class:"card-title"},"👑 מי מקבל התראות")]);
    notifCard.appendChild(e("div",{style:"font-size:13px;color:#94A3B8;margin-bottom:12px"},
      "בחר אילו מנהלים יקבלו התראות (מייל + Push) על בקשות חופשה, חילופים והצטרפות למשמרת. כברירת מחדל כולם מקבלים."));

    const listWrap = e("div",{style:"display:flex;flex-direction:column;gap:8px;margin-bottom:12px"});
    allMgrsForCard.forEach(mgr => {
      const isSel = selectedSet.has(mgr.id);
      const row = e("label",{style:"display:flex;align-items:center;gap:10px;background:#0F172A;border:1px solid #334155;border-radius:10px;padding:10px 14px;cursor:pointer"},[
        e("input",{type:"checkbox",checked:isSel?"checked":null,
          onchange:(ev)=>{ if(ev.target.checked) selectedSet.add(mgr.id); else selectedSet.delete(mgr.id); }
        }),
        e("span",{style:"font-size:13px;color:#E2E8F0;font-weight:600"},mgr.name),
        mgr.id === S.business?.owner_id ? e("span",{style:"font-size:10px;color:#FCD34D"},"👑 בעלים") : null
      ]);
      listWrap.appendChild(row);
    });
    notifCard.appendChild(listWrap);

    notifCard.appendChild(btn("btn-purple","💾 שמור",async()=>{
      const ids = Array.from(selectedSet);
      if (ids.length === 0) { toast("בחר לפחות מנהל אחד", "err"); return; }
      const { error } = await sb.from("businesses").update({ notified_manager_ids: ids }).eq("id", S.profile.business_id);
      if (error) { toast(friendlyError(error), "err"); return; }
      S.business.notified_manager_ids = ids;
      toast("הגדרות התראות נשמרו ✓");
      render();
    },{style:"width:100%"}));

    if (!usingAll) {
      notifCard.appendChild(btn("btn-sm btn-sm-gray","איפוס לברירת מחדל (כולם)",async()=>{
        const { error } = await sb.from("businesses").update({ notified_manager_ids: null }).eq("id", S.profile.business_id);
        if (error) { toast(friendlyError(error), "err"); return; }
        S.business.notified_manager_ids = null;
        toast("אופס לברירת מחדל ✓");
        render();
      },{style:"width:100%;margin-top:8px"}));
    }

    wrap.appendChild(notifCard);
  }

  // Danger zone
  const dangerCard = div("card",[e("div",{style:"font-weight:700;font-size:14px;color:#EF4444;margin-bottom:12px"},"⚠️ אזור מסוכן")]);
  dangerCard.appendChild(btn("btn-sm btn-sm-red","יציאה מהמערכת",handleLogout,{style:"margin-bottom:8px;width:100%"}));
  wrap.appendChild(dangerCard);

  return wrap;
}

// ══════════════════════════════════════════════════════
// EMPLOYEE VACATION VIEW (self-service)
// ══════════════════════════════════════════════════════
function viewEmpVacations() {
  // When manager is viewing as employee, use that employee's ID
  const viewingEmpId = S.testAsEmployee && S.empViewId ? S.empViewId : S.user.id;
  const my = S.vacations.filter(x => x.employee_id === viewingEmpId);
  const wrap = div("");

  wrap.appendChild(div("page-title", ["🌴 היעדרויות"]));

  wrap.appendChild(btn("btn-add", "+ הגשת בקשה חדשה", () => {
    S.showAddVac = !S.showAddVac;
    if (S.showAddVac) S.newVac = { type: "vacation", startDate: "", endDate: "", reason: "" };
    render();
  }, { style: "width:100%; margin-bottom:15px; padding:15px; font-weight:800;" }));

  // Submission form
  if (S.showAddVac) {
    const typeIcons = { vacation: "🌴", reserve: "🎖️", exam: "📝" };
    const typeNames = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };

    const f = div("card", [div("card-title", ["📝 הגשת בקשה חדשה"])]);

    // Type selector - big buttons
    const typeSel = e("div", { style: "display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px" });
    ["vacation", "reserve", "exam"].forEach(type => {
      const sel = (S.newVac.type || "vacation") === type;
      const colors = { vacation: "#10B981", reserve: "#6366F1", exam: "#F59E0B" };
      typeSel.appendChild(e("button", {
        style: `padding:12px 8px;border-radius:12px;border:2px solid ${sel ? colors[type] : colors[type]+"44"};background:${sel ? colors[type]+"22" : "#0F172A"};color:${sel ? colors[type] : "#64748B"};font-family:inherit;font-weight:800;font-size:13px;cursor:pointer`,
        onclick: () => { S.newVac.type = type; render(); }
      }, [
        e("div", { style: "font-size:20px;margin-bottom:4px" }, typeIcons[type]),
        e("div", {}, typeNames[type])
      ]));
    });
    f.appendChild(typeSel);

    // Info banner based on type
    const infos = {
      vacation: { color: "#10B981", text: "📤 בקשת חופשה תישלח לאישור מנהל — לאחר אישור תחסום את המשמרות" },
      reserve:  { color: "#6366F1", text: "📤 בקשת מילואים תישלח לאישור מנהל — לאחר אישור תחסום את המשמרות" },
      exam:     { color: "#F59E0B", text: "📤 בקשת מבחן תישלח לאישור מנהל — לאחר אישור לא תחסום משמרות, רק תתריע" },
    };
    const info = infos[S.newVac.type || "vacation"];
    f.appendChild(e("div", {
      style: `background:${info.color}11;border:1px solid ${info.color}33;border-radius:10px;padding:10px 14px;font-size:12px;font-weight:600;color:${info.color};margin-bottom:14px`
    }, info.text));

    f.appendChild(div("form-row", [
      div("form-col", [
        e("label", { class: "form-label" }, "מתאריך *"),
        e("input", { type: "date", class: "fi", value: S.newVac.startDate||"", onchange: x => {
          S.newVac.startDate = x.target.value;
          // Auto-fill end date if empty/earlier — most absences are single-day.
          if (!S.newVac.endDate || S.newVac.endDate < x.target.value) S.newVac.endDate = x.target.value;
          render();
        }})
      ]),
      div("form-col", [
        e("label", { class: "form-label" }, "עד תאריך *"),
        e("input", { type: "date", class: "fi", value: S.newVac.endDate||"", onchange: x => { S.newVac.endDate = x.target.value; render(); } })
      ])
    ]));

    // Live day-count + overlong-range warning (prevents the "wrong year on the wheel" bug).
    if (S.newVac.startDate && S.newVac.endDate && S.newVac.endDate >= S.newVac.startDate) {
      const dayDiff = Math.round((new Date(S.newVac.endDate+"T00:00:00") - new Date(S.newVac.startDate+"T00:00:00")) / 86400000) + 1;
      const tooLong = dayDiff > 90;
      const weirdYear = S.newVac.endDate.slice(0,4) !== S.newVac.startDate.slice(0,4) && dayDiff > 180;
      f.appendChild(e("div",{style:`padding:8px 12px;border-radius:8px;margin-bottom:10px;font-size:13px;font-weight:600;background:${tooLong ? "#EF444422" : "#10B98122"};color:${tooLong ? "#FCA5A5" : "#86EFAC"};border:1px solid ${tooLong ? "#EF444466" : "#10B98144"}`},
        tooLong
          ? `⚠️ טווח חריג: ${dayDiff} ימים${weirdYear ? " (חוצה שנה — בדוק שהשנה נכונה!)" : ""}`
          : `✓ ${dayDiff} ${dayDiff === 1 ? "יום" : "ימים"}`
      ));
    }

    // Partial-day option for the first & last days (vacation/reserve only — exam doesn't block)
    if ((S.newVac.type || "vacation") !== "exam" && S.newVac.startDate && S.newVac.endDate && S.newVac.endDate >= S.newVac.startDate) {
      if (!S.newVac.startDayShifts) S.newVac.startDayShifts = null; // null = whole day
      if (!S.newVac.endDayShifts) S.newVac.endDayShifts = null;

      const buildPartialRow = (label, dateStr, key) => {
        const wrapEl = e("div", { style: "background:#0F172A;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:10px" });
        const partial = S.newVac[key] != null; // array present = partial
        wrapEl.appendChild(e("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:8px" }, [
          e("div", { style: "font-size:12px;font-weight:700;color:#E2E8F0" }, label + " (" + fmtDate(dateStr) + ")"),
          e("label", { style: "display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;color:#94A3B8" }, [
            e("input", { type: "checkbox", checked: partial ? "checked" : null, onchange: (ev) => {
              S.newVac[key] = ev.target.checked ? [] : null;
              render();
            }}),
            e("span", {}, "יום חלקי (יכול לעבוד חלק מהמשמרות)")
          ])
        ]));
        if (partial) {
          wrapEl.appendChild(e("div", { style: "font-size:10px;color:#64748B;margin-bottom:8px" }, "סמן את המשמרות שאתה לא יכול לעבוד ביום הזה:"));
          const chips = e("div", { style: "display:flex;flex-wrap:wrap;gap:6px" });
          SHIFTS.forEach(sh => {
            const blocked = (S.newVac[key] || []).includes(sh.id);
            chips.appendChild(e("button", {
              style: `padding:6px 12px;border-radius:8px;border:1px solid ${blocked ? sh.color : "#334155"};background:${blocked ? sh.color+"22" : "#1E293B"};color:${blocked ? sh.color : "#64748B"};font-family:inherit;font-size:12px;font-weight:700;cursor:pointer`,
              onclick: () => {
                const arr = S.newVac[key] || [];
                S.newVac[key] = blocked ? arr.filter(x => x !== sh.id) : [...arr, sh.id];
                render();
              }
            }, (blocked ? "🚫 " : "") + sh.label));
          });
          wrapEl.appendChild(chips);
        }
        return wrapEl;
      };

      const partWrap = e("div", { style: "margin-bottom:14px" });
      partWrap.appendChild(e("div", { style: "font-size:12px;font-weight:700;color:#A855F7;margin-bottom:8px" }, "🕐 ימים חלקיים (אופציונלי)"));
      partWrap.appendChild(buildPartialRow("יום ראשון של החופש", S.newVac.startDate, "startDayShifts"));
      // Only show the last-day row if it's a different day
      if (S.newVac.endDate !== S.newVac.startDate) {
        partWrap.appendChild(buildPartialRow("יום אחרון של החופש", S.newVac.endDate, "endDayShifts"));
      }
      f.appendChild(partWrap);
    }

    f.appendChild(e("label", { class: "form-label", style: "margin-top:8px;display:block" }, "הערה (אופציונלי)"));
    f.appendChild(e("input", {
      class: "fi", placeholder: "למשל: מבחן בליניארית, מילואים בנגב...",
      style: "margin-bottom:14px",
      oninput: x => S.newVac.reason = x.target.value
    }));

    f.appendChild(btn("btn-primary", "שלח בקשה", async () => {
      if (!S.newVac.startDate || !S.newVac.endDate) return toast("נא למלא תאריכים", "err");
      await addVacation();
      S.showAddVac = false;
      render();
    }, { style: "width:100%; padding:12px;" }));
    wrap.appendChild(f);
  }

  // List of requests
  if (my.length === 0) {
    wrap.appendChild(div("card", [e("div", { style: "text-align:center;padding:24px;color:#64748B" }, "אין בקשות קודמות")]));
  } else {
    const card = div("card");
    const typeIcons2 = { vacation: "🌴", reserve: "🎖️", exam: "📝" };
    const typeNames2 = { vacation: "חופשה", reserve: "מילואים", exam: "מבחן" };
    const typeColors = { vacation: "#10B981", reserve: "#6366F1", exam: "#F59E0B" };

    my.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))).forEach(v => {
      const st = v.status === "approved" ? "approved" : v.status === "rejected" ? "rejected" : "pending";
      const label = v.status === "approved" ? "אושרה ✓" : v.status === "rejected" ? "נדחתה ✗" : "ממתין לאישור";
      const col = typeColors[v.type] || "#10B981";

      card.appendChild(e("div", { style: "display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #0F172A" }, [
        e("div", {}, [
          e("div", { style: `font-weight:800;font-size:14px;color:#F1F5F9` }, [
            e("span", { style: `color:${col};margin-left:6px` }, typeIcons2[v.type] || "🌴"),
            `${typeNames2[v.type] || "חופשה"}: ${fmtDate(v.start_date)}${v.start_date !== v.end_date ? " — " + fmtDate(v.end_date) : ""}`
          ]),
          v.reason ? e("div", { style: "font-size:11px;color:#64748B;margin-top:3px" }, v.reason) : null,
          (describePartialVac(v)) ? e("div", { style: "font-size:10px;color:#C084FC;margin-top:2px" }, "🕐 "+describePartialVac(v)) : null,
          e("div", { style: "margin-top:5px" }, [e("span", { class: "status-badge status-" + st }, label)]),
          (v.status === "rejected" && v.reject_reason) ? e("div", { style: "margin-top:6px;background:#EF444415;border-right:3px solid #EF4444;border-radius:6px;padding:6px 10px" }, [
            e("span", { style: "font-size:10px;color:#FCA5A5;font-weight:700" }, "סיבת הדחייה: "),
            e("span", { style: "font-size:12px;color:#E2E8F0" }, v.reject_reason)
          ]) : null
        ]),
        btn("btn-sm btn-sm-red", "🗑️", () => deleteVacRequest(v.id))
      ]));
    });
    wrap.appendChild(card);
  }
  return wrap;
}

// ══════════════════════════════════════════════════════
// CALENDAR VIEW
// ══════════════════════════════════════════════════════
// Loads assignment counts for an ENTIRE month at once (unlike S.schedule, which only ever
// holds one week) so the monthly calendar view can show real data for every week, not just
// whichever week happens to be currently loaded elsewhere.
async function loadCalendarMonthData(firstStr, lastStr) {
  if (!S.profile?.business_id) return {};
  const rangeStart = new Date(firstStr+"T00:00:00");
  rangeStart.setDate(rangeStart.getDate() - 6); // a week's Sunday can precede the month's 1st
  const { data: scheds } = await sb.from("schedules").select("id")
    .eq("business_id", S.profile.business_id).eq("published", true)
    .gte("week_start", fmtYMD(rangeStart)).lte("week_start", lastStr);
  const schedIds = (scheds||[]).map(s=>s.id);
  if (schedIds.length === 0) return {};
  const { data: assigns } = await sb.from("assignments").select("date,shift,employee_id")
    .in("schedule_id", schedIds).gte("date", firstStr).lte("date", lastStr);
  const byDate = {};
  (assigns||[]).forEach(a => {
    if (!byDate[a.date]) byDate[a.date] = {};
    if (!byDate[a.date][a.shift]) byDate[a.date][a.shift] = [];
    byDate[a.date][a.shift].push(a.employee_id);
  });
  return byDate;
}

function viewCalendar() {
  const wrap = e("div");
  if (!S.monthOffset) S.monthOffset = 0;

  // Israel wall-clock — so "this month" / "today" in the calendar match the
  // business's calendar, not the device's local.
  const now = israelNow();
  const viewMonth = now.getMonth() + S.monthOffset;
  const viewYear = now.getFullYear() + Math.floor(viewMonth / 12);
  const actualMonth = ((viewMonth % 12) + 12) % 12;
  
  const monthName = new Date(viewYear, actualMonth, 1).toLocaleDateString("he-IL", {month:"long", year:"numeric"});

  wrap.appendChild(div("section-header",[
    div("page-title",["🗓️ "+monthName]),
    e("div",{style:"display:flex;gap:8px"},[
      btn("btn-sm btn-sm-gray","→",()=>{S.monthOffset--;S.calendarMonthData=null;render();}),
      btn("btn-sm btn-sm-blue","החודש",()=>{S.monthOffset=0;S.calendarMonthData=null;render();}),
      btn("btn-sm btn-sm-gray","←",()=>{S.monthOffset++;S.calendarMonthData=null;render();})
    ])
  ]));

  const firstDay = new Date(viewYear, actualMonth, 1);
  const lastDay = new Date(viewYear, actualMonth + 1, 0);
  const startDow = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const firstStr = fmtYMD(firstDay), lastStr = fmtYMD(lastDay);

  const cacheKey = viewYear+"-"+actualMonth;
  if (S.calendarMonthKey !== cacheKey) {
    S.calendarMonthData = null;
  }
  if (S.calendarMonthData === null) {
    loadCalendarMonthData(firstStr, lastStr).then(data => {
      S.calendarMonthData = data;
      S.calendarMonthKey = cacheKey;
      render();
    });
    wrap.appendChild(skeletonSchedule());
    return wrap;
  }
  const monthSchedData = S.calendarMonthData;

  const calCard = div("card");
  calCard.style.padding = "12px";

  // Day headers
  const hdrRow = e("div",{style:"display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px"});
  DAYS.forEach(d=>hdrRow.appendChild(e("div",{style:"text-align:center;font-size:11px;font-weight:700;color:#64748B;padding:4px 0"},d)));
  calCard.appendChild(hdrRow);

  const grid = e("div",{style:"display:grid;grid-template-columns:repeat(7,1fr);gap:2px"});

  for (let i=0; i<startDow; i++) {
    grid.appendChild(e("div",{style:"min-height:70px"}));
  }

  for (let d=1; d<=totalDays; d++) {
    const dateStr = viewYear+"-"+String(actualMonth+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
    const dt = new Date(dateStr+"T00:00:00");
    const isToday = dateStr === today();

    const cell = e("div",{
      style:"min-height:70px;background:"+(isToday?"#1E3A5F":"#1E293B")+";border-radius:8px;padding:4px;border:1px solid "+(isToday?"#3B82F6":"#334155")+";cursor:pointer;overflow:hidden",
      onclick:()=>{
        const diffDays = Math.round((dt - new Date(today()+"T00:00:00"))/(1000*60*60*24));
        S.weekOffset = Math.floor(diffDays/7);
        S.view="schedule";
        loadSchedule().then(()=>render());
      }
    });

    cell.appendChild(e("div",{style:"font-size:12px;font-weight:"+(isToday?"900":"600")+";color:"+(isToday?"#60A5FA":"#E2E8F0")+";margin-bottom:2px"},String(d)));
    const holiday = getHoliday(dateStr);
    if (holiday) {
      cell.appendChild(e("div",{style:"font-size:7px;color:#FCD34D;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"},"✡️ "+holiday));
    }

    // Show schedule data for the WHOLE month (not just whatever week happened to be loaded)
    const daySched = monthSchedData[dateStr];
    if (daySched) {
      SHIFTS.forEach(sh => {
        const empIds = daySched[sh.id];
        if (Array.isArray(empIds) && empIds.length > 0) {
          cell.appendChild(e("div",{style:"font-size:8px;background:"+sh.color+"22;color:"+sh.color+";border-radius:3px;padding:1px 3px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"},sh.label+": "+empIds.length));
        }
      });
    }

    // Vacations
    const dayVacs = S.vacations.filter(v=>v.status==="approved"&&v.type!=="exam"&&dateStr>=v.start_date&&dateStr<=v.end_date);
    dayVacs.slice(0,2).forEach(v=>{
      const emp=getEmp(v.employee_id);
      if(emp) cell.appendChild(e("div",{style:"font-size:8px;color:#F59E0B;white-space:nowrap;overflow:hidden"},"🌴 "+emp.name.split(" ")[0]));
    });

    grid.appendChild(cell);
  }

  calCard.appendChild(grid);
  wrap.appendChild(calCard);
  return wrap;
}

// ══════════════════════════════════════════════════════
// EMPLOYEE SETTINGS
// ══════════════════════════════════════════════════════
function viewEmpSettings() {
  const wrap = e("div");
  wrap.appendChild(div("page-title",["⚙️ הגדרות"],{style:"margin-bottom:16px"}));

  // Change password
  const passCard = div("card",[e("div",{class:"card-title"},"🔐 שינוי סיסמה")]);
  const newPass = e("input",{class:"fi",type:"password",placeholder:"סיסמה חדשה (לפחות 10 תווים)",style:"margin-bottom:10px"});
  const confPass = e("input",{class:"fi",type:"password",placeholder:"אישור סיסמה חדשה",style:"margin-bottom:12px"});
  passCard.appendChild(div("form-col",[e("label",{class:"form-label"},"סיסמה חדשה"),newPass],{style:"margin-bottom:10px"}));
  passCard.appendChild(div("form-col",[e("label",{class:"form-label"},"אישור סיסמה"),confPass],{style:"margin-bottom:12px"}));
  passCard.appendChild(e("div",{style:"font-size:11px;color:#64748B;margin-bottom:10px;line-height:1.6"},
    "💡 לפחות 10 תווים"));
  passCard.appendChild(btn("btn-add","🔐 שמור סיסמה חדשה",async()=>{
    const pwErr = validatePassword(newPass.value);
    if (pwErr) { toast(pwErr, "err"); return; }
    if (newPass.value !== confPass.value) { toast("הסיסמאות לא תואמות","err"); return; }
    const {error} = await sb.auth.updateUser({password: newPass.value});
    if (error) { toast(friendlyError(error),"err"); return; }
    newPass.value=""; confPass.value="";
    toast("סיסמה עודכנה בהצלחה ✓");
  },{style:"width:100%"}));
  wrap.appendChild(passCard);

  // Install PWA
  const pwaCard = div("card",[e("div",{class:"card-title"},"📱 התקנה על הטלפון")]);
  pwaCard.appendChild(e("div",{style:"font-size:13px;color:#94A3B8;margin-bottom:12px"},"התקן את משמרת כאפליקציה על מסך הבית"));
  if (S.pwaPrompt) {
    pwaCard.appendChild(btn("btn-purple","📱 התקן אפליקציה",async()=>{
      S.pwaPrompt.prompt();
      const {outcome}=await S.pwaPrompt.userChoice;
      if(outcome==="accepted"){S.pwaPrompt=null;toast("אפליקציה הותקנה ✓");}
      render();
    },{style:"width:100%"}));
  } else {
    pwaCard.appendChild(e("div",{style:"background:#1E3A5F;border-radius:10px;padding:14px"},[
      e("div",{style:"font-weight:700;font-size:13px;color:#60A5FA;margin-bottom:8px"},"כיצד להתקין:"),
      e("div",{style:"font-size:12px;color:#94A3B8;line-height:1.8"},[
        e("div",{},"📱 iPhone: לחץ על שתף ← הוסף למסך הבית"),
        e("div",{},"🤖 Android: לחץ על תפריט ← הוסף למסך הבית"),
        e("div",{},"💻 Chrome: לחץ על + בשורת הכתובת")
      ])
    ]));
  }
  wrap.appendChild(pwaCard);

  // Push notifications
  const pushCard = div("card",[e("div",{class:"card-title"},"🔔 התראות Push")]);
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushCard.appendChild(e("div",{style:"font-size:13px;color:#64748B"},"הדפדפן הזה לא תומך בהתראות Push. בטלפון, מומלץ להתקין את האפליקציה למסך הבית ולפתוח אותה משם."));
  } else if (Notification.permission === "denied") {
    pushCard.appendChild(e("div",{style:"font-size:13px;color:#EF4444"},"ההתראות נחסמו בהגדרות הדפדפן/הטלפון. יש לאפשר אותן מחדש בהגדרות כדי לקבל עדכונים."));
  } else {
    pushCard.appendChild(e("div",{style:"font-size:13px;color:#94A3B8;margin-bottom:12px"},"קבל התראה כשמתפרסם סידור חדש, כשבקשת חופשה מאושרת/נדחית, וכשמתקבלת החלטה על חילוף."));
    pushCard.appendChild(btn("btn-purple","🔔 הפעל התראות Push",enablePushNotifications,{style:"width:100%;margin-bottom:8px"}));
    pushCard.appendChild(btn("btn-sm btn-sm-gray","כבה התראות במכשיר הזה",disablePushNotifications,{style:"width:100%"}));
  }
  if (isFeatureEnabled("push_notifications")) wrap.appendChild(pushCard);

  // Logout
  wrap.appendChild(btn("btn-sm btn-sm-red","יציאה מהמערכת",handleLogout,{style:"width:100%;margin-top:16px;padding:12px"}));

  return wrap;
}
  // ── MANAGER BLOCKS VIEW ──
function viewManagerBlocks() {
  const wrap = e("div");
  wrap.appendChild(div("page-title", ["🚫 חסימות"], {style:"margin-bottom:16px"}));

  // Tabs: my blocks vs team blocks
  if (!S.mgrBlocksTab) S.mgrBlocksTab = "team";
  const tabRow = e("div",{style:"display:flex;gap:6px;margin-bottom:14px"});
  [{id:"mine",label:"🚫 החסימות שלי"},{id:"team",label:"👥 חסימות עובדים"}].forEach(t=>{
    const isActive = S.mgrBlocksTab===t.id;
    tabRow.appendChild(e("button",{
      style:"flex:1;padding:10px;border-radius:10px;border:1px solid "+(isActive?"#3B82F6":"#334155")+";background:"+(isActive?"#3B82F622":"#1E293B")+";color:"+(isActive?"#60A5FA":"#64748B")+";font-family:inherit;font-weight:700;font-size:13px",
      onclick:()=>{S.mgrBlocksTab=t.id;render();}
    },t.label));
  });
  wrap.appendChild(tabRow);

  // "My blocks" tab - reuse employee block form
  if (S.mgrBlocksTab === "mine") {
    const emp = S.employees.find(e=>e.id===S.user.id);
    if (emp) {
      const presetBase = _blockPresetBase(); // 1 normally, 2 from Saturday onward
      const targetOffset = (S.availTargetOffset !== null && S.availTargetOffset !== undefined) ? S.availTargetOffset : presetBase;
      const targetDates = getWeekDates(targetOffset);
      const targetStart = targetDates[0];
      const blockLimits = emp.block_limits || { weekday:{morning:3,afternoon:3,night:1}, weekend:{morning:1,afternoon:1,night:1} };

      function getMgrBlockCount(shiftId, isWE) {
        let count = 0;
        Object.entries(S.availDraft).forEach(([key,val]) => {
          if (!val) return;
          const [di, sid] = key.split("|");
          if (sid !== shiftId) return;
          const dt = new Date(targetDates[parseInt(di)]+"T00:00:00");
          const dayIsWE = dt.getDay() === 5 || dt.getDay() === 6;
          if (dayIsWE === isWE) count++;
        });
        return count;
      }

      // Pre-populate with existing blocks for the week being viewed.
      // Track which week the current draft belongs to — if we navigated to a different
      // week, reload that week's saved blocks fresh (unless the user actively cleared THIS week).
    const existingSub = S.availSubmissions.find(s => s.employee_id === emp.id && s.week_start === targetStart);
    const draftIsForThisWeek = (S._draftWeek === targetStart);
    if (existingSub && !draftIsForThisWeek && !(S._draftCleared && draftIsForThisWeek)) {
      S.availDraft = {};
      (existingSub.slots || []).forEach(sl => {
        targetDates.forEach((date, di) => {
          if (sl.date === date || (!sl.date && new Date(date+"T00:00:00").getDay() === sl.day)) {
            S.availDraft[di+"|"+sl.shift] = true;
          }
        });
      });
      S._draftWeek = targetStart;
      S._draftCleared = false;
    } else if (!existingSub && !draftIsForThisWeek) {
      // No saved blocks for this week and we just navigated here — start empty
      S.availDraft = {};
      S._draftWeek = targetStart;
    }

    const card = div("card");

    if (existingSub) {
      card.appendChild(e("div",{style:"background:#3B82F618;border:1px solid #3B82F633;border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center"},[
        e("div",{style:"font-size:12px;color:#60A5FA;font-weight:600"},"📝 יש חסימות קיימות לשבוע זה — ניתן לעדכן ולשלוח מחדש"),
      ]));
    }

      // Week selector
      card.appendChild(e("div",{style:"display:flex;gap:6px;margin-bottom:10px"},[
        e("button",{
          onclick:()=>{S.availTargetOffset=presetBase;S.availDraft={};S._draftWeek=null;S._draftCleared=false;render();},
          style:"flex:1;padding:10px;border-radius:10px;border:1px solid "+(targetOffset===presetBase?"#EF4444aa":"#334155")+";background:"+(targetOffset===presetBase?"#EF444422":"#1E293B")+";color:"+(targetOffset===presetBase?"#EF4444":"#94A3B8")+";font-family:inherit;cursor:pointer"
        },[
          e("div",{style:"font-size:13px;font-weight:700"},"שבוע הבא"),
          e("div",{style:"font-size:10px;opacity:0.8;margin-top:2px"},fmtDate(getWeekDates(presetBase)[0])+" — "+fmtDate(getWeekDates(presetBase)[6]))
        ]),
        e("button",{
          onclick:()=>{S.availTargetOffset=presetBase+1;S.availDraft={};S._draftWeek=null;S._draftCleared=false;render();},
          style:"flex:1;padding:10px;border-radius:10px;border:1px solid "+(targetOffset===presetBase+1?"#EF4444aa":"#334155")+";background:"+(targetOffset===presetBase+1?"#EF444422":"#1E293B")+";color:"+(targetOffset===presetBase+1?"#EF4444":"#94A3B8")+";font-family:inherit;cursor:pointer"
        },[
          e("div",{style:"font-size:13px;font-weight:700"},"עוד שבועיים"),
          e("div",{style:"font-size:10px;opacity:0.8;margin-top:2px"},fmtDate(getWeekDates(presetBase+1)[0])+" — "+fmtDate(getWeekDates(presetBase+1)[6]))
        ])
      ]));
      card.appendChild(e("div",{style:"display:flex;gap:6px;margin-bottom:14px;justify-content:center;align-items:center"},[
        btn("btn-sm btn-sm-gray","→",()=>{S.availTargetOffset=Math.max(S.availTargetOffset-1,-4);S.availDraft={};S._draftWeek=null;S._draftCleared=false;render();}),
        e("span",{style:"font-size:12px;color:#64748B;min-width:80px;text-align:center"},targetOffset<=0?"שבוע "+(targetOffset===0?"נוכחי":"קודם"):"שבוע הבא"+(targetOffset>1?" +"+targetOffset:"")),
        btn("btn-sm btn-sm-gray","←",()=>{S.availTargetOffset++;S.availDraft={};S._draftWeek=null;S._draftCleared=false;render();})
      ]));
      card.appendChild(e("div",{style:"font-size:12px;color:#64748B;margin-bottom:12px;text-align:center"},fmtDate(targetDates[0])+" — "+fmtDate(targetDates[6])));

      // Quota display
      const quotaCard2 = e("div",{style:"background:#1E293B;border:1px solid #334155;border-radius:10px;padding:12px;margin-bottom:14px"});
      quotaCard2.appendChild(e("div",{style:"font-weight:700;font-size:13px;color:#E2E8F0;margin-bottom:8px"},"🚫 מכסת חסימות"));
      quotaCard2.appendChild(e("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:8px"},[
        e("div",{style:"background:#0F172A;border-radius:8px;padding:8px"},[
          e("div",{style:"font-size:11px;color:#3B82F6;font-weight:700;margin-bottom:6px"},"ראשון — חמישי"),
          ...BLOCK_SHIFTS.map(sh=>{
            const lim = blockLimits.weekday?.[sh.id]??3;
            const used = getMgrBlockCount(sh.id, false);
            return e("div",{style:"display:flex;justify-content:space-between;font-size:11px;padding:2px 0"},[
              e("span",{style:"color:"+sh.color},sh.label),
              e("span",{style:"font-weight:700;color:"+(used>=lim?"#EF4444":"#94A3B8")},used+"/"+lim)
            ]);
          })
        ]),
        e("div",{style:"background:#0F172A;border-radius:8px;padding:8px"},[
          e("div",{style:"font-size:11px;color:#A855F7;font-weight:700;margin-bottom:6px"},"שישי — שבת"),
          ...SHIFTS.filter(sh=>sh.id!=="afternoon" && sh.id!=="morning2").map(sh=>{
            const lim = blockLimits.weekend?.[sh.id]??1;
            const used = getMgrBlockCount(sh.id, true);
            return e("div",{style:"display:flex;justify-content:space-between;font-size:11px;padding:2px 0"},[
              e("span",{style:"color:"+sh.color},sh.label),
              e("span",{style:"font-weight:700;color:"+(used>=lim?"#EF4444":"#94A3B8")},used+"/"+lim)
            ]);
          })
        ])
      ]));
      card.appendChild(quotaCard2);

      // Default buttons — mirror the employee view: read from DB first, localStorage fallback.
      const defaultKey = "blockDefaults_" + emp.id;
      let savedDefaults = emp.default_blocks || null;
      if (!savedDefaults) {
        try { savedDefaults = JSON.parse(localStorage.getItem(defaultKey) || "null"); }
        catch(_) { localStorage.removeItem(defaultKey); }
      }
      card.appendChild(e("div",{style:"display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap"},[
        savedDefaults ? btn("btn-sm btn-sm-blue","📥 טען ברירת מחדל",()=>{
          S.availDraft = {};
          (savedDefaults||[]).forEach(def => {
            targetDates.forEach((date, di) => {
              const dt = new Date(date+"T00:00:00");
              if (dt.getDay() === def.day) S.availDraft[di+"|"+def.shift] = true;
            });
          });
          toast("ברירת מחדל נטענה ✓"); render();
        }) : null,
        e("div",{style:"font-size:11px;color:#475569;display:flex;align-items:center"},
          savedDefaults ? "✓ יש ברירת מחדל — תופעל אוטומטית אם לא תגיש עד יום ראשון 16:00" : "אין ברירת מחדל")
      ]));

      card.appendChild(e("div",{style:"font-size:13px;color:#94A3B8;margin-bottom:12px"},"לחץ על משמרות שאתה לא יכול לעבוד:"));

      // Day cards
      targetDates.forEach((date, di) => {
        const dt = new Date(date+"T00:00:00");
        const dayName = DAYS[dt.getDay()];
        const isWeekend = dt.getDay() === 5 || dt.getDay() === 6;
        const dayCard = e("div",{style:"background:#0F172A;border:1px solid #334155;border-radius:12px;padding:12px;margin-bottom:10px"});
        dayCard.appendChild(e("div",{style:"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"},[
          e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0"},dayName),
          e("div",{style:"font-size:13px;color:#64748B"},dt.getDate()+"/"+(dt.getMonth()+1))
        ]));
        const shiftsRow = e("div",{style:"display:grid;grid-template-columns:"+(isWeekend?"1fr 1fr":"1fr 1fr 1fr")+";gap:6px"});
        (isWeekend ? WEEKEND_SHIFTS : BLOCK_SHIFTS).forEach(sh => {
          const key = di+"|"+sh.id;
          const picked = !!S.availDraft[key];
          const shiftLimit = isWeekend ? (blockLimits.weekend?.[sh.id]??1) : (blockLimits.weekday?.[sh.id]??3);
          const shiftUsed = getMgrBlockCount(sh.id, isWeekend);
          const atLimit = !picked && shiftUsed >= shiftLimit;

          shiftsRow.appendChild(e("button",{
            disabled: atLimit && !picked,
            style: picked ? "padding:14px 8px;border-radius:10px;background:#EF444433;border:2px solid #EF4444;color:#EF4444;font-weight:800;cursor:pointer;font-family:inherit" : atLimit ? "padding:14px 8px;border-radius:10px;background:#0F172A;border:1px solid #1E293B;color:#1E293B;cursor:not-allowed;font-family:inherit" : "padding:14px 8px;border-radius:10px;background:#1E293B;border:1px solid "+sh.color+"44;color:"+sh.color+";font-weight:700;cursor:pointer;font-family:inherit",
            onclick: () => { S.availDraft[key]=!S.availDraft[key]; render(); }
          },[
            e("div",{style:"font-size:13px"},picked?"🚫 "+sh.label:sh.label),
            e("div",{style:"direction:ltr;text-align:center;font-size:9px;opacity:0.8;margin-top:2px"},sh.start+"-"+sh.end)
          ]));
        });
        dayCard.appendChild(shiftsRow);
        card.appendChild(dayCard);
      });

      const selKeys = Object.entries(S.availDraft).filter(([,v])=>v).map(([k])=>k);

      // Single note
      card.appendChild(e("div",{style:"margin-top:14px;border-top:1px solid #334155;padding-top:12px"},[
        e("div",{style:"font-weight:700;font-size:13px;color:#F59E0B;margin-bottom:8px"},"💬 פירוט / הערה (אופציונלי)"),
        e("textarea",{
          class:"fi",
          placeholder:"למשל: מבחן ביום ראשון, אירוע משפחתי בשישי...",
          style:"min-height:70px;resize:vertical",
          id:"mgr-block-note"
        })
      ]));

      // Action buttons
      card.appendChild(div("form-actions",[
        btn("btn-sm btn-sm-blue","💾 שמור כברירת מחדל",async()=>{
          const selKeys2 = Object.entries(S.availDraft).filter(([,v])=>v).map(([k])=>k);
          if (!selKeys2.length) { toast("בחר לפחות משמרת אחת","err"); return; }
          const defaults = selKeys2.map(k => {
            const [di, shId] = k.split("|");
            const dt = new Date(targetDates[parseInt(di)]+"T00:00:00");
            return { day: dt.getDay(), shift: shId };
          });
          try {
            const { error } = await sb.from("profiles").update({ default_blocks: defaults }).eq("id", emp.id);
            if (error) throw error;
            emp.default_blocks = defaults;
            localStorage.setItem(defaultKey, JSON.stringify(defaults));
            toast("ברירת מחדל נשמרה ✓ תופעל אוטומטית בכל יום ראשון 16:00 אם לא תגיש");
            render();
          } catch (err) { toast(friendlyError(err), "err"); }
        }),
        btn("btn-sm btn-sm-red","📤 שלח חסימות",async()=>{
          const mgrNote = document.getElementById("mgr-block-note")?.value?.trim() || "";
          if (!selKeys.length && !mgrNote) { toast("בחר משמרת או כתוב הערה","err"); return; }
          const slots = selKeys.map(k=>{
            const [di,shId]=k.split("|");
            return {day:new Date(targetDates[parseInt(di)]+"T00:00:00").getDay(),shift:shId,date:targetDates[parseInt(di)],reason:""};
          });
          await submitAvailability(emp.id, targetStart, slots, mgrNote || "חסימות");
          S.availDraft={}; S._draftWeek=null; S._draftCleared=false;
          toast("חסימות נשלחו ✓"); render();
        },{style:"flex:1"}),
        btn("btn-sm btn-sm-gray","נקה",()=>{S.availDraft={};S._draftCleared=true;S._draftWeek=targetStart;render();})
      ],{style:"margin-top:12px"}));

      wrap.appendChild(card);
    }
    return wrap;
  }

  // Team blocks tab
  // Week navigation
  if (!S.blocksWeekOffset) S.blocksWeekOffset = 0;
  const viewWeekDates = getWeekDates(S.blocksWeekOffset);
  const viewWeekStart = viewWeekDates[0];

  wrap.appendChild(e("div",{style:"display:flex;gap:6px;margin-bottom:14px;align-items:center;justify-content:center"},[
    btn("btn-sm btn-sm-gray","→",()=>{S.blocksWeekOffset--;render();}),
    btn("btn-sm btn-sm-blue","השבוע",()=>{S.blocksWeekOffset=0;render();}),
    btn("btn-sm btn-sm-gray","←",()=>{S.blocksWeekOffset++;render();}),
  ]));
  wrap.appendChild(e("div",{style:"text-align:center;font-size:13px;color:#64748B;margin-bottom:16px"},
    fmtDate(viewWeekDates[0]) + " — " + fmtDate(viewWeekDates[6])));

  const allSubs = S.availSubmissions || [];

  // Filter by selected week
  const weekSubs = allSubs.filter(sub => sub.week_start === viewWeekStart && getEmp(sub.employee_id));

  if (weekSubs.length === 0) {
    wrap.appendChild(div("card", [
      e("div",{style:"text-align:center;padding:30px;color:#64748B"},"אין חסימות לשבוע זה")
    ]));
    return wrap;
  }

  // Flatten slots into individual blocks, grouped by employee
  const byEmp = {};
  weekSubs.forEach(sub => {
    if (!byEmp[sub.employee_id]) byEmp[sub.employee_id] = [];
    (sub.slots || []).forEach(sl => {
      byEmp[sub.employee_id].push({
        date: sl.date || null,
        day: sl.day,
        shift: sl.shift,
        reason: sl.reason || sub.note || ""
      });
    });
  });

  const todayStr = today();

  Object.entries(byEmp).forEach(([empId, blocks]) => {
    const emp = getEmp(empId);
    const col = ec(empIdx(empId));

    const empBox = e("div",{style:"background:#0F172A;border:1px solid "+col+"44;border-radius:14px;padding:14px;margin-bottom:12px"});

    empBox.appendChild(e("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:12px"},[
      e("div",{style:"width:36px;height:36px;border-radius:10px;background:"+col+"22;border:1px solid "+col+"44;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:"+col+";flex-shrink:0"},
        (emp?.name||"?").split(" ").map(n=>n[0]).join("").slice(0,2)),
      e("div",{style:"flex:1"},[
        e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0"},emp?.name || "עובד לא ידוע"),
        e("div",{style:"font-size:11px;color:#64748B"},blocks.length + " חסימות")
      ])
    ]));

    const grid = e("div",{style:"display:flex;flex-wrap:wrap;gap:6px"});
    blocks.sort((a,b) => (a.date||"").localeCompare(b.date||"")).forEach(b => {
      const sh = SHIFT_BY_ID[b.shift];
      const dt = b.date ? new Date(b.date+"T00:00:00") : null;
      const isPast = b.date && b.date < todayStr;
      const dayLabel = dt ? (DAYS[dt.getDay()] + " " + dt.getDate() + "/" + (dt.getMonth()+1)) : ("יום " + (DAYS[b.day] || b.day));

      grid.appendChild(e("div",{style:"background:#1E293B;border:1px solid "+(sh?.color||"#64748B")+"44;border-radius:10px;padding:8px 12px;opacity:"+(isPast?"0.5":"1")},[
        e("div",{style:"font-weight:700;font-size:12px;color:"+(sh?.color||"#94A3B8")},dayLabel),
        e("div",{style:"font-size:11px;color:"+(sh?.color||"#64748B")},sh?.label || b.shift),
        null
      ]));
    });
    empBox.appendChild(grid);
    // Show note once for the employee
    const empNote = weekSubs.find(s => s.employee_id === empId)?.note;
    if (empNote && empNote !== "חסימות") {
      empBox.appendChild(e("div",{style:"margin-top:8px;background:#F59E0B11;border:1px solid #F59E0B33;border-radius:8px;padding:8px 12px;font-size:12px;color:#FCD34D;font-style:italic"},"💬 "+empNote));
    }
    wrap.appendChild(empBox);
  });

  return wrap;
}

// ══════════════════════════════════════════════════════
// QUALIFICATIONS VIEW — track employee qualifications per system/shift
// ══════════════════════════════════════════════════════
// Load all assignments from DB to compute qualifications based on full history
// Returns: { empId: { systems: {sysName: latestDate}, shifts: {shiftId: latestDate} } }
async function loadQualificationHistory() {
  if (!S.profile?.business_id) return {};
  const todayStr = today();
  
  // Get all schedules for this business
  const { data: scheds } = await sb.from("schedules")
    .select("id")
    .eq("business_id", S.profile.business_id);
  
  if (!scheds || scheds.length === 0) return {};
  const schedIds = scheds.map(s => s.id);
  
  // Get all assignments up to today (last 365 days for performance)
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  const cutoffStr = oneYearAgo.toISOString().slice(0,10);
  
  const { data: assigns } = await sb.from("assignments")
    .select("date, shift, employee_id, note")
    .in("schedule_id", schedIds)
    .gte("date", cutoffStr)
    .lte("date", todayStr);
  
  // Build empData: { empId: { systems: {}, shifts: {} } }
  const empData = {};
  schedulableEmployees().forEach(emp => {
    empData[emp.id] = { systems: {}, shifts: {} };
  });
  
  (assigns || []).forEach(a => {
    if (!empData[a.employee_id]) return;
    
    // Track shift assignments (latest date per shift)
    const existingShift = empData[a.employee_id].shifts[a.shift];
    if (!existingShift || a.date > existingShift) {
      empData[a.employee_id].shifts[a.shift] = a.date;
    }
    
    // Parse system tags from note: "🏷️ Sys1, Sys2 | text"
    if (a.note && a.note.startsWith("🏷️ ")) {
      const tagPart = a.note.split(" | ")[0].replace("🏷️ ","");
      const tags = tagPart.split(", ").map(t=>t.trim()).filter(Boolean);
      tags.forEach(tag => {
        const existing = empData[a.employee_id].systems[tag];
        if (!existing || a.date > existing) {
          empData[a.employee_id].systems[tag] = a.date;
        }
      });
    }
  });
  
  return empData;
}

// ══════════════════════════════════════════════════════
// ANALYTICS — fairness/balance insights for the manager
// ══════════════════════════════════════════════════════
function viewAnalytics() {
  const wrap = e("div");
  wrap.appendChild(div("page-title",["📊 אנליטיקה"],{style:"margin-bottom:16px"}));

  // Period picker (last 1/3/6 months)
  if (!S.analyticsPeriod) S.analyticsPeriod = 3;
  const periodBar = e("div",{style:"display:flex;gap:8px;margin-bottom:16px"});
  [1,3,6,12].forEach(m => {
    const sel = S.analyticsPeriod === m;
    periodBar.appendChild(btn("", m===12 ? "שנה" : m+" ח'", () => {
      S.analyticsPeriod = m;
      S.analyticsData = null;
      render();
    }, {
      style:`flex:1;padding:10px;border-radius:10px;border:1px solid ${sel?"#3B82F6":"#334155"};background:${sel?"#3B82F622":"#1E293B"};color:${sel?"#60A5FA":"#64748B"};font-family:inherit;font-weight:700;font-size:13px`
    }));
  });
  wrap.appendChild(periodBar);

  const periodKey = "p"+S.analyticsPeriod;
  if (S.analyticsKey !== periodKey || !S.analyticsData) {
    // Load analytics data from DB
    loadAnalyticsData(S.analyticsPeriod).then(data => {
      S.analyticsData = data;
      S.analyticsKey = periodKey;
      render();
    });
    wrap.appendChild(div("card",[e("div",{style:"text-align:center;padding:40px;color:#64748B"},"טוען נתונים...")]));
    return wrap;
  }

  const data = S.analyticsData;

  if (!data.rows || data.rows.length === 0) {
    wrap.appendChild(div("card",[e("div",{style:"text-align:center;padding:40px;color:#64748B"},"אין משמרות מפורסמות בתקופה זו")]));
    return wrap;
  }

  // Summary card: total shifts in period
  const totalShiftsAll = data.rows.reduce((s,r) => s + r.total, 0);
  const avgPerEmp = data.rows.length > 0 ? (totalShiftsAll / data.rows.length).toFixed(1) : 0;
  wrap.appendChild(div("card",[
    e("div",{style:"display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px"},[
      e("div",{style:"text-align:center"},[
        e("div",{style:"font-size:22px;font-weight:900;color:#3B82F6"}, String(totalShiftsAll)),
        e("div",{style:"font-size:11px;color:#64748B;margin-top:2px"}, "סה״כ שיבוצים")
      ]),
      e("div",{style:"text-align:center;border-right:1px solid #334155;border-left:1px solid #334155"},[
        e("div",{style:"font-size:22px;font-weight:900;color:#10B981"}, String(data.rows.length)),
        e("div",{style:"font-size:11px;color:#64748B;margin-top:2px"}, "עובדים פעילים")
      ]),
      e("div",{style:"text-align:center"},[
        e("div",{style:"font-size:22px;font-weight:900;color:#F59E0B"}, String(avgPerEmp)),
        e("div",{style:"font-size:11px;color:#64748B;margin-top:2px"}, "ממוצע לעובד")
      ]),
    ])
  ]));

  // Shift type breakdown — who's doing what
  const breakdownCard = div("card",[
    e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0;margin-bottom:14px"},"🎯 פילוח לפי סוג משמרת"),
  ]);
  // Sort by total descending
  const sortedByTotal = [...data.rows].sort((a,b) => b.total - a.total);
  const maxTotal = Math.max(...sortedByTotal.map(r=>r.total), 1);
  sortedByTotal.forEach(row => {
    const emp = getEmp(row.empId);
    if (!emp) return;
    const col = ec(empIdx(row.empId));
    const total = row.total;
    const barPct = Math.round((total / maxTotal) * 100);

    const breakdownRow = e("div",{style:"background:#0F172A;border:1px solid #1E293B;border-radius:12px;padding:12px;margin-bottom:10px"},[
      e("div",{style:"display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"},[
        e("div",{style:"display:flex;align-items:center;gap:8px"},[
          e("span",{style:"width:10px;height:10px;border-radius:50%;background:"+col}),
          e("span",{style:"font-weight:700;font-size:14px;color:#E2E8F0"}, emp.name)
        ]),
        e("span",{style:"font-weight:900;font-size:16px;color:"+col}, String(total))
      ]),
      // Mini bar chart of shift types
      e("div",{style:"display:flex;gap:4px;height:10px;background:#1E293B;border-radius:5px;overflow:hidden;margin-bottom:6px"},[
        row.morning > 0 ? e("div",{style:`background:#F59E0B;width:${(row.morning/total)*100}%`,title:"בוקר "+row.morning}) : null,
        row.morning2 > 0 ? e("div",{style:`background:#FB923C;width:${(row.morning2/total)*100}%`,title:"בוקר ב׳ "+row.morning2}) : null,
        row.afternoon > 0 ? e("div",{style:`background:#10B981;width:${(row.afternoon/total)*100}%`,title:"צהריים "+row.afternoon}) : null,
        row.night > 0 ? e("div",{style:`background:#6366F1;width:${(row.night/total)*100}%`,title:"לילה "+row.night}) : null,
      ].filter(Boolean)),
      e("div",{style:"display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:#94A3B8"},[
        row.morning > 0 ? e("span",{},`🌅 ${row.morning}`) : null,
        row.morning2 > 0 ? e("span",{},`☀️ ${row.morning2}`) : null,
        row.afternoon > 0 ? e("span",{},`🌇 ${row.afternoon}`) : null,
        row.night > 0 ? e("span",{},`🌙 ${row.night}`) : null,
        row.weekend > 0 ? e("span",{style:"color:#A855F7;font-weight:700"},`🎌 ${row.weekend} סופ״ש`) : null,
      ].filter(Boolean))
    ]);
    breakdownCard.appendChild(breakdownRow);
  });
  wrap.appendChild(breakdownCard);

  // Weekend balance — who worked the most/least weekends
  const weekendRows = [...data.rows].filter(r => r.weekend > 0).sort((a,b) => b.weekend - a.weekend);
  const noWeekendRows = data.rows.filter(r => r.weekend === 0);
  if (weekendRows.length > 0) {
    const weekendCard = div("card",[
      e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0;margin-bottom:14px"},"🎌 איזון סופי שבוע"),
    ]);
    weekendRows.forEach(row => {
      const emp = getEmp(row.empId);
      if (!emp) return;
      const col = ec(empIdx(row.empId));
      weekendCard.appendChild(e("div",{style:"display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1E293B"},[
        e("div",{style:"display:flex;align-items:center;gap:8px"},[
          e("span",{style:"width:8px;height:8px;border-radius:50%;background:"+col}),
          e("span",{style:"font-size:13px;color:#E2E8F0"}, emp.name)
        ]),
        e("div",{style:"display:flex;gap:3px"}, Array.from({length:row.weekend}, (_,i) =>
          e("span",{style:`display:inline-block;width:12px;height:12px;border-radius:3px;background:${col}`})
        ))
      ]));
    });
    if (noWeekendRows.length > 0) {
      weekendCard.appendChild(e("div",{style:"margin-top:12px;padding:10px;background:#10B98111;border:1px solid #10B98133;border-radius:8px;font-size:12px;color:#10B981"},
        "לא עבדו סופ״ש: " + noWeekendRows.map(r => getEmp(r.empId)?.name).filter(Boolean).join(", ")));
    }
    wrap.appendChild(weekendCard);
  }

  // Night balance — who worked the most/least nights
  const nightRows = [...data.rows].filter(r => r.night > 0).sort((a,b) => b.night - a.night);
  if (nightRows.length > 0) {
    const nightCard = div("card",[
      e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0;margin-bottom:14px"},"🌙 איזון לילות"),
    ]);
    nightRows.forEach(row => {
      const emp = getEmp(row.empId);
      if (!emp) return;
      const col = ec(empIdx(row.empId));
      nightCard.appendChild(e("div",{style:"display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1E293B"},[
        e("div",{style:"display:flex;align-items:center;gap:8px"},[
          e("span",{style:"width:8px;height:8px;border-radius:50%;background:"+col}),
          e("span",{style:"font-size:13px;color:#E2E8F0"}, emp.name)
        ]),
        e("div",{style:"font-weight:800;font-size:14px;color:#6366F1"}, String(row.night) + " לילות")
      ]));
    });
    wrap.appendChild(nightCard);
  }

  // Fairness verdict
  const spread = sortedByTotal.length > 0 ? sortedByTotal[0].total - sortedByTotal[sortedByTotal.length-1].total : 0;
  const nightSpread = nightRows.length > 0 ? nightRows[0].night - (nightRows[nightRows.length-1]?.night || 0) : 0;
  const weekendSpread = weekendRows.length > 0 ? weekendRows[0].weekend - (weekendRows[weekendRows.length-1]?.weekend || 0) : 0;
  const verdictCard = div("card",[
    e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0;margin-bottom:12px"},"⚖️ מדדי איזון"),
    e("div",{style:"display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px"},[
      e("div",{style:`background:${spread<=3?"#10B98111":spread<=6?"#F59E0B11":"#EF444411"};border:1px solid ${spread<=3?"#10B98133":spread<=6?"#F59E0B33":"#EF444433"};border-radius:10px;padding:12px;text-align:center`},[
        e("div",{style:`font-size:22px;font-weight:900;color:${spread<=3?"#10B981":spread<=6?"#F59E0B":"#EF4444"}`}, String(spread)),
        e("div",{style:"font-size:10px;color:#94A3B8;margin-top:4px"},"פער סה״כ"),
        e("div",{style:"font-size:9px;color:#64748B;margin-top:2px"}, spread<=3?"מצוין ✓":spread<=6?"סביר":"גבוה")
      ]),
      e("div",{style:`background:${nightSpread<=2?"#10B98111":nightSpread<=4?"#F59E0B11":"#EF444411"};border:1px solid ${nightSpread<=2?"#10B98133":nightSpread<=4?"#F59E0B33":"#EF444433"};border-radius:10px;padding:12px;text-align:center`},[
        e("div",{style:`font-size:22px;font-weight:900;color:${nightSpread<=2?"#10B981":nightSpread<=4?"#F59E0B":"#EF4444"}`}, String(nightSpread)),
        e("div",{style:"font-size:10px;color:#94A3B8;margin-top:4px"},"פער לילות"),
        e("div",{style:"font-size:9px;color:#64748B;margin-top:2px"}, nightSpread<=2?"מצוין ✓":nightSpread<=4?"סביר":"גבוה")
      ]),
      e("div",{style:`background:${weekendSpread<=1?"#10B98111":weekendSpread<=2?"#F59E0B11":"#EF444411"};border:1px solid ${weekendSpread<=1?"#10B98133":weekendSpread<=2?"#F59E0B33":"#EF444433"};border-radius:10px;padding:12px;text-align:center`},[
        e("div",{style:`font-size:22px;font-weight:900;color:${weekendSpread<=1?"#10B981":weekendSpread<=2?"#F59E0B":"#EF4444"}`}, String(weekendSpread)),
        e("div",{style:"font-size:10px;color:#94A3B8;margin-top:4px"},"פער סופ״ש"),
        e("div",{style:"font-size:9px;color:#64748B;margin-top:2px"}, weekendSpread<=1?"מצוין ✓":weekendSpread<=2?"סביר":"גבוה")
      ]),
    ])
  ]);
  wrap.appendChild(verdictCard);

  return wrap;
}

// Load analytics data from DB — assignments across the last N months, grouped per employee.
async function loadAnalyticsData(months) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const fromStr = from.getFullYear()+"-"+String(from.getMonth()+1).padStart(2,"0")+"-01";
  const toStr = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");

  // Only count PUBLISHED (final) schedules
  const { data: scheds } = await sb.from("schedules")
    .select("id,week_start,publish_type")
    .eq("business_id", S.profile.business_id)
    .eq("published", true)
    .gte("week_start", fromStr)
    .lte("week_start", toStr);

  const finalSchedIds = (scheds||[]).filter(s => s.publish_type === "final" || !s.publish_type).map(s => s.id);
  if (finalSchedIds.length === 0) return { rows: [] };

  const { data: assigns } = await sb.from("assignments")
    .select("employee_id,date,shift")
    .in("schedule_id", finalSchedIds)
    .gte("date", fromStr)
    .lte("date", toStr);

  // Group by employee
  const perEmp = {};
  (assigns||[]).forEach(a => {
    if (!perEmp[a.employee_id]) {
      perEmp[a.employee_id] = {
        empId: a.employee_id,
        total: 0, morning: 0, morning2: 0, afternoon: 0, night: 0, weekend: 0,
      };
    }
    const row = perEmp[a.employee_id];
    row.total++;
    if (row[a.shift] !== undefined) row[a.shift]++;
    const dow = new Date(a.date+"T00:00:00").getDay();
    if (dow === 5 || dow === 6) row.weekend++;
  });

  return { rows: Object.values(perEmp) };
}

function viewQualifications() {
  const wrap = e("div");
  wrap.appendChild(div("page-title",["🎯 כשירות עובדים"],{style:"margin-bottom:16px"}));
  
  const quals = S.qualifications || {systems:{},shifts:{}};
  const systems = S.systems || [];
  // Defensive: a system/tag might exist without ever having its expiry explicitly saved
  // (e.g. added before this default was fixed) — default it to 30 days for display so it
  // isn't silently invisible here.
  if (!quals.systems) quals.systems = {};
  systems.forEach(sys => { if (!quals.systems[sys]) quals.systems[sys] = 30; });
  const trackedShifts = [
    {id:"morning",label:"בוקר",color:"#F59E0B"},
    {id:"morning2",label:"בוקר ב׳",color:"#F97316"}
  ];
  
  // Check if any qualifications are configured
  const hasSystemQuals = Object.keys(quals.systems||{}).length > 0;
  const hasShiftQuals = Object.keys(quals.shifts||{}).length > 0;
  
  if (!hasSystemQuals && !hasShiftQuals && systems.length === 0) {
    wrap.appendChild(div("card",[
      e("div",{style:"text-align:center;padding:40px"},[
        e("div",{style:"font-size:48px;margin-bottom:12px"},"🎯"),
        e("div",{style:"font-weight:800;font-size:18px;color:#94A3B8;margin-bottom:8px"},"לא מוגדרת כשירות"),
        e("div",{style:"font-size:13px;color:#64748B;margin-bottom:20px"},"קודם הוסף מערכות והגדר ימי כשירות בהגדרות"),
        btn("btn-add","עבור להגדרות →",()=>{S.view="settings";render();})
      ])
    ]));
    return wrap;
  }
  
  // Use cached historical data, or trigger load
  if (S.qualHistory === null) {
    // Show loading + trigger fetch
    loadQualificationHistory().then(data => {
      S.qualHistory = data;
      render();
    });
    wrap.appendChild(skeletonCard());
    wrap.appendChild(skeletonCard());
    return wrap;
  }
  const empData = S.qualHistory;
  
  const todayStr = today();
  const todayDate = new Date(todayStr+"T12:00:00");
  
  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr+"T12:00:00");
    return Math.floor((todayDate - d) / (1000*60*60*24));
  }
  
  function getStatus(daysSinceLast, expiryDays) {
    if (daysSinceLast === Infinity) return {color:"#EF4444", icon:"❌", label:"מעולם לא"};
    if (daysSinceLast >= expiryDays) return {color:"#EF4444", icon:"❌", label:"פג!"};
    const remaining = expiryDays - daysSinceLast;
    if (remaining <= 3) return {color:"#F59E0B", icon:"⚠️", label:"עוד "+remaining+" ימים"};
    return {color:"#10B981", icon:"✅", label:"כשיר"};
  }
  
  // Summary banner
  let totalExpired = 0;
  let totalWarning = 0;
  S.employees.forEach(emp => {
    Object.entries(quals.systems||{}).forEach(([sys, days]) => {
      const last = empData[emp.id]?.systems[sys];
      const since = daysSince(last);
      if (since >= days) totalExpired++;
      else if (days - since <= 3) totalWarning++;
    });
    trackedShifts.forEach(sh => {
      if (!quals.shifts?.[sh.id]) return;
      const last = empData[emp.id]?.shifts[sh.id];
      const since = daysSince(last);
      if (since >= quals.shifts[sh.id]) totalExpired++;
      else if (quals.shifts[sh.id] - since <= 3) totalWarning++;
    });
  });
  
  wrap.appendChild(e("div",{style:"display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px"},[
    e("div",{style:"background:#EF444418;border:1px solid #EF444444;border-radius:12px;padding:14px;text-align:center"},[
      e("div",{style:"font-size:24px;font-weight:900;color:#EF4444"},String(totalExpired)),
      e("div",{style:"font-size:11px;color:#FCA5A5;font-weight:700"},"❌ פג")
    ]),
    e("div",{style:"background:#F59E0B18;border:1px solid #F59E0B44;border-radius:12px;padding:14px;text-align:center"},[
      e("div",{style:"font-size:24px;font-weight:900;color:#F59E0B"},String(totalWarning)),
      e("div",{style:"font-size:11px;color:#FCD34D;font-weight:700"},"⚠️ עומד לפוג")
    ]),
    e("div",{style:"background:#10B98118;border:1px solid #10B98144;border-radius:12px;padding:14px;text-align:center"},[
      e("div",{style:"font-size:24px;font-weight:900;color:#10B981"},String(S.employees.length)),
      e("div",{style:"font-size:11px;color:#34D399;font-weight:700"},"👥 עובדים")
    ])
  ]));
  
  // Filter
  if (!S.qualFilter) S.qualFilter = "all";
  const filters = [
    {id:"all",label:"הכל"},
    {id:"expired",label:"❌ פג"},
    {id:"warning",label:"⚠️ עומד לפוג"},
    {id:"ok",label:"✅ כשירים"}
  ];
  // Refresh button
  wrap.appendChild(e("div",{style:"display:flex;justify-content:flex-end;margin-bottom:8px"},[
    btn("btn-sm btn-sm-blue","🔄 רענן נתונים",async()=>{
      S.qualHistory = null;
      render();
    },{title:"טען מחדש מהיסטוריית הסידורים"})
  ]));
  
  const filterRow = e("div",{style:"display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap"});
  filters.forEach(f => {
    const isActive = S.qualFilter === f.id;
    filterRow.appendChild(e("button",{
      style:"padding:8px 14px;border-radius:8px;border:1px solid "+(isActive?"#3B82F6":"#334155")+";background:"+(isActive?"#3B82F622":"#1E293B")+";color:"+(isActive?"#60A5FA":"#94A3B8")+";font-family:inherit;font-weight:700;font-size:12px;cursor:pointer",
      onclick:()=>{S.qualFilter=f.id;render();}
    },f.label));
  });
  wrap.appendChild(filterRow);
  
  // Employee cards
  schedulableEmployees().forEach((emp, idx) => {
    const col = ec(idx);
    const empQualSystems = Object.entries(quals.systems||{}).map(([sys, days]) => {
      const last = empData[emp.id]?.systems[sys];
      const since = daysSince(last);
      const status = getStatus(since, days);
      return {type:"system", name:sys, lastDate:last, since, expiryDays:days, status};
    });
    const empQualShifts = trackedShifts.filter(sh => quals.shifts?.[sh.id]).map(sh => {
      const last = empData[emp.id]?.shifts[sh.id];
      const since = daysSince(last);
      const status = getStatus(since, quals.shifts[sh.id]);
      return {type:"shift", name:sh.label, color:sh.color, lastDate:last, since, expiryDays:quals.shifts[sh.id], status};
    });
    
    const allQuals = [...empQualSystems, ...empQualShifts];
    
    // Apply filter
    let filtered = allQuals;
    if (S.qualFilter === "expired") filtered = allQuals.filter(q => q.status.icon === "❌");
    else if (S.qualFilter === "warning") filtered = allQuals.filter(q => q.status.icon === "⚠️");
    else if (S.qualFilter === "ok") filtered = allQuals.filter(q => q.status.icon === "✅");
    
    // Skip employee card if filter removes all
    if (S.qualFilter !== "all" && filtered.length === 0) return;
    
    const expiredCount = allQuals.filter(q => q.status.icon === "❌").length;
    const warnCount = allQuals.filter(q => q.status.icon === "⚠️").length;
    const cardBorder = expiredCount > 0 ? "#EF444444" : warnCount > 0 ? "#F59E0B44" : col+"44";
    
    const empCard = e("div",{style:"background:#1E293B;border:1px solid "+cardBorder+";border-radius:14px;padding:14px;margin-bottom:12px"});
    
    // Header
    empCard.appendChild(e("div",{style:"display:flex;align-items:center;gap:10px;margin-bottom:12px"},[
      e("div",{style:"width:36px;height:36px;border-radius:10px;background:"+col+"22;border:1px solid "+col+"44;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;color:"+col},
        emp.name.split(" ").map(n=>n[0]).join("").slice(0,2)),
      e("div",{style:"flex:1"},[
        e("div",{style:"font-weight:800;font-size:15px;color:#E2E8F0"},emp.name),
        e("div",{style:"font-size:11px;color:#64748B;margin-top:2px"},
          (expiredCount > 0 ? "❌ "+expiredCount+" פג · " : "") +
          (warnCount > 0 ? "⚠️ "+warnCount+" קרוב · " : "") +
          (allQuals.length - expiredCount - warnCount)+" כשירים")
      ])
    ]));
    
    if (filtered.length === 0) {
      empCard.appendChild(e("div",{style:"color:#64748B;font-size:12px;padding:8px;text-align:center"},"אין פריטים שמתאימים לסינון"));
    } else {
      const grid = e("div",{style:"display:flex;flex-wrap:wrap;gap:6px"});
      filtered.forEach(q => {
        grid.appendChild(e("div",{style:"background:#0F172A;border:1px solid "+q.status.color+"44;border-radius:10px;padding:8px 12px;min-width:140px"},[
          e("div",{style:"display:flex;align-items:center;gap:6px;margin-bottom:4px"},[
            e("span",{style:"font-size:13px"},q.status.icon),
            e("div",{style:"font-weight:700;font-size:12px;color:"+(q.color||q.status.color)},
              (q.type === "system" ? "🏷️ " : "🌅 ") + q.name)
          ]),
          e("div",{style:"font-size:10px;color:#64748B"},
            q.lastDate ? "אחרון: " + fmtDate(q.lastDate) + " ("+q.since+" ימים)" : "מעולם לא בוצע"),
          e("div",{style:"font-size:10px;color:"+q.status.color+";font-weight:700;margin-top:2px"},q.status.label)
        ]));
      });
      empCard.appendChild(grid);
    }
    
    wrap.appendChild(empCard);
  });
  
  return wrap;
}
