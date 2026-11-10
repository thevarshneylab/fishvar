/*!
 * Output rendering. A design that is going into an injection has to be
 * readable at a glance and auditable afterwards, so the text report leads with
 * the verdict and always shows why a variant was rejected.
 */
"use strict";

function pad(s, n) {
  s = String(s === null || s === undefined ? "" : s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

var STATUS_LINE = {
  ok: "designed",
  no_design: "no guide could be designed",
  not_modelable: "not modelable in zebrafish",
  isoform_mismatch: "transcript numbering disagreement",
  unsupported_consequence: "out of scope for v1",
  no_ortholog: "no zebrafish orthologue",
  no_gene: "no gene symbol"
};

function formatText(r, opts) {
  var o = opts || {};
  var topN = o.topN || 5;
  var L = [];

  L.push("");
  L.push("=".repeat(78));
  L.push(r.variant.name || r.query);
  if (r.variant.accession) L.push("  ClinVar " + r.variant.accession +
    (r.variant.classification ? "  [" + r.variant.classification + "]" : ""));
  if (r.variant.change) {
    L.push("  human " + r.variant.gene + " p." + r.variant.change.wt +
      r.variant.change.position + r.variant.change.mut +
      "   (" + r.variant.consequence + ")");
  }
  L.push("  verdict: " + (STATUS_LINE[r.status] || r.status));
  L.push("=".repeat(78));

  if (r.reason) {
    L.push("");
    L.push("  " + wrap(r.reason, 74, "  "));
  }

  (r.warnings || []).forEach(function (w) {
    L.push("");
    L.push("  ! " + wrap(w, 72, "    "));
  });

  if (r.orthologSummary) {
    L.push("");
    L.push("Orthologues examined: " + r.orthologSummary.examined +
      ", residue conserved in " + r.orthologSummary.conserved +
      (r.orthologSummary.duplicated ? " (gene is duplicated in zebrafish)" : ""));
    L.push("");
    L.push("  " + pad("zebrafish gene", 22) + pad("type", 20) + pad("%id", 6) +
      pad("residue", 9) + "status");
    L.push("  " + "-".repeat(74));
    r.candidates.forEach(function (c) {
      L.push("  " + pad(c.zebrafishGene, 22) +
        pad((c.orthologyType || "").replace("ortholog_", ""), 20) +
        pad(c.percentIdentity != null ? c.percentIdentity.toFixed(1) : "-", 6) +
        pad(c.zebrafishAa && c.zebrafishResidue ? c.zebrafishAa + c.zebrafishResidue : "-", 9) +
        c.status);
      if (c.reason && c.status !== "conserved") {
        L.push("      " + wrap(c.reason, 68, "      "));
      }
    });
  }

  (r.strategies || []).forEach(function (s) {
    L.push("");
    L.push("-".repeat(78));
    L.push(s.zebrafishGene + "   " + (s.locus || "") +
      (s.zebrafishTranscript ? "   " + s.zebrafishTranscript : ""));

    if (s.status !== "designed") {
      L.push("  " + (STATUS_LINE[s.status] || s.status) + ": " +
        wrap(s.reason || "", 70, "    "));
      if (s.rescueCodons && s.rescueCodons.length) {
        L.push("  the change would have been reachable had zebrafish used " +
          s.rescueCodons.join(" or ") + " for " + s.zebrafishAa);
      }
      return;
    }

    L.push("  target: " + s.zebrafishAa + s.zebrafishResidue + " -> " +
      s.targetResidueChange.slice(-1) +
      "   codon " + s.wtCodon +
      "   identity " + Math.round((s.percentIdentity || 0)) + "% global, " +
      Math.round((s.localIdentity || 0) * 100) + "% local");

    s.edits.forEach(function (e) {
      L.push("");
      L.push("  " + e.wtCodon + " > " + e.mutCodon + "   (" + e.change +
        " at codon position " + e.codonPosition + ")   " +
        e.family + " on the " + e.strand + " strand   [" + e.productKind + " product]");

      if (e.mixedProducts) {
        L.push("    this chemistry makes a mixture at the edited base:");
        e.outcomeSpectrum.forEach(function (p) {
          L.push("      " + pad(p.base, 3) + pad(p.kind, 11) +
            pad(p.residueChange || "-", 10) +
            (p.requested ? "<- requested" : "") +
            (p.note ? "  " + p.note : ""));
        });
      }

      if (!e.guides.length) {
        L.push("    no editor window and compatible PAM could be placed over this base");
        if (e.flank && e.flank.extraPamSide && isFinite(e.flank.extraPamSide)) {
          L.push("    " + e.flank.extraPamSide + " more bases on the " +
            e.flank.pamSide + " side would be needed");
        }
        return;
      }

      L.push("");
      L.push("    " + pad("score", 7) + pad("editor", 22) + pad("str", 5) +
        pad("spacer (5'->3')", 23) + pad("PAM", 6) + pad("pos", 5) + "bystanders");
      L.push("    " + "-".repeat(70));

      e.guides.slice(0, topN).forEach(function (g) {
        var flags = [];
        if (!g.inPeak) flags.push("window edge");
        if (g.hasPolyT) flags.push("polyT");
        if (g.crossesExonBoundary) flags.push("exon junction");
        if (g.derived) flags.push("predicted pairing");
        if (g.untestedWithUmax) flags.push("backbone untested");
        if (g.unpublished) flags.push("unpublished editor");

        L.push("    " + pad(g.score, 7) + pad(g.editor, 22) + pad(g.strand, 5) +
          pad(g.spacer, 23) + pad(g.pam, 6) + pad(g.positionInWindow, 5) +
          (g.bystanderCount === 0 ? "none" : g.bystanderCount + ": " +
            g.bystanderEffects.map(function (b) { return b.description; }).join(", ")));
        if (flags.length) L.push("    " + " ".repeat(29) + "^ " + flags.join("; "));
      });

      if (e.guides.length > topN) {
        L.push("    ... " + (e.guides.length - topN) + " more (use --top or --format json)");
      }
    });

    L.push("");
    L.push("  genomic context, coding orientation, target codon at offset " +
      s.contextCodonOffset + ":");
    L.push("    " + s.contextSequence);
  });

  L.push("");
  if (r.umaxCommit) {
    L.push("engine: umax-guide-designer @ " + r.umaxCommit.slice(0, 10));
  }
  L.push("");
  return L.join("\n");
}

function wrap(text, width, indent) {
  var words = String(text).split(/\s+/);
  var lines = [], line = "";
  words.forEach(function (w) {
    if (line && (line + " " + w).length > width) { lines.push(line); line = w; }
    else line = line ? line + " " + w : w;
  });
  if (line) lines.push(line);
  return lines.join("\n" + (indent || ""));
}

var CSV_COLUMNS = [
  "query", "clinvar_accession", "classification", "human_gene", "human_change",
  "consequence", "status", "zebrafish_gene", "zebrafish_transcript",
  "orthology_type", "percent_identity", "local_identity", "zebrafish_residue",
  "zebrafish_codon", "zebrafish_change", "required_base_change", "codon_position",
  "editor", "family", "cas", "pam", "strand", "spacer", "position_in_window",
  "in_peak", "score", "bystander_count", "bystander_effects",
  "crosses_exon_boundary", "product_kind", "locus", "flags", "reason"
];

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  var s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** One row per guide; one row per variant when nothing was designed. */
function toCsvRows(r, opts) {
  var o = opts || {};
  var topN = o.topN || Infinity;
  var common = {
    query: r.query,
    clinvar_accession: r.variant.accession,
    classification: r.variant.classification,
    human_gene: r.variant.gene,
    human_change: r.variant.change
      ? "p." + r.variant.change.wt + r.variant.change.position + r.variant.change.mut
      : null,
    consequence: r.variant.consequence,
    status: r.status
  };

  var rows = [];
  var designed = (r.strategies || []).filter(function (s) { return s.status === "designed"; });

  if (!designed.length) {
    rows.push(Object.assign({}, common, {
      reason: r.reason ||
        ((r.strategies || [])[0] && r.strategies[0].reason) || null,
      zebrafish_gene: ((r.strategies || [])[0] || {}).zebrafishGene || null
    }));
    return rows;
  }

  designed.forEach(function (s) {
    s.edits.forEach(function (e) {
      e.guides.slice(0, topN).forEach(function (g) {
        var flags = [];
        if (g.derived) flags.push("predicted-pairing");
        if (g.untestedWithUmax) flags.push("backbone-untested");
        if (g.unpublished) flags.push("unpublished-editor");
        if (g.hasPolyT) flags.push("polyT");
        if (!g.inPeak) flags.push("window-edge");

        rows.push(Object.assign({}, common, {
          zebrafish_gene: s.zebrafishGene,
          zebrafish_transcript: s.zebrafishTranscript,
          orthology_type: s.orthologyType,
          percent_identity: s.percentIdentity,
          local_identity: s.localIdentity,
          zebrafish_residue: s.zebrafishAa + s.zebrafishResidue,
          zebrafish_codon: e.wtCodon,
          zebrafish_change: s.targetResidueChange,
          required_base_change: e.change,
          codon_position: e.codonPosition,
          editor: g.editor,
          family: g.family,
          cas: g.cas,
          pam: g.pam,
          strand: g.strand,
          spacer: g.spacer,
          position_in_window: g.positionInWindow,
          in_peak: g.inPeak,
          score: g.score,
          bystander_count: g.bystanderCount,
          bystander_effects: g.bystanderEffects.map(function (b) { return b.description; }).join("; "),
          crosses_exon_boundary: g.crossesExonBoundary,
          product_kind: e.productKind,
          locus: s.locus,
          flags: flags.join("; ")
        }));
      });
    });
  });
  return rows;
}

function formatCsv(results, opts) {
  var rows = [];
  results.forEach(function (r) { rows = rows.concat(toCsvRows(r, opts)); });
  var out = [CSV_COLUMNS.join(",")];
  rows.forEach(function (row) {
    out.push(CSV_COLUMNS.map(function (c) { return csvEscape(row[c]); }).join(","));
  });
  return out.join("\n") + "\n";
}

module.exports = {
  formatText: formatText,
  formatCsv: formatCsv,
  toCsvRows: toCsvRows,
  CSV_COLUMNS: CSV_COLUMNS
};
