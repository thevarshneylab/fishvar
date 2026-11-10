/*!
 * Residue-level mapping between a human protein and its zebrafish orthologue,
 * driven by the Compara protein alignment that Ensembl already computed.
 *
 * Two checks here carry most of the scientific weight:
 *
 *   1. Isoform agreement. A ClinVar p. change is numbered against a RefSeq
 *      protein; the alignment is numbered against Ensembl canonical. Those can
 *      disagree. If the human residue at the mapped column is not the wild-type
 *      residue ClinVar reported, the numbering is wrong and everything
 *      downstream is wrong, so the pair is rejected rather than reported.
 *
 *   2. Conservation. Modelling a human substitution only means something if the
 *      zebrafish orthologue carries the same wild-type residue. A non-conserved
 *      position is reported as such, never quietly designed against.
 */
"use strict";

/**
 * Index an aligned sequence so residue number and alignment column can be
 * converted in both directions in O(1).
 */
function indexAlignment(alignSeq) {
  var colOfResidue = [null];   // 1-based residue number -> column index
  var residueOfCol = new Array(alignSeq.length).fill(null);
  var n = 0;
  for (var i = 0; i < alignSeq.length; i++) {
    var ch = alignSeq.charAt(i);
    if (ch !== "-" && ch !== ".") {
      n++;
      colOfResidue[n] = i;
      residueOfCol[i] = n;
    }
  }
  return { colOfResidue: colOfResidue, residueOfCol: residueOfCol, length: n };
}

/** Fraction of identical, non-gap columns in a window either side of `col`. */
function localIdentity(src, tgt, col, flank) {
  var lo = Math.max(0, col - flank);
  var hi = Math.min(src.length - 1, col + flank);
  var same = 0, scored = 0;
  for (var i = lo; i <= hi; i++) {
    var a = src.charAt(i), b = tgt.charAt(i);
    if (a === "-" || b === "-") continue;
    scored++;
    if (a === b) same++;
  }
  return scored ? same / scored : 0;
}

/**
 * Map one human residue onto one orthologue pair.
 *
 * @param {object} homology  a /homology entry (source + target with align_seq)
 * @param {object} change    {wt, position, mut} from the ClinVar p. change
 * @returns {object} mapping verdict
 */
function mapResidue(homology, change) {
  var src = homology.source.align_seq;
  var tgt = homology.target.align_seq;

  var base = {
    zebrafishGene: homology.target.id,
    zebrafishProtein: homology.target.protein_id,
    humanProtein: homology.source.protein_id,
    orthologyType: homology.type,
    percentIdentity: homology.target.perc_id,
    humanPercentIdentity: homology.source.perc_id,
    taxonomyLevel: homology.taxonomy_level
  };

  var srcIdx = indexAlignment(src);
  if (change.position > srcIdx.length) {
    return Object.assign(base, {
      status: "isoform_mismatch",
      reason: "residue " + change.position + " is beyond the Ensembl human protein (" +
        srcIdx.length + " aa); ClinVar numbering refers to a different isoform"
    });
  }

  var col = srcIdx.colOfResidue[change.position];
  var humanAa = src.charAt(col);

  if (humanAa !== change.wt) {
    return Object.assign(base, {
      status: "isoform_mismatch",
      reason: "ClinVar reports " + change.wt + change.position + " but the Ensembl human protein has " +
        humanAa + " there; transcript numbering disagrees",
      humanAa: humanAa
    });
  }

  var targetAa = tgt.charAt(col);
  var identity = localIdentity(src, tgt, col, 10);

  if (targetAa === "-" || targetAa === ".") {
    return Object.assign(base, {
      status: "no_aligned_residue",
      reason: "the human residue falls in a gap in the zebrafish alignment (indel or missing domain)",
      alignmentColumn: col,
      localIdentity: identity
    });
  }

  var tgtIdx = indexAlignment(tgt);
  var zResidue = tgtIdx.residueOfCol[col];

  if (targetAa !== change.wt) {
    return Object.assign(base, {
      status: "not_conserved",
      reason: "zebrafish carries " + targetAa + " at the orthologous position, not " + change.wt,
      alignmentColumn: col,
      zebrafishResidue: zResidue,
      zebrafishAa: targetAa,
      humanAa: humanAa,
      localIdentity: identity
    });
  }

  return Object.assign(base, {
    status: "conserved",
    alignmentColumn: col,
    zebrafishResidue: zResidue,
    zebrafishAa: targetAa,
    humanAa: humanAa,
    localIdentity: identity
  });
}

var STATUS_RANK = {
  conserved: 0,
  not_conserved: 1,
  no_aligned_residue: 2,
  isoform_mismatch: 3
};

/**
 * Map every orthologue pair and rank them.
 *
 * All candidates are returned, not just the best. Teleost whole-genome
 * duplication leaves many human genes with two zebrafish co-orthologues, and
 * which one (or both) to edit is an experimental design decision about genetic
 * redundancy that the tool should inform rather than make.
 */
function mapAll(homologies, change) {
  var results = homologies.map(function (h) { return mapResidue(h, change); });

  results.sort(function (a, b) {
    var byStatus = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (byStatus) return byStatus;
    var byLocal = (b.localIdentity || 0) - (a.localIdentity || 0);
    if (byLocal) return byLocal;
    return (b.percentIdentity || 0) - (a.percentIdentity || 0);
  });

  var conserved = results.filter(function (r) { return r.status === "conserved"; });

  return {
    candidates: results,
    conserved: conserved,
    duplicated: new Set(results.map(function (r) { return r.zebrafishGene; })).size > 1,
    redundancyWarning: conserved.length > 1
      ? "the orthologous residue is conserved in " + conserved.length +
        " zebrafish co-orthologues; a single-paralogue edit may be buffered by the other"
      : null
  };
}

/* ------------------------------------------------------------------ *
 * Mapping for truncating variants
 * ------------------------------------------------------------------ */

/**
 * Locate the zebrafish equivalent of a human truncation point.
 *
 * Unlike the missense path this does NOT require the residue to be conserved:
 * a premature stop does not substitute the residue, it discards everything
 * from that point on, so only the position matters. The isoform check still
 * applies, because a truncation point taken from the wrong transcript
 * numbering puts the stop in the wrong part of the protein.
 *
 * Where the human residue falls in an alignment gap, the nearest aligned
 * position is used, searching upstream first: a stop placed slightly earlier
 * removes at least as much protein as the human lesion does, while one placed
 * later removes less and is the weaker model.
 */
function mapTruncationPoint(homology, change) {
  var src = homology.source.align_seq;
  var tgt = homology.target.align_seq;

  var base = {
    zebrafishGene: homology.target.id,
    zebrafishProtein: homology.target.protein_id,
    humanProtein: homology.source.protein_id,
    orthologyType: homology.type,
    percentIdentity: homology.target.perc_id,
    taxonomyLevel: homology.taxonomy_level
  };

  var srcIdx = indexAlignment(src);
  if (change.position > srcIdx.length) {
    return Object.assign(base, {
      status: "isoform_mismatch",
      reason: "residue " + change.position + " is beyond the Ensembl human protein (" +
        srcIdx.length + " aa); ClinVar numbering refers to a different isoform"
    });
  }

  var col = srcIdx.colOfResidue[change.position];
  var humanAa = src.charAt(col);
  if (humanAa !== change.wt) {
    return Object.assign(base, {
      status: "isoform_mismatch",
      reason: "ClinVar reports " + change.wt + change.position + " but the Ensembl human protein has " +
        humanAa + " there; transcript numbering disagrees",
      humanAa: humanAa
    });
  }

  var tgtIdx = indexAlignment(tgt);
  var usedCol = col;
  var shifted = 0;

  if (tgt.charAt(col) === "-" || tgt.charAt(col) === ".") {
    var found = null;
    for (var d = 1; d < tgt.length; d++) {
      var up = col - d;
      if (up >= 0 && tgtIdx.residueOfCol[up] !== null) { found = up; shifted = -d; break; }
      var down = col + d;
      if (down < tgt.length && tgtIdx.residueOfCol[down] !== null) { found = down; shifted = d; break; }
    }
    if (found === null) {
      return Object.assign(base, {
        status: "no_aligned_residue",
        reason: "the zebrafish orthologue has no aligned residue anywhere near the truncation point"
      });
    }
    usedCol = found;
  }

  return Object.assign(base, {
    status: "located",
    alignmentColumn: usedCol,
    zebrafishResidue: tgtIdx.residueOfCol[usedCol],
    zebrafishAa: tgt.charAt(usedCol),
    humanAa: humanAa,
    approximate: shifted !== 0,
    shiftedBy: shifted,
    conserved: tgt.charAt(col) === change.wt,
    localIdentity: localIdentity(src, tgt, usedCol, 10),
    zebrafishProteinLength: tgtIdx.length
  });
}

var TRUNC_STATUS_RANK = { located: 0, no_aligned_residue: 1, isoform_mismatch: 2 };

function mapAllForTruncation(homologies, change) {
  var results = homologies.map(function (h) { return mapTruncationPoint(h, change); });

  results.sort(function (a, b) {
    var byStatus = (TRUNC_STATUS_RANK[a.status] ?? 9) - (TRUNC_STATUS_RANK[b.status] ?? 9);
    if (byStatus) return byStatus;
    /* An exactly aligned position beats one borrowed from a neighbour. */
    var byExact = (a.approximate ? 1 : 0) - (b.approximate ? 1 : 0);
    if (byExact) return byExact;
    return (b.percentIdentity || 0) - (a.percentIdentity || 0);
  });

  var usable = results.filter(function (r) { return r.status === "located"; });

  return {
    candidates: results,
    located: usable,
    duplicated: new Set(results.map(function (r) { return r.zebrafishGene; })).size > 1,
    redundancyWarning: usable.length > 1
      ? "the truncation point maps onto " + usable.length + " zebrafish co-orthologues; " +
        "a premature stop in one may be buffered by the other"
      : null
  };
}

module.exports = {
  indexAlignment: indexAlignment,
  localIdentity: localIdentity,
  mapResidue: mapResidue,
  mapAll: mapAll,
  mapTruncationPoint: mapTruncationPoint,
  mapAllForTruncation: mapAllForTruncation
};
