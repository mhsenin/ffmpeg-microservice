const express = require('express');
const multer = require('multer');
const { execSync, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── STORAGE ───────────────────────────────────────────────────────────────────
// Use /tmp for all file operations — writable on all platforms including Render
const TMP_DIR = '/tmp/ffmpeg-jobs';
fs.mkdirSync(TMP_DIR, { recursive: true });

// Multer config — accept visual (png/mp4), audio (mp3), captions (srt)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobDir = path.join(TMP_DIR, req.jobId);
    fs.mkdirSync(jobDir, { recursive: true });
    cb(null, jobDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.fieldname + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max per file
});

// Attach a jobId to every request before multer runs
app.use((req, res, next) => {
  req.jobId = uuidv4();
  next();
});

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  // Check FFmpeg is available
  try {
    const version = execSync('ffmpeg -version 2>&1').toString().split('\n')[0];
    res.json({ status: 'ok', ffmpeg: version });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'FFmpeg not found', detail: e.message });
  }
});

// ── ASSEMBLE VIDEO ────────────────────────────────────────────────────────────
// POST /assemble
// Fields:
//   visual  — PNG (quote card / reflection) or MP4 (carousel)
//   audio   — MP3 from Revoicer
//   srt     — SRT captions file (optional)
//   type    — "image" or "video" (default: "image")
//
// Returns: { success: true, url: "/output/<jobId>/final.mp4", jobId }

app.post('/assemble', upload.fields([
  { name: 'visual', maxCount: 1 },
  { name: 'audio',  maxCount: 1 },
  { name: 'srt',    maxCount: 1 }
]), async (req, res) => {

  const jobId = req.jobId;
  const jobDir = path.join(TMP_DIR, jobId);
  const outputPath = path.join(jobDir, 'final.mp4');
  const type = req.body.type || 'image'; // 'image' or 'video'

  try {
    // Validate required files
    if (!req.files || !req.files.visual || !req.files.audio) {
      return res.status(400).json({ success: false, error: 'Missing required files: visual and audio' });
    }

    const visualPath = req.files.visual[0].path;
    const audioPath  = req.files.audio[0].path;
    const hasSRT     = req.files.srt && req.files.srt.length > 0;
    const srtPath    = hasSRT ? req.files.srt[0].path : null;

    // ── BUILD FFMPEG COMMAND ──────────────────────────────────────────────────
    let cmd;

    if (type === 'video') {
      // Carousel: MP4 visual + MP3 audio + optional SRT
      if (hasSRT) {
        cmd = `ffmpeg -y \
          -i "${visualPath}" \
          -i "${audioPath}" \
          -vf "subtitles=${srtPath}:force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,Bold=1,Alignment=2',scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
          -c:v libx264 -c:a aac \
          -shortest -movflags +faststart \
          "${outputPath}"`;
      } else {
        cmd = `ffmpeg -y \
          -i "${visualPath}" \
          -i "${audioPath}" \
          -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
          -c:v libx264 -c:a aac \
          -shortest -movflags +faststart \
          "${outputPath}"`;
      }
    } else {
      // Quote card / reflection: PNG visual + MP3 audio + optional SRT
      if (hasSRT) {
        cmd = `ffmpeg -y \
          -loop 1 -framerate 30 -i "${visualPath}" \
          -i "${audioPath}" \
          -vf "subtitles=${srtPath}:force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,Bold=1,Alignment=2',scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
          -c:v libx264 -c:a aac \
          -shortest -movflags +faststart \
          "${outputPath}"`;
      } else {
        cmd = `ffmpeg -y \
          -loop 1 -framerate 30 -i "${visualPath}" \
          -i "${audioPath}" \
          -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2" \
          -c:v libx264 -c:a aac \
          -shortest -movflags +faststart \
          "${outputPath}"`;
      }
    }

    console.log(`[${jobId}] Running FFmpeg...`);
    console.log(`[${jobId}] Command: ${cmd}`);

    // Run FFmpeg — synchronous, wait for it to finish
    execSync(cmd, { timeout: 120000 }); // 2 min timeout

    console.log(`[${jobId}] FFmpeg complete. Output: ${outputPath}`);

    // Return the download URL
    res.json({
      success: true,
      jobId,
      url: `/output/${jobId}/final.mp4`,
      message: 'Video assembled successfully'
    });

  } catch (err) {
    console.error(`[${jobId}] FFmpeg error:`, err.message);
    res.status(500).json({
      success: false,
      jobId,
      error: err.message
    });
  }
});

// ── SERVE OUTPUT FILES ────────────────────────────────────────────────────────
// GET /output/:jobId/final.mp4
// Returns the assembled MP4 file for download

app.get('/output/:jobId/final.mp4', (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.jobId, 'final.mp4');

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or expired' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="post-${req.params.jobId}.mp4"`);
  res.sendFile(filePath);
});

// ── CLEANUP OLD JOBS ──────────────────────────────────────────────────────────
// Delete jobs older than 2 hours to keep /tmp clean
setInterval(() => {
  try {
    const now = Date.now();
    const jobs = fs.readdirSync(TMP_DIR);
    jobs.forEach(jobId => {
      const jobDir = path.join(TMP_DIR, jobId);
      const stat = fs.statSync(jobDir);
      if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
        fs.rmSync(jobDir, { recursive: true, force: true });
        console.log(`Cleaned up job: ${jobId}`);
      }
    });
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }
}, 30 * 60 * 1000); // Run every 30 minutes

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FFmpeg microservice running on port ${PORT}`);
  console.log(`Health check: GET /`);
  console.log(`Assemble video: POST /assemble`);
});
