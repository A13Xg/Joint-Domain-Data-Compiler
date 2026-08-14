---
name: run-desktop
description: Launch and drive the JDDC Electron desktop app, run smoke tests, take screenshots, interact with the workbench
---

# Running JDDC Desktop App

JDDC is a single-user trajectory analysis workbench that runs as a desktop Electron app. This skill builds the app for your platform, launches it with remote debugging enabled, and provides a programmatic driver for testing and automation.

The driver handles platform differences (Linux/macOS/Windows), runs the app headless via xvfb on Linux, connects to the Chrome DevTools protocol, and exposes commands for taking screenshots, running smoke tests, and driving the UI.

## Prerequisites

**All platforms:**
- Node.js 22+ (check with `node --version`)
- npm (comes with Node.js)

**Linux only:**
- xvfb (virtual X11 display)
- ImageMagick or GNOME Screenshot (for screenshots)

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install -y xvfb imagemagick
```

## Build

Build the desktop app for your platform. This creates an unpacked Electron app in `release/`.

```bash
npm run build:desktop
```

The build outputs depend on your platform:
- **Linux:** `release/linux-unpacked/joint-domain-data-compiler`
- **macOS:** `release/mac/Joint Domain Data Compiler.app/Contents/MacOS/Joint Domain Data Compiler`
- **Windows:** `release/win-unpacked/JointDomainDataCompiler.exe`

## Run: Agent Path

The driver runs Electron with remote debugging enabled, connects to the Chrome DevTools protocol, and provides a command interface. Use this from automation or scripting.

### Interactive REPL Mode

```bash
node .claude/skills/run-desktop/driver.mjs
```

This enters an interactive shell where you can type commands:

```
jddc> launch
jddc> smoke
jddc> ss screenshot.png
jddc> wait 1000
jddc> quit
```

### Command Mode

Run a single command and exit:

```bash
# Build and launch
node .claude/skills/run-desktop/driver.mjs build
node .claude/skills/run-desktop/driver.mjs launch

# Verify the app mounted
node .claude/skills/run-desktop/driver.mjs smoke

# Take a screenshot
node .claude/skills/run-desktop/driver.mjs ss app.png

# Clean up
node .claude/skills/run-desktop/driver.mjs quit
```

### Available Commands

- **build** — Compile the desktop app for your platform
- **launch** — Start the app with debugging port enabled (~5 seconds to launch)
- **smoke** — Verify the app renderer mounted and the workbench is responsive (runs after launch)
- **ss [filename]** — Take a screenshot of the current window (default: `screenshot-{timestamp}.png`)
- **wait MS** — Wait for N milliseconds (useful between actions)
- **eval EXPR** — Evaluate JavaScript in the app's renderer (advanced)
- **info** — Show current process and screenshot directory
- **quit** — Close the app and clean up
- **help** — Show all commands

### Typical Workflow (Automation)

```bash
# Build once
node .claude/skills/run-desktop/driver.mjs build

# Start the app
node .claude/skills/run-desktop/driver.mjs launch

# Wait for startup
node .claude/skills/run-desktop/driver.mjs wait 3000

# Verify it's running
node .claude/skills/run-desktop/driver.mjs smoke

# Take before screenshot
node .claude/skills/run-desktop/driver.mjs ss before.png

# Your test/interaction steps here...

# Take after screenshot
node .claude/skills/run-desktop/driver.mjs ss after.png

# Clean up
node .claude/skills/run-desktop/driver.mjs quit
```

## Run: Human Path

To see the app open in a window (only practical on a machine with a display):

```bash
# Option 1: Build and launch the dev server
npm run dev:desktop

# Option 2: Launch a packaged build
npm run build:desktop
npm run check:desktop:linux    # Linux
npm run check:desktop:mac      # macOS
npm run check:desktop:win      # Windows
```

The first time you run the app, it presents an import dialog. You can drag files in or use the file picker to select a trajectory file (CSV, GPX, KML, NMEA, GeoJSON, EAG TSPI, or GPB format).

## Gotchas

**Linux: No screenshot file**  
If `ss` fails and says "Screenshot failed," ImageMagick may not be installed:
```bash
sudo apt-get install imagemagick
```

**Linux: Graphics mode issues**  
The app uses WebGL for 3D rendering. On some headless systems, even with xvfb, GPU access may be unavailable. The app falls back to software rendering, but charts/maps may not display fully in screenshots.

**App takes ~5 seconds to start**  
Electron has startup overhead. The `launch` command returns once the debugger port is open, not when the workbench is fully mounted. Use `smoke` to verify the workbench is ready.

**Smoke test is strict**  
The `smoke` command waits up to 30 seconds for the React workbench to mount and the title to match "Joint Domain Data Compiler". If the title is off or React fails to mount, the smoke test fails.

**WebSocket timeout during eval/smoke**  
If you run `eval` or `smoke` while the app is still loading heavy data, the DevTools websocket may timeout. Use `wait` to add delays between operations.

**Screenshots only on Linux in this driver**  
The driver currently only implements screenshots on Linux (via ImageMagick or gnome-screenshot). macOS and Windows support is planned — for now, use native screenshot tools or `npm run dev:desktop` to see the window.

## Troubleshooting

**Build fails with TypeScript error**  
Ensure TypeScript compilation succeeds:
```bash
npx tsc -b
```

**"Executable not found" on launch**  
The build step was skipped. Run:
```bash
node .claude/skills/run-desktop/driver.mjs build
```

**Smoke test times out with "Renderer didn't become ready"**  
- Check that the Electron app started (look for log output)
- Ensure xvfb is running on Linux: `ps aux | grep Xvfb`
- Try `wait 5000` then `smoke` again — the debugger port may take time to open
- Check for Electron startup errors in the app's stderr

**"Workbench did not mount" after renderer appears**  
The Electron window opened, but the React app did not render. This usually means a JS error during mount. Try:
```bash
node .claude/skills/run-desktop/driver.mjs quit
npm run build:desktop
node .claude/skills/run-desktop/driver.mjs launch
node .claude/skills/run-desktop/driver.mjs wait 5000
node .claude/skills/run-desktop/driver.mjs smoke
```

**App crashes on startup**  
Check the Electron logs and ensure all dependencies are installed:
```bash
npm ci
npm run build:desktop
```

**Interactive mode hangs after a command**  
Press Ctrl+C to interrupt and exit. The app will be cleaned up on exit.
