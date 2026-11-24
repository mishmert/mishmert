// export.js — print, PDF, CSV, and WhatsApp-image exports of the current schedule.
// Extracted from index.html on 2026-11-24.
//
// Contents:
//  - _parseNote(rawNote)             : splits a per-assignment note into [tags] and
//                                      free text (notes may begin with '🏷️ tag1 | tag2 | text').
//  - escHtml / RTL helpers           : shared HTML-escape and direction helpers used by
//                                      every export path.
//  - exportToPdf / exportToPrint     : opens a child window that document.write()s a
//                                      self-contained HTML document (its own <style>
//                                      block, intentionally duplicated from styles.css).
//  - exportToCsv                     : builds a UTF-8 BOM'd CSV of the week and triggers
//                                      a client-side download.
//  - buildScheduleTableInnerHTML     : the single DOM-less renderer shared by the PNG
//                                      WhatsApp export path; feeds html2canvas when loaded.
//
// Dependencies at call time: `S`, `SHIFTS`/`DAYS`/`SHIFT_BY_ID`/`JEWISH_HOLIDAYS`
// (constants.js), `getWeekDates`/`fmtYMD` (utils.js), `getEmp` / `getQualifiedEmps`
// (inline), `toast()` (utils.js), `logAction()` (audit.js).

// EXPORT
// ══════════════════════════════════════════════════════
// Parse a note into tags and free text
"use strict";

function _parseNote(rawNote) {
  if (!rawNote) return { tags: [], text: "" };
  if (rawNote.startsWith("🏷️ ")) {
    const parts = rawNote.split(" | ");
    const tags = parts[0].replace("🏷️ ","").split(", ").map(t=>t.trim()).filter(Boolean);
    const text = parts.slice(1).join(" | ");
    return { tags, text };
  }
  return { tags: [], text: rawNote };
}

// Load schedule data (current week's live state, or fetch from DB for any other week)
async function loadWeekDataForExport(offset, weekStart) {
  let scheduleData = S.schedule;
  let notesData = S.assignmentNotes;
  let hoursData = S.customHours;
  if (offset !== S.weekOffset) {
    const { data: sched } = await sb.from("schedules")
      .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
    if (sched) {
      const { data: assigns } = await sb.from("assignments").select("*").eq("schedule_id", sched.id);
      scheduleData = {};
      notesData = {};
      hoursData = {};
      (assigns || []).forEach(a => {
        if (!scheduleData[a.date]) scheduleData[a.date] = {};
        if (!scheduleData[a.date][a.shift]) scheduleData[a.date][a.shift] = [];
        scheduleData[a.date][a.shift].push(a.employee_id);
        const key = a.date+"|"+a.shift+"|"+a.employee_id;
        if (a.note) notesData[key] = a.note;
        if (a.custom_start && a.custom_end) hoursData[key] = {start:a.custom_start, end:a.custom_end};
      });
    } else {
      scheduleData = {}; notesData = {}; hoursData = {};
    }
  }
  return { scheduleData, notesData, hoursData };
}

// Build just the inner content (no <html>/<head>/<body>) of the schedule table —
// reused for both the printable PDF document and the WhatsApp image export.
// Escape user-controlled text before inserting into an HTML string (prevents XSS in exports).
function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildScheduleTableInnerHTML(wd, scheduleData, notesData, hoursData, weekLabel) {
  let html = `<div id="wa-export-root" style="font-family:Heebo,Arial,sans-serif;direction:rtl;padding:20px;color:#1a1a2e;background:white;width:fit-content;">
<style>
  #wa-export-root h1{font-weight:900;font-size:22px;margin-bottom:4px}
  #wa-export-root .sub{color:#666;font-size:13px;margin-bottom:20px}
  #wa-export-root table{border-collapse:collapse;font-size:12px}
  #wa-export-root th{background:#1E293B;color:white;padding:8px 10px;text-align:center;font-weight:700}
  #wa-export-root th:first-child{text-align:right}
  #wa-export-root td{padding:7px 6px;border:1px solid #ddd;text-align:center;vertical-align:top;min-width:88px}
  #wa-export-root td:first-child{text-align:right;font-weight:700;white-space:nowrap}
  #wa-export-root .chip{display:inline-block;border-radius:4px;padding:2px 6px;margin:1px;font-size:10px;font-weight:700}
  #wa-export-root .morning{background:#FEF3C7;color:#92400E}
  #wa-export-root .morning2{background:#FED7AA;color:#9A3412}
  #wa-export-root .afternoon{background:#D1FAE5;color:#065F46}
  #wa-export-root .night{background:#EDE9FE;color:#4C1D95}
  #wa-export-root .empty{color:#ccc;font-size:11px}
  #wa-export-root .emp-block{display:block;padding:3px 0;border-bottom:1px dashed #eee;margin-bottom:2px}
  #wa-export-root .emp-block:last-child{border-bottom:none;margin-bottom:0}
  #wa-export-root .tag{display:inline-block;background:#DBEAFE;color:#1E40AF;border-radius:3px;padding:1px 5px;margin:1px;font-size:9px;font-weight:600}
  #wa-export-root .hours{font-size:9px;color:#666;display:block;margin-top:1px}
  #wa-export-root .note{font-size:9px;color:#92400E;font-style:italic;display:block;margin-top:1px}
</style>
<h1>סידור עבודה — ${escHtml(S.business?.name||"ניהול משמרות")}</h1>
<div class="sub">${escHtml(weekLabel)}</div>
<table>
<tr><th>משמרת</th>`;

  wd.forEach(date => {
    const dt = new Date(date+"T00:00:00");
    html += `<th>${DAYS[dt.getDay()]}<br><strong>${dt.getDate()}</strong></th>`;
  });
  html += "</tr>";

  SHIFTS.forEach(sh => {
    html += `<tr><td class="${sh.id}">${sh.label}<br><small>${sh.start}–${sh.end}</small></td>`;
    wd.forEach(date => {
      // Day-specific override hours (Thu-night, Fri, Sat) — show them per-employee
      // when they differ from the row's generic weekday hours.
      const shForDay = getShiftsForDate(date).find(s => s.id === sh.id) || sh;
      const dayHours = shForDay.start + "–" + shForDay.end;
      const genericHours = sh.start + "–" + sh.end;
      const empIds = scheduleData[date]?.[sh.id]||[];
      html += "<td>";
      if (empIds.length === 0) {
        html += '<span class="empty">—</span>';
      } else {
        empIds.forEach(id => {
          const emp = getEmp(id);
          const key = date+"|"+sh.id+"|"+id;
          const ch = hoursData[key];
          const noteInfo = _parseNote(notesData[key]);
          html += `<div class="emp-block">`;
          html += `<span class="chip ${sh.id}">${escHtml(emp?.name||"?")}</span>`;
          if (ch) html += `<span class="hours">⏰ ${ch.start}–${ch.end}</span>`;
          else if (dayHours !== genericHours) html += `<span class="hours">⏰ ${dayHours}</span>`;
          if (noteInfo.tags.length > 0) {
            html += `<div>` + noteInfo.tags.map(t=>`<span class="tag">🏷️ ${escHtml(t)}</span>`).join("") + `</div>`;
          }
          if (noteInfo.text) html += `<span class="note">📝 ${escHtml(noteInfo.text)}</span>`;
          html += `</div>`;
        });
      }
      html += "</td>";
    });
    html += "</tr>";
  });
  html += `</table>
<div style="margin-top:16px;font-size:11px;color:#999">הופק מ-${escHtml(S.business?.name||"משמרת")} · ${new Date().toLocaleDateString("he-IL")}</div>
</div>`;
  return html;
}

// Export the employee's own shifts for the current week as an .ics calendar file.
// Works with iPhone Calendar, Google Calendar, Outlook — any calendar app.
// Morning has two variants (בוקר / בוקר ב׳) that overlap in time — for "who's with me"
// purposes they should be treated as the same group, not separate shifts.
function _shiftGroupIds(shiftId) {
  return (shiftId === "morning" || shiftId === "morning2") ? ["morning", "morning2"] : [shiftId];
}
function _dateShift(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
// Chronological shift order per day: night(D-1) -> morning(D) -> afternoon(D) -> night(D) -> morning(D+1)...
// "Who I'm replacing" = whoever worked the shift immediately before mine in that chain.
function _handoverBefore(shiftId, date) {
  if (shiftId === "morning" || shiftId === "morning2") return { date: _dateShift(date, -1), ids: ["night"] };
  if (shiftId === "afternoon") return { date, ids: ["morning", "morning2"] };
  if (shiftId === "night") return { date, ids: ["afternoon"] };
  return null;
}
// "Who replaces me" = whoever works the shift immediately after mine in that chain.
function _handoverAfter(shiftId, date) {
  if (shiftId === "morning" || shiftId === "morning2") return { date, ids: ["afternoon"] };
  if (shiftId === "afternoon") return { date, ids: ["night"] };
  if (shiftId === "night") return { date: _dateShift(date, 1), ids: ["morning", "morning2"] };
  return null;
}

async function exportMyShiftsToCalendar(empId, weekOffsetParam) {
  const offset = weekOffsetParam != null ? weekOffsetParam : S.weekOffset;
  const wd = getWeekDates(offset);
  const targetEmp = getEmp(empId) || getActiveProfile();

  // Gather this employee's shifts for the week. Use day-specific shift definitions so
  // Thu-night, Fri and Sat each get their own hours (e.g. Fri-night 19:30-07:30 instead
  // of the generic weekday 22:45-07:00). Without this the exported .ics shows wrong times
  // for weekend / Thursday night shifts.
  const myShifts = [];
  wd.forEach(date => {
    const dayShifts = getShiftsForDate(date);
    dayShifts.forEach(sh => {
      if ((S.schedule[date]?.[sh.id] || []).includes(empId)) {
        const ch = S.customHours[date+"|"+sh.id+"|"+empId];
        const noteInfo = _parseNote(S.assignmentNotes[date+"|"+sh.id+"|"+empId]);
        myShifts.push({ date, sh, ch, noteInfo });
      }
    });
  });

  if (myShifts.length === 0) {
    toast("אין משמרות להוספה ליומן השבוע", "err");
    return;
  }

  // Need the day just before the week and just after it too, so "who am I replacing" /
  // "who replaces me" works correctly at the week's edges (Sunday's shift looks at the
  // previous Saturday, Saturday's shift looks at the next Sunday).
  const prevBoundaryDate = _dateShift(wd[0], -1);
  const nextBoundaryDate = _dateShift(wd[6], 1);
  const [prevWeekData, nextWeekData] = await Promise.all([
    loadWeekDataForExport(offset - 1, getWeekDates(offset - 1)[0]),
    loadWeekDataForExport(offset + 1, getWeekDates(offset + 1)[0]),
  ]);

  const allScheduleData = { ...S.schedule };
  if (prevWeekData.scheduleData[prevBoundaryDate]) allScheduleData[prevBoundaryDate] = prevWeekData.scheduleData[prevBoundaryDate];
  if (nextWeekData.scheduleData[nextBoundaryDate]) allScheduleData[nextBoundaryDate] = nextWeekData.scheduleData[nextBoundaryDate];
  const allNotesData = { ...S.assignmentNotes, ...prevWeekData.notesData, ...nextWeekData.notesData };

  // Returns [{id, shiftId}] — one entry per employee found in any of the given shift ids on that date.
  function occupantsForIds(date, ids) {
    const out = [];
    const seen = new Set();
    ids.forEach(sid => (allScheduleData[date]?.[sid] || []).forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, shiftId: sid });
    }));
    return out;
  }
  // Formats an occupant as "שם" or "שם (תגית · הערה)" when they have tags/notes on that shift.
  function formatOccupant(o, date) {
    const nm = getEmp(o.id)?.name;
    if (!nm) return null;
    const info = _parseNote(allNotesData[date+"|"+o.shiftId+"|"+o.id]);
    const extras = [];
    if (info.tags.length > 0) extras.push(info.tags.join("/"));
    if (info.text) extras.push(info.text);
    return extras.length > 0 ? `${nm} (${extras.join(" · ")})` : nm;
  }

  // Build ICS content
  function pad(n){ return String(n).padStart(2,"0"); }
  function toICSDate(dateStr, timeStr, addDay) {
    // dateStr "2026-06-21", timeStr "07:00" -> "20260621T070000" (local, floating time)
    const [y,m,d] = dateStr.split("-").map(Number);
    const [hh,mm] = timeStr.split(":").map(Number);
    const dt = new Date(y, m-1, d + (addDay||0), hh, mm, 0);
    return dt.getFullYear()+pad(dt.getMonth()+1)+pad(dt.getDate())+"T"+pad(dt.getHours())+pad(dt.getMinutes())+"00";
  }
  function escICS(s){ return (s||"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n"); }

  const nowStamp = (()=>{ const d=new Date(); return d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+"T"+pad(d.getUTCHours())+pad(d.getUTCMinutes())+pad(d.getUTCSeconds())+"Z"; })();

  let ics = "BEGIN:VCALENDAR\r\n";
  ics += "VERSION:2.0\r\n";
  ics += "PRODID:-//Meshmeret//Shift Schedule//HE\r\n";
  ics += "CALSCALE:GREGORIAN\r\n";
  ics += "METHOD:PUBLISH\r\n";

  myShifts.forEach((item, i) => {
    const start = item.ch ? item.ch.start : item.sh.start;
    const end = item.ch ? item.ch.end : item.sh.end;
    // Night shift (or any shift where end <= start) crosses midnight -> end is next day
    const crossesMidnight = (end <= start);
    const dtStart = toICSDate(item.date, start, 0);
    const dtEnd = toICSDate(item.date, end, crossesMidnight ? 1 : 0);

    const together = occupantsForIds(item.date, _shiftGroupIds(item.sh.id))
      .filter(o => o.id !== empId).map(o => formatOccupant(o, item.date)).filter(Boolean);
    const beforeInfo = _handoverBefore(item.sh.id, item.date);
    const before = beforeInfo
      ? occupantsForIds(beforeInfo.date, beforeInfo.ids).filter(o => o.id !== empId).map(o => formatOccupant(o, beforeInfo.date)).filter(Boolean)
      : [];
    const afterInfo = _handoverAfter(item.sh.id, item.date);
    const after = afterInfo
      ? occupantsForIds(afterInfo.date, afterInfo.ids).filter(o => o.id !== empId).map(o => formatOccupant(o, afterInfo.date)).filter(Boolean)
      : [];

    // Build description with extras
    let descLines = [];
    if (item.noteInfo.tags.length > 0) descLines.push("מערכות/תפקיד: " + item.noteInfo.tags.join(", "));
    if (item.noteInfo.text) descLines.push("הערה: " + item.noteInfo.text);
    if (together.length > 0) descLines.push("יחד איתי: " + together.join(", "));
    if (before.length > 0) descLines.push("מחליף/ה את: " + before.join(", "));
    if (after.length > 0) descLines.push("אחריי: " + after.join(", "));
    const desc = descLines.join("\\n");

    // Deterministic UID — same shift always gets the same UID, so re-exporting
    // updates the existing calendar event instead of duplicating it. Dropping the
    // array index means that adding/removing other shifts doesn't shift all UIDs.
    const uid = "meshmeret-" + empId + "-" + item.date + "-" + item.sh.id + "@mishmert.com";

    ics += "BEGIN:VEVENT\r\n";
    ics += "UID:" + uid + "\r\n";
    ics += "DTSTAMP:" + nowStamp + "\r\n";
    ics += "DTSTART:" + dtStart + "\r\n";
    ics += "DTEND:" + dtEnd + "\r\n";
    ics += "SUMMARY:" + escICS("משמרת " + item.sh.label) + "\r\n";
    if (desc) ics += "DESCRIPTION:" + escICS(desc) + "\r\n";
    // Honor the employee's reminder preference instead of hardcoded 2h.
    const reminderMin = targetEmp?.shift_reminder_minutes;
    if (reminderMin != null && reminderMin > 0) {
      ics += "BEGIN:VALARM\r\n";
      ics += "TRIGGER:-PT" + reminderMin + "M\r\n";
      ics += "ACTION:DISPLAY\r\n";
      ics += "DESCRIPTION:" + escICS("משמרת " + item.sh.label + " בעוד " + reminderMin + " דקות") + "\r\n";
      ics += "END:VALARM\r\n";
    }
    ics += "END:VEVENT\r\n";
  });

  ics += "END:VCALENDAR\r\n";

  // Trigger download / share of the .ics file
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const fileName = "mishmarot_" + wd[0] + ".ics";

  // Try native share first (lets iPhone open directly in Calendar)
  const file = new File([blob], fileName, { type: "text/calendar" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: "המשמרות שלי" })
      .then(()=>toast("✓ נפתח — בחר 'הוסף ליומן'"))
      .catch(err=>{
        if (err?.name === "AbortError") return;
        _downloadICS(blob, fileName);
      });
  } else {
    _downloadICS(blob, fileName);
  }
}

function _downloadICS(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast("📅 קובץ היומן הורד — פתח אותו כדי להוסיף ליומן");
}

async function exportSchedulePDF(weekOffsetParam) {
  const offset = weekOffsetParam != null ? weekOffsetParam : S.weekOffset;
  const wd = getWeekDates(offset);
  const weekStart = wd[0];
  const weekLabel = fmtDate(wd[0]) + " — " + fmtDate(wd[6]);
  
  const { scheduleData, notesData, hoursData } = await loadWeekDataForExport(offset, weekStart);
  const innerHtml = buildScheduleTableInnerHTML(wd, scheduleData, notesData, hoursData, weekLabel);

  let html = `<!DOCTYPE html><html dir="rtl" lang="he">
<head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
  body{margin:0}
  @page{size:landscape;margin:8mm}
  @media print{body{padding:0}}
</style></head><body>
${innerHtml}
</body></html>`;

  // Use hidden iframe instead of new window — so user stays in the app
  const existingIframe = document.getElementById("__print_iframe");
  if (existingIframe) existingIframe.remove();
  
  const iframe = document.createElement("iframe");
  iframe.id = "__print_iframe";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  document.body.appendChild(iframe);
  
  // Write content to iframe
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  
  // Wait for fonts/content to load, then print
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (err) {
      console.error("Print failed:", err);
      // Fallback: offer HTML download
      const blob = new Blob([html], {type: "text/html;charset=utf-8"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `seder_avoda_${weekStart}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast("הורד כקובץ HTML — פתח אותו והדפס לקבלת PDF","ok");
    }
    // Remove iframe after a delay
    setTimeout(() => iframe.remove(), 2000);
  }, 800);
  
  toast("פתח להדפסה / שמירה כ-PDF ✓");
}

// Lazy-load html2canvas only when actually needed (keeps initial page load light)
function _ensureHtml2Canvas() {
  return new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
    // MSH-202648-005: SRI on dynamically-injected scripts too. If the CDN
    // ever swaps the file, the browser blocks the execution.
    s.integrity = "sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H";
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("html2canvas failed to load"));
    document.head.appendChild(s);
  });
}

async function exportScheduleWhatsApp(weekOffsetParam) {
  const offset = weekOffsetParam != null ? weekOffsetParam : S.weekOffset;
  const wd = getWeekDates(offset);
  const weekStart = wd[0];
  const weekLabel = fmtDate(wd[0]) + " — " + fmtDate(wd[6]);

  toast("📸 מכין תמונה...");

  try {
    await _ensureHtml2Canvas();
  } catch (err) {
    toast("שגיאה בטעינת מנוע התמונה. בדוק חיבור לאינטרנט.", "err");
    return;
  }

  const { scheduleData, notesData, hoursData } = await loadWeekDataForExport(offset, weekStart);
  const innerHtml = buildScheduleTableInnerHTML(wd, scheduleData, notesData, hoursData, weekLabel);

  // Render the table off-screen (not display:none — html2canvas needs real layout)
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.top = "0";
  wrapper.style.left = "-99999px";
  wrapper.style.zIndex = "-1";
  wrapper.innerHTML = innerHtml;
  document.body.appendChild(wrapper);

  // Give fonts/layout a moment to settle
  await new Promise(r => setTimeout(r, 150));

  let blob;
  try {
    const target = wrapper.querySelector("#wa-export-root") || wrapper;
    const canvas = await window.html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  } catch (err) {
    console.error("html2canvas failed:", err);
    toast("שגיאה ביצירת התמונה", "err");
    wrapper.remove();
    return;
  }
  wrapper.remove();

  if (!blob) { toast("שגיאה ביצירת התמונה", "err"); return; }

  const fileName = `seder_avoda_${weekStart}.png`;
  const file = new File([blob], fileName, { type: "image/png" });

  // Prefer the native share sheet (lets the user pick WhatsApp directly) when available
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "סידור עבודה", text: weekLabel });
      toast("✓ נשלח לשיתוף");
      return;
    } catch (err) {
      // User cancelled the share sheet — not an error, just stop quietly
      if (err?.name === "AbortError") return;
      console.warn("Share failed, falling back to download:", err);
    }
  }

  // Fallback (desktop / unsupported browsers): download the image and guide the user
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
  toast("📥 התמונה הורדה — צרף אותה ידנית בוואטסאפ", "ok");
}

async function exportScheduleCSV(weekOffsetParam) {
  const offset = weekOffsetParam != null ? weekOffsetParam : S.weekOffset;
  const wd = getWeekDates(offset);
  const weekStart = wd[0];
  
  // Load schedule data + notes + customHours for the selected week
  let scheduleData = S.schedule;
  let notesData = S.assignmentNotes;
  let hoursData = S.customHours;
  if (offset !== S.weekOffset) {
    const { data: sched } = await sb.from("schedules")
      .select("id").eq("business_id", S.profile.business_id).eq("week_start", weekStart).maybeSingle();
    if (sched) {
      const { data: assigns } = await sb.from("assignments").select("*").eq("schedule_id", sched.id);
      scheduleData = {};
      notesData = {};
      hoursData = {};
      (assigns || []).forEach(a => {
        if (!scheduleData[a.date]) scheduleData[a.date] = {};
        if (!scheduleData[a.date][a.shift]) scheduleData[a.date][a.shift] = [];
        scheduleData[a.date][a.shift].push(a.employee_id);
        const key = a.date+"|"+a.shift+"|"+a.employee_id;
        if (a.note) notesData[key] = a.note;
        if (a.custom_start && a.custom_end) hoursData[key] = {start:a.custom_start, end:a.custom_end};
      });
    } else {
      scheduleData = {};
      notesData = {};
      hoursData = {};
    }
  }
  
  let csv = "\u05de\u05e9\u05de\u05e8\u05ea,\u05e9\u05e2\u05d5\u05ea,"+wd.map(d=>{const dt=new Date(d+"T00:00:00");return DAYS[dt.getDay()]+" "+dt.getDate();}).join(",")+String.fromCharCode(10);
  SHIFTS.forEach(sh => {
    const row = [sh.label, sh.start+"–"+sh.end];
    wd.forEach(date => {
      // Pick up day-specific hours (Thu-night, Fri, Sat) when the employee has no
      // custom hours — otherwise the CSV wrongly shows the generic weekday times.
      const shForDay = getShiftsForDate(date).find(s => s.id === sh.id) || sh;
      const dayDefaultHours = shForDay.start + "-" + shForDay.end;
      const genericDefaultHours = sh.start + "-" + sh.end;
      const empIds = scheduleData[date]?.[sh.id]||[];
      if (empIds.length === 0) {
        row.push("—");
      } else {
        // For each employee, format: "Name [07:00-15:00] {Cortex, EDR} (note)"
        const empStrs = empIds.map(id => {
          const emp = getEmp(id);
          const key = date+"|"+sh.id+"|"+id;
          const ch = hoursData[key];
          const noteInfo = _parseNote(notesData[key]);
          let str = emp?.name||"?";
          if (ch) str += " [" + ch.start + "-" + ch.end + "]";
          else if (dayDefaultHours !== genericDefaultHours) str += " [" + dayDefaultHours + "]";
          if (noteInfo.tags.length > 0) str += " {" + noteInfo.tags.join(", ") + "}";
          if (noteInfo.text) str += " (" + noteInfo.text + ")";
          return str;
        });
        row.push(empStrs.join(" + "));
      }
    });
    csv += row.map(v=>"\""+v.replace(/"/g, '""')+"\"").join(",") + String.fromCharCode(10);
  });
  const blob = new Blob(["﻿"+csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=`seder_avoda_${weekStart}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast("קובץ CSV הורד ✓");
}
