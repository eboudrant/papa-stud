// Only runs when PAPASTUD_VERSION is set (Electron main sets it when packaged).
//
// Uses the GitHub releases atom feed at `github.com/<repo>/releases.atom`
// rather than the REST API. The feed has no rate limit, needs no auth, and
// returns the same data we need. The REST `api.github.com` endpoint is
// limited to 60 unauthenticated requests/hour per IP — easy to hit on a
// shared corp egress, after which every user on that IP gets a silent
// 403 and no upgrade banner.

const https = require('https');

const REPO = 'eboudrant/papa-stud';
const CACHE_TTL = 30 * 60 * 1000;
const FAILURE_CACHE_TTL = 5 * 60 * 1000;
const REQUEST_TIMEOUT = 5000;

let _cache = null;
let _cacheAt = 0;
let _inflight = null;

function _fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://github.com/${REPO}/releases.atom`, {
      headers: { 'User-Agent': 'papa-stud-update-check', 'Accept': 'application/atom+xml' },
      timeout: REQUEST_TIMEOUT,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`GitHub ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(_parseAtomLatest(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// Extract the newest release from an atom feed. Entries are ordered newest
// first; the first <entry> wins. Returns `{ tag_name, html_url }` to match
// the shape the rest of the module expects from the old REST response.
function _parseAtomLatest(xml) {
  const entry = xml.match(/<entry\b[\s\S]*?<\/entry>/);
  if (!entry) throw new Error('atom: no entries');
  const titleMatch = entry[0].match(/<title>([^<]+)<\/title>/);
  const linkMatch = entry[0].match(/<link\s+[^>]*href="([^"]+)"/);
  if (!titleMatch) throw new Error('atom: no title');
  return { tag_name: titleMatch[1].trim(), html_url: linkMatch ? linkMatch[1] : null };
}

function _parseVersion(v) {
  if (!v) return null;
  const parts = String(v).replace(/^v/, '').split('.').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts;
}

function _isNewer(latest, current) {
  const a = _parseVersion(latest);
  const b = _parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

async function checkForUpdate() {
  const current = process.env.PAPASTUD_VERSION;
  if (!current) return { available: false };

  const now = Date.now();
  if (_cache) {
    const ttl = _cache.available ? CACHE_TTL : FAILURE_CACHE_TTL;
    if (now - _cacheAt < ttl) return _cache;
  }
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const release = await _fetchLatestRelease();
      const latest = release.tag_name || '';
      _cache = {
        available: _isNewer(latest, current),
        current,
        latest: latest.replace(/^v/, ''),
        url: release.html_url || `https://github.com/${REPO}/releases`,
      };
    } catch {
      _cache = { available: false, current };
    }
    _cacheAt = now;
    _inflight = null;
    return _cache;
  })();

  return _inflight;
}

module.exports = { checkForUpdate, _parseAtomLatest };
