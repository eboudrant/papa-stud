// @ts-check

/** @param {string} url */
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

/**
 * @param {string} url
 * @param {object} body
 */
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

/**
 * @param {string} url
 * @param {object} body
 */
async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${url}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

/** @param {string} url */
async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url}: ${res.status}`);
}

/** Escape a string for safe HTML insertion. */
function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/** Escape a string for use in HTML attributes. */
function escAttr(str) {
  return escHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Show a toast notification. type: 'success' | 'info' | 'error' */
let _toastTimer = null;
function showToast(message, type, duration) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  // Replace any existing toast — don't accumulate
  container.innerHTML = '';
  if (_toastTimer) clearTimeout(_toastTimer);
  const toast = document.createElement('div');
  toast.className = `toast toast-${type || 'success'}`;
  toast.textContent = message;
  container.appendChild(toast);
  _toastTimer = setTimeout(() => { toast.remove(); _toastTimer = null; }, duration || 4000);
}

async function copyToClipboard(text, successMsg) {
  try {
    await navigator.clipboard.writeText(text);
    if (successMsg) showToast(successMsg, 'success');
    return true;
  } catch {
    showToast('Copy failed', 'error');
    return false;
  }
}

/** Render a snapshot pass/fail bar. cssClass defaults to 'test-bar'. */
function snapshotBar(total, failed, cssClass) {
  if (!total || total === 0) return '';
  const cls = cssClass || 'test-bar';
  const minPct = cls === 'scan-test-bar' ? 2 : 8;
  const failedPct = failed > 0 ? Math.max(failed / total * 100, minPct) : 0;
  const passedPct = Math.max(0, 100 - failedPct);
  return `<div class="${cls}" title="${total} snapshots, ${failed} failed"><div class="test-bar-passed" style="width:${passedPct}%"></div><div class="test-bar-failed" style="width:${failedPct}%"></div></div>`;
}
