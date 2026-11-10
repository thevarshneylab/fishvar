/*!
 * Umax Guide Designer — sgRNA design for zebrafish ABE-Umax and TCBE-Umax base editors.
 * https://github.com/thevarshneylab/umax-guide-designer
 *
 * Runs in the browser (loaded by index.html) and in Node (required by test.js).
 * All editor parameters live in editors.json; nothing editor-specific is hard-coded here.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.UMAX = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Constants
   * ------------------------------------------------------------------ */

  var IUPAC = {
    A: "A", C: "C", G: "G", T: "T",
    R: "AG", Y: "CT", S: "CG", W: "AT", K: "GT", M: "AC",
    B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT"
  };

  var CODONS = {
    TTT:"F",TTC:"F",TTA:"L",TTG:"L",CTT:"L",CTC:"L",CTA:"L",CTG:"L",
    ATT:"I",ATC:"I",ATA:"I",ATG:"M",GTT:"V",GTC:"V",GTA:"V",GTG:"V",
    TCT:"S",TCC:"S",TCA:"S",TCG:"S",CCT:"P",CCC:"P",CCA:"P",CCG:"P",
    ACT:"T",ACC:"T",ACA:"T",ACG:"T",GCT:"A",GCC:"A",GCA:"A",GCG:"A",
    TAT:"Y",TAC:"Y",TAA:"*",TAG:"*",CAT:"H",CAC:"H",CAA:"Q",CAG:"Q",
    AAT:"N",AAC:"N",AAA:"K",AAG:"K",GAT:"D",GAC:"D",GAA:"E",GAG:"E",
    TGT:"C",TGC:"C",TGA:"*",TGG:"W",CGT:"R",CGC:"R",CGA:"R",CGG:"R",
    AGT:"S",AGC:"S",AGA:"R",AGG:"R",GGT:"G",GGC:"G",GGA:"G",GGG:"G"
  };

  var AA3 = {
    A:"Ala",R:"Arg",N:"Asn",D:"Asp",C:"Cys",E:"Glu",Q:"Gln",G:"Gly",H:"His",
    I:"Ile",L:"Leu",K:"Lys",M:"Met",F:"Phe",P:"Pro",S:"Ser",T:"Thr",W:"Trp",
    Y:"Tyr",V:"Val","*":"Stop"
  };

  var SPACER_LENGTH = 20;

  /* The base each family deaminates on the protospacer strand, and what it
     becomes. Everything downstream derives from this table.
     `to` is the intended product. `products` lists every outcome the editor
     actually makes at an edited base: transition editors resolve cleanly to
     one, but adenine-transversion editors leave an abasic intermediate that
     cellular repair resolves several ways, so they declare all of them. */
  var FAMILY = {
    ABE: {
      from: "A", to: "G", senseBase: "A", antisenseBase: "T", label: "A→G",
      mixedProducts: false,
      products: [{ base: "G", kind: "intended" }]
    },
    CBE: {
      from: "C", to: "T", senseBase: "C", antisenseBase: "G", label: "C→T",
      mixedProducts: false,
      products: [{ base: "T", kind: "intended" }]
    },
    AYE: {
      from: "A", to: "C", senseBase: "A", antisenseBase: "T", label: "A→Y (C or T)",
      mixedProducts: true,
      products: [
        { base: "C", kind: "intended",  note: "predominant transversion product" },
        { base: "T", kind: "alternate", note: "second transversion product" },
        { base: "G", kind: "byproduct", note: "residual transition from the ABE chemistry" }
      ]
    }
  };

  /* ------------------------------------------------------------------ *
   * Sequence utilities
   * ------------------------------------------------------------------ */

  /** Strip FASTA headers, digits, whitespace and anything that is not a base. */
  function cleanSequence(text) {
    return String(text || "")
      .split("\n")
      .filter(function (line) { return line.charAt(0) !== ">"; })
      .join("")
      .toUpperCase()
      .replace(/[^ACGTN]/g, "");
  }

  function reverseComplement(seq) {
    var map = { A: "T", T: "A", G: "C", C: "G", N: "N" };
    var out = "";
    for (var i = seq.length - 1; i >= 0; i--) out += map[seq.charAt(i)] || "N";
    return out;
  }

  function matchesPam(site, pattern) {
    if (site.length !== pattern.length) return false;
    for (var i = 0; i < pattern.length; i++) {
      var allowed = IUPAC[pattern.charAt(i)];
      if (!allowed || allowed.indexOf(site.charAt(i)) < 0) return false;
    }
    return true;
  }

  /** Classify a 3-nt PAM into the tiers the Umax papers rank by. */
  function pamTier(site) {
    var second = site.charAt(1);
    if (second === "G") return "NGN";
    if (second === "A") return "NAN";
    return "NYN";
  }

  function gcPercent(seq) {
    if (!seq.length) return 0;
    return (seq.match(/[GC]/g) || []).length / seq.length * 100;
  }

  function translate(seq) {
    var out = "";
    for (var i = 0; i + 2 < seq.length; i += 3) out += CODONS[seq.substr(i, 3)] || "X";
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Guide finding
   * ------------------------------------------------------------------ */

  /**
   * Which strand's guide can edit the base at `index`?
   * Base editors deaminate the displaced protospacer strand, so an A or C on
   * the sense strand needs a sense-strand guide, and a T or G needs an
   * antisense one.
   * @returns {"+"|"-"|null}
   */
  function guideStrandFor(base, family) {
    var f = FAMILY[family];
    if (!f) throw new Error("Unknown editor family: " + family);
    if (base === f.senseBase) return "+";
    if (base === f.antisenseBase) return "-";
    return null;
  }

  /**
   * Find every guide that places the base at `target` inside an editing window.
   * @param {string} seq      cleaned sense-strand sequence
   * @param {number} target   0-based index into seq
   * @param {string} family   "ABE" | "CBE"
   * @param {Array}  editors  entries from editors.json
   * @returns {Array} guide objects
   */
  function findGuides(seq, target, family, editors) {
    var base = seq.charAt(target);
    var strand = guideStrandFor(base, family);
    if (!strand) return [];

    var onSense = strand === "+";
    var length = seq.length;
    var work = onSense ? seq : reverseComplement(seq);
    var workTarget = onSense ? target : length - 1 - target;
    var editedBase = FAMILY[family].from;
    var results = [];

    function toSenseIndex(start, positionInSpacer) {
      var idx = start + positionInSpacer - 1;
      return onSense ? idx : length - 1 - idx;
    }

    for (var e = 0; e < editors.length; e++) {
      var ed = editors[e];
      if (ed.family !== family) continue;

      var pamLength = ed.pam.length;
      var winStart = ed.window[0];
      var winEnd = ed.window[1];

      for (var pos = winStart; pos <= winEnd; pos++) {
        var start = workTarget - (pos - 1);
        if (start < 0 || start + SPACER_LENGTH + pamLength > work.length) continue;

        var spacer = work.substr(start, SPACER_LENGTH);
        var pamSite = work.substr(start + SPACER_LENGTH, pamLength);
        if (spacer.indexOf("N") >= 0 || pamSite.indexOf("N") >= 0) continue;
        if (!matchesPam(pamSite, ed.pam)) continue;

        var bystanders = [];
        for (var w = winStart; w <= winEnd; w++) {
          if (w !== pos && spacer.charAt(w - 1) === editedBase) bystanders.push(w);
        }

        results.push({
          editor: ed,
          strand: strand,
          spacer: spacer,
          pam: pamSite,
          pamTier: pamTier(pamSite),
          start: start,
          position: pos,
          inPeak: pos >= ed.peak[0] && pos <= ed.peak[1],
          bystanders: bystanders,
          targetIndex: target,
          bystanderIndices: bystanders.map(function (w) { return toSenseIndex(start, w); }),
          gc: gcPercent(spacer),
          hasPolyT: /TTTT/.test(spacer),
          context: targetContext(spacer, pos),
          contextFavorable: ed.favorableContexts
            ? ed.favorableContexts.indexOf(targetContext(spacer, pos)) >= 0
            : null
        });
      }
    }
    return results;
  }

  /* ------------------------------------------------------------------ *
   * Protein consequence
   * ------------------------------------------------------------------ */

  /**
   * Apply base-editor edits at the given sense-strand indices.
   * @param {string} [productBase] which product to install on the protospacer
   *   strand; defaults to the family's intended product.
   */
  function applyEdits(seq, family, strand, senseIndices, productBase) {
    var f = FAMILY[family];
    var product = productBase || f.to;
    var written = strand === "+" ? product : reverseComplement(product);
    var chars = seq.split("");
    for (var i = 0; i < senseIndices.length; i++) {
      chars[senseIndices[i]] = written;
    }
    return chars.join("");
  }

  /**
   * Codon-level consequences of a set of edits.
   * @param {number} frame  0-based index of the first base of codon 1, or -1 for non-coding
   * @returns {Array|null}  one entry per affected codon
   */
  function codonEffects(seq, frame, family, strand, senseIndices, productBase) {
    if (frame < 0 || !senseIndices.length) return null;
    var edited = applyEdits(seq, family, strand, senseIndices, productBase);
    var seen = {};
    var changes = [];

    for (var i = 0; i < senseIndices.length; i++) {
      var idx = senseIndices[i];
      if (idx < frame) continue;
      var codonNumber = Math.floor((idx - frame) / 3);
      if (seen[codonNumber]) continue;
      seen[codonNumber] = true;

      var startBase = frame + codonNumber * 3;
      if (startBase + 3 > seq.length) continue;

      var before = CODONS[seq.substr(startBase, 3)];
      var after = CODONS[edited.substr(startBase, 3)];
      if (!before || !after) continue;

      changes.push({
        codon: codonNumber + 1,
        from: before,
        to: after,
        fromCodon: seq.substr(startBase, 3),
        toCodon: edited.substr(startBase, 3),
        silent: before === after
      });
    }
    return changes;
  }

  function describeEffect(change) {
    if (change.silent) return change.from + change.codon + "= (silent)";
    if (change.to === "*") return change.from + change.codon + "* (premature stop)";
    if (change.from === "*") return "stop" + change.codon + change.to + " (stop lost)";
    return change.from + change.codon + change.to +
      " (" + AA3[change.from] + "→" + AA3[change.to] + ")";
  }

  /**
   * Every outcome an editor can produce at one edited base, with the protein
   * consequence of each. For a transition editor this is a single row; for an
   * adenine-transversion editor it is the full product spectrum, which is the
   * thing that actually has to be designed around.
   *
   * @returns {Array} [{base, kind, note, effect|null, description}]
   */
  function outcomeSpectrum(seq, frame, family, strand, senseIndex) {
    var f = FAMILY[family];
    if (!f) throw new Error("Unknown editor family: " + family);

    return f.products.map(function (product) {
      var onStrand = strand === "+" ? product.base : reverseComplement(product.base);
      var changes = codonEffects(seq, frame, family, strand, [senseIndex], product.base);
      var effect = changes && changes.length ? changes[0] : null;
      return {
        base: product.base,
        observedBase: onStrand,
        kind: product.kind,
        note: product.note || "",
        effect: effect,
        description: effect ? describeEffect(effect) : null
      };
    });
  }

  /**
   * The trinucleotide around a target base on the protospacer strand, used for
   * the sequence-context preferences that transversion editors show.
   * @returns {string|null} e.g. "CAG", or null when a neighbour falls outside
   *   the spacer (so the context cannot be read from the guide alone)
   */
  function targetContext(spacer, position) {
    if (position < 2 || position > spacer.length - 1) return null;
    return spacer.substr(position - 2, 3);
  }

  /* ------------------------------------------------------------------ *
   * Ranking
   * ------------------------------------------------------------------ *
   * A triage heuristic, not a trained efficiency model. It encodes the
   * published selection strategies: prefer the peak window, prefer NGG,
   * punish bystanders unless the reading frame shows they are silent.
   */

  var WEIGHTS = {
    peakWindow: 30,
    edgeOfWindow: 8,
    nggPam: 20,
    engineeredPam: 15,
    pamPreferenceTop: 12,
    pamPreferenceStep: 4,
    pamUnlisted: 6,
    bystanderInPeak: -12,
    bystanderInWindow: -7,
    bystanderSilent: -2,
    activityScale: 20,
    gcInRange: 5,
    gcOutOfRange: -6,
    polyT: -15,
    leadingG: 2,
    contextFavorable: 10,
    contextUnfavorable: -4
  };

  function scoreGuide(guide, seq, frame, family) {
    var ed = guide.editor;
    var score = guide.inPeak ? WEIGHTS.peakWindow : WEIGHTS.edgeOfWindow;

    if (ed.pam === "NGG") {
      score += WEIGHTS.nggPam;
    } else if (ed.pamPreference) {
      var rank = ed.pamPreference.indexOf(guide.pamTier);
      score += rank < 0
        ? WEIGHTS.pamUnlisted
        : WEIGHTS.pamPreferenceTop - WEIGHTS.pamPreferenceStep * rank;
    } else {
      score += WEIGHTS.engineeredPam;
    }

    var silentCodons = {};
    var bystanderChanges = codonEffects(seq, frame, family, guide.strand, guide.bystanderIndices);
    if (bystanderChanges) {
      bystanderChanges.forEach(function (c) { if (c.silent) silentCodons[c.codon] = true; });
    }

    for (var i = 0; i < guide.bystanders.length; i++) {
      var w = guide.bystanders[i];
      var idx = guide.bystanderIndices[i];
      var codon = frame >= 0 ? Math.floor((idx - frame) / 3) + 1 : null;
      if (codon !== null && silentCodons[codon]) {
        score += WEIGHTS.bystanderSilent;
      } else if (w >= ed.peak[0] && w <= ed.peak[1]) {
        score += WEIGHTS.bystanderInPeak;
      } else {
        score += WEIGHTS.bystanderInWindow;
      }
    }

    /* Local sequence context, where the editor has a published preference. */
    if (ed.favorableContexts && guide.context) {
      score += ed.favorableContexts.indexOf(guide.context) >= 0
        ? WEIGHTS.contextFavorable
        : WEIGHTS.contextUnfavorable;
    }

    /* Narrow-window editors buy precision by giving up on-target activity, so
       they are discounted by that reported activity. They then win only where
       the bystander penalties above say they earn it. */
    var activity = typeof ed.activity === "number" ? ed.activity : 1;
    score += (activity - 1) * WEIGHTS.activityScale;
    if (ed.penalty) score -= ed.penalty;
    score += (guide.gc >= 35 && guide.gc <= 75) ? WEIGHTS.gcInRange : WEIGHTS.gcOutOfRange;
    if (guide.hasPolyT) score += WEIGHTS.polyT;
    if (guide.spacer.charAt(0) === "G") score += WEIGHTS.leadingG;

    return score;
  }

  /** Find, score and rank in one call. */
  function design(seq, target, family, editors, frame) {
    var guides = findGuides(seq, target, family, editors);
    guides.forEach(function (g) { g.score = scoreGuide(g, seq, frame, family); });
    guides.sort(function (a, b) { return b.score - a.score; });
    return guides;
  }

  /**
   * Why a target has no guides, in terms of the sequence the user pasted.
   *
   * A guide's PAM sits 3' of the protospacer on the guide's own strand. For a
   * sense-strand guide that is downstream of the target on the pasted
   * sequence; for an antisense-strand guide it is UPSTREAM. So a target near
   * the 5' end of a short pasted region can be undesignable on the antisense
   * strand purely for lack of room, and the fix is to paste more sequence on
   * the side this reports.
   *
   * @returns {object|null} null when the base is not editable by this family
   */
  function flankReport(seq, target, family, editors) {
    var strand = guideStrandFor(seq.charAt(target), family);
    if (!strand) return null;

    var upstream = target;
    var downstream = seq.length - 1 - target;

    /* On the pasted (sense) sequence, which side does the PAM fall on? */
    var pamSide = strand === "+" ? "downstream" : "upstream";
    var havePam = strand === "+" ? downstream : upstream;
    var haveFar = strand === "+" ? upstream : downstream;

    /* One guide has to satisfy both sides at once, so the two requirements
       cannot be minimized independently — they are checked per (editor,
       position) pair. `extraPamSide` is the smallest number of additional
       bases on the PAM side that would make some placement fit, given the
       room currently available on the far side. */
    var anyFits = false;
    var extraPamSide = Infinity;
    var needFarSide = Infinity;

    for (var i = 0; i < editors.length; i++) {
      var ed = editors[i];
      if (ed.family !== family) continue;
      for (var p = ed.window[0]; p <= ed.window[1]; p++) {
        var farNeeded = p - 1;
        var pamNeeded = SPACER_LENGTH - p + ed.pam.length;
        needFarSide = Math.min(needFarSide, farNeeded);
        if (haveFar < farNeeded) continue;              // no room for the spacer
        if (havePam >= pamNeeded) { anyFits = true; break; }
        extraPamSide = Math.min(extraPamSide, pamNeeded - havePam);
      }
      if (anyFits) break;
    }

    return {
      strand: strand,
      pamSide: pamSide,
      farSide: pamSide === "downstream" ? "upstream" : "downstream",
      upstream: upstream,
      downstream: downstream,
      /* true when no placement can physically fit in the pasted sequence,
         regardless of what the bases are */
      shortOnPamSide: !anyFits && extraPamSide !== Infinity,
      shortOnFarSide: haveFar < needFarSide,
      extraPamSide: extraPamSide === Infinity ? 0 : extraPamSide,
      neededFarSide: needFarSide,
      roomForAnyGuide: anyFits
    };
  }

  /* ------------------------------------------------------------------ *
   * Whole-sequence scan
   * ------------------------------------------------------------------ */

  /** Coarse class of a protein change, for filtering a scan. */
  function effectClass(effect) {
    if (!effect) return "noncoding";
    if (effect.silent) return "silent";
    if (effect.to === "*") return "nonsense";
    if (effect.from === "*") return "stop-lost";
    return "missense";
  }

  /**
   * Design guides for every editable base in a sequence at once.
   *
   * One entry per base the family can act on, carrying its best-scoring guide
   * and the full product spectrum. Bases with no usable guide are reported
   * too (guideCount 0) so a scan shows what is unreachable as well as what is
   * reachable — that absence is usually the more actionable half.
   *
   * @param {object} [options]
   * @param {boolean} [options.reachableOnly=false] drop bases with no guide
   * @returns {{entries: Array, totalGuides: number, reachable: number, editable: number}}
   */
  function scanSequence(seq, family, editors, frame, options) {
    var opts = options || {};
    var f = FAMILY[family];
    if (!f) throw new Error("Unknown editor family: " + family);

    var entries = [];
    var totalGuides = 0;
    var reachable = 0;
    var editable = 0;

    for (var i = 0; i < seq.length; i++) {
      var strand = guideStrandFor(seq.charAt(i), family);
      if (!strand) continue;
      editable++;

      var guides = design(seq, i, family, editors, frame);
      totalGuides += guides.length;
      if (guides.length) reachable++;
      else if (opts.reachableOnly) continue;

      var spectrum = outcomeSpectrum(seq, frame, family, strand, i);
      var intended = spectrum[0];

      entries.push({
        index: i,
        position: i + 1,
        base: seq.charAt(i),
        strand: strand,
        guideCount: guides.length,
        best: guides.length ? guides[0] : null,
        spectrum: spectrum,
        effect: intended.effect,
        effectClass: effectClass(intended.effect),
        /* With mixed products the other outcomes matter as much as the
           intended one, so a scan must be filterable on any of them. */
        effectClasses: spectrum.map(function (o) { return effectClass(o.effect); }),
        mixedProducts: !!f.mixedProducts
      });
    }

    return {
      entries: entries,
      totalGuides: totalGuides,
      reachable: reachable,
      editable: editable
    };
  }

  /**
   * Scan one sequence with several editor families at once.
   *
   * A and T are editable by both the adenine families, C and G only by the
   * cytosine one, so a base can yield more than one entry — the same position
   * reached by different chemistry with a different outcome. Each entry
   * carries its own `family`, and entries are ordered by position so the
   * table reads along the sequence.
   *
   * @param {string[]} families  family keys, e.g. ["ABE", "CBE"]
   * @returns {{entries, totalGuides, reachable, editable, byFamily}}
   */
  function scanFamilies(seq, families, editors, frame, options) {
    var order = {};
    families.forEach(function (fam, i) { order[fam] = i; });

    var entries = [];
    var totalGuides = 0;
    var reachable = 0;
    var editable = 0;
    var byFamily = {};

    families.forEach(function (family) {
      var one = scanSequence(seq, family, editors, frame, options);
      byFamily[family] = {
        editable: one.editable,
        reachable: one.reachable,
        totalGuides: one.totalGuides
      };
      totalGuides += one.totalGuides;
      reachable += one.reachable;
      editable += one.editable;
      one.entries.forEach(function (e) {
        e.family = family;
        entries.push(e);
      });
    });

    entries.sort(function (a, b) {
      return a.index - b.index || order[a.family] - order[b.family];
    });

    return {
      entries: entries,
      totalGuides: totalGuides,
      reachable: reachable,
      editable: editable,
      byFamily: byFamily,
      /* Distinct sequence positions touched, as opposed to rows: a base an
         adenine editor and a transversion editor can both reach counts once
         here and twice in `entries`. */
      positions: Object.keys(entries.reduce(function (acc, e) {
        acc[e.index] = true; return acc;
      }, {})).length
    };
  }

  /* ------------------------------------------------------------------ *
   * Cas9 backbones
   * ------------------------------------------------------------------ *
   * An editor is a deaminase architecture (which fixes the editing window)
   * plus a Cas9 nickase (which fixes the PAM). The published editors pair
   * only some architectures with some backbones; swapping in another Cas9 is
   * a construct a lab can build, and the window is expected to carry over
   * because that is what happened for every published PAM variant. Those
   * pairings are still predictions, so they are derived separately and
   * marked, never mixed silently into the published set.
   */

  /** Strip a trailing Cas9 suffix to get the architecture's base name. */
  function architectureOf(editorId, casIds) {
    for (var i = 0; i < casIds.length; i++) {
      var suffix = "-" + casIds[i];
      if (editorId.length > suffix.length &&
          editorId.slice(-suffix.length) === suffix) {
        return editorId.slice(0, -suffix.length);
      }
    }
    return editorId;
  }

  /**
   * Expand the published editors with Cas9 pairings that have not been built.
   *
   * @param {object} data  parsed editors.json
   * @param {object} [options]
   * @param {boolean} [options.includeUntested=false] add predicted pairings
   * @returns {Array} editor entries; derived ones carry derived:true and
   *   basedOn/casNote, and inherit the parent's window, peak and context
   */
  function expandEditors(data, options) {
    var opts = options || {};
    var published = data.editors || [];
    var variants = data.casVariants || [];
    if (!opts.includeUntested || !variants.length) return published.slice();

    var casIds = variants.map(function (c) { return c.id; });
    var casById = {};
    variants.forEach(function (c) { casById[c.id] = c; });

    /* What already exists, so nothing is duplicated or contradicted. */
    var haveParent = {};
    var seenPairing = {};
    var familyCasPreference = {};
    published.forEach(function (ed) {
      var arch = architectureOf(ed.id, casIds);
      seenPairing[arch + "|" + ed.cas] = true;
      if (ed.cas === "SpCas9") haveParent[arch] = ed;
      if (ed.pamPreference) familyCasPreference[ed.family + "|" + ed.cas] = ed.pamPreference;
    });

    var out = published.slice();
    Object.keys(haveParent).forEach(function (arch) {
      var parent = haveParent[arch];
      variants.forEach(function (cas) {
        if (cas.id === "SpCas9") return;
        if (seenPairing[arch + "|" + cas.id]) return;
        /* A backbone may restrict which architectures it can carry. The
           ex/rest variants rebuild the Cas9 protein itself — deaminase
           inserted at a numbered residue, HNH deleted, Cas9 mutated — so
           they are not a nickase swap and do not exist on every backbone. */
        if (cas.architectures && cas.architectures.indexOf(arch) < 0) return;

        var preference = familyCasPreference[parent.family + "|" + cas.id] || cas.pamPreference;
        var derived = {
          id: arch + "-" + cas.id,
          family: parent.family,
          cas: cas.id,
          pam: cas.pam,
          window: parent.window.slice(),
          peak: parent.peak.slice(),
          precise: !!parent.precise,
          source: parent.source,
          derived: true,
          basedOn: parent.id,
          casNote: cas.note || "",
          unpublished: true,
          use: "Predicted pairing: the " + arch + " architecture on a " + cas.id +
               " nickase (" + cas.pam + " PAM). Not reported, so the window is " +
               "assumed to carry over from " + parent.id + " and the activity is unknown."
        };
        if (preference) derived.pamPreference = preference.slice();
        if (parent.favorableContexts) derived.favorableContexts = parent.favorableContexts.slice();
        if (typeof parent.activity === "number") derived.activity = parent.activity;
        if (parent.penalty) derived.penalty = parent.penalty;
        out.push(derived);
      });
    });
    return out;
  }

  /** Validate editors.json so a bad contribution fails loudly. */
  function validateEditors(data) {
    var problems = [];
    if (!data || !Array.isArray(data.editors)) return ["editors.json has no `editors` array"];

    /* The Cas9 registry, when present, is the single source of truth for
       PAMs: an editor that disagrees with it is a typo in one of the two. */
    var casPam = {};
    if (Array.isArray(data.casVariants)) {
      var casIds = {};
      data.casVariants.forEach(function (c, i) {
        var where = "casVariants " + (c.id || i);
        if (!c.id) problems.push(where + ": missing id");
        if (casIds[c.id]) problems.push(where + ": duplicate id");
        casIds[c.id] = true;
        if (!c.pam || !/^[ACGTRYSWKMBDHVN]+$/.test(c.pam)) problems.push(where + ": invalid pam");
        else casPam[c.id] = c.pam;
        if (c.architectures !== undefined) {
          if (!Array.isArray(c.architectures) || !c.architectures.length) {
            problems.push(where + ": architectures must be a non-empty array");
          } else {
            /* A name that matches no parent editor would silently remove the
               backbone from the results, so it is an error, not a no-op. */
            c.architectures.forEach(function (arch) {
              var exists = (data.editors || []).some(function (e) {
                return e.id === arch && e.cas === "SpCas9";
              });
              if (!exists) {
                problems.push(where + ": architecture \"" + arch +
                  "\" matches no SpCas9 parent editor");
              }
            });
          }
        }
      });
    }

    /* Source keys referenced by editors and backbones must resolve, or a
       citation removed later leaves a dangling reference nothing reports. */
    var sourceKeys = {};
    if (Array.isArray(data.sources)) {
      data.sources.forEach(function (s, i) {
        if (!s.key) problems.push("sources entry " + i + ": missing key");
        else if (sourceKeys[s.key]) problems.push("sources " + s.key + ": duplicate key");
        else sourceKeys[s.key] = true;
        if (!s.citation) problems.push("sources " + (s.key || i) + ": missing citation");
      });
    }
    if (Array.isArray(data.casVariants)) {
      data.casVariants.forEach(function (c) {
        if (c.source && !sourceKeys[c.source]) {
          problems.push("casVariants " + c.id + ": source \"" + c.source +
            "\" is not in sources");
        }
      });
    }

    var ids = {};
    data.editors.forEach(function (ed, i) {
      var where = ed.id || "entry " + i;
      if (!ed.id) problems.push(where + ": missing id");
      if (ids[ed.id]) problems.push(where + ": duplicate id");
      ids[ed.id] = true;
      if (!FAMILY[ed.family]) problems.push(where + ": family must be one of " + Object.keys(FAMILY).join(", "));
      if (!ed.pam || !/^[ACGTRYSWKMBDHVN]+$/.test(ed.pam)) problems.push(where + ": invalid pam");
      ["window", "peak"].forEach(function (k) {
        var r = ed[k];
        if (!Array.isArray(r) || r.length !== 2) { problems.push(where + ": " + k + " must be [start, end]"); return; }
        if (r[0] < 1 || r[1] > SPACER_LENGTH) problems.push(where + ": " + k + " outside 1-" + SPACER_LENGTH);
        if (r[0] > r[1]) problems.push(where + ": " + k + " start is after its end");
      });
      if (Array.isArray(ed.window) && Array.isArray(ed.peak)) {
        if (ed.peak[0] < ed.window[0] || ed.peak[1] > ed.window[1]) {
          problems.push(where + ": peak must sit inside window");
        }
      }
      if (!ed.use) problems.push(where + ": missing `use` note");
      if (ed.source && Object.keys(sourceKeys).length && !sourceKeys[ed.source]) {
        problems.push(where + ": source \"" + ed.source + "\" is not in sources");
      }
      if (casPam[ed.cas] && ed.pam !== casPam[ed.cas]) {
        problems.push(where + ": pam " + ed.pam + " disagrees with the " + ed.cas +
          " registry entry (" + casPam[ed.cas] + ")");
      }
      if (ed.cas && Object.keys(casPam).length && !casPam[ed.cas]) {
        problems.push(where + ": cas \"" + ed.cas + "\" is not in casVariants");
      }
    });
    return problems;
  }

  return {
    SPACER_LENGTH: SPACER_LENGTH,
    FAMILY: FAMILY,
    AA3: AA3,
    CODONS: CODONS,
    WEIGHTS: WEIGHTS,
    cleanSequence: cleanSequence,
    reverseComplement: reverseComplement,
    matchesPam: matchesPam,
    pamTier: pamTier,
    gcPercent: gcPercent,
    translate: translate,
    guideStrandFor: guideStrandFor,
    findGuides: findGuides,
    applyEdits: applyEdits,
    codonEffects: codonEffects,
    outcomeSpectrum: outcomeSpectrum,
    targetContext: targetContext,
    describeEffect: describeEffect,
    scoreGuide: scoreGuide,
    design: design,
    scanSequence: scanSequence,
    scanFamilies: scanFamilies,
    effectClass: effectClass,
    expandEditors: expandEditors,
    architectureOf: architectureOf,
    flankReport: flankReport,
    validateEditors: validateEditors
  };
});
