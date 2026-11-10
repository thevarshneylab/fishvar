/*!
 * The set of single-nucleotide changes the Umax editor families can install,
 * and the codon arithmetic that turns "make this residue into that residue"
 * into "edit this base with this chemistry on this strand".
 *
 * Nothing here is hard-coded chemistry. The palette is derived from UMAX.FAMILY
 * in the vendored engine, so adding a family to editors.json / umax.js widens
 * the palette here automatically.
 */
"use strict";

var COMP = { A: "T", T: "A", C: "G", G: "C" };

function comp(b) { return COMP[b] || "N"; }

/* Rank of a product within its family's outcome spectrum. A transversion
   editor leaves an abasic site that repair resolves several ways, so the
   requested change may be the editor's main product, its second product, or
   a residual byproduct of the parent chemistry. That distinction decides
   whether a design is worth attempting. */
var KIND_RANK = { intended: 0, alternate: 1, byproduct: 2 };

/**
 * Build the palette from the engine's family table.
 *
 * Base editors deaminate the displaced protospacer strand. An editor whose
 * chemistry is X->Y therefore installs X>Y where the target base is X on the
 * sense strand (sense guide), and comp(X)>comp(Y) where it is comp(X) on the
 * sense strand (antisense guide).
 *
 * @param {object} FAMILY  UMAX.FAMILY
 * @returns {Map<string, Array>} "A>G" -> [{family, from, to, strand, kind, note}]
 */
function buildPalette(FAMILY) {
  var palette = new Map();

  Object.keys(FAMILY).forEach(function (family) {
    var f = FAMILY[family];
    (f.products || [{ base: f.to, kind: "intended" }]).forEach(function (p) {
      [
        { from: f.from, to: p.base, strand: "+" },
        { from: comp(f.from), to: comp(p.base), strand: "-" }
      ].forEach(function (route) {
        if (route.from === route.to) return;
        var key = route.from + ">" + route.to;
        if (!palette.has(key)) palette.set(key, []);
        palette.get(key).push({
          family: family,
          from: route.from,
          to: route.to,
          strand: route.strand,
          kind: p.kind || "intended",
          note: p.note || null
        });
      });
    });
  });

  /* Best route first, so callers can take [0] and be right. */
  palette.forEach(function (routes) {
    routes.sort(function (a, b) {
      return (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9);
    });
  });

  return palette;
}

/**
 * Every way to turn `codon` into a codon encoding `targetAa` with one
 * substitution, annotated with whether the Umax palette can do it.
 *
 * The human variant's own nucleotide change is deliberately ignored: the
 * zebrafish ortholog may use a different synonymous codon, in which case the
 * required change is different or impossible. Arg->His is the standard
 * example -- reachable from CGT and CGC, unreachable from the other four
 * arginine codons by any single substitution at all.
 *
 * @param {string} codon     zebrafish WT codon, coding orientation
 * @param {string} targetAa  one-letter residue the human variant produces
 * @param {object} CODONS    UMAX.CODONS
 * @param {Map}    palette   from buildPalette
 * @returns {{reachable: Array, blocked: Array}}
 */
function requiredEdits(codon, targetAa, CODONS, palette) {
  var reachable = [];
  var blocked = [];

  for (var i = 0; i < 3; i++) {
    var wt = codon.charAt(i);
    for (var mut of ["A", "C", "G", "T"]) {
      if (mut === wt) continue;
      var mutCodon = codon.substring(0, i) + mut + codon.substring(i + 1);
      if (CODONS[mutCodon] !== targetAa) continue;

      var key = wt + ">" + mut;
      var routes = palette.get(key) || [];
      var entry = {
        codonPosition: i + 1,          // 1-based position within the codon
        change: key,
        wtBase: wt,
        mutBase: mut,
        wtCodon: codon,
        mutCodon: mutCodon,
        routes: routes
      };
      if (routes.length) reachable.push(entry); else blocked.push(entry);
    }
  }

  /* Prefer the cleanest chemistry available. */
  reachable.sort(function (a, b) {
    return (KIND_RANK[a.routes[0].kind] ?? 9) - (KIND_RANK[b.routes[0].kind] ?? 9);
  });

  return { reachable: reachable, blocked: blocked };
}

/**
 * Is `targetAa` reachable from `codon` by any single substitution at all,
 * regardless of chemistry? Distinguishes "the genetic code forbids this" from
 * "the Umax palette cannot do this", which are very different messages to
 * put in front of a user.
 */
function reachableByAnyChemistry(codon, targetAa, CODONS) {
  for (var i = 0; i < 3; i++) {
    for (var mut of ["A", "C", "G", "T"]) {
      if (mut === codon.charAt(i)) continue;
      if (CODONS[codon.substring(0, i) + mut + codon.substring(i + 1)] === targetAa) return true;
    }
  }
  return false;
}

/**
 * Synonymous codons of `aa` from which `targetAa` IS reachable with the Umax
 * palette. Used to explain a dead end: if the zebrafish ortholog happens to
 * use an unreachable synonymous codon, this says which codon would have
 * worked, which is the difference between "impossible" and "unlucky".
 */
function rescueCodons(aa, targetAa, CODONS, palette) {
  var out = [];
  Object.keys(CODONS).forEach(function (codon) {
    if (CODONS[codon] !== aa) return;
    if (requiredEdits(codon, targetAa, CODONS, palette).reachable.length) out.push(codon);
  });
  return out.sort();
}

module.exports = {
  comp: comp,
  KIND_RANK: KIND_RANK,
  buildPalette: buildPalette,
  requiredEdits: requiredEdits,
  reachableByAnyChemistry: reachableByAnyChemistry,
  rescueCodons: rescueCodons
};
