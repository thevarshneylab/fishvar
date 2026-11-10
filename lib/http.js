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
