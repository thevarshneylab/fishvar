/*!
 * Exercise docs/app.js against a minimal DOM, offline.
 *
 * Syntax checks cannot catch a typo inside a render path that only runs for one
 * strategy, and the browser pane cannot reach this sandbox. So this stands up
 * just enough of the DOM for app.js to run, drives the real click handler for
 * several variants, and asserts on the text it rendered.
 *
 * The point is coverage of the UI code, not of the design logic -- that is
 * already covered by test/run.js and test/bundle.js.
 *
 *   node test/build-fixtures.js && node tools/bundle.js && node test/dom.js
 */
"use strict";

var fs = require("fs");
var path = require("path");
var cache = require("../lib/http.js");

var ROOT = path.join(__dirname, "..");
var FIXTURES = path.join(ROOT, "fixtures");

var passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log("  ok   " + label); }
  else { failed++; console.log("  FAIL " + label + (detail ? "\n         " + detail : "")); }
}

/* ------------------------------------------------------------------ *
 * Minimal DOM
 * ------------------------------------------------------------------ */

function Node(tag) {
  this.tagName = (tag || "").toUpperCase();
  this.children = [];
  this.attrs = {};
  this.className = "";
  this.style = {};
  this._text = "";
  this.listeners = {};
}
Node.prototype.appendChild = function (c) { this.children.push(c); return c; };
Node.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; });
};
Node.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Node.prototype.getAttribute = function (k) {
  return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
};
Node.prototype.addEventListener = function (ev, fn) {
  (this.listeners[ev] = this.listeners[ev] || []).push(fn);
};
Node.prototype.fire = function (ev) {
  return Promise.all((this.listeners[ev] || []).map(function (fn) { return fn({ key: ev }); }));
};
Object.defineProperty(Node.prototype, "textContent", {
  get: function () {
    return this._text + this.children.map(function (c) { return c.textContent; }).join("");
  },
  set: function (v) { this._text = v === null || v === undefined ? "" : String(v); this.children = []; }
});
Node.prototype.text = function () { return this.textContent; };
Node.prototype.classes = function () {
  var out = [this.className];
  this.children.forEach(function (c) { out = out.concat(c.classes()); });
  return out.filter(Boolean);
};

function TextNode(t) { Node.call(this, "#text"); this._text = t; }
TextNode.prototype = Object.create(Node.prototype);

var IDS = ["status", "out", "variant", "run", "top", "untested", "paralogs", "ptctop", "stamp"];
var byId = {};
IDS.forEach(function (id) {
  var n = new Node(id === "variant" || id === "top" ? "input" : "div");
  n.id = id;
  n.value = "";
  n.checked = false;
  n.disabled = false;
  byId[id] = n;
});
byId.top.value = "3";
byId.paralogs.value = "4";
byId.ptctop.value = "8";

var header = new Node("header");

global.document = {
  createElement: function (tag) { return new Node(tag); },
  createTextNode: function (t) { return new TextNode(t); },
  getElementById: function (id) { return byId[id] || null; },
  querySelector: function (sel) { return sel === "header" ? header : null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: new Node("body")
};
global.location = { hash: "", href: "http://localhost/" };
global.history = { replaceState: function () {} };
/* Node 22 defines a getter-only global navigator, so it has to be redefined
   rather than assigned. */
Object.defineProperty(global, "navigator", {
  value: { clipboard: { writeText: function () { return Promise.resolve(); } } },
  configurable: true, writable: true
});
global.Blob = function (parts) { this.parts = parts; };
global.URL.createObjectURL = function () { return "blob:stub"; };
global.URL.revokeObjectURL = function () {};

/* ------------------------------------------------------------------ *
 * fetch: fixtures for absolute URLs, docs/ for relative ones
 * ------------------------------------------------------------------ */

var fetched = [];
global.fetch = function (url) {
  var u = String(url);
  fetched.push(u);

  if (!/^https?:\/\//.test(u)) {
    var p = path.join(ROOT, "docs", u.replace(/^\.?\//, ""));
    if (!fs.existsSync(p)) {
      return Promise.resolve({ ok: false, status: 404,
        text: function () { return Promise.resolve(""); } });
    }
    var body = fs.readFileSync(p, "utf8");
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve(JSON.parse(body)); },
      text: function () { return Promise.resolve(body); },
      headers: { get: function () { return null; } }
    });
  }

  var file = cache.cachePath(FIXTURES, u);
  if (!file || !fs.existsSync(file)) {
    return Promise.resolve({ ok: false, status: 404,
      text: function () { return Promise.resolve("no fixture"); },
      headers: { get: function () { return null; } } });
  }
  var text = fs.readFileSync(file, "utf8");
  return Promise.resolve({
    ok: true, status: 200,
    json: function () { return Promise.resolve(JSON.parse(text)); },
    text: function () { return Promise.resolve(text); },
    headers: { get: function () { return null; } }
  });
};

/* ------------------------------------------------------------------ *
 * Load the page scripts in order
 * ------------------------------------------------------------------ */

global.self = global;
require("../vendor/umax.js");               // sets self.UMAX via its UMD wrapper
global.self.UMAX = require("../vendor/umax.js");
require("../docs/fishvar.bundle.js");       // sets self.FISHVAR
require("../docs/app.js");                  // wires the handlers

async function designFor(spec) {
  byId.variant.value = spec;
  byId.out.children = [];
  global.self.FISHVAR.http.clearMemoryCache();
  await byId.run.fire("click");
  return { out: byId.out.textContent, status: byId.status.textContent, node: byId.out };
}

(async function main() {
  console.log("\nPage wiring");
  check("build stamp rendered in the footer",
    /^Build [0-9a-f]{16}\.$/.test(byId.stamp.textContent), byId.stamp.textContent);
  check("run button has a click handler", (byId.run.listeners.click || []).length === 1);
  check("variant field has a keydown handler", (byId.variant.listeners.keydown || []).length === 1);

  console.log("\nEmpty input");
  var empty = await designFor("");
  check("asks for a variant rather than throwing", /Enter a variant/.test(empty.status), empty.status);

  console.log("\nMissense renders");
  var mis = await designFor("VCV000099999");
  check("verdict badge", /designed/.test(mis.out), mis.out.slice(0, 120));
  check("names the strategy", /orthologous substitution/.test(mis.out));
  check("shows the human change", /human TESTA p\.R100H/.test(mis.out));
  check("orthologue table lists the conserved paralogue",
    /ENSDARG00000000001/.test(mis.out) && /conserved/.test(mis.out));
  check("reports the non-conserved paralogue too",
    /not_conserved/.test(mis.out));
  check("shows the codon change", /CGC → CAC/.test(mis.out), "no codon arrow");
  check("shows a spacer", /ACGCGTGAGTTCAGGATACC/.test(mis.out));
  check("shows the genomic context", /target codon|copy context/.test(mis.out) ||
    mis.node.classes().indexOf("ctx") >= 0);
  check("offers export", /Download CSV/.test(mis.out));
  check("status reports a guide count", /guides designed/.test(mis.status), mis.status);

  console.log("\nTransversion renders its product mixture");
  var tv = await designFor("TESTF:p.Asp100Ala");
  check("declares the mixture", /makes a mixture at the edited base/.test(tv.out));
  check("lists all three products",
    /D90A/.test(tv.out) && /D90V/.test(tv.out) && /D90G/.test(tv.out));
  check("flags unpublished chemistry", /unpublished editor/.test(tv.out));

  console.log("\nPremature stop renders");
  var ptc = await designFor("VCV000077777");
  check("names the strategy", /premature stop/.test(ptc.out));
  check("reports the truncation point", /truncation point maps to/.test(ptc.out));
  check("reports the scan", /stop-able codons/.test(ptc.out));
  check("shows an NMD-competent verdict", /NMD competent/.test(ptc.out));
  check("shows distance to the last junction",
    /nt from the last exon–exon junction/.test(ptc.out));
  check("shows an NMD escape with its explanation",
    /NMD escape/.test(ptc.out) && /final exon|exon-exon junction/.test(ptc.out));
  check("explains the start-proximal case",
    /reinitiation/.test(ptc.out), "start-proximal detail missing");
  check("shows a stop codon conversion", /CAA → TAA/.test(ptc.out));
  check("marks a guide reaching an exon junction", /exon junction/.test(ptc.out));
  check("shows position relative to the lesion",
    /residues before the lesion/.test(ptc.out));

  console.log("\nDead ends and refusals render as reasons, not errors");
  var dead = await designFor("TESTB:p.Arg100His");
  check("dead end explains the genetic code",
    /whatever the chemistry/.test(dead.out), dead.out.slice(0, 200));
  check("names the codons that would have worked",
    /CGC or CGT/.test(dead.out));
  check("no export offered when nothing was designed", !/Download CSV/.test(dead.out));

  var scope = await designFor("TESTA:p.Ter150Leu");
  check("out-of-scope badge", /out of scope/.test(scope.out), scope.out.slice(0, 160));
  check("explains read-through", /read-through/.test(scope.out));

  var iso = await designFor("TESTA:p.Lys100His");
  check("numbering mismatch badge", /numbering mismatch/.test(iso.out));
  check("points at the transcript", /isoform|numbered against/.test(iso.out));

  console.log("\nUnreachable host is reported as such");
  var saved = global.fetch;
  global.fetch = function (url) {
    if (/^https?:\/\//.test(String(url))) return Promise.reject(new TypeError("Failed to fetch"));
    return saved(url);
  };
  var offline = await designFor("TESTA:p.Arg100His");
  global.fetch = saved;
  check("explains that the host could not be reached",
    /could not be reached|Could not reach/.test(offline.out), offline.out.slice(0, 200));
  check("does not present it as a design failure",
    !/no guide|not modelable/.test(offline.out));

  console.log("\nClinVar specifically suggests the direct-input fallback");
  global.fetch = function (url) {
    var u = String(url);
    if (/eutils\.ncbi/.test(u)) return Promise.reject(new TypeError("Failed to fetch"));
    return saved(url);
  };
  var cv = await designFor("VCV000099999");
  global.fetch = saved;
  check("names ClinVar as the blocked host", /ClinVar could not be reached/.test(cv.out),
    cv.out.slice(0, 200));
  check("offers GENE:p.Change as the way round it",
    /GENE:p\.Change/.test(cv.out) && /MYO7A/.test(cv.out));

  console.log("\n" + (failed ? "FAILED" : "PASSED") + ": " +
    passed + " checks passed, " + failed + " failed\n");
  process.exitCode = failed ? 1 : 0;
})().catch(function (e) {
  console.error("\nDOM suite crashed: " + e.stack);
  process.exitCode = 1;
});
