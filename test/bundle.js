/*!
 * Does the browser bundle produce the same answers as the CLI?
 *
 * The bundle is generated from lib/, so in principle it must. In practice the
 * browser path differs in two real ways -- no filesystem cache and an injected
 * engine instead of one read from disk -- and either could change behaviour
 * without changing lib/. So this runs both and compares the results field by
 * field.
 *
 * Fixtures are served by stubbing global fetch against the same cache files the
 * CLI reads, so both paths see byte-identical inputs and any difference is the
 * code, not the data.
 *
 *   node test/build-fixtures.js && node tools/bundle.js && node test/bundle.js
 */
"use strict";

var fs = require("fs");
var path = require("path");

var FIXTURES = path.join(__dirname, "..", "fixtures");
var nodeHttp = require("../lib/http.js");
var nodePipeline = require("../lib/pipeline.js");
var UMAX = require("../vendor/umax.js");
var editorsData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vendor", "editors.json"), "utf8"));

var passed = 0, failed = 0;

function check(label, ok, detail) {
  if (ok) { passed++; console.log("  ok   " + label); }
  else { failed++; console.log("  FAIL " + label + (detail ? "\n         " + detail : "")); }
}

/* Serve the fixtures through fetch, so the bundle's own HTTP layer runs. */
var served = 0, missed = [];
global.fetch = function (url) {
  var file = nodeHttp.cachePath(FIXTURES, String(url));
  if (!file || !fs.existsSync(file)) {
    missed.push(String(url));
    return Promise.resolve({
      ok: false, status: 404,
      text: function () { return Promise.resolve("no fixture"); },
      headers: { get: function () { return null; } }
    });
  }
  served++;
  var body = fs.readFileSync(file, "utf8");
  return Promise.resolve({
    ok: true, status: 200,
    json: function () { return Promise.resolve(JSON.parse(body)); },
    text: function () { return Promise.resolve(body); },
    headers: { get: function () { return null; } }
  });
};

global.self = global;
require("../docs/fishvar.bundle.js");
var FISHVAR = global.self.FISHVAR;

/* The engine is injected in the browser rather than read from disk. */
var ENGINE = { UMAX: UMAX, editorsData: editorsData, commit: "test" };

/** umaxCommit differs by construction (disk vs injected); ignore just that. */
function normalise(r) {
  var copy = JSON.parse(JSON.stringify(r));
  delete copy.umaxCommit;
  return copy;
}

function diffPath(a, b, where) {
  if (a === b) return null;
  if (typeof a !== typeof b) return where + ": " + typeof a + " vs " + typeof b;
  if (a === null || b === null || typeof a !== "object") {
    return where + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return where + ": array vs object";
  if (Array.isArray(a) && a.length !== b.length) {
    return where + ".length: " + a.length + " vs " + b.length;
  }
  var keys = [...new Set(Object.keys(a).concat(Object.keys(b)))];
  for (var k of keys) {
    var d = diffPath(a[k], b[k], where + "." + k);
    if (d) return d;
  }
  return null;
}

var CASES = [
  "VCV000099999",          // missense, conserved, CBE
  "TESTF:p.Asp100Ala",     // missense, transversion with a mixed product spectrum
  "TESTB:p.Arg100His",     // dead end: codon cannot reach the residue
  "TESTA:p.Lys100His",     // isoform numbering disagreement
  "VCV000077777",          // nonsense -> premature stop
  "VCV000066666",          // frameshift -> premature stop
  "TESTA:p.Ter150Leu",     // stop-loss, out of scope
  "TESTC:p.Arg100His",     // guides reaching an exon junction
  "TESTD:p.Arg100His"      // split codon, refused
];

(async function main() {
  console.log("\nBundle integrity");
  check("bundle exposes a stamp", typeof FISHVAR.stamp === "string" && FISHVAR.stamp.length === 16);
  check("bundle reports no filesystem", FISHVAR.http.hasDisk === false);
  check("every lib module is present",
    ["http", "palette", "clinvar", "ensembl", "ortholog", "ptc", "format", "pipeline"]
      .every(function (m) { return FISHVAR[m]; }));
  check("node built-ins throw rather than resolving to null",
    (function () {
      try { FISHVAR.pipeline.loadEngine(); return false; }
      catch (e) { return /guide engine|built-in/.test(e.message); }
    })(),
    "loadEngine with no injected engine must fail loudly in the browser");

  console.log("\nBundle matches the CLI, variant by variant");

  for (var spec of CASES) {
    FISHVAR.http.clearMemoryCache();
    var fromNode, fromBundle, nodeErr = null, bundleErr = null;

    try {
      fromNode = await nodePipeline.run(spec, { cacheDir: FIXTURES, cacheOnly: true });
    } catch (e) { nodeErr = e.message; }

    try {
      fromBundle = await FISHVAR.pipeline.run(spec, { engine: ENGINE });
    } catch (e) { bundleErr = e.message; }

    if (nodeErr || bundleErr) {
      check(spec + ": both paths fail the same way", nodeErr === bundleErr,
        "node: " + nodeErr + "\n         bundle: " + bundleErr);
      continue;
    }

    var d = diffPath(normalise(fromNode), normalise(fromBundle), spec);
    check(spec + ": identical result (" + fromNode.status + ")", d === null, d);
  }

  console.log("\nRendering through the bundle");
  FISHVAR.http.clearMemoryCache();
  var one = await FISHVAR.pipeline.run("VCV000077777", { engine: ENGINE });
  var text = FISHVAR.format.formatText(one, { topN: 2 });
  check("text report renders", text.indexOf("premature stop") >= 0 || text.indexOf("NMD") >= 0,
    text.slice(0, 200));
  var csv = FISHVAR.format.formatCsv([one], { topN: 1 });
  check("CSV renders with a header and rows", csv.split("\n").length > 2);
  check("CSV marks the strategy", csv.indexOf("premature_stop") >= 0);

  console.log("\nfetch stub served " + served + " fixture responses" +
    (missed.length ? ", " + missed.length + " missed" : ""));
  if (missed.length) {
    console.log("missed URLs:");
    [...new Set(missed)].slice(0, 10).forEach(function (u) { console.log("  " + u); });
  }

  console.log("\n" + (failed ? "FAILED" : "PASSED") + ": " +
    passed + " checks passed, " + failed + " failed\n");
  process.exitCode = failed ? 1 : 0;
})().catch(function (e) {
  console.error("\nbundle suite crashed: " + e.stack);
  process.exitCode = 1;
});
