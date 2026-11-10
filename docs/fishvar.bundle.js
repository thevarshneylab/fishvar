/*!
 * fishvar browser bundle -- GENERATED, do not edit.
 *
 * Built from lib/ by tools/bundle.js. Edit lib/ and run `npm run bundle`.
 * Source stamp: 2fced605b036f786
 */
(function (root) {
"use strict";

var __modules = {};
var __cache = {};
var __builtins = ["fs","path","crypto","url"];

function require(name) {
  var key = String(name).replace(/^\.\//, '').replace(/\.js$/, '');
  /* The lib modules wrap built-in requires in try/catch and treat a
     throw as 'running in a browser'. Throwing is therefore the correct
     answer here, not returning null. */
  if (__builtins.indexOf(key) >= 0) {
    throw new Error('node built-in "' + key + '" is not available in the browser');
  }
  if (__cache[key]) return __cache[key].exports;
  var factory = __modules[key];
  if (!factory) throw new Error('module not in bundle: ' + name);
  var mod = __cache[key] = { exports: {} };
  factory(mod, mod.exports, require);
  return mod.exports;
}

__modules["http"] = function (module, exports, require) {
/*!
 * JSON fetch with caching, per-host rate limiting and retry.
 *
 * Runs in Node and in the browser from the same source. In Node, responses are
 * written to a cache directory, which is not an optimization but a
 * reproducibility feature: a design that went into an injection needs to be
 * re-derivable months later, after an Ensembl release has moved, which is what
 * --cache-only does. In the browser there is no filesystem, so the cache is an
 * in-memory map that lasts for the page session -- enough to stop a rerun of
 * the same variant from hitting the APIs again.
 */
"use strict";

/* Node built-ins, absent in the browser bundle. */
var fs = null, path = null, crypto = null;
try { fs = require("fs"); path = require("path"); crypto = require("crypto"); } catch (e) { /* browser */ }

var hasDisk = !!(fs && path && crypto && fs.existsSync);
var memory = new Map();

/* Published limits: Ensembl REST allows 15 requests/s, NCBI E-utilities 3/s
   without an API key and 10/s with one. Staying under them is the difference
   between a tool that works in batch and one that gets the lab's IP blocked. */
var RATE = {
  "rest.ensembl.org": 12,
  "eutils.ncbi.nlm.nih.gov": 3
};

var lastCall = new Map();

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function throttle(host) {
  var perSec = RATE[host] || 5;
  var minGap = Math.ceil(1000 / perSec);
  var prev = lastCall.get(host) || 0;
  var wait = prev + minGap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
}

function cachePath(dir, url) {
  if (!hasDisk) return null;
  var hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  /* A readable prefix makes a stale cache entry easy to find by eye. */
  var slug = url.replace(/^https?:\/\//, "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60);
  return path.join(dir, slug + "-" + hash + ".json");
}

/**
 * @param {string} url
 * @param {object} opts {cacheDir, cacheOnly, retries, label}
 * @returns {Promise<object>} parsed JSON
 */
async function getJson(url, opts) {
  var o = opts || {};
  var file = (o.cacheDir && hasDisk) ? cachePath(o.cacheDir, url) : null;

  if (file && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  if (!file && memory.has(url)) {
    return memory.get(url);
  }
  if (o.cacheOnly) {
    throw new Error(
      "cache miss in --cache-only mode for " + (o.label || url) +
      (file ? "\n  expected cache file: " + file : "")
    );
  }

  var host = new URL(url).host;
  var retries = o.retries === undefined ? 3 : o.retries;
  var lastErr;

  for (var attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    /* Live lookups take a few seconds across several hosts, so a caller with a
       user watching can report what is in flight. */
    if (typeof o.onFetch === "function") {
      try { o.onFetch(o.label || url, { host: host, attempt: attempt }); } catch (e) { /* never fail a fetch over reporting */ }
    }
    try {
      var res = await fetch(url, { headers: { Accept: "application/json" } });

      /* Ensembl answers 429 with Retry-After when a client outruns the limit. */
      if (res.status === 429) {
        var after = Number(res.headers.get("Retry-After") || 1);
        await sleep((after + 0.5) * 1000);
        continue;
      }
      if (res.status >= 500) throw new Error("HTTP " + res.status + " from " + host);
      if (!res.ok) {
        var body = await res.text();
        var err = new Error("HTTP " + res.status + " for " + url + "\n  " + body.slice(0, 300));
        err.status = res.status;
        throw err;   // 4xx is our fault; retrying will not help
      }

      var data = await res.json();
      if (file) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 1));
      } else {
        memory.set(url, data);
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status >= 400 && e.status < 500) throw e;

      /* A browser reports a blocked cross-origin request as an opaque
         TypeError with no status, indistinguishable from the host being down.
         Retrying cannot fix a missing CORS header, so say what it might be
         rather than burning three attempts on it. */
      if (!hasDisk && e instanceof TypeError) {
        var blocked = new Error(
          "could not reach " + host + " from the browser. The request was blocked " +
          "before any response was read, which usually means the host does not send " +
          "cross-origin headers, or the network refused the request."
        );
        blocked.corsSuspected = true;
        blocked.host = host;
        throw blocked;
      }
      if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

/** Drop the in-memory cache. Browser only; the disk cache is managed by the CLI. */
function clearMemoryCache() { memory.clear(); }

module.exports = {
  getJson: getJson,
  cachePath: cachePath,
  clearMemoryCache: clearMemoryCache,
  hasDisk: hasDisk
};

};

__modules["palette"] = function (module, exports, require) {
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

};

__modules["clinvar"] = function (module, exports, require) {
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
 * Parse an HGVS protein change.
 *
 * Handles substitutions (p.Arg403Gln, p.(Arg403Gln), p.R403Q), frameshifts in
 * both the short and the full HGVS forms (p.Arg403fs, p.Arg403ValfsTer12,
 * p.Arg403Valfs*12) and start loss (p.Met1?).
 *
 * @returns {{wt, position, mut, kind, raw}|null} `kind` is set only where the
 *   notation itself names the lesion type; otherwise the residues decide.
 */
function parseProteinChange(text) {
  if (!text) return null;
  var s = String(text).trim().replace(/^p\.?/i, "").replace(/^\(|\)$/g, "");

  /* Start loss: the residue is unknown rather than substituted. */
  var startLoss = s.match(/^(Met|M)(\d+)\?$/i);
  if (startLoss) {
    return {
      wt: "M", position: Number(startLoss[2]), mut: null,
      kind: "start-loss", raw: text
    };
  }

  /* Frameshift. The residue that follows `fs` is the first changed one and the
     Ter count is where the shifted frame stops; neither changes the truncation
     point, which is what matters for placing a PTC. */
  var fs = s.match(/^([A-Za-z]{3}|[A-Z])(\d+)(?:[A-Za-z]{3}|[A-Z])?fs(?:Ter\d+|\*\d+|\*\?)?$/);
  if (fs) {
    var fsWt = fs[1].length === 3 ? aa1(fs[1]) : fs[1];
    if (fsWt) {
      return {
        wt: fsWt, position: Number(fs[2]), mut: null,
        kind: "frameshift", raw: text
      };
    }
  }

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

/* Lesions modelled by installing a premature stop in the orthologue rather
   than by substituting the orthologous residue. */
var TRUNCATING = { nonsense: true, frameshift: true, "start-loss": true };

/**
 * Classify a parsed change.
 *
 * Stop-loss is deliberately NOT truncating: read-through extends the protein
 * instead of shortening it, so a premature stop models the opposite lesion.
 */
function classify(change) {
  if (!change) return "unparsed";
  if (change.kind) return change.kind;
  if (change.mut === "*") return "nonsense";
  if (change.wt === change.mut) return "synonymous";
  if (change.wt === "*") return "stop-loss";
  if (change.position === 1 && change.wt === "M") return "start-loss";
  return "missense";
}

function isTruncating(consequence) {
  return !!TRUNCATING[consequence];
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
  TRUNCATING: TRUNCATING,
  isTruncating: isTruncating,
  parseProteinChange: parseProteinChange,
  classify: classify,
  fetchVariant: fetchVariant,
  parseDirect: parseDirect
};

};

__modules["ensembl"] = function (module, exports, require) {
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

};

__modules["ortholog"] = function (module, exports, require) {
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

};

__modules["ptc"] = function (module, exports, require) {
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

};

__modules["format"] = function (module, exports, require) {
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
    /* The two paths count different things: the missense path needs the
       residue conserved, the stop path only needs the position located. */
    L.push("Orthologues examined: " + r.orthologSummary.examined +
      (r.strategyType === "premature_stop"
        ? ", truncation point located in " + r.orthologSummary.located
        : ", residue conserved in " + r.orthologSummary.conserved) +
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

  if (r.strategyType === "premature_stop") {
    (r.strategies || []).forEach(function (s) { formatPtcStrategy(L, s, topN); });
    L.push("");
    if (r.umaxCommit) L.push("engine: umax-guide-designer @ " + r.umaxCommit.slice(0, 10));
    L.push("");
    return L.join("\n");
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

var NMD_LABEL = {
  competent: "NMD competent",
  uncertain: "NMD uncertain",
  escapes: "NMD ESCAPE",
  unknown: "NMD unknown"
};

function formatPtcStrategy(L, s, topN) {
  L.push("");
  L.push("-".repeat(78));
  L.push(s.zebrafishGene + "   " + (s.zebrafishTranscript || ""));

  if (s.status !== "designed" && s.status !== "no_guides") {
    L.push("  " + s.status + ": " + wrap(s.reason || "", 70, "    "));
    return;
  }

  L.push("  truncation point maps to " + (s.zebrafishAa || "") + s.zebrafishResidue +
    " of " + s.proteinLength + " aa" +
    (s.approximatePosition
      ? "  (approximate: nearest aligned residue, shifted " + s.shiftedBy + " columns)"
      : "") +
    (s.residueConserved ? "" : "  (residue not conserved, which does not matter for a stop)"));
  L.push("  " + s.exonCount + " exons, " + s.cdsLength + " nt CDS" +
    "   identity " + Math.round(s.percentIdentity || 0) + "% global");

  if (s.scan) {
    var v = s.scan.byNmdVerdict || {};
    L.push("  " + s.scan.total + " stop-able codons: " +
      Object.keys(v).map(function (k) { return v[k] + " " + k; }).join(", ") +
      "   codons used: " + Object.keys(s.scan.byCodon || {}).sort().join(", "));
  }
  if (s.reason) L.push("  " + wrap(s.reason, 70, "    "));

  s.candidates.forEach(function (c) {
    L.push("");
    L.push("  " + (c.wtAa || "") + c.residue + " " + c.wtCodon + " > " + c.stopCodon +
      "   (" + c.change + " at codon position " + c.codonPosition + ")   " +
      c.family + " on the " + c.strand + " strand");
    L.push("    " + c.locus +
      "   exon " + c.nmd.exonNumber + "/" + c.nmd.exonCount +
      "   " + Math.round(100 * c.fractionOfCds) + "% through the CDS" +
      (c.distanceFromLesion === null ? "" :
        "   " + (c.distanceFromLesion === 0 ? "at the lesion"
          : Math.abs(c.distanceFromLesion) + " residues " +
            (c.distanceFromLesion < 0 ? "before" : "after") + " the lesion")));

    var label = NMD_LABEL[c.nmd.verdict] || c.nmd.verdict;
    if (c.nmd.distanceToLastJunction !== null && c.nmd.distanceToLastJunction !== undefined) {
      label += "  (" + c.nmd.distanceToLastJunction +
        " nt from the last exon-exon junction)";
    }
    L.push("    " + label);
    (c.nmd.escapes || []).forEach(function (e) {
      L.push("      ! " + wrap(e.detail, 64, "        "));
    });

    if (c.status !== "designed") {
      L.push("    " + c.status + ": " + wrap(c.reason || "", 66, "      "));
      return;
    }

    (c.designs || []).forEach(function (d) {
      if (d.mixedProducts) {
        L.push("    this chemistry makes a mixture at the edited base; the stop is one outcome");
      }
      L.push("    " + pad("score", 7) + pad("editor", 22) + pad("str", 5) +
        pad("spacer (5'->3')", 23) + pad("PAM", 6) + pad("pos", 5) + "bystanders");
      L.push("    " + "-".repeat(70));
      d.guides.slice(0, topN).forEach(function (g) {
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
      if (d.guides.length > topN) {
        L.push("    ... " + (d.guides.length - topN) + " more (use --top or --format json)");
      }
    });
  });

  if (s.notEvaluated) {
    L.push("");
    L.push("  " + s.notEvaluated + " further stop-able codons were ranked but not designed " +
      "(raise --ptc-top to include them)");
  }
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
  "consequence", "strategy", "status", "zebrafish_gene", "zebrafish_transcript",
  "orthology_type", "percent_identity", "local_identity", "zebrafish_residue",
  "zebrafish_codon", "zebrafish_change", "required_base_change", "codon_position",
  "stop_codon", "nmd_verdict", "nmd_escapes", "distance_from_lesion",
  "fraction_of_cds", "exon_number", "exon_count",
  "editor", "family", "cas", "pam", "strand", "spacer", "position_in_window",
  "in_peak", "score", "bystander_count", "bystander_effects",
  "crosses_exon_boundary", "product_kind", "locus", "flags", "reason"
];

function guideFlags(g) {
  var flags = [];
  if (g.derived) flags.push("predicted-pairing");
  if (g.untestedWithUmax) flags.push("backbone-untested");
  if (g.unpublished) flags.push("unpublished-editor");
  if (g.hasPolyT) flags.push("polyT");
  if (!g.inPeak) flags.push("window-edge");
  if (g.crossesExonBoundary) flags.push("exon-junction");
  return flags.join("; ");
}

/** One row per guide for the premature-stop path. */
function ptcCsvRows(r, common, topN) {
  var rows = [];
  (r.strategies || []).forEach(function (s) {
    if (s.status !== "designed" && s.status !== "no_guides") {
      rows.push(Object.assign({}, common, {
        zebrafish_gene: s.zebrafishGene,
        zebrafish_transcript: s.zebrafishTranscript,
        reason: s.reason || null
      }));
      return;
    }
    s.candidates.forEach(function (c) {
      var shared = Object.assign({}, common, {
        zebrafish_gene: s.zebrafishGene,
        zebrafish_transcript: s.zebrafishTranscript,
        orthology_type: s.orthologyType,
        percent_identity: s.percentIdentity,
        local_identity: s.localIdentity,
        zebrafish_residue: (c.wtAa || "") + c.residue,
        zebrafish_codon: c.wtCodon,
        zebrafish_change: (c.wtAa || "") + c.residue + "*",
        required_base_change: c.change,
        codon_position: c.codonPosition,
        stop_codon: c.stopCodon,
        nmd_verdict: c.nmd.verdict,
        nmd_escapes: (c.nmd.escapes || []).map(function (e) { return e.rule; }).join("; "),
        distance_from_lesion: c.distanceFromLesion,
        fraction_of_cds: c.fractionOfCds,
        exon_number: c.nmd.exonNumber,
        exon_count: c.nmd.exonCount,
        locus: c.locus
      });

      if (c.status !== "designed") {
        rows.push(Object.assign({}, shared, { reason: c.reason || null }));
        return;
      }
      (c.designs || []).forEach(function (d) {
        d.guides.slice(0, topN).forEach(function (g) {
          rows.push(Object.assign({}, shared, {
            editor: g.editor, family: g.family, cas: g.cas, pam: g.pam,
            strand: g.strand, spacer: g.spacer,
            position_in_window: g.positionInWindow, in_peak: g.inPeak,
            score: g.score, bystander_count: g.bystanderCount,
            bystander_effects: g.bystanderEffects.map(function (b) { return b.description; }).join("; "),
            crosses_exon_boundary: g.crossesExonBoundary,
            product_kind: d.productKind,
            flags: guideFlags(g)
          }));
        });
      });
    });
  });
  return rows;
}

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
    strategy: r.strategyType || (r.variant.consequence === "missense" ? "orthologous_substitution" : null),
    status: r.status
  };

  if (r.strategyType === "premature_stop") {
    var ptcRows = ptcCsvRows(r, common, topN);
    return ptcRows.length ? ptcRows : [Object.assign({}, common, { reason: r.reason || null })];
  }

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
          flags: guideFlags(g)
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

};

__modules["pipeline"] = function (module, exports, require) {
/*!
 * ClinVar missense variant -> zebrafish orthologous codon -> Umax guide.
 *
 * Guide finding, scoring and protein-consequence calling are NOT reimplemented
 * here. They are called out to the vendored umax-guide-designer engine, so
 * there is exactly one implementation of the ranking heuristic and the two
 * tools cannot drift apart.
 */
"use strict";

/* Node built-ins, absent in the browser bundle. */
var path = null, fs = null;
try { path = require("path"); fs = require("fs"); } catch (e) { /* browser */ }

var ensembl = require("./ensembl.js");
var clinvar = require("./clinvar.js");
var ortholog = require("./ortholog.js");
var palette = require("./palette.js");
var ptc = require("./ptc.js");

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

/**
 * Resolve the guide engine.
 *
 * In Node it is read from disk. In the browser there is no filesystem, so the
 * caller passes the already-loaded engine in `opts.engine` -- umax.js is a UMD
 * module that puts itself on the global, and editors.json is fetched. Either
 * way the registry is validated with the engine's own validateEditors, so a
 * malformed one fails immediately instead of producing quiet nonsense.
 */
function loadEngine(umaxPath, injected) {
  var UMAX, editorsData;

  if (injected && injected.UMAX && injected.editorsData) {
    UMAX = injected.UMAX;
    editorsData = injected.editorsData;
  } else if (fs && path) {
    var dir = umaxPath || path.join(__dirname, "..", "vendor");
    var enginePath = path.join(dir, "umax.js");
    var editorsPath = path.join(dir, "editors.json");
    if (!fs.existsSync(enginePath) || !fs.existsSync(editorsPath)) {
      throw new Error(
        "could not find umax.js and editors.json in " + dir +
        "\n  point --umax-path at a checkout of thevarshneylab/umax-guide-designer"
      );
    }
    UMAX = require(enginePath);
    editorsData = JSON.parse(fs.readFileSync(editorsPath, "utf8"));
  } else {
    throw new Error("no guide engine available: pass opts.engine = {UMAX, editorsData}");
  }

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
  var engine = loadEngine(o.umaxPath, o.engine);
  var UMAX = engine.UMAX;
  var pal = palette.buildPalette(UMAX.FAMILY);

  var variant = clinvar.parseDirect(variantSpec);
  if (!variant) variant = await clinvar.fetchVariant(variantSpec, o);

  var out = {
    query: variantSpec,
    variant: variant,
    umaxCommit: readCommit(o.umaxPath, o.engine),
    strategies: [],
    candidates: [],
    warnings: []
  };

  var truncating = clinvar.isTruncating(variant.consequence);

  if (variant.consequence !== "missense" && !truncating) {
    out.status = "unsupported_consequence";
    out.reason = variant.consequence === "stop-loss"
      ? "this is a stop-loss variant: read-through extends the protein rather than shortening it, " +
        "so neither an orthologous substitution nor a premature stop models the same lesion"
      : "fishvar handles missense SNVs and truncating variants (nonsense, frameshift, start loss); " +
        "this variant classifies as " + variant.consequence;
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

  if (truncating) return runPtc(out, engine, pal, variant, homologies, o);

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

/* ------------------------------------------------------------------ *
 * Truncating variants: premature stop in the orthologue
 * ------------------------------------------------------------------ */

/** Exon boundaries inside a fetched window, as local offsets. Local arithmetic
    only -- the transcript model already holds the exon structure. */
function boundariesInWindow(model, winLo, winHi) {
  var out = [];
  model.exonSpans.forEach(function (e) {
    [e.start, e.end].forEach(function (pos) {
      if (pos < winLo || pos > winHi) return;
      out.push(model.strand === 1 ? pos - winLo : winHi - pos);
    });
  });
  return [...new Set(out)]
    .filter(function (p) { return p > 0 && p < (winHi - winLo); })
    .sort(function (a, b) { return a - b; });
}

/** Fetch the genomic window for one PTC candidate and design guides on it. */
async function designPtc(engine, model, candidate, mapping, opts) {
  var UMAX = engine.UMAX;
  var editors = UMAX.expandEditors(engine.editorsData, {
    includeUntested: !!opts.includeUntested
  });
  var untestedCas = {};
  (engine.editorsData.casVariants || []).forEach(function (c) {
    if (c.untestedWithUmax) untestedCas[c.id] = true;
  });

  var a = model.genomicOfCds(candidate.cdsOffset);
  var b = model.genomicOfCds(candidate.cdsOffset + 2);
  if (a === null || b === null) return { error: "codon falls outside the mapped coding blocks" };
  var lo = Math.min(a, b), hi = Math.max(a, b);

  var winLo = lo - FLANK, winHi = hi + FLANK;
  var region = model.chrom + ":" + winLo + "-" + winHi;
  var seq = await ensembl.regionSequence(region, model.strand, opts);
  if (!seq || seq.length !== (winHi - winLo + 1)) {
    return { error: "unexpected sequence length for " + region };
  }
  seq = seq.toUpperCase();

  if (seq.substr(FLANK, 3) !== candidate.wtCodon) {
    /* The CDS said one codon and the assembly says another. Refuse rather than
       design on whichever happens to be wrong. */
    return {
      error: "genomic codon " + seq.substr(FLANK, 3) + " at " + region +
        " disagrees with the CDS codon " + candidate.wtCodon + " for residue " + candidate.residue
    };
  }

  var boundaries = boundariesInWindow(model, winLo, winHi);
  var targetIndex = FLANK + candidate.codonPosition - 1;
  var frame = 0;
  var localTargetCodon = Math.floor(targetIndex / 3) + 1;

  var designs = [];
  candidate.routes.forEach(function (route) {
    var engineStrand = UMAX.guideStrandFor(seq.charAt(targetIndex), route.family);
    if (engineStrand !== route.strand) {
      throw new Error("internal inconsistency: palette says " + route.strand +
        " for " + candidate.change + " via " + route.family + ", engine says " + engineStrand);
    }

    var guides = UMAX.design(seq, targetIndex, route.family, editors, frame);
    var annotated = guides.map(function (g) {
      var senseLo, senseHi;
      if (g.strand === "+") {
        senseLo = g.start;
        senseHi = g.start + UMAX.SPACER_LENGTH + g.editor.pam.length - 1;
      } else {
        senseHi = seq.length - 1 - g.start;
        senseLo = senseHi - (UMAX.SPACER_LENGTH + g.editor.pam.length - 1);
      }
      var crosses = boundaries.filter(function (p) { return p >= senseLo && p <= senseHi; });

      var bystanderEffects = UMAX.codonEffects(
        seq, frame, route.family, g.strand, g.bystanderIndices
      ) || [];

      return {
        editor: g.editor.id,
        family: g.editor.family,
        cas: g.editor.cas,
        derived: !!g.editor.derived,
        untestedWithUmax: !!g.editor.untestedWithUmax || !!untestedCas[g.editor.cas],
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
        bystanderCount: g.bystanders.length,
        bystanderEffects: bystanderEffects.map(function (c) {
          var residue = candidate.residue + (c.codon - localTargetCodon);
          return {
            residue: residue, from: c.from, to: c.to, silent: c.silent,
            description: describeAt(c, residue)
          };
        }),
        crossesExonBoundary: crosses.length > 0,
        note: crosses.length
          ? "protospacer reaches an exon junction; bystander consequences assume a continuous reading frame and are unreliable here"
          : null
      };
    });

    designs.push({
      family: route.family,
      strand: route.strand,
      productKind: route.kind,
      productNote: route.note || null,
      mixedProducts: !!UMAX.FAMILY[route.family].mixedProducts,
      guides: annotated
    });
  });

  return {
    region: region,
    contextSequence: seq,
    contextCodonOffset: FLANK,
    designs: designs
  };
}

/**
 * Build the PTC strategy for one orthologue.
 *
 * The scan is ordered before any genomic sequence is fetched, because NMD
 * competence and distance from the lesion are computable from the CDS and the
 * exon structure alone. Only the top candidates then cost a request each,
 * which keeps a batch run bounded no matter how many stop-able codons a long
 * gene contains.
 */
async function ptcStrategyFor(engine, pal, mapping, variant, opts) {
  var UMAX = engine.UMAX;
  var strategy = {
    zebrafishGene: mapping.zebrafishGene,
    zebrafishProtein: mapping.zebrafishProtein,
    zebrafishResidue: mapping.zebrafishResidue,
    orthologyType: mapping.orthologyType,
    percentIdentity: mapping.percentIdentity,
    localIdentity: Math.round(mapping.localIdentity * 100) / 100,
    approximatePosition: !!mapping.approximate,
    shiftedBy: mapping.shiftedBy || 0,
    residueConserved: !!mapping.conserved,
    candidates: []
  };

  var tx = await ensembl.lookup(mapping.zebrafishProtein, opts);
  var transcriptId = tx && tx.Parent;
  if (!transcriptId) {
    strategy.status = "no_transcript";
    strategy.reason = "could not resolve a transcript for " + mapping.zebrafishProtein;
    return strategy;
  }
  strategy.zebrafishTranscript = transcriptId;

  var proteinLength = mapping.zebrafishProteinLength;
  var cds = await ensembl.cdsSequence(transcriptId, opts);
  var blocks = await ensembl.mapTranslationRange(
    mapping.zebrafishProtein, 1, proteinLength, opts);
  var exons = await ensembl.exons(transcriptId, opts);

  if (!cds || cds.length % 3 !== 0) {
    strategy.status = "bad_cds";
    strategy.reason = "CDS for " + transcriptId + " is " +
      (cds ? cds.length + " nt, not a multiple of 3" : "unavailable");
    return strategy;
  }

  var model = ptc.buildTranscriptModel(blocks, exons);
  if (model.error) {
    strategy.status = "no_structure";
    strategy.reason = model.error;
    return strategy;
  }

  /* Ensembl's CDS usually carries the terminal stop codon while the
     translation map does not, so the two differ by exactly one codon.
     Anything else means they describe different things and the scan would be
     out of frame against the genome. */
  var expected = 3 * proteinLength;
  if (model.cdsLength !== expected) {
    strategy.status = "structure_mismatch";
    strategy.reason = "coding blocks total " + model.cdsLength + " nt but the protein is " +
      proteinLength + " aa (" + expected + " nt expected); the alignment, the translation " +
      "and the assembly disagree";
    return strategy;
  }
  if (cds.length !== expected && cds.length !== expected + 3) {
    strategy.status = "structure_mismatch";
    strategy.reason = "CDS is " + cds.length + " nt but the protein is " + proteinLength +
      " aa, so the two do not describe the same coding region";
    return strategy;
  }

  var coding = cds.substr(0, expected).toUpperCase();
  strategy.exonCount = model.exonCount;
  strategy.cdsLength = expected;
  strategy.proteinLength = proteinLength;

  var candidates = ptc.scanCds(coding, model, UMAX.CODONS, pal, {
    targetResidue: mapping.zebrafishResidue,
    thresholds: opts.nmdThresholds
  });
  strategy.scan = ptc.summarize(candidates);

  if (!candidates.length) {
    strategy.status = "no_ptc_codon";
    strategy.reason = "no codon in this coding sequence can be turned into a stop by any " +
      "Umax editor (the reachable set is " +
      [...ptc.stopRoutes(UMAX.CODONS, pal).keys()].sort().join(", ") + ")";
    return strategy;
  }

  var top = candidates.slice(0, opts.ptcTop || 12);
  for (var c of top) {
    var design = await designPtc(engine, model, c, mapping, opts);
    var entry = {
      residue: c.residue,
      wtAa: c.wtAa,
      wtCodon: c.wtCodon,
      stopCodon: c.stopCodon,
      change: c.change,
      codonPosition: c.codonPosition,
      family: c.family,
      strand: c.strand,
      productKind: c.productKind,
      locus: model.chrom + ":" + c.genomic + " (" + (model.strand === 1 ? "+" : "-") + ")",
      fractionOfCds: c.fractionOfCds,
      distanceFromLesion: c.distanceFromTarget,
      nmd: c.nmd
    };
    if (design.error) {
      entry.status = "no_context";
      entry.reason = design.error;
    } else {
      entry.status = "designed";
      entry.contextSequence = design.contextSequence;
      entry.contextCodonOffset = design.contextCodonOffset;
      entry.designs = design.designs;
      entry.guideCount = design.designs.reduce(function (n, d) { return n + d.guides.length; }, 0);
      if (!entry.guideCount) {
        entry.status = "no_guides";
        entry.reason = "no editor window and compatible PAM could be placed over this base";
      }
    }
    strategy.candidates.push(entry);
  }

  strategy.notEvaluated = Math.max(0, candidates.length - top.length);
  var designed = strategy.candidates.filter(function (c) { return c.status === "designed"; });
  strategy.status = designed.length ? "designed" : "no_guides";
  if (!designed.length) {
    strategy.reason = "stop-able codons exist, but none of the top " + top.length +
      " could be given a guide";
  }
  return strategy;
}

async function runPtc(out, engine, pal, variant, homologies, opts) {
  out.strategyType = "premature_stop";

  var mapped = ortholog.mapAllForTruncation(homologies, variant.change);
  out.orthologSummary = {
    examined: mapped.candidates.length,
    located: mapped.located.length,
    duplicated: mapped.duplicated
  };
  if (mapped.redundancyWarning) out.warnings.push(mapped.redundancyWarning);

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
      approximate: !!c.approximate,
      localIdentity: c.localIdentity != null ? Math.round(c.localIdentity * 100) / 100 : null
    };
  });

  if (!mapped.located.length) {
    var statuses = new Set(mapped.candidates.map(function (c) { return c.status; }));
    if (statuses.size === 1 && statuses.has("isoform_mismatch")) {
      out.status = "isoform_mismatch";
      out.reason = "the residue ClinVar reports does not match the Ensembl human protein in any " +
        "orthologue pair, so the two are numbered against different isoforms";
    } else {
      out.status = "not_modelable";
      out.reason = "the truncation point could not be located in any zebrafish orthologue";
    }
    return out;
  }

  var limit = opts.maxParalogs || 4;
  for (var mapping of mapped.located.slice(0, limit)) {
    out.strategies.push(await ptcStrategyFor(engine, pal, mapping, variant, opts));
  }

  var ok = out.strategies.filter(function (s) { return s.status === "designed"; });
  out.status = ok.length ? "ok" : "no_design";
  return out;
}

function readCommit(umaxPath, injected) {
  if (injected && injected.commit) return injected.commit;
  if (!fs || !path) return null;
  try {
    var dir = umaxPath || path.join(__dirname, "..", "vendor");
    return fs.readFileSync(path.join(dir, "UMAX_COMMIT"), "utf8").trim();
  } catch (e) {
    return null;
  }
}

module.exports = { run: run, loadEngine: loadEngine, FLANK: FLANK };

};

root.FISHVAR = {
  stamp: "2fced605b036f786",
  http: require("http"),
  palette: require("palette"),
  clinvar: require("clinvar"),
  ensembl: require("ensembl"),
  ortholog: require("ortholog"),
  ptc: require("ptc"),
  format: require("format"),
  pipeline: require("pipeline"),
};
})(typeof self !== 'undefined' ? self : this);
