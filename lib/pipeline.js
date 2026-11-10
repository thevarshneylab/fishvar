/*!
 * ClinVar missense variant -> zebrafish orthologous codon -> Umax guide.
 *
 * Guide finding, scoring and protein-consequence calling are NOT reimplemented
 * here. They are called out to the vendored umax-guide-designer engine, so
 * there is exactly one implementation of the ranking heuristic and the two
 * tools cannot drift apart.
 */
"use strict";

var path = require("path");
var fs = require("fs");

var ensembl = require("./ensembl.js");
var clinvar = require("./clinvar.js");
var ortholog = require("./ortholog.js");
var palette = require("./palette.js");

/* Enough genomic context for every editor in the registry: the widest window
   reaches position 16 (needs 15 bases on the PAM-distal side) and the earliest
   usable position is 3 (needs 20 - 3 + 3 = 20 bases on the PAM side). 45 clears
   both with margin and is a multiple of 3, which keeps the fetched window in
   frame so `frame = 0` is correct. */
var FLANK = 45;

/**
 * Describe a codon change at a real residue number. Mirrors the engine's
 * describeEffect wording, but numbered against the zebrafish protein rather
 * than the local analysis window.
 */
function describeAt(change, residue) {
  if (change.silent) return change.from + residue + "= (silent)";
  if (change.to === "*") return change.from + residue + "* (premature stop)";
  if (change.from === "*") return "stop" + residue + change.to + " (stop lost)";
  return change.from + residue + change.to;
}

function loadEngine(umaxPath) {
  var dir = umaxPath || path.join(__dirname, "..", "vendor");
  var enginePath = path.join(dir, "umax.js");
  var editorsPath = path.join(dir, "editors.json");
  if (!fs.existsSync(enginePath) || !fs.existsSync(editorsPath)) {
    throw new Error(
      "could not find umax.js and editors.json in " + dir +
      "\n  point --umax-path at a checkout of thevarshneylab/umax-guide-designer"
    );
  }
  var UMAX = require(enginePath);
  var editorsData = JSON.parse(fs.readFileSync(editorsPath, "utf8"));

  var problems = UMAX.validateEditors(editorsData);
  if (problems.length) {
    throw new Error("editors.json failed validation:\n  " + problems.join("\n  "));
  }
  return { UMAX: UMAX, editorsData: editorsData };
}

/**
 * Pull the zebrafish codon and its genomic context, in coding orientation.
 *
 * Requesting the region with an explicit strand means Ensembl returns the
 * sequence already oriented 5'->3' along the coding direction, so the codon
 * always sits at offset FLANK and no local reverse-complementing is needed.
 */
async function fetchCodonContext(mapping, residue, opts) {
  var blocks = await ensembl.mapTranslation(mapping.zebrafishProtein, residue, opts);
  if (!blocks.length) {
    return { error: "Ensembl returned no genomic mapping for residue " + residue };
  }

  var total = blocks.reduce(function (n, b) { return n + (b.end - b.start + 1); }, 0);
  var split = blocks.length > 1;
  if (total !== 3) {
    return {
      error: "residue " + residue + " maps to " + total +
        " genomic bases across " + blocks.length + " block(s); expected 3"
    };
  }

  var strand = blocks[0].strand;
  var chrom = blocks[0].seq_region_name;
  var lo = Math.min.apply(null, blocks.map(function (b) { return b.start; }));
  var hi = Math.max.apply(null, blocks.map(function (b) { return b.end; }));

  if (split) {
    /* The codon straddles an exon junction, so its three bases are not
       contiguous in the genome. A contiguous window would contain intronic
       bases between codon positions and any guide designed on it would be
       wrong, so this is refused rather than approximated. */
    return {
      error: "codon for residue " + residue + " is split across an exon junction (" +
        blocks.map(function (b) { return chrom + ":" + b.start + "-" + b.end; }).join(" + ") +
        "); v1 does not design across junctions",
      split: true
    };
  }

  var region = chrom + ":" + (lo - FLANK) + "-" + (hi + FLANK);
  var seq = await ensembl.regionSequence(region, strand, opts);

  if (!seq || seq.length !== (hi - lo + 1) + 2 * FLANK) {
    return { error: "unexpected sequence length for " + region + " (got " + (seq ? seq.length : 0) + ")" };
  }

  return {
    sequence: seq.toUpperCase(),
    codonOffset: FLANK,
    codon: seq.toUpperCase().substr(FLANK, 3),
    chrom: chrom,
    start: lo,
    end: hi,
    strand: strand,
    region: region
  };
}

/**
 * Offsets within the fetched window where an exon ends, in local coordinates.
 * A guide spanning one of these reaches into an intron: the on-target codon is
 * still fine, but bystander protein consequences computed on a continuous
 * reading frame are not, so such guides are flagged.
 */
async function exonBoundaryOffsets(mapping, context, opts) {
  try {
    var tx = await ensembl.lookup(mapping.zebrafishProtein, opts);
    var transcriptId = tx && tx.Parent;
    if (!transcriptId) return { offsets: [], transcriptId: null };

    var exons = await ensembl.exons(transcriptId, opts);
    var winLo = context.start - FLANK;
    var winHi = context.end + FLANK;
    var offsets = [];

    exons.forEach(function (e) {
      [e.start, e.end].forEach(function (pos) {
        if (pos < winLo || pos > winHi) return;
        var offset = context.strand === 1 ? pos - winLo : winHi - pos;
        offsets.push(offset);
      });
    });

    /* Boundaries at the very edge of the window are not informative. */
    offsets = [...new Set(offsets)].filter(function (o) { return o > 0 && o < (winHi - winLo); });
    return { offsets: offsets.sort(function (a, b) { return a - b; }), transcriptId: transcriptId };
  } catch (e) {
    return { offsets: [], transcriptId: null, warning: "exon structure unavailable: " + e.message };
  }
}

/**
 * Design guides for one required base change at one orthologous codon.
 */
function designForEdit(engine, context, edit, route, exonInfo, zResidue, opts) {
  var UMAX = engine.UMAX;
  var editors = UMAX.expandEditors(engine.editorsData, {
    includeUntested: !!opts.includeUntested
  });

  /* `untestedWithUmax` is declared on the backbone in casVariants, and
     expandEditors does not copy it onto the editors it derives. Reading it
     off the editor would therefore always be false and would quietly drop a
     caveat the registry states outright, so resolve it from the backbone. */
  var untestedCas = {};
  (engine.editorsData.casVariants || []).forEach(function (c) {
    if (c.untestedWithUmax) untestedCas[c.id] = true;
  });

  var targetIndex = context.codonOffset + (edit.codonPosition - 1);
  var seq = context.sequence;

  /* Cross-check the palette against the engine: both derive the guide strand
     from the same family table, so disagreement means a bug, not a dead end. */
  var engineStrand = UMAX.guideStrandFor(seq.charAt(targetIndex), route.family);
  if (engineStrand !== route.strand) {
    throw new Error(
      "internal inconsistency: palette says " + route.strand + " strand for " +
      edit.change + " via " + route.family + ", engine says " + engineStrand
    );
  }

  /* FLANK is a multiple of 3, so the fetched window starts in frame. */
  var frame = 0;
  var localTargetCodon = Math.floor(targetIndex / 3) + 1;
  var guides = UMAX.design(seq, targetIndex, route.family, editors, frame);

  var spacerSpan = UMAX.SPACER_LENGTH;
  var annotated = guides.map(function (g) {
    var lo = Math.min(g.start, g.start + spacerSpan - 1);
    /* g.start is an index into the strand the guide anneals to; convert the
       protospacer footprint back to window coordinates for the overlap test. */
    var senseLo, senseHi;
    if (g.strand === "+") {
      senseLo = g.start;
      senseHi = g.start + spacerSpan + g.editor.pam.length - 1;
    } else {
      var endIdx = seq.length - 1 - g.start;
      senseHi = endIdx;
      senseLo = endIdx - (spacerSpan + g.editor.pam.length - 1);
    }

    var crosses = exonInfo.offsets.filter(function (o) {
      return o >= senseLo && o <= senseHi;
    });

    var bystanderEffects = UMAX.codonEffects(
      seq, frame, route.family, g.strand, g.bystanderIndices
    ) || [];

    return {
      editor: g.editor.id,
      family: g.editor.family,
      cas: g.editor.cas,
      derived: !!g.editor.derived,
      untestedWithUmax: !!g.editor.untestedWithUmax || !!untestedCas[g.editor.cas],
      /* The engine marks every derived pairing `unpublished`, meaning the
         pairing has not been reported -- which `derived` already says. Reserve
         this field for an editor whose own chemistry is unpublished, so that
         "unpublished editor" is not reported for a published architecture
         like TCBE-Umax merely sitting on a predicted backbone. */
      unpublished: !!g.editor.unpublished && !g.editor.derived,
      strand: g.strand,
      spacer: g.spacer,
      pam: g.pam,
      pamTier: g.pamTier,
      positionInWindow: g.position,
      inPeak: g.inPeak,
      window: g.editor.window,
      score: g.score,
      gc: Math.round(g.gc * 10) / 10,
      hasPolyT: g.hasPolyT,
      context: g.context,
      contextFavorable: g.contextFavorable,
      bystanderCount: g.bystanders.length,
      bystanderPositions: g.bystanders,
      bystanderEffects: bystanderEffects.map(function (c) {
        /* The engine numbers codons within the window it was handed, which
           starts at an arbitrary point in the transcript. Renumbering to real
           residues matters: "L13=" in a window centred on residue 90 reads as
           residue 13, which is a different part of the protein entirely. */
        var residue = zResidue + (c.codon - localTargetCodon);
        return {
          residue: residue,
          from: c.from,
          to: c.to,
          silent: c.silent,
          description: describeAt(c, residue)
        };
      }),
      crossesExonBoundary: crosses.length > 0,
      note: crosses.length
        ? "protospacer reaches an exon junction; bystander consequences assume a continuous reading frame and are unreliable here"
        : null
    };
  });

  /* Every product this chemistry makes at the target base, with the residue
     each one produces. For a transversion editor the requested change is only
     one outcome of a mixture, and the others are real protein changes.
     `o.base` is on the protospacer strand while `route.to` is on the sense
     strand, so an antisense route has to be complemented before comparing. */
  var requestedProduct = route.strand === "+" ? route.to : palette.comp(route.to);
  var spectrum = UMAX.outcomeSpectrum(seq, frame, route.family, route.strand, targetIndex)
    .map(function (o) {
      return {
        base: o.base,
        kind: o.kind,
        note: o.note || null,
        residueChange: o.effect
          ? o.effect.from + (zResidue + (o.effect.codon - localTargetCodon)) + o.effect.to
          : null,
        silent: o.effect ? o.effect.silent : null,
        requested: o.base === requestedProduct
      };
    });

  return {
    change: edit.change,
    codonPosition: edit.codonPosition,
    wtCodon: edit.wtCodon,
    mutCodon: edit.mutCodon,
    family: route.family,
    strand: route.strand,
    productKind: route.kind,
    productNote: route.note,
    mixedProducts: !!UMAX.FAMILY[route.family].mixedProducts,
    outcomeSpectrum: spectrum,
    guides: annotated,
    flank: UMAX.flankReport(seq, targetIndex, route.family, editors)
  };
}

/**
 * Run the whole pipeline for one variant.
 */
async function run(variantSpec, opts) {
  var o = opts || {};
  var engine = loadEngine(o.umaxPath);
  var UMAX = engine.UMAX;
  var pal = palette.buildPalette(UMAX.FAMILY);

  var variant = clinvar.parseDirect(variantSpec);
  if (!variant) variant = await clinvar.fetchVariant(variantSpec, o);

  var out = {
    query: variantSpec,
    variant: variant,
    umaxCommit: readCommit(o.umaxPath),
    strategies: [],
    candidates: [],
    warnings: []
  };

  if (variant.consequence !== "missense") {
    out.status = "unsupported_consequence";
    out.reason = variant.consequence === "nonsense"
      ? "this is a truncating variant; the right zebrafish model is a CBE-installed premature stop, " +
        "which is a different design path and is not in v1"
      : "v1 handles missense SNVs only (this variant classifies as " + variant.consequence + ")";
    return out;
  }

  if (!variant.gene) {
    out.status = "no_gene";
    out.reason = "could not determine a gene symbol for this variant";
    return out;
  }

  var homologies = await ensembl.orthologues(variant.gene, o);
  if (!homologies.length) {
    out.status = "no_ortholog";
    out.reason = "Ensembl Compara reports no zebrafish orthologue with a protein alignment for " + variant.gene;
    return out;
  }

  var mapped = ortholog.mapAll(homologies, variant.change);
  out.orthologSummary = {
    examined: mapped.candidates.length,
    conserved: mapped.conserved.length,
    duplicated: mapped.duplicated
  };
  if (mapped.redundancyWarning) out.warnings.push(mapped.redundancyWarning);

  var limit = o.maxParalogs || 4;
  var usable = mapped.conserved.slice(0, limit);

  /* Report every candidate, including the rejected ones with their reason:
     "not conserved in zebrafish" is a scientifically useful answer, not a
     failure to hide. */
  out.candidates = mapped.candidates.map(function (c) {
    return {
      zebrafishGene: c.zebrafishGene,
      zebrafishProtein: c.zebrafishProtein,
      orthologyType: c.orthologyType,
      percentIdentity: c.percentIdentity,
      status: c.status,
      reason: c.reason || null,
      zebrafishResidue: c.zebrafishResidue || null,
      zebrafishAa: c.zebrafishAa || null,
      localIdentity: c.localIdentity != null ? Math.round(c.localIdentity * 100) / 100 : null
    };
  });

  if (!usable.length) {
    /* Why there is nothing to design matters: a numbering disagreement is a
       fixable input problem, while a non-conserved residue is a real
       biological answer. Collapsing them into one message would send the user
       looking in the wrong place. */
    var statuses = new Set(mapped.candidates.map(function (c) { return c.status; }));
    if (statuses.size === 1 && statuses.has("isoform_mismatch")) {
      out.status = "isoform_mismatch";
      out.reason = "the residue ClinVar reports does not match the Ensembl human protein in any " +
        "orthologue pair, so the two are numbered against different isoforms; " +
        "check the transcript the p. change refers to";
    } else {
      out.status = "not_modelable";
      out.reason = "the residue is not conserved in any zebrafish orthologue, so an " +
        "equivalent substitution cannot be made; see candidates for what zebrafish carries instead";
    }
    return out;
  }

  for (var mapping of usable) {
    var context = await fetchCodonContext(mapping, mapping.zebrafishResidue, o);
    if (context.error) {
      out.strategies.push({
        zebrafishGene: mapping.zebrafishGene,
        zebrafishProtein: mapping.zebrafishProtein,
        zebrafishResidue: mapping.zebrafishResidue,
        status: "no_context",
        reason: context.error
      });
      continue;
    }

    /* The codon must actually encode the residue the alignment promised.
       A mismatch means the alignment, the translation and the assembly
       disagree, and nothing downstream can be trusted. */
    var codonAa = UMAX.CODONS[context.codon];
    if (codonAa !== mapping.zebrafishAa) {
      out.strategies.push({
        zebrafishGene: mapping.zebrafishGene,
        zebrafishProtein: mapping.zebrafishProtein,
        zebrafishResidue: mapping.zebrafishResidue,
        status: "codon_mismatch",
        reason: "genomic codon " + context.codon + " encodes " + codonAa +
          " but the Compara alignment reports " + mapping.zebrafishAa +
          "; the protein, the assembly and the alignment disagree at this position"
      });
      continue;
    }

    var edits = palette.requiredEdits(context.codon, variant.change.mut, UMAX.CODONS, pal);
    var exonInfo = await exonBoundaryOffsets(mapping, context, o);
    if (exonInfo.warning) out.warnings.push(exonInfo.warning);

    var strategy = {
      zebrafishGene: mapping.zebrafishGene,
      zebrafishProtein: mapping.zebrafishProtein,
      zebrafishTranscript: exonInfo.transcriptId,
      zebrafishResidue: mapping.zebrafishResidue,
      zebrafishAa: mapping.zebrafishAa,
      orthologyType: mapping.orthologyType,
      percentIdentity: mapping.percentIdentity,
      localIdentity: Math.round(mapping.localIdentity * 100) / 100,
      locus: context.chrom + ":" + context.start + "-" + context.end + " (" +
        (context.strand === 1 ? "+" : "-") + ")",
      wtCodon: context.codon,
      targetResidueChange: mapping.zebrafishAa + mapping.zebrafishResidue + variant.change.mut,
      contextSequence: context.sequence,
      contextCodonOffset: context.codonOffset,
      edits: []
    };

    if (!edits.reachable.length) {
      var anyChem = palette.reachableByAnyChemistry(context.codon, variant.change.mut, UMAX.CODONS);
      strategy.status = anyChem ? "blocked_by_chemistry" : "blocked_by_genetic_code";
      strategy.reason = anyChem
        ? "the required change" + (edits.blocked.length === 1 ? " " + edits.blocked[0].change : "s " +
            edits.blocked.map(function (e) { return e.change; }).join(" or ")) +
          " is outside the Umax palette (no editor installs C>A, C>G, G>C or G>T)"
        : context.codon + " cannot reach any " + variant.change.mut +
          " codon by a single substitution, whatever the chemistry";
      strategy.rescueCodons = palette.rescueCodons(
        mapping.zebrafishAa, variant.change.mut, UMAX.CODONS, pal
      );
      out.strategies.push(strategy);
      continue;
    }

    edits.reachable.forEach(function (edit) {
      edit.routes.forEach(function (route) {
        strategy.edits.push(
          designForEdit(engine, context, edit, route, exonInfo, mapping.zebrafishResidue, o)
        );
      });
    });

    var total = strategy.edits.reduce(function (n, e) { return n + e.guides.length; }, 0);
    strategy.status = total ? "designed" : "no_guides";
    if (!total) {
      strategy.reason = "the required change is in the Umax palette, but no editor window and " +
        "compatible PAM could be placed over this base";
    }
    out.strategies.push(strategy);
  }

  var designed = out.strategies.filter(function (s) { return s.status === "designed"; });
  out.status = designed.length ? "ok" : "no_design";
  return out;
}

function readCommit(umaxPath) {
  try {
    var dir = umaxPath || path.join(__dirname, "..", "vendor");
    return fs.readFileSync(path.join(dir, "UMAX_COMMIT"), "utf8").trim();
  } catch (e) {
    return null;
  }
}

module.exports = { run: run, loadEngine: loadEngine, FLANK: FLANK };
