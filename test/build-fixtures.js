/*!
 * Build offline fixtures.
 *
 * Fixtures are written into the HTTP cache directory under the exact filenames
 * lib/http.js would use, so the test suite exercises the real code path --
 * URL construction included -- with no network and no mocking seam. If a URL
 * is built wrongly the test fails with a cache miss, which is the behaviour we
 * want from a fixture.
 *
 * The data is synthetic but internally coherent: the alignment, the protein,
 * the genomic codon and the assembly all agree, which is exactly the
 * consistency the pipeline asserts at runtime.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var http = require("../lib/http.js");

var DIR = path.join(__dirname, "..", "fixtures");
var E = "https://rest.ensembl.org";
var N = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function write(url, data) {
  var file = http.cachePath(DIR, url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return file;
}

/* ---------------------------------------------------------------- *
 * A 150-residue human protein with Arg at position 100.
 * ---------------------------------------------------------------- */
var FILLER = "MATLSEQKVNDFGIPYWHC";
function protein(n, overrides) {
  var s = "";
  for (var i = 0; i < n; i++) s += FILLER.charAt(i % FILLER.length);
  var chars = s.split("");
  Object.keys(overrides || {}).forEach(function (pos) {
    chars[Number(pos) - 1] = overrides[pos];
  });
  return chars.join("");
}

var human = protein(150, { 100: "R" });

/**
 * Zebrafish aligned sequence: identical to human except for a ten-residue
 * deletion at columns 20-29.
 *
 * The deletion is what makes the test meaningful. It shifts zebrafish
 * numbering back by ten relative to human, so human residue 100 maps to
 * zebrafish residue 90 and any code that quietly assumes the two proteins
 * share numbering fails here. Residues outside the gap match, which keeps
 * local identity realistic for a conserved site.
 */
function targetAlign(residueAtColumn100) {
  var chars = (human.slice(0, 20) + "----------" + human.slice(30, 150)).split("");
  if (chars.length !== human.length) throw new Error("alignment length mismatch");
  chars[99] = residueAtColumn100;             // column 99 -> target residue 90
  return chars.join("");
}

var homology = {
  data: [{
    id: "TESTA",
    homologies: [
      {
        type: "ortholog_one2many",
        taxonomy_level: "Euteleostomi",
        method_link_type: "ENSEMBL_ORTHOLOGUES",
        dn_ds: null,
        source: {
          species: "homo_sapiens", taxon_id: 9606,
          id: "ENSG00000TESTA", protein_id: "ENSP00000TESTA",
          perc_id: 71.2, perc_pos: 82.4, cigar_line: "150M",
          align_seq: human
        },
        target: {
          species: "danio_rerio", taxon_id: 7955,
          id: "ENSDARG00000000001", protein_id: "ENSDARP00000000001",
          perc_id: 68.4, perc_pos: 80.1, cigar_line: "10D140M",
          align_seq: targetAlign("R")              // conserved
        }
      },
      {
        type: "ortholog_one2many",
        taxonomy_level: "Euteleostomi",
        method_link_type: "ENSEMBL_ORTHOLOGUES",
        dn_ds: null,
        source: {
          species: "homo_sapiens", taxon_id: 9606,
          id: "ENSG00000TESTA", protein_id: "ENSP00000TESTA",
          perc_id: 71.2, perc_pos: 82.4, cigar_line: "150M",
          align_seq: human
        },
        target: {
          species: "danio_rerio", taxon_id: 7955,
          id: "ENSDARG00000000002", protein_id: "ENSDARP00000000002",
          perc_id: 54.1, perc_pos: 66.0, cigar_line: "10D140M",
          align_seq: targetAlign("K")              // not conserved: Lys
        }
      },
      {
        type: "ortholog_one2many",
        taxonomy_level: "Euteleostomi",
        method_link_type: "ENSEMBL_ORTHOLOGUES",
        dn_ds: null,
        source: {
          species: "homo_sapiens", taxon_id: 9606,
          id: "ENSG00000TESTA", protein_id: "ENSP00000TESTA",
          perc_id: 71.2, perc_pos: 82.4, cigar_line: "150M",
          align_seq: human
        },
        target: {
          species: "danio_rerio", taxon_id: 7955,
          id: "ENSDARG00000000003", protein_id: "ENSDARP00000000003",
          perc_id: 41.0, perc_pos: 55.2, cigar_line: "10D140M",
          align_seq: targetAlign("-")              // falls in a gap
        }
      }
    ]
  }]
};
write(E + "/homology/symbol/human/TESTA?target_species=danio_rerio;type=orthologues;sequence=protein;content-type=application/json", homology);

/* A second gene whose orthologous codon uses an arginine codon from which His
   is unreachable, to exercise the dead-end reporting. */
var homologyBlocked = JSON.parse(JSON.stringify(homology));
homologyBlocked.data[0].id = "TESTB";
homologyBlocked.data[0].homologies = [homologyBlocked.data[0].homologies[0]];
homologyBlocked.data[0].homologies[0].target.id = "ENSDARG00000000009";
homologyBlocked.data[0].homologies[0].target.protein_id = "ENSDARP00000000009";
write(E + "/homology/symbol/human/TESTB?target_species=danio_rerio;type=orthologues;sequence=protein;content-type=application/json", homologyBlocked);

/* ---------------------------------------------------------------- *
 * Genomic context. 45 + 3 + 45 = 93 nt, codon at offset 45.
 * CC at sense offsets 27-28 guarantees an NGG PAM for an antisense
 * guide reaching the codon's middle base, which is where a G>A edit
 * has to happen for CGC -> CAC.
 * ---------------------------------------------------------------- */
/* 31 codons, none of them a stop, so bystander consequences read as real
   residue changes rather than artefacts of a synthetic sequence. Codon 10 is
   CCA, which puts CC at offsets 27-28; the reverse complement of that is TGG,
   an NGG PAM for the antisense guide that a G>A edit at the codon's middle
   base requires. Codon 16 is the target and sits at offset 45. */
var CODON_CONTEXT = [
  "ATG", "GCT", "AGC", "CTG", "GAA", "AAG", "GTC", "ACC", "TTC", "CCA",
  "GGT", "ATC", "CTG", "AAC", "TCA", "XXX", "GTG", "AAG", "CTT", "GAC",
  "ATG", "TCC", "AAG", "CTG", "ACC", "TTC", "GGA", "CAG", "ATC", "CTG", "AAC"
];

/**
 * @param {string} codon      the target codon, placed at offset 45
 * @param {object} [replace]  1-based codon index -> replacement triplet
 */
function buildContext(codon, replace) {
  var codons = CODON_CONTEXT.map(function (c) { return c === "XXX" ? codon : c; });
  Object.keys(replace || {}).forEach(function (i) {
    codons[Number(i) - 1] = replace[i];
  });
  var seq = codons.join("");
  if (seq.length !== 93) throw new Error("context must be 93 nt, got " + seq.length);
  if (seq.substr(45, 3) !== codon) throw new Error("target codon is not at offset 45");
  if (seq.substr(27, 2) !== "CC") throw new Error("PAM-enabling CC is not at offset 27");
  return seq;
}

function writeLocus(protein, residue, chrom, start, codon, exonEndOffset, replace) {
  write(E + "/map/translation/" + protein + "/" + residue + ".." + residue +
    "?content-type=application/json", {
    mappings: [{
      seq_region_name: chrom, start: start, end: start + 2,
      strand: 1, coord_system: "chromosome", assembly_name: "GRCz11",
      gap: 0, rank: 0
    }]
  });

  var region = chrom + ":" + (start - 45) + "-" + (start + 2 + 45);
  write(E + "/sequence/region/danio_rerio/" + region + ":1?content-type=application/json", {
    id: "chromosome:GRCz11:" + chrom + ":" + (start - 45) + ":" + (start + 47) + ":1",
    seq: buildContext(codon, replace),
    molecule: "dna"
  });

  write(E + "/lookup/id/" + protein + "?content-type=application/json", {
    id: protein, object_type: "Translation", species: "danio_rerio",
    Parent: protein.replace("ENSDARP", "ENSDART"),
    length: 140, db_type: "core"
  });

  var tx = protein.replace("ENSDARP", "ENSDART");
  write(E + "/overlap/id/" + tx + "?feature=exon;content-type=application/json", [
    {
      id: tx.replace("ENSDART", "ENSDARE") + "1", Parent: tx, feature_type: "exon",
      seq_region_name: chrom, strand: 1,
      start: start - 300,
      end: start + (exonEndOffset === undefined ? 14 : exonEndOffset),
      assembly_name: "GRCz11"
    },
    {
      id: tx.replace("ENSDART", "ENSDARE") + "2", Parent: tx, feature_type: "exon",
      seq_region_name: chrom, strand: 1,
      start: start + 900, end: start + 1200, assembly_name: "GRCz11"
    }
  ]);
}

/* CGC: His reachable via G>A at codon position 2. Exon runs well past the
   codon, so no guide reaches the junction. */
writeLocus("ENSDARP00000000001", 90, "7", 1000000, "CGC", 14);
/* CGA: His unreachable from this codon by any single substitution. */
writeLocus("ENSDARP00000000009", 90, "7", 2000000, "CGA", 14);
/* Paralogues that should never be fetched, but keep the cache complete. */
writeLocus("ENSDARP00000000002", 90, "7", 3000000, "CGC", 14);

/* ---------------------------------------------------------------- *
 * TESTC: same codon, but the exon ends 5 nt after it, so PAM-proximal
 * guides reach into the intron and must be flagged while PAM-distal
 * ones stay clean. A mixed result is the only kind that proves the
 * flag is actually discriminating.
 * ---------------------------------------------------------------- */
function singleOrtholog(geneSymbol, zGene, zProtein, columnResidue, humanResidue) {
  var h = JSON.parse(JSON.stringify(homology));
  h.data[0].id = geneSymbol;
  h.data[0].homologies = [h.data[0].homologies[0]];
  var pair = h.data[0].homologies[0];
  pair.target.id = zGene;
  pair.target.protein_id = zProtein;

  if (humanResidue) {
    /* Rebuild both sides so the human wild-type residue at position 100 is
       whatever the test needs, keeping the ten-residue gap intact. */
    var hu = protein(150, { 100: humanResidue });
    pair.source.align_seq = hu;
    var chars = (hu.slice(0, 20) + "----------" + hu.slice(30, 150)).split("");
    chars[99] = columnResidue || humanResidue;
    pair.target.align_seq = chars.join("");
  } else if (columnResidue) {
    pair.target.align_seq = targetAlign(columnResidue);
  }

  write(E + "/homology/symbol/human/" + geneSymbol +
    "?target_species=danio_rerio;type=orthologues;sequence=protein;content-type=application/json", h);
}

singleOrtholog("TESTC", "ENSDARG00000000011", "ENSDARP00000000011", "R");
writeLocus("ENSDARP00000000011", 90, "7", 4000000, "CGC", 5);

/* ---------------------------------------------------------------- *
 * TESTD: the codon straddles an exon junction, so its three bases are
 * not contiguous in the genome. v1 must refuse rather than design on a
 * continuous window that does not exist.
 * ---------------------------------------------------------------- */
singleOrtholog("TESTD", "ENSDARG00000000012", "ENSDARP00000000012", "R");
write(E + "/map/translation/ENSDARP00000000012/90..90?content-type=application/json", {
  mappings: [
    { seq_region_name: "7", start: 5000000, end: 5000001, strand: 1,
      coord_system: "chromosome", assembly_name: "GRCz11", gap: 0, rank: 0 },
    { seq_region_name: "7", start: 5000500, end: 5000500, strand: 1,
      coord_system: "chromosome", assembly_name: "GRCz11", gap: 0, rank: 1 }
  ]
});

/* ---------------------------------------------------------------- *
 * TESTE: codon 11 becomes TTC, which puts an NAA PAM in reach at
 * protospacer position 7. That is the only way an iSpyMac guide gets
 * enumerated, and iSpyMac is the backbone the registry marks as never
 * having been tested with a Umax editor -- so this is what proves the
 * "backbone untested" caveat actually reaches the user.
 * ---------------------------------------------------------------- */
singleOrtholog("TESTE", "ENSDARG00000000013", "ENSDARP00000000013", "R");
writeLocus("ENSDARP00000000013", 90, "7", 6000000, "CGC", 14, { 11: "TTC" });

/* ---------------------------------------------------------------- *
 * TESTF: p.Asp100Ala against a GAT codon. Asp->Ala needs A>C, which
 * only the transversion chemistry can install, so this is the fixture
 * that exercises the zAYE family and -- more importantly -- the mixed
 * product spectrum, where the requested change is one of three
 * outcomes the editor actually produces at the edited base.
 * ---------------------------------------------------------------- */
singleOrtholog("TESTF", "ENSDARG00000000014", "ENSDARP00000000014", "D", "D");
writeLocus("ENSDARP00000000014", 90, "7", 7000000, "GAT", 14);

/* ---------------------------------------------------------------- *
 * ClinVar
 * ---------------------------------------------------------------- */
write(N + "/esearch.fcgi?db=clinvar&retmode=json&term=VCV000099999", {
  esearchresult: { count: "1", idlist: ["99999"] }
});
write(N + "/esummary.fcgi?db=clinvar&retmode=json&id=99999", {
  result: {
    uids: ["99999"],
    "99999": {
      uid: "99999",
      accession: "VCV000099999",
      title: "NM_000000.1(TESTA):c.299G>A (p.Arg100His)",
      gene_sort: "TESTA",
      genes: [{ symbol: "TESTA", GeneID: "1" }],
      germline_classification: { description: "Pathogenic", review_status: "criteria provided" },
      variation_set: [{
        measure_id: "99999",
        variation_name: "NM_000000.1(TESTA):c.299G>A (p.Arg100His)",
        cdna_change: "c.299G>A",
        molecular_consequence_list: ["missense variant"]
      }]
    }
  }
});

/* A truncating variant, which v1 must refuse with a reason rather than map. */
write(N + "/esearch.fcgi?db=clinvar&retmode=json&term=VCV000088888", {
  esearchresult: { count: "1", idlist: ["88888"] }
});
write(N + "/esummary.fcgi?db=clinvar&retmode=json&id=88888", {
  result: {
    uids: ["88888"],
    "88888": {
      uid: "88888", accession: "VCV000088888",
      title: "NM_000000.1(TESTA):c.298C>T (p.Arg100Ter)",
      gene_sort: "TESTA", genes: [{ symbol: "TESTA", GeneID: "1" }],
      germline_classification: { description: "Pathogenic" },
      variation_set: [{
        variation_name: "NM_000000.1(TESTA):c.298C>T (p.Arg100Ter)",
        molecular_consequence_list: ["nonsense"]
      }]
    }
  }
});

console.log("fixtures written to " + DIR);
console.log("context sequence:", buildContext("CGC"));
console.log("codon at offset 45:", buildContext("CGC").substr(45, 3));
