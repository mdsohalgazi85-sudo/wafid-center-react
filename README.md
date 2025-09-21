# Wafid Center Helper (React + Vite)

Fresh Chrome extension that injects a React helper panel on `https://wafid.com/appointment/` for selecting Bangladeshi medical centers.

## Features
- Detects the medical center `<select>` and appends every Bangladesh code grouped by city.
- Floating **Centers** button opens a searchable React panel; picking an entry fills the official form field and dispatches the site change events.
- Runs only on the WAFID appointment domain and ships as a single bundled content script (`content.js`).

## Getting started
1. Install dependencies:
   ```bash
   npm install
   # or: yarn install / pnpm install
   ```
2. Build the extension assets:
   ```bash
   npm run build
   ```
   The bundled files live in `dist/` (manifest + `content.js`).
3. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable **Developer mode**
   - Click **Load unpacked** and choose the `dist` folder
   - Visit `https://wafid.com/appointment/` and use the **Centers** button

## Development notes
- Source lives under `src/content`. The full center catalogue is defined in `src/content/centers.ts`.
- Update `public/manifest.json` if you need additional permissions or assets.
- Vite builds the content script in library mode (IIFE) so React and dependencies are bundled—no extra scripts required in the manifest.
- Automated tests are not included in this starter; validate manually after changes.
# wafid-center-react
