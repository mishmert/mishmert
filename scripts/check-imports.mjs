import { parse } from "acorn";
import fs from "fs";
import path from "path";

// Resolve js/ relative to the repo root (one directory above this script).
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const jsDir = path.resolve(__dirname, "..", "js");
const files = fs.readdirSync(jsDir).filter(f => f.endsWith(".js")).sort();

// Walk AST and collect ALL Identifier nodes that are "usage" positions
// (not declarations, not property keys without computed, not MemberExpression.property)
function collectUsages(node, ctx, acc) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(n => collectUsages(n, ctx, acc)); return; }
  if (!node.type) return;

  const t = node.type;

  // Declarations introduce binding, not usage
  if (t === "VariableDeclarator") {
    // init is a usage; id is a declaration
    collectUsages(node.init, ctx, acc);
    return;
  }
  if (t === "FunctionDeclaration" || t === "FunctionExpression" || t === "ArrowFunctionExpression" || t === "ClassDeclaration" || t === "ClassExpression") {
    collectUsages(node.body, ctx, acc);
    // params are declarations; defaults are usages
    (node.params || []).forEach(p => {
      if (p.type === "AssignmentPattern") collectUsages(p.right, ctx, acc);
    });
    return;
  }
  if (t === "Property" || t === "PropertyDefinition") {
    if (node.computed) collectUsages(node.key, ctx, acc);
    collectUsages(node.value, ctx, acc);
    return;
  }
  if (t === "MemberExpression") {
    collectUsages(node.object, ctx, acc);
    if (node.computed) collectUsages(node.property, ctx, acc);
    return;
  }
  if (t === "ImportDeclaration") return;  // handled separately
  if (t === "ExportNamedDeclaration") {
    collectUsages(node.declaration, ctx, acc);
    return;
  }
  if (t === "ExportDefaultDeclaration") {
    collectUsages(node.declaration, ctx, acc);
    return;
  }

  if (t === "Identifier") {
    acc.add(node.name);
    return;
  }

  // Default: recurse everything
  for (const k in node) {
    if (k === "type" || k === "loc" || k === "start" || k === "end") continue;
    const v = node[k];
    if (v && (typeof v === "object")) collectUsages(v, ctx, acc);
  }
}

// Exports per file
const exportsByFile = {};
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), "utf8");
  const ast = parse(src, { ecmaVersion: 2022, sourceType: "module", locations: true });
  const exp = new Set();
  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const d = node.declaration;
      if (d.type === "FunctionDeclaration" && d.id) exp.add(d.id.name);
      else if (d.type === "VariableDeclaration") {
        for (const decl of d.declarations) if (decl.id.type === "Identifier") exp.add(decl.id.name);
      }
    }
  }
  exportsByFile[f] = exp;
}
const owner = {};
for (const [f, s] of Object.entries(exportsByFile)) for (const n of s) if (!(n in owner)) owner[n] = f;

const BUILTIN = new Set("Array Boolean Date Error JSON Map Math Number Object Promise RegExp Set String Symbol undefined null true false NaN Infinity console document window location localStorage sessionStorage navigator history URL URLSearchParams FileReader FormData Blob File Image crypto fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame atob btoa parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent self globalThis arguments supabase TextDecoder TextEncoder Uint8Array Int8Array ArrayBuffer DataView TypeError RangeError SyntaxError ReferenceError alert confirm prompt event Audio Notification HTMLElement Event performance requestIdleCallback cancelIdleCallback CustomEvent Headers Response Request AbortController AbortSignal structuredClone ReadableStream WritableStream Int32Array Int16Array Uint32Array Uint16Array Float32Array Float64Array BigInt BigInt64Array BigUint64Array Reflect Proxy WeakMap WeakSet DOMParser XMLSerializer".split(" "));

let totalMissing = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(jsDir, f), "utf8");
  let ast;
  try { ast = parse(src, { ecmaVersion: 2022, sourceType: "module", locations: true }); }
  catch (e) { console.error(f, "parse fail", e.message); continue; }

  // Collected imported names
  const imported = new Set();
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      for (const sp of node.specifiers) imported.add(sp.local.name);
    }
  }

  // Local scope: var/let/const decls, fn names, class names, catch params, for-of/in loop vars, destructuring
  const local = new Set();
  const walkLocal = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walkLocal); return; }
    if (n.type === "VariableDeclarator" && n.id) collectPatternNames(n.id, local);
    if (n.type === "FunctionDeclaration" && n.id) local.add(n.id.name);
    if (n.type === "FunctionExpression" && n.id) local.add(n.id.name);
    if (n.type === "ClassDeclaration" && n.id) local.add(n.id.name);
    if (n.type === "ClassExpression" && n.id) local.add(n.id.name);
    if ((n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") && n.params) {
      for (const p of n.params) collectPatternNames(p, local);
    }
    if (n.type === "CatchClause" && n.param) collectPatternNames(n.param, local);
    if ((n.type === "ForOfStatement" || n.type === "ForInStatement") && n.left) {
      if (n.left.type === "VariableDeclaration") {
        for (const d of n.left.declarations) collectPatternNames(d.id, local);
      }
    }
    for (const k in n) {
      if (k === "type" || k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (v && typeof v === "object") walkLocal(v);
    }
  };
  function collectPatternNames(pat, set) {
    if (!pat) return;
    if (pat.type === "Identifier") set.add(pat.name);
    else if (pat.type === "ObjectPattern") pat.properties.forEach(p => {
      if (p.type === "Property") collectPatternNames(p.value, set);
      else if (p.type === "RestElement") collectPatternNames(p.argument, set);
    });
    else if (pat.type === "ArrayPattern") pat.elements.forEach(e => e && collectPatternNames(e, set));
    else if (pat.type === "RestElement") collectPatternNames(pat.argument, set);
    else if (pat.type === "AssignmentPattern") collectPatternNames(pat.left, set);
  }
  walkLocal(ast);

  // Collect used identifiers via the walker
  const used = new Set();
  collectUsages(ast.body, null, used);

  const missing = new Set();
  for (const name of used) {
    if (BUILTIN.has(name)) continue;
    if (imported.has(name)) continue;
    if (local.has(name)) continue;
    if (exportsByFile[f].has(name)) continue;
    if (owner[name] && owner[name] !== f) missing.add(name);
  }

  if (missing.size > 0) {
    const byOwner = {};
    for (const n of missing) (byOwner[owner[n]] ||= []).push(n);
    for (const [src, names] of Object.entries(byOwner)) {
      console.log(`${f}: MISSING import { ${names.sort().join(", ")} } from './${src}'`);
      totalMissing += names.length;
    }
  }
}
console.log(`\n== ${totalMissing} missing imports across ${files.length} files ==`);
if (totalMissing > 0) process.exit(1);
