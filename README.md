Rust OBS Scene Toggle Helper (Electron)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee)](https://buymeacoffee.com/save5bucks)
[![Watch Tutorial](https://img.shields.io/badge/YouTube-Watch%20Tutorial-red?logo=youtube)](https://youtu.be/Q_JPHWbQ25c)

## 🎮 Protect Your Rust Base from Stream Snipers

**The Problem:** When you die in Rust, your death screen shows your exact map coordinates and base location. Stream snipers can use this information to raid your base while you're offline.

**The Solution:** This automated OBS scene switcher instantly hides your stream when you die or open the map, protecting your sensitive location data from viewers and potential raiders.

## ⚡ Features

- **🔒 Automatic Death Screen Detection** - Instantly switches to a "Be Right Back" scene when you die, hiding your coordinates
- **🗺️ Map Key Detection** - Automatically hides stream when pressing G (map key) to prevent base location leaks
- **🎯 Smart ROI Detection** - User-configurable screen region monitoring for reliable death screen detection
- **🖥️ System Tray Integration** - Runs quietly in the background while you stream
- **⚙️ OBS Integration** - Seamless connection via obs-websocket v5
- **🎨 Custom Branding** - Professional UI with custom skull icon

## 🚀 Installation

**Easy Installation:** Download the latest installer from the [Releases page](https://github.com/Save5Bucks/rust-hide-screen-on-death/releases) and run the setup executable.

## 📖 How It Works

This Electron app monitors your screen and communicates with OBS to automatically switch scenes when:
1. **Death Screen Detected** - When the Rust death screen appears, it switches to your configured "Death" scene (typically a BRB screen)
2. **Map Key Pressed** - When you hold G to open the map, it switches to your "Map" scene to hide coordinates
3. **Game Returns** - Automatically switches back to your "Live" scene when you respawn or close the map

## ⚙️ Setup Guide

### Prerequisites
- OBS Studio 28+ (includes obs-websocket v5)
- Windows 10/11

### OBS Configuration
1. Open OBS and go to **Tools** → **obs-websocket Settings**
2. Enable WebSocket server (default port: 4455)
3. Set a password for secure connection
4. Create three scenes in OBS:
   - **Live Scene** - Your normal gameplay stream
   - **Death/BRB Scene** - Shown when you die (hide coordinates)
   - **Map Scene** - Shown when viewing map (optional)

### App Configuration
1. Launch **Rust OBS Scene Toggle**
2. Enter your OBS connection details (host: localhost, port: 4455, password)
3. Click **Connect** and **Refresh Scenes**
4. Select your Live, Death, and Map scenes from the dropdowns
5. **Set Respawn Delay** (default: 200ms) - Prevents coordinate leaks by adding a buffer before returning to Live scene
6. Click **Select Death ROI From Screen** while on the Rust death screen
7. Draw a rectangle over a stable part of the death UI (like the skull icon)
8. Click **Start Monitoring**
9. Minimize to system tray and start streaming safely!

## 🛠️ Developer Setup

For developers who want to build from source:

### Quick Start
1. Install Node.js 18+
2. Clone the repository: `git clone https://github.com/Save5Bucks/rust-hide-screen-on-death.git`
3. Install dependencies: `npm install`
4. Start the app: `npm start`

### Optional: Enable Map Key Detection
- The app attempts to load `iohook` for global G key capture
- To enable: `npm i iohook` (requires native build tools)
- Without it, only death detection will function

### Build Installer
- Run `npm run dist` to create the NSIS installer for Windows
- Output: `dist/Rust OBS Scene Toggle Setup 0.1.0.exe`

### Project Structure
- `src/main/*` – Main process, OBS client, preload, key monitoring
- `src/renderer/*` – UI and death detection via screen capture + ROI comparison
- `assets/` – Icons and future assets
- `build/` – Build configuration and icons for packaging

## 🎯 Use Cases

- **Rust Streamers** - Protect base coordinates from stream snipers
- **Content Creators** - Professional scene transitions during death/respawn
- **Competitive Players** - Prevent strategic information leaks
- **Community Servers** - Maintain fair play on stream

## ❓ Troubleshooting & FAQ

### Connection Issues

**Q: Can't connect to OBS?**
- Verify OBS is running
- Check that obs-websocket is enabled: **Tools** → **obs-websocket Settings**
- Confirm the port (default: 4455) and password match
- Make sure no firewall is blocking localhost connections
- Try restarting OBS

**Q: "Authentication failed" error?**
- Double-check your obs-websocket password in OBS settings
- Ensure you're using the correct password (not your OBS Studio password)

### Detection Issues

**Q: Death screen not being detected?**
- Make sure you selected the ROI (Region of Interest) while the death screen was visible
- Try selecting a different area of the death screen (avoid changing elements)
- The skull icon or static text areas work best
- Ensure your monitor resolution hasn't changed since setting the ROI
- Re-select the ROI if you've changed game resolution or display settings

**Q: False detections happening?**
- Your ROI might be too generic - try selecting a more unique part of the death screen
- Avoid selecting areas with animations or changing elements
- Make the ROI smaller and more specific

**Q: Map key (G) not working?**
- Map key detection requires `iohook` which needs native build tools
- If you see "iohook not loaded" in the UI, only death detection will work
- To enable: Install Visual Studio Build Tools, then run `npm i iohook`
- Alternatively, rely on death detection only (most streamers prefer this)

**Q: What is Respawn Delay and why do I need it?**
- The app may detect your respawn faster than the game clears the screen
- Without a delay, coordinates/location might briefly flash on stream during the transition
- Default 200ms delay provides a safe buffer to ensure the game UI has fully transitioned
- Adjust higher (300-500ms) if you still see brief flashes
- Adjust lower (100-150ms) if the delay feels too long

**Q: My coordinates/location still show briefly when I respawn?**
- Increase the Respawn Delay value (try 300ms or 500ms)
- The app works faster than the game UI transitions
- Higher delay = more protection, but slightly longer scene switch

### Performance Issues

**Q: App causing lag or high CPU usage?**
- The screen capture runs every second by default
- Close other screen recording/capture applications
- Try selecting a smaller ROI area
- Ensure you're running the latest version

**Q: OBS scenes switching slowly?**
- Check your OBS websocket connection is stable
- Reduce the number of sources in your scenes
- The switch happens within 1-2 seconds of detection (normal latency)
- Note: The Respawn Delay (200ms default) adds a buffer before returning to Live - this is intentional!

### General Questions

**Q: Does this work with Streamlabs OBS?**
- This app is designed for OBS Studio with obs-websocket v5
- Streamlabs OBS has different API requirements
- We recommend using OBS Studio 28+ for best compatibility

**Q: Can I use this for other games?**
- The death detection is Rust-specific (looks for Rust's death screen)
- However, you can modify the ROI detection for other games' death/menu screens
- The map key (G) detection works with any application

**Q: Will this get me banned?**
- No, this app only reads your screen and controls OBS
- It does not modify game files or memory
- It's completely external to the game
- Many popular Rust streamers use similar scene-switching tools

**Q: Does it work on multiple monitors?**
- Currently, it captures from your primary monitor
- Multi-monitor support is planned for future versions

**Q: Can I minimize the app?**
- Yes! Click the X button to minimize to system tray
- Double-click the tray icon to restore
- Right-click the tray icon for quick access to Show/Quit options

### Still Need Help?

- Check the [Issues](https://github.com/Save5Bucks/rust-hide-screen-on-death/issues) page for similar problems
- Open a new issue with details about your setup and the problem
- Include screenshots if possible

## 🤝 Contributing

Contributions are welcome! This project is open source and community-driven.

**Future Ideas:**
- Better template matching with OpenCV.js
- Configurable key capture settings
- Multi-monitor support
- Custom hotkeys
- Discord integration for offline notifications

## 💖 Support

If this tool helps protect your Rust base, consider supporting development:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-yellow?logo=buy-me-a-coffee)](https://buymeacoffee.com/save5bucks)

## 📝 License

MIT License - See [LICENSE](LICENSE) file for details.

---

**Made with ❤️ by [save5bucks](https://github.com/Save5Bucks) for the Rust streaming community**
