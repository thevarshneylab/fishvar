#!/usr/bin/env node
/*!
 * Local server for checking docs/ in a real browser, offline.
 *
 *   node test/serve.js [port]
 *
 * Serves docs/ and, for index.html, injects a stub that redirects every
 * absolute http(s) fetch to the fixture cache. The page therefore runs its own
 * code -- bundle, HTTP layer, pipeline, renderer -- against the same fixtures
 * the test suites use, with no network and no API keys.
 *
 * This is a test harness. It is not part of the published site.
 */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var cache = require("../lib/http.js");

var ROOT = path.join(__dirname, "..");
var DOCS = path.join(ROOT, "docs");
var FIXTURES = path.join(ROOT, "fixtures");
var PORT = Number(process.argv[2]) || 8099;

var TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".svg": "image/svg+xml", ".txt": "text/plain"
};

/* Injected into index.html ahead of app.js. */
var STUB = [
  "<script>",
  "(function(){",
  "  var real = self.fetch.bind(self);",
  "  var served = 0, missed = [];",
  "  self.__fixtureStats = function(){ return {served: served, missed: missed}; };",
  "  self.fetch = function(url, opts){",
  "    var u = String(url);",
  "    if (/^https?:\\/\\//.test(u)) {",
  "      return real('/__fixture?url=' + encodeURIComponent(u), opts).then(function(r){",
  "        if (r.ok) served++; else missed.push(u);",
  "        return r;",
  "      });",
  "    }",
  "    return real(url, opts);",
  "  };",
  "  document.addEventListener('DOMContentLoaded', function(){",
  "    var n = document.createElement('p');",
  "    n.className = 'meta';",
  "    n.id = 'harness';",
  "    n.textContent = 'OFFLINE HARNESS \\u2014 all API calls are served from test fixtures.';",
  "    n.style.color = 'var(--bad)';",
  "    document.querySelector('header').appendChild(n);",
  "  });",
  "})();",
  "</script>"
].join("\n");

function sendFixture(res, url) {
  var file = cache.cachePath(FIXTURES, url);
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "no fixture for " + url }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(fs.readFileSync(file));
}

http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost:" + PORT);

  if (u.pathname === "/__fixture") {
    return sendFixture(res, u.searchParams.get("url") || "");
  }

  var name = u.pathname === "/" ? "/index.html" : u.pathname;
  var file = path.join(DOCS, path.normalize(name).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(DOCS) || !fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found: " + name);
    return;
  }

  var body = fs.readFileSync(file);
  var ext = path.extname(file);

  if (ext === ".html") {
    /* Inject ahead of the first script so the stub is in place before the
       bundle or the app can call fetch. */
    body = Buffer.from(
      body.toString("utf8").replace("<script src=\"umax.js\">", STUB + "\n<script src=\"umax.js\">")
    );
  }

  res.writeHead(200, {
    "Content-Type": (TYPES[ext] || "application/octet-stream") + "; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}).listen(PORT, function () {
  process.stdout.write("serving docs/ with fixture stub on http://localhost:" + PORT + "/\n");
  process.stdout.write("  try http://localhost:" + PORT + "/#VCV000077777\n");
});
