/*!
 * ClinVar lookup and protein-change parsing.
 *
 * v1 handles missense SNVs only. Truncating variants are recognised and
 * rejected with a clear reason rather than silently mapped, because the right
 * strategy for them is a CBE-installed premature stop rather than an
 * orthologous residue substitution -- a different code path.
 */
"use strict";

var http = require("./http.js");

var EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

var AA1 = {
  Ala: "A", Arg: "R", Asn: "N", Asp: "D", Cys: "C", Glu: "E", Gln: "Q",
  Gly: "G", His: "H", Ile: "I", Leu: "L", Lys: "K", Met: "M", Phe: "F",
  Pro: "P", Ser: "S", Thr: "T", Trp: "W", Tyr: "Y", Val: "V",
  Ter: "*", Sec: "U", Xaa: "X"
};

function aa1(three) {
  var key = three.charAt(0).toUpperCase() + three.slice(1).toLowerCase();
  return AA1[key] || null;
}

/**
 * Parse an HGVS protein change into {wt, position, mut}.
 * Accepts p.Arg403Gln, p.(Arg403Gln), and single-letter p.R403Q.
 */
function parseProteinChange(text) {
  if (!text) return null;
  var s = String(text).trim().replace(/^p\.?/i, "").replace(/^\(|\)$/g, "");

  var three = s.match(/^([A-Za-z]{3})(\d+)([A-Za-z]{3}|=|\*)$/);
  if (three) {
    var wt = aa1(three[1]);
    var mut = three[3] === "=" ? wt : (three[3] === "*" ? "*" : aa1(three[3]));
    if (wt && mut) return { wt: wt, position: Number(three[2]), mut: mut, raw: text };
  }

  var one = s.match(/^([A-Z])(\d+)([A-Z*=])$/);
  if (one) {
    var w = one[1];
    var m = one[3] === "=" ? w : one[3];
    return { wt: w, position: Number(one[2]), mut: m, raw: text };
  }
  return null;
}

/**
 * Classify a parsed change. Only `missense` proceeds in v1.
 */
function classify(change) {
  if (!change) return "unparsed";
  if (change.mut === "*") return "nonsense";
  if (change.wt === change.mut) return "synonymous";
  if (change.wt === "*") return "stop-loss";
  if (change.position === 1 && change.wt === "M") return "start-loss";
  return "missense";
}

/** Resolve an accession or rsID to a ClinVar UID. */
async function resolveUid(query, opts) {
  if (/^\d+$/.test(query)) return query;
  var url = EUTILS + "/esearch.fcgi?db=clinvar&retmode=json&term=" +
    encodeURIComponent(query) + apiKeyParam(opts);
  var data = await http.getJson(url, Object.assign({ label: "esearch " + query }, opts));
  var ids = (data.esearchresult && data.esearchresult.idlist) || [];
  if (!ids.length) throw new Error("no ClinVar record found for \"" + query + "\"");
  if (ids.length > 1) {
    /* Ambiguity here is usually an rsID covering several alleles. Surfacing the
       list beats silently designing against the wrong one. */
    throw new Error(
      "\"" + query + "\" matches " + ids.length + " ClinVar records: " +
      ids.slice(0, 10).join(", ") + (ids.length > 10 ? ", ..." : "") +
      "\n  rerun with one specific VCV accession or UID"
    );
  }
  return ids[0];
}

function apiKeyParam(opts) {
  var key = (opts && opts.ncbiApiKey) || process.env.NCBI_API_KEY;
  return key ? "&api_key=" + encodeURIComponent(key) : "";
}

/**
 * Fetch and normalise a ClinVar record.
 * @returns {{uid, accession, gene, name, change, consequence, classification, transcript}}
 */
async function fetchVariant(query, opts) {
  var uid = await resolveUid(query, opts);
  var url = EUTILS + "/esummary.fcgi?db=clinvar&retmode=json&id=" + uid + apiKeyParam(opts);
  var data = await http.getJson(url, Object.assign({ label: "esummary " + uid }, opts));

  var rec = data.result && data.result[uid];
  if (!rec) throw new Error("ClinVar returned no summary for UID " + uid);

  var vset = (rec.variation_set && rec.variation_set[0]) || {};
  var name = vset.variation_name || rec.title || "";

  /* "NM_000257.4(MYH7):c.1208G>A (p.Arg403Gln)" */
  var pMatch = name.match(/\(p\.([^)]+)\)\s*$/);
  var change = parseProteinChange(pMatch ? pMatch[1] : null);
  var txMatch = name.match(/^([A-Z]{2}_[\d.]+)/);

  var genes = (rec.genes || []).map(function (g) { return g.symbol; }).filter(Boolean);

  return {
    uid: uid,
    accession: rec.accession || vset.accession || null,
    gene: genes[0] || rec.gene_sort || null,
    allGenes: genes,
    name: name,
    transcript: txMatch ? txMatch[1] : null,
    change: change,
    consequence: classify(change),
    reportedConsequence: (vset.molecular_consequence_list || []).join("; ") || null,
    classification:
      (rec.germline_classification && rec.germline_classification.description) ||
      (rec.clinical_significance && rec.clinical_significance.description) || null
  };
}

/**
 * Accept `GENE:p.Arg403Gln` so the pipeline can be driven without ClinVar at
 * all -- useful for variants not yet deposited, and it keeps the orthology
 * path testable without an NCBI round trip.
 */
function parseDirect(spec) {
  var m = String(spec).match(/^([A-Za-z0-9._-]+)\s*[:\s]\s*(p\.?.+)$/);
  if (!m) return null;
  var change = parseProteinChange(m[2]);
  if (!change) return null;
  return {
    uid: null,
    accession: null,
    gene: m[1].toUpperCase(),
    allGenes: [m[1].toUpperCase()],
    name: m[1].toUpperCase() + ":" + m[2],
    transcript: null,
    change: change,
    consequence: classify(change),
    reportedConsequence: null,
    classification: null
  };
}

module.exports = {
  AA1: AA1,
  aa1: aa1,
  parseProteinChange: parseProteinChange,
  classify: classify,
  fetchVariant: fetchVariant,
  parseDirect: parseDirect
};
