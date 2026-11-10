/*!
 * Ensembl REST client: orthology, residue-to-genome mapping, genomic sequence.
 *
 * All of this works unauthenticated and sends Access-Control-Allow-Origin: *,
 * so the same calls can later be made straight from the browser app with no
 * backend. Keeping the client thin and the mapping logic in ortholog.js is
 * what makes that port cheap.
 */
"use strict";

var http = require("./http.js");

var BASE = "https://rest.ensembl.org";

/**
 * Orthologues of a human gene symbol in zebrafish, with the Compara protein
 * alignment attached. `align_seq` on source and target is the whole point:
 * it gives a residue-to-residue mapping without running an aligner locally.
 */
async function orthologues(symbol, opts) {
  var url = BASE + "/homology/symbol/human/" + encodeURIComponent(symbol) +
    "?target_species=danio_rerio;type=orthologues;sequence=protein;content-type=application/json";
  var data = await http.getJson(url, Object.assign({ label: "orthologues of " + symbol }, opts));

  var pairs = [];
  (data.data || []).forEach(function (entry) {
    (entry.homologies || []).forEach(function (h) {
      if (!h.source || !h.target) return;
      if (!h.source.align_seq || !h.target.align_seq) return;
      pairs.push(h);
    });
  });
  return pairs;
}

/** Full record for a stable ID (used to resolve a protein ID to its transcript). */
async function lookup(id, opts, params) {
  var url = BASE + "/lookup/id/" + encodeURIComponent(id) +
    "?content-type=application/json" + (params || "");
  return http.getJson(url, Object.assign({ label: "lookup " + id }, opts));
}

/**
 * Genomic coordinates of a residue range within a translation.
 *
 * The response is a list of blocks, not a single interval. More than one block
 * means the codon straddles an exon junction, which matters: the flanking
 * genomic sequence a guide needs is then discontinuous in transcript space,
 * and a tool that assumes otherwise will design a guide against a sequence
 * that does not exist in the genome.
 */
async function mapTranslation(proteinId, residue, opts) {
  return mapTranslationRange(proteinId, residue, residue, opts);
}

/**
 * Genomic blocks for a residue range. Asking for the whole protein returns the
 * complete coding structure in one call, which is what the PTC scan needs:
 * block boundaries are the coding exon boundaries, so CDS offsets can be
 * converted to genomic coordinates locally instead of one request per codon.
 */
async function mapTranslationRange(proteinId, from, to, opts) {
  var url = BASE + "/map/translation/" + encodeURIComponent(proteinId) + "/" +
    from + ".." + to + "?content-type=application/json";
  var data = await http.getJson(url,
    Object.assign({ label: "map residues " + from + "-" + to + " of " + proteinId }, opts));
  return data.mappings || [];
}

/** Coding sequence of a transcript, in frame and 5'->3'. */
async function cdsSequence(transcriptId, opts) {
  var url = BASE + "/sequence/id/" + encodeURIComponent(transcriptId) +
    "?type=cds;content-type=application/json";
  var data = await http.getJson(url,
    Object.assign({ label: "CDS of " + transcriptId }, opts));
  return data.seq;
}

/**
 * Genomic sequence for a region. Passing strand returns the sequence already
 * in the requested orientation, so downstream code never flips it by hand.
 */
async function regionSequence(region, strand, opts) {
  var url = BASE + "/sequence/region/danio_rerio/" + region +
    (strand === -1 ? ":-1" : ":1") +
    "?content-type=application/json";
  var data = await http.getJson(url, Object.assign({ label: "sequence " + region }, opts));
  return data.seq;
}

/** Exons of a transcript, for detecting a guide window that runs into an intron. */
async function exons(transcriptId, opts) {
  var url = BASE + "/overlap/id/" + encodeURIComponent(transcriptId) +
    "?feature=exon;content-type=application/json";
  var data = await http.getJson(url,
    Object.assign({ label: "exons of " + transcriptId }, opts));
  return (Array.isArray(data) ? data : []).filter(function (e) {
    return e.Parent === transcriptId;
  });
}

module.exports = {
  BASE: BASE,
  orthologues: orthologues,
  lookup: lookup,
  mapTranslation: mapTranslation,
  mapTranslationRange: mapTranslationRange,
  cdsSequence: cdsSequence,
  regionSequence: regionSequence,
  exons: exons
};
