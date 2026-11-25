// types/globals.d.ts — TypeScript sees these when it type-checks js/*.js.
//
// Incremental approach: declare the common CDN/window globals + the S app-state
// shape just well enough that IDE autocomplete works and the most obvious
// mistakes (undefined global, wrong S field) surface. This is NOT a full TS
// conversion — most .js functions still have `any` parameters.

/// <reference types="vite/client" />

// ──────────────────────────────────────────────────────────────────────
//  CDN GLOBALS
// ──────────────────────────────────────────────────────────────────────

interface Window {
  S: AppState;
  sb: SupabaseClient;
  html2canvas?: (el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>;
  PasswordCredential?: new (opts: any) => any;
}

declare var supabase: {
  createClient(url: string, key: string, opts?: any): SupabaseClient;
};

declare var twemoji: {
  parse(node: HTMLElement | Document, opts?: any): void;
};

declare var html2canvas: ((el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>) | undefined;

// Legacy memoization guard referenced by history.js — never actually defined.
declare var invalidateMonthCache: (() => void) | undefined;

// ──────────────────────────────────────────────────────────────────────
//  SUPABASE CLIENT (just enough shape for autocomplete; not a full typing)
// ──────────────────────────────────────────────────────────────────────

interface SupabaseClient {
  auth: any;
  from: (table: string) => any;
  rpc: (fn: string, args?: any) => any;
  channel: (name: string) => any;
  removeChannel: (ch: any) => any;
  functions: { invoke: (name: string, opts?: any) => Promise<any> };
  realtime: any;
}

// ──────────────────────────────────────────────────────────────────────
//  APP STATE (S)
// ──────────────────────────────────────────────────────────────────────
// `[key: string]: any` is an intentional escape hatch — the codebase assigns
// dozens of ad-hoc keys to S across views and actions, typing every one would
// be a rewrite. The named fields below are the stable, frequently-accessed
// ones — enough for IDE autocomplete on S.view, S.user, etc.

interface AppState {
  [key: string]: any;

  view: string;
  user: { id: string; email?: string } | null;
  profile: {
    id: string;
    business_id: string;
    role: "admin" | "manager" | "employee";
    name?: string;
    email?: string;
    is_super_admin?: boolean;
  } | null;
  business: {
    id: string;
    name: string;
    enabled_features?: Record<string, boolean>;
    notified_manager_ids?: string[];
  } | null;

  employees: Array<any>;
  vacations: Array<any>;
  swapRequests: Array<any>;
  availSubmissions: Array<any>;
  invitations: Array<any>;

  schedule: Record<string, Record<string, string[]>>;
  publishedWeeks: Set<string>;
  lockedSlots: Record<string, Set<string>>;
  customHours: Record<string, { start: string; end: string }>;
  assignmentNotes: Record<string, string>;

  weekOffset: number;
  selectedCell: { date: string; shift: string } | null;
  empViewId: string | null;
  empViewTab: string;

  toast: { msg: string; type: string; undo?: Function | null } | null;
  modal: any;
  dialog: any;

  testAsEmployee: boolean;
  loginMode: "login" | "signup" | "reset";
}
