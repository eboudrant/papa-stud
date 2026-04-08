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

const STATIC_DIR = path.resolve(__dirname, '..', 'static');

function createRouter() {
  const router = express.Router();

  // --- API GET ---

  router.get('/api/health', (req, res) => {
    res.json({ status: 'ok', watchMode: 'native', ffmpeg: video.hasFfmpeg() });
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

  router.get('/api/images', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    if (!projects.isPathUnderProject(filePath)) return res.status(403).json({ error: 'forbidden' });
    res.sendFile(filePath);
  });

  // --- API POST ---

  router.post('/api/projects', (req, res) => {
    const body = req.body;
    if (!body || !body.path) return res.status(400).json({ error: 'path required' });
    const name = body.name || path.basename(body.path);
    const project = projects.addProject(name, body.path, body.template_ids);
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
    const jobId = scanJobs.startScan(
      req.params.id, project.name, project.path, project.profiles
    );
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

  router.post('/api/scans/:id/video', (req, res) => {
    const scan = projects.getScan(req.params.id, { page: 0, size: 10000 });
    if (!scan) return res.status(404).json({ error: 'scan not found' });
    const failures = (scan.failures || []).filter(f => f.delta_path);
    if (!failures.length) return res.status(400).json({ error: 'no failures to export' });

    const tmpPath = path.join(os.tmpdir(), `papastud-${req.params.id}.mp4`);
    try {
      video.generateVideo(failures, tmpPath);
      const safeId = req.params.id.replace(/[\r\n"]/g, '');
      res.set('Content-Disposition', `attachment; filename="papa-stud-${safeId}.mp4"`);
      res.sendFile(tmpPath, () => {
        try { fs.unlinkSync(tmpPath); } catch {}
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
      try { fs.unlinkSync(tmpPath); } catch {}
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
  app.get('/', (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));
  return app;
}

module.exports = { createRouter, createApp, STATIC_DIR };
