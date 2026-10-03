# Python ROI Capture Setup

## Quick Install

1. **Install Python dependencies:**
```bash
pip install -r scripts/requirements.txt
```

Or manually:
```bash
pip install mss==9.0.1 Pillow==10.1.0
```

2. **Test Python capture (optional):**
```bash
python scripts/capture_roi.py
```
Then send a test command:
```json
{"action": "ping"}
```
Should respond with `{"success": true, "message": "pong"}`

## How It Works

- **Python script** (`capture_roi.py`) uses `mss` library for ultra-fast screen region capture (5-15ms)
- **Node.js wrapper** (`roiCapture.js`) manages the Python child process
- **Main process** exposes IPC handlers for the renderer to request captures
- **Renderer** uses Python capture instead of Electron's slow desktopCapturer

## Performance

- **Old method (Electron desktopCapturer):** 80-200ms per capture
- **New method (Python mss):** 5-15ms per capture
- **Speed improvement:** 10-20x faster! ⚡

## Usage in Renderer

The Python capture is automatically used when available. Fallback to Electron desktopCapturer if Python not installed.

## Troubleshooting

**Error: "Python not found"**
- Make sure Python is in your PATH
- Try `python --version` in terminal

**Error: "No module named 'mss'"**
- Run: `pip install -r scripts/requirements.txt`

**Slow captures still happening**
- Check logs for "WARNING: Slow capture" messages
- Verify Python process is running (check Task Manager)
