/**
 * Express route handlers matching the Python API surface.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const projects = require('./projects');
const scanJobs = require('./scanJobs');
const templates = require('./templates');
const video = require('./video');
const config = require('./config');
const updateCheck = require('./updateCheck');
const apng = require('./apng');

const STATIC_DIR = path.resolve(__dirname, '..', 'static');
const INDEX_HTML = path.join(STATIC_DIR, 'index.html');

function createRouter() {
  const router = express.Router();

  // --- API GET ---

  router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', watchMode: 'native', ffmpeg: video.hasFfmpeg() });
  });

  router.get('/api/update-check', async (req, res) => {
    res.json(await updateCheck.checkForUpdate());
  });

  router.get('/api/templates', (req, res) => {
    res.json(templates.listTemplates());
  });

  router.get('/api/projects', (req, res) => {
    res.json(projects.listProjects());
  });

  router.get('/api/scans', (req, res) => {
    res.json(projects.listScans());
  });

  router.get('/api/scans/:id/watch', (req, res) => {
    res.json({ watching: scanJobs.isWatching(req.params.id) });
  });

  router.get('/api/scans/:id', (req, res) => {
    const { page, size, status, q, module, profile, sort } = req.query;
    const result = projects.getScan(req.params.id, {
      page: parseInt(page) || 0,
      size: parseInt(size) || 50,
      status: status || undefined,
      query: q || undefined,
      module: module || undefined,
      profile: profile || undefined,
      sort: sort || undefined,
    });
    if (result) res.json(result);
    else res.status(404).json({ error: 'scan not found' });
  });

  router.get('/api/scan-jobs/:id', (req, res) => {
    const job = scanJobs.getJob(req.params.id);
    if (job) res.json(job);
    else res.status(404).json({ error: 'job not found' });
  });

  // Resolve a user-supplied image path against the same allowlist /api/images
  // and /api/images/meta share. Returns { real } on success or
  // { status, error } on failure.
  function resolveImagePath(filePath) {
    if (!filePath || !path.isAbsolute(filePath)) {
      return { status: 400, error: 'absolute path required' };
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
      return { status: 400, error: 'only image files allowed' };
    }
    let real;
    try { real = fs.realpathSync(filePath); }
    catch { return { status: 404, error: 'not found' }; }
    const roots = [];
    for (const p of projects.listProjects()) {
      try { roots.push(fs.realpathSync(p.path)); } catch {}
    }
    try { roots.push(fs.realpathSync(path.join(projects.getDataDir(), 'cache'))); } catch {}
    if (!roots.find(r => real.startsWith(r + path.sep))) {
      return { status: 403, error: 'forbidden' };
    }
    return { real };
  }

  router.get('/api/images', (req, res) => {
    const r = resolveImagePath(req.query.path);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.sendFile(r.real);
  });

  router.get('/api/images/meta', (req, res) => {
    const r = resolveImagePath(req.query.path);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(apng.detectApng(r.real));
  });

  // --- Config ---

  function sendExportBundle(res, filename, bundle) {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.set('Content-Disposition', `attachment; filename="${safeName}"`);
    res.set('Content-Type', 'application/json');
    res.send(JSON.stringify(bundle, null, 2));
  }

  router.get('/api/config/info', (req, res) => {
    const allProjects = projects.listProjects();
    const allTemplates = templates.listTemplates();
    res.json({
      dataDir: projects.getDataDir(),
      projectCount: allProjects.length,
      templateCount: allTemplates.filter(t => !t.builtin).length,
    });
  });

  router.get('/api/config/export', (req, res) => {
    const allProjects = projects.listProjects();
    const customTemplates = templates.listTemplates().filter(t => !t.builtin);
    sendExportBundle(res, 'papastud-config.json', config.createExportBundle(allProjects, customTemplates));
  });

  router.post('/api/config/import', (req, res) => {
    let bundle;
    try {
      bundle = config.migrate(req.body);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    let imported = { projects: 0, templates: 0 };
    if (bundle.projects && bundle.projects.length) {
      projects.importProjects(bundle.projects);
      imported.projects = bundle.projects.length;
    }
    if (bundle.templates && bundle.templates.length) {
      templates.importTemplates(bundle.templates);
      imported.templates = bundle.templates.length;
    }
    res.json(imported);
  });

  router.get('/api/config/export/project/:id', (req, res) => {
    const project = projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    sendExportBundle(res, `papastud-project-${project.name}.json`, config.createExportBundle([project], []));
  });

  router.get('/api/config/export/template/:id', (req, res) => {
    const t = templates.getTemplate(req.params.id);
    if (!t || t.builtin) return res.status(404).json({ error: 'custom template not found' });
    sendExportBundle(res, `papastud-template-${t.name}.json`, config.createExportBundle([], [t]));
  });

  router.post('/api/config/import/project', (req, res) => {
    const body = req.body;
    if (!body || !body.id || !body.path) return res.status(400).json({ error: 'invalid project data' });
    projects.importProjects([body]);
    res.json({ imported: 1 });
  });

  router.post('/api/config/import/template', (req, res) => {
    const body = req.body;
    if (!body || !body.id || !body.name) return res.status(400).json({ error: 'invalid template data' });
    templates.importTemplates([body]);
    res.json({ imported: 1 });
  });

  router.post('/api/config/reset', (req, res) => {
    projects.resetProjects();
    templates.resetTemplates();
    res.json({ reset: true });
  });

  // --- API POST ---

  router.post('/api/projects', (req, res) => {
    const body = req.body;
    if (!body || !body.path) return res.status(400).json({ error: 'path required' });
    const expanded = projects.expandHome(body.path);
    if (!path.isAbsolute(expanded)) {
      return res.status(400).json({ error: `absolute path required: ${body.path}` });
    }
    const resolved = path.resolve(expanded);
    const shown = resolved !== body.path ? `${body.path} (expanded to ${resolved})` : body.path;
    let stat;
    // codeql[js/path-injection]: by design — this single-user app lets the user
    // pick any directory on their machine to scan. Server binds to 127.0.0.1
    // (Electron only; no remote attacker). The path is normalized via
    // expandHome + path.resolve and rejected if not absolute.
    try { stat = fs.statSync(resolved); }
    catch { return res.status(400).json({ error: `path does not exist: ${shown}` }); }
    if (!stat.isDirectory()) return res.status(400).json({ error: `path is not a directory: ${shown}` });
    const name = body.name || path.basename(resolved);
    const project = projects.addProject(name, resolved, body.template_ids, body.strategy, {
      xcresult_path: body.xcresult_path,
    });
    res.status(201).json(project);
  });

  router.post('/api/templates', (req, res) => {
    const body = req.body;
    if (!body || !body.name) return res.status(400).json({ error: 'name required' });
    const t = templates.createTemplate(body);
    res.status(201).json(t);
  });

  router.post('/api/projects/:id/scan', (req, res) => {
    const project = projects.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    const jobId = scanJobs.startScan(project);
    res.status(202).json({ jobId });
  });

  router.post('/api/scans/:id/watch', (req, res) => {
    if (scanJobs.startWatching(req.params.id)) {
      res.json({ watching: true });
    } else {
      res.status(404).json({ error: 'scan not found' });
    }
  });

  router.post('/api/scan-jobs/:id/cancel', (req, res) => {
    if (scanJobs.cancelJob(req.params.id)) {
      res.json({ cancelled: true });
    } else {
      res.status(404).json({ error: 'job not found' });
    }
  });

  router.post('/api/scans/:id/video', async (req, res) => {
    const scanId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
    const { module: mod, profile, q } = req.query;
    const scan = projects.getScan(scanId, {
      page: 0, size: 10000,
      module: mod || undefined,
      profile: profile || undefined,
      query: q || undefined,
    });
    if (!scan) return res.status(404).json({ error: 'scan not found' });
    const failures = (scan.failures || []).filter(f => f.delta_path);
    if (!failures.length) return res.status(400).json({ error: 'no failures to export' });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-vid-'));
    const tmpFile = path.join(tmpDir, 'output.mp4');
    try {
      await video.generateVideo(failures, tmpFile);
      const filterTag = [mod, profile, q].filter(Boolean).join('-').replace(/[^a-zA-Z0-9._-]/g, '') || 'all';
      res.set('Content-Disposition', `attachment; filename="papa-stud-${scanId}-${filterTag}.mp4"`);
      res.set('Content-Type', 'video/mp4');
      const stat = fs.statSync(tmpFile);
      res.set('Content-Length', String(stat.size));
      const stream = fs.createReadStream(tmpFile);
      stream.on('error', () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res).on('finish', () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });
    } catch (e) {
      console.error('Video generation failed:', e.message);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // --- API PUT ---

  router.put('/api/projects/:id/profiles', (req, res) => {
    const body = req.body;
    if (!body || !body.profiles) return res.status(400).json({ error: 'profiles required' });
    const result = projects.updateProjectProfiles(req.params.id, body.profiles);
    if (result) res.json(result);
    else res.status(404).json({ error: 'project not found' });
  });

  router.put('/api/scans/:scanId/failures/:filename/status', (req, res) => {
    const body = req.body;
    if (!body || !body.status) return res.status(400).json({ error: 'status required' });
    const stats = projects.updateFailureStatus(req.params.scanId, req.params.filename, body.status);
    if (stats) res.json(stats);
    else res.status(404).json({ error: 'not found' });
  });

  router.put('/api/scans/:scanId/failures/batch', (req, res) => {
    const body = req.body;
    if (!body || !body.status || !body.filenames) {
      return res.status(400).json({ error: 'status and filenames required' });
    }
    const stats = projects.batchUpdateStatus(req.params.scanId, body.filenames, body.status);
    if (stats) res.json(stats);
    else res.status(404).json({ error: 'not found' });
  });

  router.post('/api/scans/:scanId/failures/:filename/accept', (req, res) => {
    const result = projects.acceptBaseline(req.params.scanId, req.params.filename);
    if (!result) return res.status(404).json({ error: 'not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  router.post('/api/scans/:scanId/accept-all', (req, res) => {
    const result = projects.acceptAllBaselines(req.params.scanId);
    if (!result) return res.status(404).json({ error: 'scan not found' });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  });

  // --- API DELETE ---

  router.delete('/api/templates/:id', (req, res) => {
    if (templates.deleteTemplate(req.params.id)) {
      res.status(204).end();
    } else {
      res.status(400).json({ error: 'cannot delete built-in template' });
    }
  });

  router.delete('/api/projects/:id', (req, res) => {
    projects.deleteProject(req.params.id);
    res.status(204).end();
  });

  router.delete('/api/scans/:id/watch', (req, res) => {
    scanJobs.stopWatching(req.params.id);
    res.json({ watching: false });
  });

  router.delete('/api/scans/:id', (req, res) => {
    scanJobs.stopWatching(req.params.id);
    projects.deleteScan(req.params.id);
    res.status(204).end();
  });

  return router;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(createRouter());
  app.use('/static', express.static(STATIC_DIR));
  // Serve index.html from a known constant path
  app.get('/', (req, res) => res.sendFile(INDEX_HTML));
  return app;
}

module.exports = { createRouter, createApp, STATIC_DIR };
