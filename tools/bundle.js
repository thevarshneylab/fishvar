#!/usr/bin/env node
/*!
 * Build the browser bundle in docs/.
 *
 *   node tools/bundle.js          write docs/
 *   node tools/bundle.js --check  fail if docs/ is stale
 *
 * No bundler, no npm dependencies, no build chain to rot. The lib modules are
 * plain CommonJS, so they are wrapped in a tiny module registry with a require
 * shim that returns null for Node built-ins -- which the modules already
 * tolerate, because that is how they detect the browser.
 *
 * The point of building rather than maintaining a second browser copy is that
 * lib/ stays the only implementation. `--check` runs in the test suite, so a
 * change to lib/ that is not rebuilt fails the tests instead of silently
 * shipping a stale page.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ROOT = path.join(__dirname, "..");
var DOCS = path.join(ROOT, "docs");

/* Dependency order: a module must appear after everything it requires. */
var MODULES = [
  "http.js",
  "palette.js",
  "clinvar.js",
  "ensembl.js",
  "ortholog.js",
  "ptc.js",
  "format.js",
  "pipeline.js"
];

/* Node built-ins the lib modules probe for and expect to be absent. */
var BUILTINS = ["fs", "path", "crypto", "url"];

function banner(sources) {
  var h = crypto.createHash("sha256");
  Object.keys(sources).sort().forEach(function (k) { h.update(k).update(sources[k]); });
  return h.digest("hex").slice(0, 16);
}

function build() {
  var sources = {};
  MODULES.forEach(function (m) {
    sources[m] = fs.readFileSync(path.join(ROOT, "lib", m), "utf8");
  });

  var stamp = banner(sources);
  var out = [];

  out.push("/*!");
  out.push(" * fishvar browser bundle -- GENERATED, do not edit.");
  out.push(" *");
  out.push(" * Built from lib/ by tools/bundle.js. Edit lib/ and run `npm run bundle`.");
  out.push(" * Source stamp: " + stamp);
  out.push(" */");
  out.push("(function (root) {");
  out.push('"use strict";');
  out.push("");
  out.push("var __modules = {};");
  out.push("var __cache = {};");
  out.push("var __builtins = " + JSON.stringify(BUILTINS) + ";");
  out.push("");
  out.push("function require(name) {");
  out.push("  var key = String(name).replace(/^\\.\\//, '').replace(/\\.js$/, '');");
  out.push("  /* The lib modules wrap built-in requires in try/catch and treat a");
  out.push("     throw as 'running in a browser'. Throwing is therefore the correct");
  out.push("     answer here, not returning null. */");
  out.push("  if (__builtins.indexOf(key) >= 0) {");
  out.push("    throw new Error('node built-in \"' + key + '\" is not available in the browser');");
  out.push("  }");
  out.push("  if (__cache[key]) return __cache[key].exports;");
  out.push("  var factory = __modules[key];");
  out.push("  if (!factory) throw new Error('module not in bundle: ' + name);");
  out.push("  var mod = __cache[key] = { exports: {} };");
  out.push("  factory(mod, mod.exports, require);");
  out.push("  return mod.exports;");
  out.push("}");
  out.push("");

  MODULES.forEach(function (m) {
    var key = m.replace(/\.js$/, "");
    out.push("__modules[" + JSON.stringify(key) + "] = function (module, exports, require) {");
    out.push(sources[m]);
    out.push("};");
    out.push("");
  });

  out.push("root.FISHVAR = {");
  out.push("  stamp: " + JSON.stringify(stamp) + ",");
  MODULES.forEach(function (m) {
    var key = m.replace(/\.js$/, "");
    out.push("  " + key + ": require(" + JSON.stringify(key) + "),");
  });
  out.push("};");
  out.push("})(typeof self !== 'undefined' ? self : this);");
  out.push("");

  return { text: out.join("\n"), stamp: stamp };
}

/* umax.js and editors.json are served from docs/ too, copied from vendor/ so
   the page and the CLI run the same engine build. */
function vendorCopies() {
  return ["umax.js", "editors.json", "UMAX_COMMIT"].map(function (f) {
    return { name: f, text: fs.readFileSync(path.join(ROOT, "vendor", f), "utf8") };
  });
}

var built = build();
var copies = vendorCopies();
var targets = [{ name: "fishvar.bundle.js", text: built.text }].concat(copies);
var check = process.argv.indexOf("--check") >= 0;

if (check) {
  var stale = [];
  targets.forEach(function (t) {
    var p = path.join(DOCS, t.name);
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== t.text) stale.push(t.name);
  });
  if (stale.length) {
    process.stderr.write(
      "docs/ is stale: " + stale.join(", ") +
      "\n  lib/ or vendor/ changed without rebuilding. Run: npm run bundle\n"
    );
    process.exit(1);
  }
  process.stdout.write("docs/ is up to date (stamp " + built.stamp + ")\n");
} else {
  fs.mkdirSync(DOCS, { recursive: true });
  targets.forEach(function (t) {
    fs.writeFileSync(path.join(DOCS, t.name), t.text);
  });
  process.stdout.write(
    "wrote " + targets.map(function (t) { return "docs/" + t.name; }).join(", ") +
    "\n  stamp " + built.stamp + ", bundle " + Math.round(built.text.length / 1024) + " KB\n"
  );
}
