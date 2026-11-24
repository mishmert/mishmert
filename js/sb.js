"use strict";

// sb.js — the single Supabase client the whole app shares.
// Loaded right after the supabase-js UMD build in index.html so the global
// `supabase` is defined. No other file should createClient() its own; everyone
// else just references `sb` (resolved at call time via classic-script shared scope).

// ══════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════
export const SUPABASE_URL = "https://zszlqoisokjgvplrcbic.supabase.co";
export const SUPABASE_KEY = "sb_publishable_b6ZEtYrgGIQT8WxkahGzZg_iHTYMasi";
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Meshmeret app runtime — Supabase client + styles imported; rest preserved as one scope.
