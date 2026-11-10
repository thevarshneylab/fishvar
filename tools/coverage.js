#!/usr/bin/env node
/*!
 * How much of the substitution space each Umax chemistry can reach.
 *
 * Derived from the engine's family table and the live palette, so the numbers
 * cannot drift away from the editors actually implemented. Run it after
 * changing editors.json or adding a chemistry.
 *
 *   node tools/coverage.js
 *
 * The denominator is every (wild-type codon -> target residue) job that some
 * single nucleotide substitution could perform. This is a ceiling on chemistry
 * alone: it says nothing about whether the residue is conserved in zebrafish,
 * whether a PAM is available, or whether the base lands in an editing window.
 * Real end-to-end yield is lower.
 */
"use strict";

var UMAX = require("../vendor/umax.js");
var palette = require("../lib/palette.js");

var ALL = {};
"ACGT".split("").forEach(function (x) {
  "ACGT".split("").forEach(function (y) { if (x !== y) ALL[x + ">" + y] = true; });
});

function reachableAas(codon, allowed) {
  var out = {};
  for (var i = 0; i < 3; i++) {
    for (var m of ["A", "C", "G", "T"]) {
      if (m === codon.charAt(i)) continue;
      if (!allowed[codon.charAt(i) + ">" + m]) continue;
      out[UMAX.CODONS[codon.substring(0, i) + m + codon.substring(i + 1)]] = true;
    }
  }
  return out;
}

function tally(allowed) {
  var t = { missenseHere: 0, missenseAny: 0, stopHere: 0, stopAny: 0 };
  Object.keys(UMAX.CODONS).forEach(function (codon) {
    var wt = UMAX.CODONS[codon];
    if (wt === "*") return;
    var universe = reachableAas(codon, ALL);
    var mine = reachableAas(codon, allowed);
    Object.keys(universe).forEach(function (aa) {
      if (aa === wt) return;
      if (aa === "*") { t.stopAny++; if (mine[aa]) t.stopHere++; }
      else { t.missenseAny++; if (mine[aa]) t.missenseHere++; }
    });
  });
  return t;
}

function allowedFor(families) {
  var pal = palette.buildPalette(UMAX.FAMILY);
  var allowed = {};
  pal.forEach(function (routes, key) {
    if (routes.some(function (r) { return families.indexOf(r.family) >= 0; })) allowed[key] = true;
  });
  return allowed;
}

function pct(a, b) { return b ? (100 * a / b).toFixed(1).padStart(5) + "%" : "    -" ; }

var families = Object.keys(UMAX.FAMILY);
var full = allowedFor(families);

console.log("");
console.log("Substitutions the palette can install:");
console.log("  available  : " + Object.keys(full).sort().join(", "));
console.log("  unavailable: " + Object.keys(ALL).filter(function (k) { return !full[k]; }).sort().join(", "));
console.log("");

var rows = families.map(function (f) { return { label: f + " only", fams: [f] }; });
/* Cumulative combinations, in the order the chemistries were published. */
for (var i = 2; i <= families.length; i++) {
  rows.push({ label: families.slice(0, i).join(" + "), fams: families.slice(0, i) });
}

console.log("Share of single-base codon jobs each palette can perform");
console.log("(denominator: jobs doable by any single substitution)");
console.log("");
console.log("  " + "palette".padEnd(26) + "missense   nonsense");
console.log("  " + "-".repeat(48));
rows.forEach(function (r) {
  var t = tally(allowedFor(r.fams));
  console.log("  " + r.label.padEnd(26) + pct(t.missenseHere, t.missenseAny) +
    "     " + pct(t.stopHere, t.stopAny));
});
console.log("");

/* Substitution classes that a single base change could make, but that no
   source codon makes reachable with this palette. These are the permanent
   dead ends worth surfacing in a UI. */
var never = [];
var aas = [...new Set(Object.values(UMAX.CODONS))].filter(function (a) { return a !== "*"; }).sort();
aas.forEach(function (wt) {
  var codons = Object.keys(UMAX.CODONS).filter(function (c) { return UMAX.CODONS[c] === wt; });
  var targets = {};
  codons.forEach(function (c) {
    Object.keys(reachableAas(c, ALL)).forEach(function (aa) { if (aa !== wt) targets[aa] = true; });
  });
  Object.keys(targets).forEach(function (aa) {
    var ok = codons.some(function (c) { return reachableAas(c, full)[aa]; });
    if (!ok) never.push(wt + ">" + aa);
  });
});

console.log("Substitution classes reachable by one base change but never by this palette");
console.log("(" + never.length + " classes):");
console.log("  " + never.join(" "));
console.log("");
