# GradeLens

AI-assisted assignment evaluation for faculty. Teachers register classes, upload assignment questions, let AI write the answer key, and evaluate every handwritten submission from a Google Drive folder or a Google Form responses sheet. The app flags copied work and exports the marks to Excel, Google Sheets or PDF.

**One codebase, three platforms:**

| Platform | How it runs |
|---|---|
| PC / laptop | Web app (open the URL in Chrome/Edge, then "Install app") |
| Android | Capacitor app (APK / Play Store AAB) |
| iPhone / iPad | Capacitor app (needs a Mac with Xcode to build) |

```
gradelens/
├── app/       React + Vite + Tailwind frontend, Capacitor (android/ is ready, iOS is added on a Mac)
├── server/    Node.js + Express + PostgreSQL (Drizzle ORM) backend: Google login, Drive/Sheets, Claude, exports
├── docs/      Screenshots, privacy policy template
├── render.yaml  One-click deploy blueprint for Render
└── package.json Root scripts used for deployment (build both, start server)
```

---

## 1. Run it on your computer (VS Code)

Requirements: **Node.js 20 or 22**, **Git**, and **PostgreSQL** (or a free cloud database from [neon.tech](https://neon.tech) — easiest).

```bash
# 1) Backend
cd server
npm install
cp .env.example .env        # Windows: copy .env.example .env
# Fill DATABASE_URL, JWT_SECRET, TOKEN_ENCRYPTION_KEY (see the comments in the file)
# For a first look without Google/Claude keys also set: DEV_LOGIN=true
npm run seed:demo           # optional: demo classes, students and results
npm run dev                 # API on http://localhost:8080 (tables are created automatically)

# 2) Frontend (new terminal)
cd app
npm install
npm run dev                 # open http://localhost:5173
```

With `DEV_LOGIN=true` the login screen shows **Continue in demo mode** — use it to click through every screen with the demo data. Turn it off (and never enable it) in production; the server ignores it when `NODE_ENV=production`.

> Tip: create the two secrets with
> `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (JWT_SECRET) and
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (TOKEN_ENCRYPTION_KEY).

---

## 2. Google Cloud setup (Google sign-in + Drive access)

1. Open [console.cloud.google.com](https://console.cloud.google.com) → create a project, e.g. **GradeLens**.
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Sheets API**.
3. **OAuth consent screen**
   - User type: **Internal** if your Google account belongs to the college Google Workspace (only college accounts can sign in, no Google review needed). Otherwise **External**.
   - App name: GradeLens, support email, logo (optional).
   - Scopes: `openid`, `email`, `profile`, `.../auth/drive.readonly`, `.../auth/drive.file`.
   - External + Testing: add each teacher's email under **Test users** (max 100).
4. **Credentials → Create credentials → OAuth client ID → Web application**
   - Authorised redirect URI: `https://YOUR-SERVER/api/auth/google/callback`
     (local: `http://localhost:8080/api/auth/google/callback`)
   - Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

The same Web client is used by the PC, Android and iOS apps: phones sign in through the system browser and the app picks up the session automatically, so no Android/iOS OAuth client or SHA-1 key is needed.

**Important for publishing:** `drive.readonly` is a *restricted* Google scope.
- *Internal* (Workspace) apps: no verification needed.
- *External* apps in **Testing** mode: works for test users, but Google signs users out of Drive every **7 days** (teachers just sign in again).
- *External* apps in **Production** for everyone: Google requires app verification and a security assessment for restricted scopes. For a college rollout, ask the college IT admin to create the project inside the college Workspace (Internal) — this is the simplest route.

Set `ALLOWED_EMAIL_DOMAINS=gehu.ac.in` (for example) so only college accounts can sign in.

---

## 3. Claude API

1. Create a key at [platform.claude.com](https://platform.claude.com) → API keys → put it in `ANTHROPIC_API_KEY`.
2. In the Console set a **monthly spend limit** (Billing / Limits) so a bug can never overspend.
3. Models used (change in `.env` if needed):
   - `claude-haiku-5-5` grades every submission (fast, cheapest).
   - `claude-sonnet-5-5` writes answer keys and automatically re-checks unclear / low-confidence submissions ("Second AI opinion", can be turned off in Settings).
4. Throughput depends on your Claude API rate-limit tier. `EVAL_CONCURRENCY=5` is a safe start; raise it to 10–20 when your tier allows it. Rate-limit errors are retried automatically.

The app shows the AI cost of each assignment (Results header) and the total (Settings → About).

---

## 4. Deploy (free tier): Neon + Render

1. **Database:** create a project on [neon.tech](https://neon.tech) → copy the connection string (`postgresql://…?sslmode=require`).
2. Push this folder to a **private** GitHub repository.
3. On [render.com](https://render.com) → **New → Blueprint** → select the repo (it reads `render.yaml`).
4. Fill the environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `PUBLIC_API_URL` | Your Render URL, e.g. `https://gradelens.onrender.com` |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters (see tip above) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 2 |
| `ANTHROPIC_API_KEY` | From step 3 |
| `ALLOWED_EMAIL_DOMAINS` | e.g. `gehu.ac.in` (optional) |

5. Add `https://gradelens.onrender.com/api/auth/google/callback` as a redirect URI in Google Cloud.
6. Open the URL → the PC/web version is live. Teachers can click **Install** in Chrome/Edge to use it like a desktop app.

**Free-plan notes:** Render's free server sleeps after ~15 minutes without traffic (first request then takes ~1 minute) and an interrupted evaluation resumes automatically when it wakes. For daily college use, a paid instance (~$7/month) or any always-on server is recommended. A free uptime pinger (e.g. UptimeRobot hitting `/api/health` every 10 minutes) keeps it awake.

---

## 5. Android app

```bash
cd app
# Point the app at your server (REQUIRED for phones)
echo VITE_API_URL=https://gradelens.onrender.com > .env
npm run cap:android        # builds the web app, syncs it into android/ and opens Android Studio
```

In Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK** (to share the file directly) or **Generate Signed Bundle** (AAB for Play Store).

Before publishing:
- Change `appId` in `app/capacitor.config.ts` (e.g. `com.mridulpurohit.gradelens`) **and** `applicationId` / `namespace` in `app/android/app/build.gradle`. It cannot change after release.
- Replace the placeholder "GL" logo: put a 1024×1024 `icon-only.png` (and `splash.png`) in `app/assets/` and run `npx @capacitor/assets generate --android`.
- Play Console needs a **privacy policy URL** (template in `docs/PRIVACY_POLICY.md`) and the Data safety form (Google account email, name, student work processed by Claude API). Account deletion is built in: Settings → Delete account.

## 6. iPhone / iPad app (needs macOS)

```bash
cd app
npx cap add ios
npx @capacitor/assets generate --ios
npm run cap:ios                   # opens Xcode
```
In Xcode set your Team (Apple Developer account, $99/year), bundle identifier, then **Product → Archive** to upload to TestFlight / App Store. Without a Mac, teachers on iPhone can use the web app from Safari → Share → **Add to Home Screen**.

---

## 7. How teachers collect submissions

**Option A – Google Drive folder** (share the folder with the teacher's Google account)
- Files named with the roll number, e.g. `MCA23001_Aarav.jpg`, `MCA23001_page2.jpg`, **or**
- one sub-folder per student named with roll number or name.
- Photos (JPG/PNG/HEIC), PDFs, DOCX and Google Docs are supported (max 12 pages per student).

**Option B – Google Form** with a *File upload* question (plus Name and Roll number questions). Link the **responses sheet**. Files uploaded through Forms already belong to the teacher's Drive. If a student submits twice, the latest response is used.

Unmatched uploads are still evaluated; GradeLens reads the name/roll number written on the paper and the teacher can assign the rest manually.

**Tips for students (better accuracy):** clear daylight photo from straight above, one page per photo, blue/black pen, name + roll number on the first page.

---

## 8. How evaluation works

1. Teacher uploads questions (PDF / image / DOCX, extracted by AI) or types them, with marks.
2. AI writes a model answer and a marking scheme (points add up exactly to the marks). The teacher edits and approves each question — evaluation cannot start before that.
3. Each submission is downloaded, straightened, contrast-enhanced and graded question-by-question against the marking scheme (strictness: Lenient / Standard / Strict). Marks can never exceed the maximum; text written in a submission is treated as student work, never as instructions.
4. Low confidence, poor handwriting or concerns → **Needs Review** (and a second opinion from the stronger model).
5. Integrity checks (toggle per assignment and in Settings):
   - **Duplicate image** – the same photo/scan uploaded by two students (re-compressed copies included).
   - **Copied text** – answers with very similar wording (from an AI transcript of each paper).
   - **Handwriting verification** – compares the first page with the student's earlier verified submission.
   Flags are indicators, not proof; the teacher confirms ("Mark as copied" sets marks to 0) or dismisses them.
6. Teacher reviews, edits marks, approves (or "Approve all clean"), and exports.

Approximate cost (300 students, ~4 pages each): about ₹40–80 with Haiku, more when many papers need the Sonnet second opinion.

---

## 9. Tests

```bash
cd server
# needs a PostgreSQL database for the API tests (default: postgresql://gradelens:gradelens@localhost:5432/gradelens_test)
npm test
```
Covers roster parsing, student matching, Google link parsing, Form-response parsing, text similarity, duplicate-image fingerprints, AI output clamping, and the full API flow (class → assignment → answer key → evaluation → fraud flags → approve → Excel/PDF/Sheets export → account deletion) with Google and Claude mocked.

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| "Unable to access this link" | Share the folder/sheet with the same Google account you signed in with. |
| "Google Drive access has expired" | Sign in again (Testing-mode apps expire every 7 days). |
| "Google Drive/Sheets API is not enabled" | Enable both APIs in Google Cloud (step 2). |
| "The Claude API key is not configured" | Set `ANTHROPIC_API_KEY` and restart the server. |
| Phone app cannot connect | `VITE_API_URL` missing or wrong in `app/.env`; rebuild with `npm run cap:android`. |
| Evaluation paused | Open the progress screen: the reason is shown with a **Resume** button. |
| New icon shows as text | Run `python scripts/subset-icons.py` in `app/` (needs `pip install fonttools brotli`). |

## 11. Known limitations
- AI marks are suggestions: the teacher must review them.
- Duplicate-image detection catches re-uploads of the same photo; a *new photo* of someone else's copy is caught by the text-similarity check instead.
- Handwriting verification needs at least one earlier evaluated submission of the same student in the same class.
- Notifications are in-app (bell icon); there are no push notifications yet.
