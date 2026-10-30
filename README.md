# Campus Pulse

Campus Pulse is a live, student-powered issue map for CPUT District Six. Its core loop is simple: report an issue, ask **“Is this still happening?”**, and let nearby students confirm or clear it. The frontend is deliberately retro-futurist: a 2016/Y2K interface with neon cyan, glass panels, scanlines, and a playful **Built with AI** identity.


## Run locally

1. Install Node.js 18+.
2. Copy `.env.example` to `.env` and set a long `JWT_SECRET`.
3. Install dependencies: `npm install`
4. Start the app:
   - Windows PowerShell when script execution is restricted: `npm.cmd start`
   - Windows shortcut: double-click `start.cmd`
   - macOS/Linux: `npm start`
5. Open `http://localhost:3000/index.html`.

For development with automatic server restarts, use `npm.cmd run dev` in restricted
PowerShell, or double-click `dev.cmd`.

The SQLite database is created as `campus-pulse.db` on first start. It starts empty by design. The schema is also available in [schema.sql](./schema.sql).
