/*!
 * JSON fetch with on-disk caching, per-host rate limiting and retry.
 *
 * Caching is not an optimization here, it is a correctness feature: a design
 * that went into an injection needs to be reproducible months later, and
 * Ensembl releases move. Every response is written to the cache directory and
 * replayed from there on subsequent runs, so `--cache-only` reruns a design
 * offline against exactly the data that produced it.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

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
  var file = o.cacheDir ? cachePath(o.cacheDir, url) : null;

  if (file && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  if (o.cacheOnly) {
    throw new Error(
      "cache miss in --cache-only mode for " + (o.label || url) +
      "\n  expected cache file: " + file
    );
  }

  var host = new URL(url).host;
  var retries = o.retries === undefined ? 3 : o.retries;
  var lastErr;

  for (var attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    try {
      var res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "fishvar/0.1" }
      });

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
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (e.status && e.status >= 400 && e.status < 500) throw e;
      if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

module.exports = { getJson: getJson, cachePath: cachePath };
