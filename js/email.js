// email.js — queued transactional email via Supabase Edge Function + Resend.
// Extracted from index.html on 2026-11-24.
//
// Contents:
//  - APP_URL + _deepLinkUrl(type)  : builds the ?goto=<target> URL that each
//                                    email's CTA opens.
//  - The in-process email queue    : enqueueEmail + _processEmailQueue, with
//                                    2-per-second pacing to stay under Resend's
//                                    free-tier rate limit.
//  - sendEmail(type, toEmail, data): the one entry point every caller uses;
//                                    hands off to the rapid-action Edge Function
//                                    with the caller's session JWT (not the anon
//                                    key) so the server can tenant-check the
//                                    recipient list against the sender's business.
//
// Dependencies at call time: `sb` (inline CONFIG), `S` (state.js), `toast()`
// (utils.js). No render() calls here.

// ══════════════════════════════════════════════════════
// EMAIL NOTIFICATIONS via Supabase Edge Function + Resend
// ══════════════════════════════════════════════════════
"use strict";

import { sb } from './sb.js';
export const APP_URL = "https://mishmert.com/";

// Email queue with rate limiting (Resend: 2/sec limit)
// Map each email type to the screen its link should open (?goto=<target>).
export function _deepLinkUrl(type) {
  const base = APP_URL.replace(/\/$/, "");
  const map = {
    schedule_published:    "schedule",
    schedule_initial:      "schedule",
    schedule_full_view:    "schedule",
    schedule_preview_full: "schedule",
    vacation_approved:     "vacations",
    vacation_rejected:     "vacations",
    absence_request:       "vacations",
    swap_request:          "swaps",
    swap_decision:         "swaps",
    block_message:         "blocks",
    reminder:              "blocks",
  };
  const goto = map[type];
  return goto ? (base + "/?goto=" + goto) : (base + "/");
}

export const _emailQueue = [];
export let _emailProcessing = false;

export async function _processEmailQueue() {
  if (_emailProcessing) return;
  _emailProcessing = true;
  while (_emailQueue.length > 0) {
    const { type, toEmail, data, retries } = _emailQueue.shift();
    try {
      // MSH-202648-001: the Edge Function requires the caller's session JWT so
      // it can gate recipient against the caller's tenant.
      const sess = (await sb.auth.getSession())?.data?.session;
      if (!sess?.access_token) {
        console.warn("📧 Email skipped: no active session");
        continue;
      }
      const resp = await fetch("https://zszlqoisokjgvplrcbic.supabase.co/functions/v1/rapid-action", {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + sess.access_token,
        },
        body: JSON.stringify({ type, to: toEmail, data: { ...data, appUrl: _deepLinkUrl(type) } })
      });
      
      // Handle rate limit with retry
      if (resp.status === 429 && retries < 3) {
        console.warn("📧 Rate limited, retry in 2s:", toEmail);
        _emailQueue.unshift({ type, toEmail, data, retries: retries + 1 });
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      
      const result = await resp.json().catch(()=>({}));
      if (resp.status >= 200 && resp.status < 300) {
      } else {
        console.warn("📧 ✗ Failed:", resp.status, result);
      }
    } catch (err) {
      console.warn("📧 Network error:", err);
    }
    // Throttle: wait 600ms between requests (~1.6/sec, safe under 2/sec limit)
    await new Promise(r => setTimeout(r, 600));
  }
  _emailProcessing = false;
}
