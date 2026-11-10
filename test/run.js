/*!
 * Test suite. Runs entirely offline against fixtures/.
 *
 *   node test/build-fixtures.js && node test/run.js
 */
"use strict";

var path = require("path");
var UMAX = require("../vendor/umax.js");
var palette = require("../lib/palette.js");
var ortholog = require("../lib/ortholog.js");
var clinvar = require("../lib/clinvar.js");
var pipeline = require("../lib/pipeline.js");

var FIXTURES = path.join(__dirname, "..", "fixtures");
var OPTS = { cacheDir: FIXTURES, cacheOnly: true };

var passed = 0, failed = 0;
var current = "";

function section(name) { current = name; console.log("\n" + name); }

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log("  ok   " + label);
  } else {
    failed++;
    console.log("  FAIL " + label + (detail ? "\n         " + detail : ""));
  }
}

function eq(label, actual, expected) {
  check(label, actual === expected, "expected " + JSON.stringify(expected) +
    ", got " + JSON.stringify(actual));
}

var pal = palette.buildPalette(UMAX.FAMILY);

/* ------------------------------------------------------------------ */
section("Palette derived from the engine's family table");

eq("eight reachable substitutions", pal.size, 8);
["A>G", "T>C", "C>T", "G>A", "A>C", "A>T", "T>G", "T>A"].forEach(function (k) {
  check("reachable: " + k, pal.has(k));
});
["C>A", "C>G", "G>C", "G>T"].forEach(function (k) {
  check("blocked: " + k, !pal.has(k));
});
eq("A>G prefers the clean ABE route over the AYE byproduct",
  pal.get("A>G")[0].family + "/" + pal.get("A>G")[0].kind, "ABE/intended");
eq("G>A is a CBE edit on the antisense strand", pal.get("G>A")[0].strand, "-");

/* Each palette route must agree with the engine about which strand a guide
   anneals to, since both derive it from the same family table. */
pal.forEach(function (routes, key) {
  routes.forEach(function (r) {
    var engineStrand = UMAX.guideStrandFor(r.from, r.family);
    check("engine agrees on strand for " + key + " via " + r.family,
      engineStrand === r.strand, "palette " + r.strand + " vs engine " + engineStrand);
  });
});

/* ------------------------------------------------------------------ */
section("Codon dependence: the human nucleotide change cannot be reused");

var argToHis = {};
["CGT", "CGC", "CGA", "CGG", "AGA", "AGG"].forEach(function (c) {
  argToHis[c] = palette.requiredEdits(c, "H", UMAX.CODONS, pal).reachable.length > 0;
});
check("Arg>His reachable only from CGT and CGC",
  argToHis.CGT && argToHis.CGC && !argToHis.CGA && !argToHis.CGG &&
  !argToHis.AGA && !argToHis.AGG, JSON.stringify(argToHis));

check("CGA>His is forbidden by the genetic code, not by the palette",
  !palette.reachableByAnyChemistry("CGA", "H", UMAX.CODONS));
check("GGT>Cys is allowed by the code but blocked by the palette",
  palette.reachableByAnyChemistry("GGT", "C", UMAX.CODONS) &&
  palette.requiredEdits("GGT", "C", UMAX.CODONS, pal).reachable.length === 0);
eq("rescue codons for Arg>His",
  palette.rescueCodons("R", "H", UMAX.CODONS, pal).join(","), "CGC,CGT");

/* ------------------------------------------------------------------ */
section("Protein change parsing");

eq("three-letter", JSON.stringify(clinvar.parseProteinChange("p.Arg403Gln")),
  JSON.stringify({ wt: "R", position: 403, mut: "Q", raw: "p.Arg403Gln" }));
eq("single-letter", clinvar.parseProteinChange("p.R403Q").mut, "Q");
eq("parenthesised", clinvar.parseProteinChange("p.(Arg403Gln)").position, 403);
eq("nonsense classified", clinvar.classify(clinvar.parseProteinChange("p.Arg100Ter")), "nonsense");
eq("synonymous classified", clinvar.classify(clinvar.parseProteinChange("p.Arg100=")), "synonymous");
eq("missense classified", clinvar.classify(clinvar.parseProteinChange("p.Arg100His")), "missense");
check("junk rejected", clinvar.parseProteinChange("not a variant") === null);

/* ------------------------------------------------------------------ */
section("Alignment indexing");

var idx = ortholog.indexAlignment("AB--CD");
eq("residue 1 -> column 0", idx.colOfResidue[1], 0);
eq("residue 3 -> column 4", idx.colOfResidue[3], 4);
eq("column 2 is a gap", idx.residueOfCol[2], null);
eq("four residues", idx.length, 4);

/* ------------------------------------------------------------------ */
(async function main() {

  section("End to end: ClinVar missense -> zebrafish guide");

  var out = await pipeline.run("VCV000099999", OPTS);
  eq("status", out.status, "ok");
  eq("gene resolved from ClinVar", out.variant.gene, "TESTA");
  eq("consequence", out.variant.consequence, "missense");
  eq("change parsed", out.variant.change.wt + out.variant.change.position + out.variant.change.mut, "R100H");
  eq("engine provenance recorded", typeof out.umaxCommit, "string");

  eq("three orthologue pairs examined", out.orthologSummary.examined, 3);
  eq("one conserved", out.orthologSummary.conserved, 1);
  check("duplication detected", out.orthologSummary.duplicated);

  var byStatus = {};
  out.candidates.forEach(function (c) { byStatus[c.status] = c.zebrafishGene; });
  check("conserved paralogue reported", !!byStatus.conserved);
  check("non-conserved paralogue reported", !!byStatus.not_conserved);
  check("gap paralogue reported", !!byStatus.no_aligned_residue);

  var s = out.strategies[0];
  eq("strategy status", s.status, "designed");
  eq("human residue 100 maps to zebrafish 90 across a 10-residue gap", s.zebrafishResidue, 90);
  eq("zebrafish wild-type residue", s.zebrafishAa, "R");
  eq("zebrafish codon", s.wtCodon, "CGC");
  eq("intended residue change", s.targetResidueChange, "R90H");
  eq("local identity", s.localIdentity, 1);
  eq("context is in frame and stop-free",
    UMAX.translate(s.contextSequence).indexOf("*"), -1);
  eq("target codon sits at the declared offset",
    s.contextSequence.substr(s.contextCodonOffset, 3), "CGC");

  eq("one required edit", s.edits.length, 1);
  var e = s.edits[0];
  eq("required change", e.change, "G>A");
  eq("codon position", e.codonPosition, 2);
  eq("codon transition", e.wtCodon + ">" + e.mutCodon, "CGC>CAC");
  eq("chemistry", e.family, "CBE");
  eq("guide strand", e.strand, "-");
  eq("clean product", e.productKind, "intended");
  check("requested product flagged in the spectrum",
    e.outcomeSpectrum.some(function (o) { return o.requested && o.residueChange === "R90H"; }),
    JSON.stringify(e.outcomeSpectrum));
  check("guides found", e.guides.length > 0);

  /* Independently re-derive the top guide from the context sequence. */
  var top = e.guides[0];
  var rc = function (x) {
    return x.split("").reverse().map(function (c) {
      return { A: "T", T: "A", G: "C", C: "G" }[c];
    }).join("");
  };
  var work = rc(s.contextSequence);
  var targetIdx = s.contextCodonOffset + e.codonPosition - 1;
  var workTarget = s.contextSequence.length - 1 - targetIdx;
  var start = workTarget - (top.positionInWindow - 1);
  eq("top guide spacer re-derived", work.substr(start, 20), top.spacer);
  eq("top guide PAM re-derived", work.substr(start + 20, top.pam.length), top.pam);
  eq("deaminated base is a cytosine on the protospacer strand",
    top.spacer.charAt(top.positionInWindow - 1), "C");
  check("top guide places the target in the peak window", top.inPeak);

  /* Apply the edit and confirm the consequence independently. */
  var edited = s.contextSequence.substring(0, targetIdx) + "A" +
    s.contextSequence.substring(targetIdx + 1);
  eq("edited codon", edited.substr(s.contextCodonOffset, 3), "CAC");
  eq("edited residue", UMAX.CODONS[edited.substr(s.contextCodonOffset, 3)], "H");

  check("no guide is reported as crossing a junction when the exon runs long",
    e.guides.every(function (g) { return !g.crossesExonBoundary; }));

  /* ---------------------------------------------------------------- */
  section("Direct gene:change input bypasses ClinVar");

  var direct = await pipeline.run("TESTA:p.Arg100His", OPTS);
  eq("same verdict as the ClinVar route", direct.status, "ok");
  eq("same guide as the ClinVar route",
    direct.strategies[0].edits[0].guides[0].spacer, top.spacer);

  /* ---------------------------------------------------------------- */
  section("Truncating variants are refused, not mapped");

  var trunc = await pipeline.run("VCV000088888", OPTS);
  eq("status", trunc.status, "unsupported_consequence");
  eq("classified as nonsense", trunc.variant.consequence, "nonsense");
  check("reason names the premature-stop strategy",
    /premature stop/.test(trunc.reason), trunc.reason);
  eq("nothing designed", trunc.strategies.length, 0);

  /* ---------------------------------------------------------------- */
  section("Dead end: codon cannot reach the target residue");

  var blocked = await pipeline.run("TESTB:p.Arg100His", OPTS);
  eq("status", blocked.status, "no_design");
  var bs = blocked.strategies[0];
  eq("strategy status", bs.status, "blocked_by_genetic_code");
  eq("codon", bs.wtCodon, "CGA");
  check("reason distinguishes the genetic code from the palette",
    /whatever the chemistry/.test(bs.reason), bs.reason);
  eq("names the synonymous codons that would have worked",
    (bs.rescueCodons || []).join(","), "CGC,CGT");

  /* ---------------------------------------------------------------- */
  section("Guides reaching an exon junction are flagged");

  var near = await pipeline.run("TESTC:p.Arg100His", OPTS);
  eq("status", near.status, "ok");
  var ng = near.strategies[0].edits[0].guides;
  var crossing = ng.filter(function (g) { return g.crossesExonBoundary; });
  check("some guides are flagged", crossing.length > 0,
    "none of " + ng.length + " guides flagged");
  check("not all guides are flagged", crossing.length < ng.length,
    "all " + ng.length + " flagged, so the test is not discriminating");
  check("flagged guides reach further toward the PAM than clean ones",
    Math.max.apply(null, crossing.map(function (g) { return g.positionInWindow; })) >
    Math.min.apply(null, ng.filter(function (g) { return !g.crossesExonBoundary; })
      .map(function (g) { return g.positionInWindow; })));
  check("flag carries an explanation",
    crossing.every(function (g) { return !!g.note; }));

  /* ---------------------------------------------------------------- */
  section("Split codon is refused");

  var split = await pipeline.run("TESTD:p.Arg100His", OPTS);
  eq("status", split.status, "no_design");
  eq("strategy status", split.strategies[0].status, "no_context");
  check("reason names the junction",
    /split across an exon junction/.test(split.strategies[0].reason),
    split.strategies[0].reason);

  /* ---------------------------------------------------------------- */
  section("Isoform disagreement is caught, not designed around");

  var wrongWt = await pipeline.run("TESTA:p.Lys100His", OPTS);
  eq("status", wrongWt.status, "isoform_mismatch");
  check("every candidate flags the mismatch",
    wrongWt.candidates.every(function (c) { return c.status === "isoform_mismatch"; }));
  check("reason points at the transcript",
    /different isoforms|numbered against/.test(wrongWt.reason), wrongWt.reason);

  var beyondEnd = await pipeline.run("TESTA:p.Arg900His", OPTS);
  eq("residue past the end of the protein is caught", beyondEnd.status, "isoform_mismatch");

  /* ---------------------------------------------------------------- */
  section("Untested backbone pairings are flagged, not passed off as published");

  var plain = await pipeline.run("TESTE:p.Arg100His", OPTS);
  eq("status without predicted pairings", plain.status, "ok");
  var plainCas = new Set(plain.strategies[0].edits[0].guides.map(function (g) { return g.cas; }));
  check("iSpyMac is absent unless asked for", !plainCas.has("iSpyMac"),
    [...plainCas].join(","));

  var untested = await pipeline.run("TESTE:p.Arg100His",
    Object.assign({ includeUntested: true }, OPTS));
  var ug = untested.strategies[0].edits[0].guides;
  var ispy = ug.filter(function (g) { return g.cas === "iSpyMac"; });
  check("iSpyMac guides appear with --include-untested", ispy.length > 0,
    "backbones: " + [...new Set(ug.map(function (g) { return g.cas; }))].join(","));
  check("every iSpyMac guide carries the untested-backbone flag",
    ispy.length > 0 && ispy.every(function (g) { return g.untestedWithUmax; }),
    "flagged " + ispy.filter(function (g) { return g.untestedWithUmax; }).length +
    " of " + ispy.length + "; the flag lives on casVariants, not on the derived editor");
  check("iSpyMac guides use an NAA PAM",
    ispy.every(function (g) { return /^.AA$/.test(g.pam); }),
    ispy.map(function (g) { return g.pam; }).join(","));
  check("derived pairings are marked as derived",
    ispy.every(function (g) { return g.derived; }));
  check("a published architecture on a predicted backbone is not called an unpublished editor",
    ispy.every(function (g) { return !g.unpublished; }),
    "the engine marks every derived pairing unpublished; that means the pairing, not the chemistry");

  /* ---------------------------------------------------------------- */
  section("Transversion chemistry and its mixed product spectrum");

  var tv = await pipeline.run("TESTF:p.Asp100Ala", OPTS);
  eq("status", tv.status, "ok");
  var ts = tv.strategies[0];
  eq("zebrafish codon", ts.wtCodon, "GAT");
  eq("one required edit", ts.edits.length, 1);
  var te = ts.edits[0];
  eq("required change needs a transversion", te.change, "A>C");
  eq("codon transition", te.wtCodon + ">" + te.mutCodon, "GAT>GCT");
  eq("chemistry", te.family, "AYE");
  eq("sense-strand guide for an adenine", te.strand, "+");
  eq("requested change is the editor's main product", te.productKind, "intended");
  check("declared as a mixed-product chemistry", te.mixedProducts);

  eq("three products reported", te.outcomeSpectrum.length, 3);
  var req = te.outcomeSpectrum.filter(function (p) { return p.requested; });
  eq("exactly one product is the requested one", req.length, 1);
  eq("requested product gives the intended residue", req[0].residueChange, "D90A");
  check("the other products give different residues",
    te.outcomeSpectrum.filter(function (p) { return !p.requested; })
      .every(function (p) { return p.residueChange && p.residueChange !== "D90A"; }),
    JSON.stringify(te.outcomeSpectrum.map(function (p) { return p.base + ":" + p.residueChange; })));
  eq("A>T alternate product gives Val",
    (te.outcomeSpectrum.find(function (p) { return p.base === "T"; }) || {}).residueChange, "D90V");
  eq("residual A>G byproduct gives Gly",
    (te.outcomeSpectrum.find(function (p) { return p.base === "G"; }) || {}).residueChange, "D90G");

  check("zAYE guides found", te.guides.length > 0);
  check("all guides are from the transversion family",
    te.guides.every(function (g) { return g.family === "AYE"; }));

  /* The zAYE family really is unpublished, so that flag must still fire where
     it belongs -- otherwise the earlier fix would have silenced it everywhere. */
  var aye = te.guides.filter(function (g) { return !g.derived; });
  check("genuinely unpublished chemistry is still flagged",
    aye.length > 0 && aye.every(function (g) { return g.unpublished; }),
    aye.length ? "flagged " + aye.filter(function (g) { return g.unpublished; }).length +
      " of " + aye.length : "no non-derived AYE guide found to check");

  /* ---------------------------------------------------------------- */
  section("Cache-only mode fails loudly on a miss");

  var missed = null;
  try {
    await pipeline.run("TESTZ:p.Arg100His", OPTS);
  } catch (err) {
    missed = err.message;
  }
  check("cache miss raises", !!missed);
  check("error names the missing resource", /cache miss/.test(missed || ""), missed);

  /* ---------------------------------------------------------------- */
  console.log("\n" + (failed ? "FAILED" : "PASSED") +
    ": " + passed + " checks passed, " + failed + " failed\n");
  process.exit(failed ? 1 : 0);

})().catch(function (err) {
  console.error("\nsuite crashed in \"" + current + "\": " + err.stack);
  process.exit(1);
});
