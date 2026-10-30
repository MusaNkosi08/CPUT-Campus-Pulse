# Campus Pulse

Campus Pulse is a live, student-powered issue map for CPUT District Six. Its core loop is simple: report an issue, ask **“Is this still happening?”**, and let nearby students confirm or clear it. The frontend is deliberately retro-futurist: a 2016/Y2K interface with neon cyan, glass panels, scanlines, and a playful **Built with AI** identity.

## Pages

- `index.html` — parallax/zoom home hero and product-style explanation
- `about.html` — the confirmation loop and “How this was made (with AI)”
- `map.html` — full-bleed Leaflet live map with filters, search, pulse pins, and confirmation actions
- `profile.html` — student reports or staff resolver queue
- `login.html` / `register.html` — standalone authentication screens
- `report.html` — authenticated report flow with clickable Leaflet pin placement

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

## Roles

Registration creates a student account. Staff accounts must be promoted directly in SQLite:

```sql
UPDATE users SET role = 'staff' WHERE email = 'staff@cput.ac.za';
```

Guests can view the map. Authenticated students can report, confirm, and clear issues. Staff can additionally move an issue to `in_progress` or `resolved` through the API.

## API

JWT is passed as `Authorization: Bearer <token>`.

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/auth/register` | Guest |
| POST | `/api/auth/login` | Guest |
| GET | `/api/issues` | Guest |
| POST | `/api/issues` | Student/staff |
| POST | `/api/issues/:id/confirm` | Student/staff |
| POST | `/api/issues/:id/resolve` | Student/staff |
| PATCH | `/api/issues/:id/status` | Staff |

`GET /api/issues` accepts `category`, `status`, and `lat`, `lng`, `radius` filters. Issues that have not been confirmed for `STALE_WINDOW_HOURS` (48 by default) are automatically marked stale.

## Postman smoke-test checklist

1. Register a student and save the returned token.
2. `POST /api/issues` with a category, description, and District Six coordinates.
3. `GET /api/issues` and verify the pin appears.
4. `POST /api/issues/:id/confirm` and verify `confirmation_count` and `last_confirmed_at`.
5. `POST /api/issues/:id/resolve` and verify the issue no longer appears as active.
6. Promote a second account to staff and verify `PATCH /api/issues/:id/status` rejects students and accepts staff.

## 5-minute demo script

Opening line: **“Waze keeps drivers honest about what’s really on the road. Campus Pulse does the same for CPUT District Six.”**

1. Start on the clean landing page and introduce the “living map” concept.
2. Open the map as a guest and show the intentionally empty state.
3. Register as a student, report a campus issue, and show its pulsing pin and confirmation count.
4. Confirm “Still there” from the card/popup and point out the timestamp and `Confirmed 1×` transparency.
5. Select “It’s fixed” and show the signal leaving the active map.
6. Explain the 48-hour stale rule and staff status workflow.
