# Namaa — Medical Study Space

An independent, local-first medical study demo with original sample material. It is not affiliated with any other study product, and its sample questions, notes, cases, and flashcards are illustrative—not clinical guidance.

## Run locally

Open `public/index.html` in a modern browser, or serve the repository root with a static file server and visit `/public/`. There are no package dependencies or build step. Progress, bookmarks, and preferences are saved in the browser's local storage.

For local Cloudflare Pages development, install Wrangler separately, copy `.dev.vars.example` to `.dev.vars`, configure a local D1 database, and run `wrangler pages dev public` from the repository root. Pages Functions are in `functions/`; schema changes are in `migrations/`.

## Public GitHub Pages

The repository includes a GitHub Actions workflow for GitHub Pages. It publishes the static `public/` app on pushes to `main` or feature branches and uses GitHub's short-lived `GITHUB_TOKEN`/OIDC permissions; it does not need a provider API key. The repository owner must enable **Settings → Pages → Build and deployment → GitHub Actions** before a workflow run can publish. GitHub Pages does not run Cloudflare Pages Functions, so Google login, D1, sync, and the admin panel are unavailable there. The public study app remains a local browser-storage demo and does not pretend that account or sync operations succeeded.

## Cloudflare Pages API setup

The backend uses Cloudflare Pages Functions and D1 only; it does not use R2, paid services, or external storage. Free-plan quotas and feature limits apply and may change. Nothing in this repository provisions resources or deploys the app. Do not configure credentials in GitHub Pages or commit secrets.

1. Create a Cloudflare Pages project connected to this repository with the repository root as the project root, no build command, and `public` as the build output directory. Pages Functions are discovered from the root `functions/` directory.
2. Create a D1 database named `namaa-db` on the free plan. Replace the all-zero placeholder `database_id` in `wrangler.toml` with the new database ID and add the same `DB` D1 binding in the Pages project's production settings. For local development, the placeholder ID is sufficient for Wrangler's local D1 emulator.
3. Apply migrations from the repository root using Wrangler: `npx wrangler d1 migrations apply namaa-db --local` for local development, or `npx wrangler d1 migrations apply namaa-db --remote` when the owner is ready to initialize the remote database. The remote command changes the database; it is not part of this implementation task.
4. Create a Google OAuth 2.0 **Web application** client. Add the exact authorized redirect URI `https://YOUR-CLOUDFLARE-PAGES-HOST/api/auth/google/callback` (or the configured custom domain equivalent) in Google Cloud Console. Do not use a frontend identity claim; the Functions exchange the authorization code with PKCE and retrieve the verified profile from Google's userinfo endpoint.
5. In Cloudflare Pages **Settings → Environment variables**, set `APP_ORIGIN` to the exact site origin with no path, such as `https://YOUR-CLOUDFLARE-PAGES-HOST`, and set `GOOGLE_CLIENT_ID`. Add `GOOGLE_CLIENT_SECRET` and `ADMIN_EMAILS` as encrypted secrets; the latter is a comma-separated allowlist of trusted administrator email addresses. Set variables/secrets only for environments that should accept sign-in. Never paste secret values into chat, source control, or browser-visible settings.
6. For local testing, copy `.dev.vars.example` to `.dev.vars`, replace its placeholders locally, and use `wrangler pages dev public`. `.dev.vars` is ignored by Git. Add the Google redirect URI `http://localhost:8788/api/auth/google/callback` only if Google OAuth is being tested against the local Pages dev server. The D1 local emulator is separate from the remote database.

**Authentication and authorization:** student registration is open to any Google account with a verified email. The app accepts no client-supplied role. Effective admin privileges are determined on every request from `ADMIN_EMAILS`; no API can grant roles and stored role values do not override the allowlist. Admins can view aggregate data and student accounts, then suspend/reactivate individual student accounts. Admin accounts cannot be changed through this panel; suspension revokes the student's active sessions. Every successful status change is audit logged. The admin panel is at `/admin.html`.

**Cookie and API contract:** session cookies are opaque, hashed in D1, HttpOnly, Secure, SameSite=Lax, and expire after seven days. The separate Secure SameSite=Lax CSRF cookie is readable by same-origin JavaScript; send its value as `X-CSRF-Token` on every mutation. Mutation routes enforce exact `Origin`, session, and CSRF-token checks; the API does not enable cross-origin access. OAuth state and PKCE verifier records expire after ten minutes and are consumed once. Request bodies and request rates are bounded.

| Route | Contract |
|---|---|
| `GET /api/status` | `200 {status:"available",apiConfigured:true}` when required bindings/config exist; otherwise `503` without exposing values. |
| `GET /api/auth/google/start` | Redirects to Google; state and PKCE are server-generated. |
| `GET /api/auth/google/callback` | Validates state, exchanges the code server-side, requires Google's `email_verified: true`, issues session + CSRF cookies, and redirects to `/admin.html`. |
| `GET /api/auth/me` | Returns `{authenticated:false,user:null}` or `{authenticated:true,user:{id,email,displayName,role},csrfToken}`. |
| `POST /api/auth/logout` | Requires `X-CSRF-Token`; returns `{ok:true}` and clears the cookies. |
| `GET /api/study/progress` | Returns the current user's `{items:[{itemKey,payload,updatedAt}]}`. |
| `PUT /api/study/progress/:itemKey` | CSRF-protected JSON `{payload:object}`; upserts only the current user's item. |
| `DELETE /api/study/progress/:itemKey` | CSRF-protected; removes only the current user's item. |
| `GET /api/study/saved` | Returns the current user's `{items:[{itemKey,kind,metadata,createdAt}]}`. |
| `PUT /api/study/saved/:itemKey` | CSRF-protected JSON `{kind,metadata?}`; upserts only the current user's item. |
| `DELETE /api/study/saved/:itemKey` | CSRF-protected; removes only the current user's item. |
| `GET /api/admin/overview` | Admin-only aggregate counts and a short list of recent audit action names. |
| `GET /api/admin/users?limit=50&offset=0` | Admin-only paged student/admin account metadata; never returns provider tokens or secrets. |
| `PATCH /api/admin/users/:id/status` | Admin + CSRF protected JSON `{status:"active"|"suspended"}`; no deletion, bulk operation, or role editing. |

API errors use `{error:{code,message}}`; session-owned records are always queried with the authenticated user ID. The static GitHub Pages deployment has no API functions and therefore cannot provide authentication or account sync. Do not claim login is live until a Cloudflare Pages project, D1 binding, Google client, and environment configuration have been configured by the owner.

`.env.example` is a placeholder for a future bundled public client and is not read by this static build. Never put API tokens, private keys, or other secrets in browser-visible environment variables or committed files.

## Included demo workflows

- Dashboard, daily goal, streak, activity history, progress summaries, and achievements.
- Question Studio with original specialty packs, content/custom sessions, tutor/timed modes, source/progress/type/difficulty filters, MCQ/written questions, flags, explanations, and a review tracker.
- Learning hub, searchable article summaries with a reading toolbar, local notes/highlights and bookmarks, flashcards with spaced-repetition scheduling and Anki TSV export, original OSCE communication checklists, and text-only video-lesson demos with specialty folders and local progress.
- Profile hub with local study notes, account/session placeholders, appearance and language preferences, keyboard shortcuts, device options, and categorized settings.
- Local backup export/import, bundled-content offline shell, and clearly marked unavailable account sync, AI, and support integrations.
- Arabic RTL interface with an English toggle; preferences and demo progress persist locally. All medical examples are original, small, and illustrative—not clinical guidance.

The repository has a Cloudflare Pages static output configuration and Pages Functions/D1 source. GitHub Pages deployment is configured in Actions, but the site must be enabled in repository settings before a run can publish it.
