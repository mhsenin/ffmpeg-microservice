# FFmpeg Microservice — Psych & Energy

A lightweight video assembly service for the Psych & Energy n8n workflow.
Combines Canva visuals + Revoicer audio + SRT captions into final MP4s.

## Endpoints

### GET /
Health check. Returns FFmpeg version if installed correctly.

### POST /assemble
Assembles a video from uploaded files.

**Form fields:**
- `visual` — PNG (quote card) or MP4 (carousel) from Canva
- `audio` — MP3 from Revoicer
- `srt` — SRT captions file (optional)
- `type` — `image` (default) or `video`

**Returns:**
```json
{
  "success": true,
  "jobId": "abc-123",
  "url": "/output/abc-123/final.mp4"
}
```

### GET /output/:jobId/final.mp4
Download the assembled MP4. Files are deleted after 2 hours.

## Deploy to Render

1. Push this folder to a GitHub repo
2. In Render: New → Web Service → connect repo
3. Runtime: Docker
4. Plan: Free
5. Done — Render builds the Docker image with FFmpeg included

## n8n Integration

Replace the FFmpeg Execute Command nodes with HTTP Request nodes:

```
POST https://your-ffmpeg-service.onrender.com/assemble
Content-Type: multipart/form-data

visual: [binary file]
audio: [binary file]
srt: [text file]
type: image
```
