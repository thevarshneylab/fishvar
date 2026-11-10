/*!
 * Premature termination codon placement for modelling truncating variants.
 *
 * A truncating human variant is not modelled by mapping its residue. The
 * useful zebrafish allele is a premature stop in the orthologue, which means
 * scanning the coding sequence for codons the Umax palette can turn into a
 * stop -- the iSTOP / CRISPR-STOP strategy -- and then choosing among them.
 *
 * Choosing is the hard part, because a PTC is only a null allele if the
 * transcript is actually degraded. Nonsense-mediated decay is positional:
 *
 *   - a PTC in the last exon, or within ~50-55 nt of the last exon-exon
 *     junction, escapes NMD and can yield a stable truncated protein
 *   - a PTC within ~150 nt of the start codon can be bypassed by reinitiation
 *   - a PTC in an exon longer than ~400 nt escapes more often than the
 *     junction rule alone predicts
 *
 * The 55 nt convention follows the iSTOP literature, which checks that the
 * targeted nucleotide sits at least 55 nt upstream of the final exon-exon
 * junction. These thresholds were established in mammalian systems; NMD is
 * conserved in zebrafish but the exact distances are not independently
 * calibrated there, so they are reported as classifications rather than
 * treated as certainties.
 */
"use strict";

var DEFAULTS = {
  lastJunctionNt: 55,    // PTC must be at least this far upstream of it
  startProximalNt: 150,  // reinitiation can bypass a PTC this close to the AUG
  longExonNt: 400        // PTCs in exons longer than this escape more often
};

/* ------------------------------------------------------------------ *
 * Codons the palette can turn into a stop
 * ------------------------------------------------------------------ */

/**
 * @returns {Map<string, Array>} wild-type codon -> ways to make it a stop
 *
 * With cytosine editing alone this is the classic iSTOP set -- CAA, CAG, CGA
 * and TGG. The transversion editors add several more, which is most of why
 * the palette matters here.
 */
function stopRoutes(CODONS, palette) {
  var out = new Map();

  Object.keys(CODONS).forEach(function (codon) {
    if (CODONS[codon] === "*") return;
    var ways = [];

    for (var i = 0; i < 3; i++) {
      var wt = codon.charAt(i);
      ["A", "C", "G", "T"].forEach(function (mut) {
        if (mut === wt) return;
        var mutCodon = codon.substring(0, i) + mut + codon.substring(i + 1);
        if (CODONS[mutCodon] !== "*") return;
        var routes = palette.get(wt + ">" + mut) || [];
        if (!routes.length) return;
        ways.push({
          codonPosition: i + 1,
          change: wt + ">" + mut,
          wtBase: wt,
          mutBase: mut,
          wtCodon: codon,
          stopCodon: mutCodon,
          routes: routes
        });
      });
    }

    if (ways.length) out.set(codon, ways);
  });

  return out;
}

/* ------------------------------------------------------------------ *
 * Transcript geometry
 * ------------------------------------------------------------------ */

/**
 * Build a local model of the transcript so CDS offsets, genomic coordinates
 * and transcript (mRNA) offsets can be converted without further API calls.
 *
 * @param {Array} cdsBlocks  /map/translation blocks: {seq_region_name,start,end,strand}
 * @param {Array} exons      /overlap?feature=exon entries for this transcript
 * @returns {object} model, or {error}
 */
function buildTranscriptModel(cdsBlocks, exons) {
  if (!cdsBlocks.length) return { error: "no CDS blocks returned for this translation" };

  var strand = cdsBlocks[0].strand;
  var chrom = cdsBlocks[0].seq_region_name;

  /* Transcript order: along the strand the gene is read on. */
  var byTranscriptOrder = function (a, b) {
    return strand === 1 ? a.start - b.start : b.start - a.start;
  };

  var cds = cdsBlocks.slice().sort(byTranscriptOrder);
  var ex = (exons || []).slice().sort(byTranscriptOrder);

  if (!ex.length) return { error: "no exons returned for this transcript" };

  /* Cumulative transcript offsets for exons, and for CDS blocks. */
  var exonSpans = [];
  var acc = 0;
  ex.forEach(function (e, i) {
    var len = e.end - e.start + 1;
    exonSpans.push({ index: i, start: e.start, end: e.end, length: len, tStart: acc });
    acc += len;
  });
  var transcriptLength = acc;

  var cdsSpans = [];
  var cAcc = 0;
  cds.forEach(function (b) {
    var len = b.end - b.start + 1;
    cdsSpans.push({ start: b.start, end: b.end, length: len, cdsStart: cAcc });
    cAcc += len;
  });
  var cdsLength = cAcc;

  /* The last exon-exon junction of the TRANSCRIPT, not of the CDS. A
     multi-exon 3' UTR puts that junction downstream of the stop codon, which
     changes the NMD verdict for late PTCs -- computing it from CDS blocks
     alone would get those wrong. */
  var lastExon = exonSpans[exonSpans.length - 1];
  var lastJunctionT = exonSpans.length > 1 ? lastExon.tStart : null;

  function genomicOfCds(offset) {
    for (var i = 0; i < cdsSpans.length; i++) {
      var s = cdsSpans[i];
      if (offset < s.cdsStart || offset >= s.cdsStart + s.length) continue;
      var into = offset - s.cdsStart;
      return strand === 1 ? s.start + into : s.end - into;
    }
    return null;
  }

  function transcriptOfGenomic(pos) {
    for (var i = 0; i < exonSpans.length; i++) {
      var e = exonSpans[i];
      if (pos < e.start || pos > e.end) continue;
      var into = strand === 1 ? pos - e.start : e.end - pos;
      return { offset: e.tStart + into, exon: e, exonNumber: i + 1 };
    }
    return null;
  }

  /* A codon is split when its three bases do not sit in one CDS block. */
  function codonSpansJunction(cdsOffset) {
    var a = blockIndexOf(cdsOffset);
    var c = blockIndexOf(cdsOffset + 2);
    return a === null || c === null || a !== c;
  }

  function blockIndexOf(offset) {
    for (var i = 0; i < cdsSpans.length; i++) {
      var s = cdsSpans[i];
      if (offset >= s.cdsStart && offset < s.cdsStart + s.length) return i;
    }
    return null;
  }

  return {
    strand: strand,
    chrom: chrom,
    exonCount: exonSpans.length,
    exonSpans: exonSpans,
    cdsSpans: cdsSpans,
    cdsLength: cdsLength,
    transcriptLength: transcriptLength,
    lastJunctionT: lastJunctionT,
    genomicOfCds: genomicOfCds,
    transcriptOfGenomic: transcriptOfGenomic,
    codonSpansJunction: codonSpansJunction,
    blockIndexOf: blockIndexOf
  };
}

/* ------------------------------------------------------------------ *
 * NMD classification
 * ------------------------------------------------------------------ */

/**
 * Classify a PTC by the positional rules.
 *
 * @param {number} editedCdsOffset  0-based CDS offset of the nucleotide edited
 * @param {object} model            from buildTranscriptModel
 * @param {object} [thresholds]
 */
function classifyNmd(editedCdsOffset, model, thresholds) {
  var t = Object.assign({}, DEFAULTS, thresholds || {});

  var genomic = model.genomicOfCds(editedCdsOffset);
  if (genomic === null) {
    return { verdict: "unknown", reason: "CDS offset falls outside the mapped coding blocks" };
  }
  var located = model.transcriptOfGenomic(genomic);
  if (!located) {
    return { verdict: "unknown", reason: "coding base does not fall inside any annotated exon" };
  }

  var escapes = [];

  if (model.exonCount === 1) {
    escapes.push({
      rule: "single_exon",
      detail: "the transcript has no exon-exon junction, so there is no exon junction complex to trigger NMD"
    });
  } else {
    var distance = model.lastJunctionT - located.offset;
    if (distance <= 0) {
      escapes.push({
        rule: "last_exon",
        detail: "the PTC lies in the final exon, downstream of the last exon-exon junction"
      });
    } else if (distance < t.lastJunctionNt) {
      escapes.push({
        rule: "last_junction_proximity",
        detail: distance + " nt upstream of the last exon-exon junction, inside the " +
          t.lastJunctionNt + " nt window where the terminating ribosome displaces the final EJC"
      });
    }
  }

  if (editedCdsOffset < t.startProximalNt) {
    escapes.push({
      rule: "start_proximal",
      detail: "within " + t.startProximalNt + " nt of the start codon, where reinitiation downstream can bypass the PTC"
    });
  }

  if (located.exon.length > t.longExonNt) {
    escapes.push({
      rule: "long_exon",
      detail: "sits in a " + located.exon.length + " nt exon, longer than the " +
        t.longExonNt + " nt above which PTCs escape more often than the junction rule predicts"
    });
  }

  /* The junction rules are the strong ones; start-proximity and exon length
     shift the odds rather than settling them. */
  var strong = escapes.filter(function (e) {
    return e.rule === "last_exon" || e.rule === "last_junction_proximity" || e.rule === "single_exon";
  });

  return {
    verdict: strong.length ? "escapes" : (escapes.length ? "uncertain" : "competent"),
    escapes: escapes,
    distanceToLastJunction: model.lastJunctionT === null
      ? null : model.lastJunctionT - located.offset,
    exonNumber: located.exonNumber,
    exonCount: model.exonCount,
    exonLength: located.exon.length,
    transcriptOffset: located.offset,
    genomic: genomic
  };
}

/* ------------------------------------------------------------------ *
 * Scan
 * ------------------------------------------------------------------ */

/**
 * Every PTC candidate in a coding sequence, classified and ranked.
 *
 * @param {string} cds            coding sequence, in frame, 5'->3'
 * @param {object} model          transcript model
 * @param {object} CODONS         UMAX.CODONS
 * @param {Map}    palette
 * @param {object} opts           {targetResidue, thresholds}
 */
function scanCds(cds, model, CODONS, palette, opts) {
  var o = opts || {};
  var routes = stopRoutes(CODONS, palette);
  var candidates = [];
  var residues = Math.floor(cds.length / 3);

  for (var r = 1; r <= residues; r++) {
    var cdsOffset = (r - 1) * 3;
    var codon = cds.substr(cdsOffset, 3);
    var ways = routes.get(codon);
    if (!ways) continue;

    /* A codon split across an exon junction has non-contiguous genomic bases;
       a continuous design window there would include intronic sequence. */
    if (model.codonSpansJunction(cdsOffset)) continue;

    ways.forEach(function (way) {
      var editedOffset = cdsOffset + way.codonPosition - 1;
      var nmd = classifyNmd(editedOffset, model, o.thresholds);
      candidates.push({
        residue: r,
        cdsOffset: cdsOffset,
        editedCdsOffset: editedOffset,
        wtCodon: way.wtCodon,
        stopCodon: way.stopCodon,
        wtAa: CODONS[way.wtCodon],
        change: way.change,
        codonPosition: way.codonPosition,
        routes: way.routes,
        family: way.routes[0].family,
        strand: way.routes[0].strand,
        productKind: way.routes[0].kind,
        nmd: nmd,
        genomic: nmd.genomic,
        fractionOfCds: Math.round(1000 * cdsOffset / cds.length) / 1000,
        distanceFromTarget: o.targetResidue ? r - o.targetResidue : null
      });
    });
  }

  rank(candidates, o);
  return candidates;
}

var NMD_RANK = { competent: 0, uncertain: 1, escapes: 2, unknown: 3 };

/**
 * Rank candidates.
 *
 * NMD competence dominates, because a PTC that escapes decay may leave a
 * partially functional truncated protein and is a different experiment from
 * the one intended. Among NMD-competent candidates, position relative to the
 * orthologue of the human lesion breaks the tie: a stop at or upstream of it
 * removes at least as much protein as the human allele does, so those are
 * preferred, and nearer is preferred to further. Clean chemistry comes next.
 * Guide quality is not considered here -- it is only known once guides are
 * designed, which happens for the top candidates after this ordering.
 */
function rank(candidates, opts) {
  var o = opts || {};
  var kindRank = { intended: 0, alternate: 1, byproduct: 2 };

  candidates.forEach(function (c) {
    var score = 0;
    score += 1000 * (NMD_RANK[c.nmd.verdict] ?? 3);

    if (o.targetResidue) {
      var d = c.residue - o.targetResidue;
      /* Downstream of the lesion leaves more protein than the human allele,
         so it is a weaker model: penalise it more than the same distance
         upstream. */
      score += d <= 0 ? Math.abs(d) : 3 * d;
    }

    score += 50 * (kindRank[c.productKind] ?? 3);
    c.positionScore = score;
  });

  candidates.sort(function (a, b) {
    if (a.positionScore !== b.positionScore) return a.positionScore - b.positionScore;
    return a.residue - b.residue;
  });
}

function summarize(candidates) {
  var byVerdict = {};
  candidates.forEach(function (c) {
    byVerdict[c.nmd.verdict] = (byVerdict[c.nmd.verdict] || 0) + 1;
  });
  var codons = {};
  candidates.forEach(function (c) { codons[c.wtCodon] = (codons[c.wtCodon] || 0) + 1; });
  return {
    total: candidates.length,
    byNmdVerdict: byVerdict,
    byCodon: codons,
    families: [...new Set(candidates.map(function (c) { return c.family; }))]
  };
}

module.exports = {
  DEFAULTS: DEFAULTS,
  stopRoutes: stopRoutes,
  buildTranscriptModel: buildTranscriptModel,
  classifyNmd: classifyNmd,
  scanCds: scanCds,
  rank: rank,
  summarize: summarize
};
