# AV Control Rack - Codex Project Guide

## Goal

Build a browser-based live visual control surface for TouchDesigner workflows. The app combines a canvas visualizer with microphone analysis, Web MIDI input, and OSC output through the local Node.js server.

## Project Structure

- `index.html`: control layout and visual output canvas.
- `styles.css`: responsive rack and stage styling.
- `app.js`: UI state, canvas rendering, audio analysis, MIDI mapping, and API calls.
- `server.js`: static HTTP server and UDP OSC bridge.
- `README.md`: setup and operator-facing connection details.

## Run And Verify

Use Node.js 18 or newer. There are currently no third-party dependencies.

```bash
npm start
```

Open `http://localhost:4173`. Before finishing a change, verify:

1. The page loads without browser console errors.
2. Scene buttons, sliders, BLACK, FREEZE, and RND work.
3. `POST /api/param` still returns a successful JSON response.
4. Responsive layouts do not overlap on desktop or mobile.
5. Changes involving audio or MIDI are tested in a compatible browser with permission granted.

## Development Constraints

- Keep the project dependency-free unless a dependency materially reduces complexity.
- Keep control values normalized from `0` to `1` unless the OSC contract is intentionally changed.
- Preserve the `/av/<parameter>` OSC address convention and document any new addresses in `README.md`.
- Treat `OSC_HOST`, `OSC_PORT`, and `PORT` as runtime configuration; do not hard-code machine-specific addresses.
- Do not commit secrets, local environment files, generated logs, or `node_modules`.
- Maintain the current direct, dense control-surface design rather than turning it into a marketing page.

## Git Collaboration

Start each work session with `git pull --rebase`. Keep commits focused and push completed work to GitHub so the other computer can receive it. Before pushing, pull again and resolve any conflicts locally. Do not overwrite or discard work from the other machine.
