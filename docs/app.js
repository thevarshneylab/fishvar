/*!
 * fishvar web front end.
 *
 * Rendering only. Every decision -- orthology mapping, which base change is
 * required, NMD classification, guide ranking -- comes from the bundled lib
 * modules, which are the same source the CLI runs. Nothing here reimplements
 * any of it, so the page and the command line cannot disagree.
 */
(function () {
  "use strict";

  var F = self.FISHVAR;
  var UMAX = self.UMAX;

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  };

  var engine = null;      // {UMAX, editorsData, commit}
  var running = false;
  var lastResult = null;

  /* ---------------------------------------------------------------- *
   * Engine
   * ---------------------------------------------------------------- */

  /* editors.json is fetched rather than inlined so the page always reflects
     the registry shipped beside it, the same way the CLI reads vendor/. */
  async function loadEngine() {
    if (engine) return engine;
    if (!UMAX) throw new Error("umax.js did not load; the guide engine is missing");

    var res = await fetch("editors.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("could not load editors.json (HTTP " + res.status + ")");
    var editorsData = await res.json();

    var problems = UMAX.validateEditors(editorsData);
    if (problems.length) {
      throw new Error("editors.json failed validation:\n" + problems.join("\n"));
    }

    var commit = null;
    try {
      var c = await fetch("UMAX_COMMIT", { cache: "no-cache" });
      if (c.ok) commit = (await c.text()).trim();
    } catch (e) { /* provenance is nice to have, not required */ }

    engine = { UMAX: UMAX, editorsData: editorsData, commit: commit };
    return engine;
  }

  /* ---------------------------------------------------------------- *
   * Status
   * ---------------------------------------------------------------- */

  function status(text, spinning) {
    var s = $("status");
    s.textContent = "";
    if (spinning) {
      var sp = el("span", "spin", "●");
      s.appendChild(sp);
      s.appendChild(document.createTextNode(" "));
    }
    s.appendChild(document.createTextNode(text || ""));
  }

  /* ---------------------------------------------------------------- *
   * Rendering helpers
   * ---------------------------------------------------------------- */

  function panel() { return el("section", "panel"); }

  function table(headers) {
    var t = el("table");
    var thead = el("thead");
    var tr = el("tr");
    headers.forEach(function (h) {
      var th = el("th", h.mono ? "mono" : null, h.label !== undefined ? h.label : h);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    t.tbody = el("tbody");
    t.appendChild(t.tbody);
    return t;
  }

  function row(tbody, cells, cls) {
    var tr = el("tr", cls);
    cells.forEach(function (c) {
      var td = el("td", c && c.mono ? "mono" : null);
      if (c && c.node) td.appendChild(c.node);
      else td.textContent = c === null || c === undefined ? "" :
        String(c && c.text !== undefined ? c.text : c);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
    return tr;
  }

  function copyButton(text, label) {
    var b = el("button", "copy", label || "copy");
    b.type = "button";
    b.addEventListener("click", function () {
      navigator.clipboard.writeText(text).then(function () {
        var old = b.textContent;
        b.textContent = "copied";
        setTimeout(function () { b.textContent = old; }, 1200);
      }, function () {
        b.textContent = "failed";
      });
    });
    return b;
  }

  function guideFlags(g) {
    var f = [];
    if (!g.inPeak) f.push("window edge");
    if (g.hasPolyT) f.push("polyT");
    if (g.crossesExonBoundary) f.push("exon junction");
    if (g.derived) f.push("predicted pairing");
    if (g.untestedWithUmax) f.push("backbone untested");
    if (g.unpublished) f.push("unpublished editor");
    return f;
  }

  var GUIDE_HEADERS = [
    "score", "editor", "str",
    { label: "spacer (5'→3')", mono: true },
    { label: "PAM", mono: true },
    "pos", "bystanders"
  ];

  function guideTable(guides, topN) {
    var t = table(GUIDE_HEADERS);
    guides.slice(0, topN).forEach(function (g) {
      var spacerCell = el("span");
      spacerCell.appendChild(el("span", "mono", g.spacer));
      spacerCell.appendChild(copyButton(g.spacer));

      var byst = g.bystanderCount === 0 ? "none"
        : g.bystanderEffects.map(function (b) { return b.description; }).join(", ");

      var tr = row(t.tbody, [
        g.score,
        g.editor,
        g.strand,
        { node: spacerCell },
        { text: g.pam, mono: true },
        g.positionInWindow,
        byst
      ]);

      var flags = guideFlags(g);
      if (flags.length) {
        var fr = el("tr");
        var td = el("td", "flags", "^ " + flags.join("; "));
        td.colSpan = GUIDE_HEADERS.length;
        fr.appendChild(td);
        t.tbody.appendChild(fr);
      }
    });
    return t;
  }

  function contextBlock(seq, offset, len) {
    var d = el("div", "ctx");
    d.appendChild(document.createTextNode(seq.slice(0, offset)));
    d.appendChild(el("b", null, seq.slice(offset, offset + (len || 3))));
    d.appendChild(document.createTextNode(seq.slice(offset + (len || 3))));
    d.appendChild(copyButton(seq, "copy context"));
    return d;
  }

  /* ---------------------------------------------------------------- *
   * Result rendering
   * ---------------------------------------------------------------- */

  var STATUS_BADGE = {
    ok: ["designed", "ok"],
    no_design: ["no guide", "no"],
    not_modelable: ["not modelable", "no"],
    isoform_mismatch: ["numbering mismatch", "warn"],
    unsupported_consequence: ["out of scope", "warn"],
    no_ortholog: ["no orthologue", "no"],
    no_gene: ["no gene", "no"]
  };

  function renderHeader(r) {
    var p = panel();
    var v = el("div", "verdict");
    v.appendChild(el("span", "name", r.variant.name || r.query));

    var badge = STATUS_BADGE[r.status] || [r.status, ""];
    v.appendChild(el("span", "badge " + badge[1], badge[0]));

    if (r.strategyType === "premature_stop") {
      v.appendChild(el("span", "badge", "premature stop"));
    } else if (r.variant.consequence === "missense") {
      v.appendChild(el("span", "badge", "orthologous substitution"));
    }
    p.appendChild(v);

    var bits = [];
    if (r.variant.gene && r.variant.change) {
      bits.push("human " + r.variant.gene + " p." + r.variant.change.wt +
        r.variant.change.position + (r.variant.change.mut || "") +
        " (" + r.variant.consequence + ")");
    }
    if (r.variant.accession) bits.push("ClinVar " + r.variant.accession);
    if (r.variant.classification) bits.push(r.variant.classification);
    if (bits.length) p.appendChild(el("p", "meta", bits.join("  ·  ")));

    if (r.reason) p.appendChild(el("div", "reason", r.reason));
    (r.warnings || []).forEach(function (w) {
      p.appendChild(el("div", "reason", "⚠ " + w));
    });
    return p;
  }

  function renderOrthologs(r) {
    if (!r.candidates || !r.candidates.length) return null;
    var p = panel();
    var counted = r.strategyType === "premature_stop"
      ? "truncation point located in " + r.orthologSummary.located
      : "residue conserved in " + r.orthologSummary.conserved;
    p.appendChild(el("h2", null, "Orthologues"));
    p.appendChild(el("p", "meta",
      r.orthologSummary.examined + " examined, " + counted +
      (r.orthologSummary.duplicated ? "  ·  gene is duplicated in zebrafish" : "")));

    var t = table(["zebrafish gene", "orthology", "%id", "residue", "status"]);
    r.candidates.forEach(function (c) {
      var statusNode = el("span");
      statusNode.appendChild(document.createTextNode(c.status));
      if (c.approximate) statusNode.appendChild(el("span", "flags", " (nearest aligned)"));
      var tr = row(t.tbody, [
        { text: c.zebrafishGene, mono: true },
        (c.orthologyType || "").replace("ortholog_", ""),
        c.percentIdentity != null ? c.percentIdentity.toFixed(1) : "",
        { text: (c.zebrafishAa || "") + (c.zebrafishResidue || ""), mono: true },
        { node: statusNode }
      ], c.status === "conserved" || c.status === "located" ? null : "esc");
      if (c.reason) {
        var rr = el("tr");
        var td = el("td", "flags", c.reason);
        td.colSpan = 5;
        rr.appendChild(td);
        t.tbody.appendChild(rr);
      }
    });
    p.appendChild(t);
    return p;
  }

  /* --- missense --- */

  function renderSubstitution(s, topN) {
    var p = panel();
    var head = el("div", "sub-head", s.zebrafishGene + "  " + (s.locus || ""));
    p.appendChild(head);

    if (s.status !== "designed") {
      p.appendChild(el("div", "reason", (s.reason || s.status)));
      if (s.rescueCodons && s.rescueCodons.length) {
        p.appendChild(el("p", "meta",
          "The change would have been reachable had zebrafish used " +
          s.rescueCodons.join(" or ") + " for " + s.zebrafishAa + "."));
      }
      return p;
    }

    p.appendChild(el("p", "meta",
      "target " + s.zebrafishAa + s.zebrafishResidue + " → " +
      s.targetResidueChange.slice(-1) + "  ·  codon " + s.wtCodon +
      "  ·  " + Math.round(s.percentIdentity || 0) + "% global identity, " +
      Math.round((s.localIdentity || 0) * 100) + "% local" +
      (s.zebrafishTranscript ? "  ·  " + s.zebrafishTranscript : "")));

    s.edits.forEach(function (e) {
      var c = el("div", "cand");
      c.appendChild(el("h4", null,
        e.wtCodon + " → " + e.mutCodon + "   (" + e.change +
        " at codon position " + e.codonPosition + ")"));
      c.appendChild(el("p", "where",
        e.family + " on the " + e.strand + " strand  ·  " + e.productKind + " product"));

      if (e.mixedProducts) {
        var sp = el("div", "spectrum");
        sp.appendChild(document.createTextNode(
          "This chemistry makes a mixture at the edited base: "));
        e.outcomeSpectrum.forEach(function (o, i) {
          if (i) sp.appendChild(document.createTextNode(", "));
          var span = el("span", o.requested ? "req" : null,
            o.base + " → " + (o.residueChange || "?") + " (" + o.kind + ")");
          sp.appendChild(span);
        });
        c.appendChild(sp);
      }

      if (!e.guides.length) {
        c.appendChild(el("div", "reason",
          "No editor window and compatible PAM could be placed over this base."));
      } else {
        c.appendChild(guideTable(e.guides, topN));
        if (e.guides.length > topN) {
          c.appendChild(el("p", "meta",
            (e.guides.length - topN) + " more — raise “Guides shown” or export the CSV."));
        }
      }
      p.appendChild(c);
    });

    p.appendChild(contextBlock(s.contextSequence, s.contextCodonOffset));
    return p;
  }

  /* --- premature stop --- */

  function renderStop(s, topN) {
    var p = panel();
    p.appendChild(el("div", "sub-head",
      s.zebrafishGene + "  " + (s.zebrafishTranscript || "")));

    if (s.status !== "designed" && s.status !== "no_guides") {
      p.appendChild(el("div", "reason", s.reason || s.status));
      return p;
    }

    p.appendChild(el("p", "meta",
      "truncation point maps to " + (s.zebrafishAa || "") + s.zebrafishResidue +
      " of " + s.proteinLength + " aa" +
      (s.approximatePosition ? " (nearest aligned, shifted " + s.shiftedBy + ")" : "") +
      "  ·  " + s.exonCount + " exons, " + s.cdsLength + " nt CDS" +
      "  ·  " + Math.round(s.percentIdentity || 0) + "% global identity"));

    if (s.scan) {
      var v = s.scan.byNmdVerdict || {};
      p.appendChild(el("p", "meta",
        s.scan.total + " stop-able codons — " +
        Object.keys(v).map(function (k) { return v[k] + " " + k; }).join(", ") +
        "  ·  codons: " + Object.keys(s.scan.byCodon || {}).sort().join(", ")));
    }
    if (s.reason) p.appendChild(el("div", "reason", s.reason));

    s.candidates.forEach(function (c) {
      var box = el("div", "cand" + (c.nmd.verdict === "escapes" ? " esc" : ""));
      box.appendChild(el("h4", null,
        (c.wtAa || "") + c.residue + "  " + c.wtCodon + " → " + c.stopCodon +
        "   (" + c.change + " at codon position " + c.codonPosition + ")"));

      var where = c.locus + "  ·  exon " + c.nmd.exonNumber + "/" + c.nmd.exonCount +
        "  ·  " + Math.round(100 * c.fractionOfCds) + "% through the CDS";
      if (c.distanceFromLesion !== null && c.distanceFromLesion !== undefined) {
        where += "  ·  " + (c.distanceFromLesion === 0 ? "at the lesion"
          : Math.abs(c.distanceFromLesion) + " residues " +
            (c.distanceFromLesion < 0 ? "before" : "after") + " the lesion");
      }
      box.appendChild(el("p", "where", where));

      var verdict = el("p", "nmd " + c.nmd.verdict);
      var labels = { competent: "NMD competent", uncertain: "NMD uncertain",
                     escapes: "NMD escape", unknown: "NMD unknown" };
      verdict.textContent = labels[c.nmd.verdict] || c.nmd.verdict;
      if (c.nmd.distanceToLastJunction !== null && c.nmd.distanceToLastJunction !== undefined) {
        verdict.textContent += "  (" + c.nmd.distanceToLastJunction +
          " nt from the last exon–exon junction)";
      }
      box.appendChild(verdict);

      if (c.nmd.escapes && c.nmd.escapes.length) {
        var ul = el("ul", "escapes");
        c.nmd.escapes.forEach(function (e) {
          ul.appendChild(el("li", null, e.detail));
        });
        box.appendChild(ul);
      }

      if (c.status !== "designed") {
        box.appendChild(el("div", "reason", c.reason || c.status));
      } else {
        (c.designs || []).forEach(function (d) {
          if (d.mixedProducts) {
            box.appendChild(el("p", "meta",
              "This chemistry makes a mixture at the edited base; the stop is one outcome."));
          }
          box.appendChild(guideTable(d.guides, topN));
          if (d.guides.length > topN) {
            box.appendChild(el("p", "meta",
              (d.guides.length - topN) + " more — raise “Guides shown” or export the CSV."));
          }
        });
        box.appendChild(contextBlock(c.contextSequence, c.contextCodonOffset));
      }
      p.appendChild(box);
    });

    if (s.notEvaluated) {
      p.appendChild(el("p", "meta",
        s.notEvaluated + " further stop-able codons were ranked but not designed — " +
        "raise “Stop candidates”."));
    }
    return p;
  }

  function renderExport(r) {
    var p = panel();
    p.appendChild(el("h2", null, "Export"));
    var rowDiv = el("div", "row");

    var csvBtn = el("button", "ghost", "Download CSV");
    csvBtn.type = "button";
    csvBtn.addEventListener("click", function () {
      var csv = F.format.formatCsv([r], { topN: 1000 });
      download(csv, slug(r) + ".csv", "text/csv");
    });

    var txtBtn = el("button", "ghost", "Download report");
    txtBtn.type = "button";
    txtBtn.addEventListener("click", function () {
      download(F.format.formatText(r, { topN: 1000 }), slug(r) + ".txt", "text/plain");
    });

    var jsonBtn = el("button", "ghost", "Download JSON");
    jsonBtn.type = "button";
    jsonBtn.addEventListener("click", function () {
      download(JSON.stringify(r, null, 2), slug(r) + ".json", "application/json");
    });

    rowDiv.appendChild(csvBtn);
    rowDiv.appendChild(txtBtn);
    rowDiv.appendChild(jsonBtn);
    p.appendChild(rowDiv);
    p.appendChild(el("p", "meta",
      "The CSV is one row per guide, with the NMD verdict and every flag — the same " +
      "columns the command-line tool writes."));
    return p;
  }

  function slug(r) {
    var base = (r.variant.gene || "variant") + "_" +
      (r.variant.change
        ? r.variant.change.wt + r.variant.change.position + (r.variant.change.mut || "fs")
        : r.query);
    return base.replace(/[^A-Za-z0-9._-]+/g, "_");
  }

  function download(text, name, type) {
    var blob = new Blob([text], { type: type + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function render(r, topN) {
    var out = $("out");
    out.textContent = "";
    out.appendChild(renderHeader(r));

    var orth = renderOrthologs(r);
    if (orth) out.appendChild(orth);

    (r.strategies || []).forEach(function (s) {
      out.appendChild(r.strategyType === "premature_stop"
        ? renderStop(s, topN)
        : renderSubstitution(s, topN));
    });

    if (r.status === "ok") out.appendChild(renderExport(r));
  }

  /* ---------------------------------------------------------------- *
   * Errors
   * ---------------------------------------------------------------- */

  function renderError(e, spec) {
    var out = $("out");
    out.textContent = "";
    var box = el("div", "err");

    /* A blocked cross-origin request is the one failure a user cannot act on
       without being told what it is, and for ClinVar there is a real way
       around it, so say so rather than printing a bare network error. */
    if (e.corsSuspected && /ncbi/.test(e.host || "")) {
      box.appendChild(el("h3", null, "ClinVar could not be reached from the browser"));
      box.appendChild(el("p", null,
        "NCBI did not allow this page to read its response, so accession and rsID " +
        "lookups cannot work here. Everything else does."));
      box.appendChild(el("p", null,
        "Enter the variant directly as GENE:p.Change instead — for example " +
        "MYO7A:p.Arg302His. That path never touches NCBI, and the design is identical."));
    } else if (e.corsSuspected) {
      box.appendChild(el("h3", null, "Could not reach " + e.host));
      box.appendChild(el("p", null, e.message));
      box.appendChild(el("p", null,
        "If you are offline or behind a filtering proxy, the command-line tool " +
        "works the same way and can be pointed at a cache."));
    } else {
      box.appendChild(el("h3", null, "Could not design guides for " + spec));
      box.appendChild(el("p", null, e.message || String(e)));
    }
    out.appendChild(box);
  }

  /* ---------------------------------------------------------------- *
   * Run
   * ---------------------------------------------------------------- */

  async function run() {
    if (running) return;
    var spec = $("variant").value.trim();
    if (!spec) { status("Enter a variant first."); return; }

    running = true;
    $("run").disabled = true;
    $("out").textContent = "";
    status("Loading the guide engine…", true);

    var topN = Math.max(1, Number($("top").value) || 5);

    try {
      var eng = await loadEngine();
      F.http.clearMemoryCache();

      var result = await F.pipeline.run(spec, {
        engine: eng,
        includeUntested: $("untested").checked,
        maxParalogs: Math.max(1, Number($("paralogs").value) || 4),
        ptcTop: Math.max(1, Number($("ptctop").value) || 8),
        onFetch: function (label) { status(label + "…", true); }
      });

      lastResult = result;
      render(result, topN);

      var n = 0;
      (result.strategies || []).forEach(function (s) {
        (s.edits || []).forEach(function (e) { n += e.guides.length; });
        (s.candidates || []).forEach(function (c) {
          (c.designs || []).forEach(function (d) { n += d.guides.length; });
        });
      });
      status(result.status === "ok"
        ? n + " guides designed."
        : "No guides designed — see the reason above.");

      history.replaceState(null, "", "#" + encodeURIComponent(spec));
    } catch (e) {
      renderError(e, spec);
      status("");
    } finally {
      running = false;
      $("run").disabled = false;
    }
  }

  /* ---------------------------------------------------------------- *
   * Wiring
   * ---------------------------------------------------------------- */

  $("run").addEventListener("click", run);
  $("variant").addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") run();
  });
  Array.prototype.forEach.call(document.querySelectorAll(".examples button"), function (b) {
    b.addEventListener("click", function () {
      $("variant").value = b.getAttribute("data-ex");
      run();
    });
  });

  /* Re-running a guide design should give the same answer, so the variant is
     kept in the URL and a shared link reproduces it. */
  if (location.hash.length > 1) {
    $("variant").value = decodeURIComponent(location.hash.slice(1));
  }

  $("stamp").textContent = "Build " + (F.stamp || "?") + ".";

  /* Report a missing engine at load, not on first click. */
  if (!UMAX || !F) {
    status("Scripts failed to load — the page needs umax.js and fishvar.bundle.js beside it.");
    $("run").disabled = true;
  } else if (location.hash.length > 1) {
    run();
  } else {
    status("");
  }
})();
