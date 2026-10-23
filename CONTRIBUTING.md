# Contributing to Talaria

Thanks for helping. Bug reports, fixes for Mac and Linux, new job-board sources and clearer wording are all welcome.

## Reporting a problem

Open an [issue](https://github.com/sehgalbhavya/talaria/issues/new/choose) and include:

- what you did, what you expected, and what happened instead
- your OS, `node --version` and `hermes --version`
- the text from the terminal window, and anything relevant on Talaria's **Activity** page

**Never paste anything from your `data/` folder, your resume, API keys or app passwords.** Remove names and email addresses from logs before sharing.

Found a security problem? Report it privately instead, as described in [SECURITY.md](SECURITY.md).

## Running it locally

```bash
git clone https://github.com/sehgalbhavya/talaria.git
cd talaria
npm install
npm run dev
```

`npm run dev` serves the web app with hot reload at http://localhost:5177 and the API at http://127.0.0.1:5178. You need Hermes installed and signed in for any AI feature to work (see the README).

To keep your real job hunt separate from your test data, point the dev server at another folder:

```bash
TALARIA_DATA_DIR=./data-dev npm run dev
```

(On Windows PowerShell: `$env:TALARIA_DATA_DIR="./data-dev"; npm run dev`.)

## Before you open a pull request

1. `npm run typecheck` passes.
2. `npm run build` passes.
3. You tried the change in the running app.
4. Keep the pull request to one change, and say in the description what it does and how you checked it.

## Ground rules for the code

- **Nothing reaches an employer without the user pressing Finalize.** Autopilot may search and draft, never submit.
- **Never guess legal or personal answers** (work authorization, visas, demographics) on application forms.
- All AI calls go through `server/lib/hermes.ts`. Don't add direct calls to a model provider.
- User data lives only under `TALARIA_DATA_DIR`. Don't write it anywhere else, and never commit it.
- Match the style of the file you're editing. UI text is plain, friendly English for people who aren't technical.
- New job sources should use public, key-free feeds and behave politely (low request rates, no scraping behind logins).
