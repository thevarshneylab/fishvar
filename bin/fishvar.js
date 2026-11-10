#!/usr/bin/env node
/*!
 * fishvar -- ClinVar missense variant to zebrafish Umax base-editing guide.
 */
"use strict";

var fs = require("fs");
var pipeline = require("../lib/pipeline.js");
var format = require("../lib/format.js");

var USAGE = [
  "",
  "fishvar -- ClinVar missense variant -> zebrafish orthologous codon -> Umax guide",
  "",
  "Usage:",
  "  fishvar <variant> [options]",
  "  fishvar --batch <file> [options]",
  "",
  "A variant is either a ClinVar identifier (VCV000012345, RCV..., rs80338939, or a",
  "numeric UID) or a direct GENE:p.Change, which skips ClinVar entirely:",
  "",
  "  fishvar VCV000012345",
  "  fishvar MYO7A:p.Arg302His",
  "  fishvar --batch variants.txt --format csv > designs.csv",
  "",
  "Options:",
  "  --format <text|json|csv>   output format (default text)",
  "  --top <n>                  guides to show per edit in text output (default 5)",
  "  --batch <file>             one variant per line; # starts a comment",
  "  --cache-dir <dir>          cache API responses here (default .fishvar-cache)",
  "  --cache-only               never hit the network; fail on a cache miss",
  "  --umax-path <dir>          checkout of umax-guide-designer (default ./vendor)",
  "  --include-untested         include predicted editor/backbone pairings",
  "  --max-paralogs <n>         conserved orthologues to design against (default 4)",
  "  --ptc-top <n>              stop candidates to design guides for (default 12)",
  "  --ncbi-api-key <key>       raises the NCBI rate limit; or set NCBI_API_KEY",
  "  --quiet                    suppress progress on stderr",
  "  -h, --help                 this message",
  "",
  "Two strategies are chosen automatically from the variant class:",
  "",
  "  missense                      -> the orthologous residue substitution",
  "  nonsense / frameshift / start -> a premature stop in the orthologue, ranked",
  "                                   by nonsense-mediated decay competence",
  "",
  "Splice, stop-loss and non-coding variants are reported as out of scope rather",
  "than mapped.",
  ""
].join("\n");

function parseArgs(argv) {
  var opts = { format: "text", topN: 5, cacheDir: ".fishvar-cache", variants: [] };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    var next = function () {
      var v = argv[++i];
      if (v === undefined) throw new Error("missing value for " + a);
      return v;
    };
    switch (a) {
      case "-h": case "--help": opts.help = true; break;
      case "--format": opts.format = next(); break;
      case "--top": opts.topN = Number(next()); break;
      case "--batch": opts.batch = next(); break;
      case "--cache-dir": opts.cacheDir = next(); break;
      case "--cache-only": opts.cacheOnly = true; break;
      case "--umax-path": opts.umaxPath = next(); break;
      case "--include-untested": opts.includeUntested = true; break;
      case "--max-paralogs": opts.maxParalogs = Number(next()); break;
      case "--ptc-top": opts.ptcTop = Number(next()); break;
      case "--ncbi-api-key": opts.ncbiApiKey = next(); break;
      case "--quiet": opts.quiet = true; break;
      default:
        if (a.charAt(0) === "-") throw new Error("unknown option " + a);
        opts.variants.push(a);
    }
  }
  return opts;
}

function readBatch(file) {
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .map(function (l) { return l.replace(/#.*$/, "").trim(); })
    .filter(Boolean);
}

(async function main() {
  var opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write("fishvar: " + e.message + "\n");
    process.exitCode = 2;
    return;
  }

  if (opts.help) { process.stdout.write(USAGE); return; }

  var variants = opts.variants.slice();
  if (opts.batch) variants = variants.concat(readBatch(opts.batch));

  if (!variants.length) {
    process.stdout.write(USAGE);
    process.exitCode = 2;
    return;
  }
  if (["text", "json", "csv"].indexOf(opts.format) < 0) {
    process.stderr.write("fishvar: --format must be text, json or csv\n");
    process.exitCode = 2;
    return;
  }

  var results = [];
  var failures = 0;

  for (var i = 0; i < variants.length; i++) {
    var v = variants[i];
    if (!opts.quiet && variants.length > 1) {
      process.stderr.write("[" + (i + 1) + "/" + variants.length + "] " + v + "\n");
    }
    try {
      var r = await pipeline.run(v, opts);
      results.push(r);
      if (opts.format === "text") process.stdout.write(format.formatText(r, opts));
    } catch (e) {
      failures++;
      /* A batch must not die on one bad row: record the failure and continue. */
      var err = {
        query: v,
        status: "error",
        reason: e.message,
        variant: { name: v, gene: null, change: null, consequence: null },
        strategies: [],
        candidates: []
      };
      results.push(err);
      if (opts.format === "text") {
        process.stdout.write("\n" + "=".repeat(78) + "\n" + v +
          "\n  verdict: error\n" + "=".repeat(78) + "\n\n  " + e.message + "\n");
      } else {
        process.stderr.write("fishvar: " + v + ": " + e.message + "\n");
      }
    }
  }

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify(
      results.length === 1 ? results[0] : results, null, 2) + "\n");
  } else if (opts.format === "csv") {
    process.stdout.write(format.formatCsv(results, { topN: opts.topN }));
  }

  if (!opts.quiet && variants.length > 1) {
    var designed = results.filter(function (r) { return r.status === "ok"; }).length;
    process.stderr.write("\n" + designed + "/" + results.length +
      " variants designed" + (failures ? ", " + failures + " errored" : "") + "\n");
  }

  /* Exit non-zero only on a hard error, not on a variant that is legitimately
     unmodelable: "not conserved in zebrafish" is an answer, not a failure.
     Set exitCode rather than calling process.exit(), which would truncate a
     large JSON or CSV batch: writes to a pipe are asynchronous and exit() does
     not wait for them to drain. */
  if (failures && failures === results.length) process.exitCode = 1;
})();
