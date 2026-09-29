# Namaa — Medical Study Space

An independent, local-first medical study demo with original sample material. It is not affiliated with any other study product, and its sample questions, notes, cases, and flashcards are illustrative—not clinical guidance.

## Run locally

Open `public/index.html` in a modern browser, or serve the repository root with a static file server and visit `/public/`. There are no package dependencies or build step. Progress, bookmarks, and preferences are saved in the browser's local storage.

For local Cloudflare Pages development, install Wrangler separately and run `wrangler pages dev` from the repository root. This serves the static app from `public/` and the optional `functions/api/status.js` scaffold at `/api/status`.

## Public GitHub Pages

The repository includes a GitHub Actions workflow for GitHub Pages. It publishes the static `public/` app on pushes to `main` or this feature branch and uses GitHub's short-lived `GITHUB_TOKEN`/OIDC permissions; it does not need a provider API key. The repository owner must enable **Settings → Pages → Build and deployment → GitHub Actions** before a workflow run can publish. The Pages function is not included in this static deployment, and the demo still works without an API. No Cloudflare resources are required.

## API configuration

The client currently uses local demo data and does not call a study API. When an API is available, set `API_BASE_URL` as a **server-side Cloudflare Pages environment variable**; the status scaffold reports only whether it is configured and never returns its value. For local Pages Functions, copy `.dev.vars.example` to `.dev.vars` and set the URL there. `.dev.vars` is ignored by Git.

`.env.example` documents the optional public `VITE_API_BASE_URL` convention for a future bundled client; it is not read by this static build. Never place API tokens, private keys, or other secrets in browser-visible environment variables or committed files.

## Included demo workflows

- Dashboard, daily goal, streak, activity history, progress summaries, and achievements.
- Question Studio with original specialty packs, content/custom sessions, tutor/timed modes, source/progress/type/difficulty filters, MCQ/written questions, flags, explanations, and a review tracker.
- Learning hub, searchable article summaries with a reading toolbar, local notes/highlights and bookmarks, flashcards with spaced-repetition scheduling and Anki TSV export, original OSCE communication checklists, and text-only video-lesson demos with specialty folders and local progress.
- Profile hub with local study notes, account/session placeholders, appearance and language preferences, keyboard shortcuts, device options, and categorized settings.
- Local backup export/import, bundled-content offline shell, and clearly marked unavailable account sync, AI, and support integrations.
- Arabic RTL interface with an English toggle; preferences and demo progress persist locally. All medical examples are original, small, and illustrative—not clinical guidance.

The repository is configured for Cloudflare Pages static hosting and a Pages Function. GitHub Pages deployment is configured in Actions, but the site must be enabled in repository settings before a run can publish it.
