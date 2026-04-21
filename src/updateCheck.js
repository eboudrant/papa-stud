// Only runs when PAPASTUD_VERSION is set (Electron main sets it when packaged).

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
    const req = https.get(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'papa-stud-update-check', 'Accept': 'application/vnd.github+json' },
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
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
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

module.exports = { checkForUpdate };
