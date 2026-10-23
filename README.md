# Talaria

[![CI](https://github.com/sehgalbhavya/talaria/actions/workflows/ci.yml/badge.svg)](https://github.com/sehgalbhavya/talaria/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A job-hunt board that runs on your own computer.** An AI assistant finds jobs that fit you, tells you honestly where you stand, tailors your resume, writes your cover letters, and fills in application forms. **Nothing is ever sent to an employer until you say so.**

You don't need to know anything about AI or programming to use it. This guide starts from zero and walks you through every step. Set aside about **20 to 30 minutes** the first time.

**Contents:** [What you get](#what-you-get) · [Before you start](#what-you-need-before-you-start) · [Setup](#setup-step-by-step) · [Daily use](#using-talaria-day-to-day) · [Troubleshooting](#troubleshooting) · [Privacy](#your-data-and-privacy) · [Developers](#for-developers)

### Already comfortable with a terminal?

You need [Node.js](https://nodejs.org) 20.19+ and [Hermes Agent](https://github.com/NousResearch/hermes-agent) signed in to an AI provider (step 4 below). Then:

```bash
git clone https://github.com/sehgalbhavya/talaria.git
cd talaria
npm install
npm start
```

Open http://127.0.0.1:5178 and follow the setup screen. Everyone else, read on.

---

## What you get

| Column on the board | What happens there |
| --- | --- |
| **Discovered** | Talaria searches job boards and company career pages and drops good matches here, each with a fit score. |
| **Hermes is on it** | You hand a job to your AI assistant (called *Hermes*). It studies the job against your resume. |
| **Needs you** | Hermes asks you a few short questions (why this company? what should I lead with?). You answer, and it writes a tailored resume and cover letter. You refine them together, in plain words. |
| **Applied** | You press **Finalize**. Talaria submits the form for you (on Greenhouse, Lever and Ashby sites) or gives you a ready-to-use kit of PDFs and text to paste. |
| **Interviewing / Offer** | Track replies. Talaria can read your Gmail and move cards for you. |

**Your data stays on your computer.** The only things that leave it are the messages sent to your AI account and public job-board searches.

---

## Words you'll see

| Word | What it means |
| --- | --- |
| **Hermes** | A free program on your computer that acts as the AI assistant. It connects to an AI account you already have. |
| **Provider** | The company whose AI Hermes uses (OpenAI/ChatGPT, GitHub Copilot, and so on). |
| **Terminal** | A window where you type commands. On Windows it's called *PowerShell*. You only ever paste lines from this guide into it. |
| **Node.js** | A free program Talaria needs to run. |
| **Repository ("repo")** | The folder of Talaria's files on GitHub. |

---

## What you need before you start

1. **A computer** with an internet connection. Windows 10/11 is the best-tested. Mac and Linux should work too (see the notes in step 5).
2. **An AI account you already pay for or get free.** Pick **one**:
   - a **ChatGPT** plan (Plus, Pro or Business), which also covers Codex, **or**
   - **GitHub Copilot** (free for verified students and teachers), **or**
   - an **API key** from a provider such as OpenRouter, Google Gemini, Anthropic or OpenAI. (An API key is a long password that lets a program use an AI service. It's usually billed per use.)
3. **Your resume** as a PDF, Word file, text, or LaTeX file (`.tex` or an Overleaf `.zip`).
4. **Google Chrome is not required.** Talaria brings its own browser window for submitting forms.

---

## Setup, step by step

### Step 1: Install Node.js

1. Go to **https://nodejs.org**.
2. Click the big **LTS** download button and run the installer. Click *Next* through all the screens and keep the defaults.
3. **Restart your computer** (or at least close and reopen any terminal windows).

To check it worked, open a terminal (Windows: press the **Windows key**, type `PowerShell`, press Enter) and run:

```bash
node --version
```

You should see a number like `v22.11.0`. Version 20.19 or higher is fine.

### Step 2: Download Talaria

**Easiest way (no extra software):**

1. On this GitHub page, click the green **Code** button, then **Download ZIP**.
2. Right-click the ZIP file, choose **Extract All**, and pick a place you'll remember, such as your Desktop.
3. You now have a folder called `talaria-main` (or similar). This is "the Talaria folder".

**If you already use Git:**

```bash
git clone https://github.com/sehgalbhavya/talaria.git
```

### Step 3: Install Hermes (the AI assistant program)

Open a terminal and paste **one** line, depending on your computer, then press Enter and wait until it finishes (a few minutes).

**Windows (PowerShell):**

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

**Mac or Linux:**

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

**Close the terminal and open a new one**, then check it worked:

```bash
hermes --version
```

You should see something like `Hermes Agent v0.21...`.

> **Windows antivirus warning?** Some antivirus programs wrongly flag a file called `uv.exe` that Hermes installs. It's a safe, well-known tool. See the [Hermes README](https://github.com/NousResearch/hermes-agent) if yours complains.

### Step 4: Sign in to your AI account

You only do this once. Pick the option that matches what you have.

#### Option A: ChatGPT or Codex plan

```bash
hermes auth add openai-codex --type oauth
```

A browser window opens. Sign in to ChatGPT and approve. When the terminal says it's done, you're connected. There's no API key and no extra bill; it uses your plan's allowance. If you use it heavily you may hit your plan's limits, and Talaria will pause and retry automatically.

#### Option B: GitHub Copilot

1. Install the GitHub command-line tool. On Windows:

   ```powershell
   winget install --id GitHub.cli
   ```

   On Mac: `brew install gh`. On Linux, follow https://cli.github.com.

2. Sign in:

   ```bash
   gh auth login
   ```

   Choose *GitHub.com*, *HTTPS*, and *Login with a web browser*, then follow the prompts.

3. Make sure Copilot is switched on for your account at https://github.com/settings/copilot.

#### Option C: An API key (OpenRouter, Gemini, Anthropic, OpenAI, and others)

```bash
hermes model
```

It shows a menu. Pick your provider and paste your key when asked. Keep your key private. Never share it or post it online.

> You can also do this step later, from inside Talaria's setup screen (step 6). It shows the same commands with a **Copy** button and a **Test the connection** button.

### Step 5: Start Talaria

**Windows:** open the Talaria folder and **double-click `Talaria.bat`**.

The first time it installs everything it needs, which takes a few minutes. A black window appears and fills with text. That's normal. When it's ready, your web browser opens Talaria automatically at **http://127.0.0.1:5178**.

**Keep the black window open while you use Talaria.** Closing it stops the app. Next time, double-click `Talaria.bat` again and you're back where you left off.

**Mac or Linux:** open a terminal *inside the Talaria folder* and run:

```bash
./talaria.sh
```

It does the same as `Talaria.bat`: installs on first run, builds, starts the server and opens your browser at http://127.0.0.1:5178. (If you see *permission denied*, run `chmod +x talaria.sh` once first.) Talaria is built and tested on Windows, so please [report any Mac or Linux problems](https://github.com/sehgalbhavya/talaria/issues).

#### Optional extras (you can add these any time)

- **Submitting applications for you** needs a small browser download (about 150 MB). Run this in the Talaria folder, then restart Talaria:

  ```bash
  npx playwright install chromium
  ```

- **Keeping your LaTeX resume's exact design** needs a LaTeX program. Install **MiKTeX** from https://miktex.org (Windows) or **TeX Live** (Mac and Linux). If your resume is a PDF or Word file, you can skip this.

### Step 6: First-time setup in Talaria

The first time you open Talaria, a short guided setup walks you through everything:

1. **Welcome.** A one-minute explanation of how Talaria works.
2. **Connect the AI.** Talaria checks that Hermes is installed, asks which AI account you have, and shows you the exact sign-in command. Press **Test the connection**. When it says *It works!*, continue.
3. **Your resume.** Drag your resume in (or paste its text). Hermes reads it and builds your profile in about 30 seconds. It never invents experience you don't have.
4. **What you want.** Confirm the roles, locations, work mode and visa needs Hermes suggests, and add anything you'd like to include or avoid.
5. **Where to look.** Choose which job boards to search and whether **Autopilot** should search for new matches on its own every few hours.

Then press **Start the hunt**. A short tour of the board follows, and the first jobs show up in a minute or two.

---

## Using Talaria day to day

1. **Open `Talaria.bat`** and look at **Discovered**. Click a card to read the job and see your fit: why you'd get it, why you might not, and how to improve your odds.
2. **Not interested?** Dismiss it. **Interested?** Hand it to Hermes.
3. **Open the cards in "Needs you."** Answer Hermes's questions. It then drafts your resume and cover letter. In the workspace you can say things like *"lead with my design work"* or *"make the cover letter warmer"*. Every version is saved under **Versions**, so you can go back.
4. **Press Finalize & submit** when you're happy. Talaria opens the company's form in its own browser window, fills every field, attaches your files and submits. It saves a screenshot of every submission in `data/applications/`.
5. **Track replies.** Move cards to Interviewing or Offer, or let the Gmail connection do it.

**Keyboard shortcuts:** `Ctrl K` opens the command palette, `n` adds a job from a link you found, `/` filters the board, `Esc` closes a panel.

### Safety rules that always hold

- **Only applications you approved are submitted.** Autopilot never submits anything.
- **Legal and personal questions are never guessed.** Work authorization and visa answers use only what you've told Talaria. Diversity questions get *prefer not to say* or are left blank.
- **It stops and asks** when a form needs something it doesn't know. The question appears under *Needs you*, and your answer is remembered.
- **CAPTCHAs:** solve them yourself in Talaria's browser window and it carries on.
- Jobs on other sites (Workday, company portals and so on) use the **Apply kit**: PDFs plus copy buttons, so you can paste them in yourself.

### Optional connections (in Settings)

**Gmail replies.** Talaria reads replies to jobs you've applied to and moves the cards (a rejection turns a card red, an interview invitation moves it to Interviewing). It needs a Google **app password**, a special password just for this app:

1. Turn on 2-Step Verification for your Google account (https://myaccount.google.com/security).
2. Go to https://myaccount.google.com/apppasswords and create one named *Talaria*.
3. Paste it into **Settings → Gmail**. It's stored only on your computer, in `data/gmail.json`, and you can delete it in your Google account at any time.

**LinkedIn.** **Settings → LinkedIn → Connect** opens LinkedIn in Talaria's window and you sign in yourself; Talaria never sees your password. It reads up to 20 postings at a human pace and never uses Easy Apply. **LinkedIn's terms forbid automated access, so there is some risk to your account. Leave this off if that worries you.**

**Chat with your board from Hermes.** In Settings, Talaria shows a one-line command that lets you ask Hermes things like *"what's waiting on me?"* from a terminal.

---

## Troubleshooting

| Problem | What to do |
| --- | --- |
| **`node` is not recognized** | Close the terminal and open a new one. If it still fails, restart your computer, or reinstall Node.js (step 1). |
| **`hermes` is not recognized** | Close the terminal and open a new one. If it still fails, run the Hermes install line (step 3) again. |
| **The black window closes right away** | Open a terminal in the Talaria folder and run `npm install`, then `npm start`. Read the message it prints. |
| **The page says "Waiting for the Talaria server…"** | The black window was closed or is still starting. Reopen `Talaria.bat` and wait a minute. |
| **"Test the connection" fails for ChatGPT/Codex** | Run `hermes auth add openai-codex --type oauth` again and finish the browser sign-in. |
| **"Test the connection" fails for Copilot** | Run `gh auth login` again, and check Copilot is switched on at github.com/settings/copilot. The model may also need enabling there. |
| **Answers are very slow or paused** | Your AI plan's limit was reached. Talaria pauses and retries when it resets. You can switch models in **Settings**. |
| **Resume won't upload** | If it's a scanned PDF, paste the text instead. Photos of text can't be read. |
| **LaTeX resume won't compile** | Install MiKTeX (see optional extras) and restart Talaria. |
| **Applications won't submit** | Run `npx playwright install chromium`, then restart. Then check **Settings → Applying → Submit applications for me** is on. |
| **Port 5178 is already in use** | Talaria is probably already running in another window. Close it, or open http://127.0.0.1:5178. |
| **Something else is wrong** | Open the **Activity** page in Talaria. It shows what every Hermes task did and any error it hit. |

---

## Your data and privacy

Everything Talaria stores lives in the **`data/`** folder next to the app: your profile, jobs, drafts, screenshots, and (if you connect it) your Gmail app password. This folder is **not** part of the GitHub repository and is never uploaded. Back it up if you care about your history, and **never share it**, because it contains your personal details.

Messages to your AI provider (your resume text, the job text, your answers) pass through Hermes. Nothing goes to an employer until you press Finalize.

To start completely fresh, use **Settings → Start over**.

---

## Updating Talaria

- **If you used Git:** run `git pull` in the Talaria folder, then start Talaria again. Your `data/` folder is left alone.
- **If you downloaded the ZIP:** download the new ZIP, extract it, and copy your old `data/` folder into the new folder. Then start Talaria from the new folder.

When `package.json` changed, the launcher may need a fresh install: delete the `node_modules` folder and start Talaria again.

---

## For developers

```bash
npm install
npm run dev        # hot-reloading app at http://localhost:5177 (API on 5178)
npm run typecheck  # TypeScript check
npm start          # production build + server at http://127.0.0.1:5178
```

- Front end: React, Vite, Tailwind, in `web/`. Server: Node + Express + TypeScript (run with `tsx`), in `server/`. Shared types are in `shared/`.
- All AI work goes through the Hermes CLI (`server/lib/hermes.ts`), under a dedicated Hermes profile called `talaria`. Remove it any time with `hermes profile delete talaria`.
### Project layout

| Path | What's there |
| --- | --- |
| `server/index.ts` | Express API and static file server. |
| `server/agents/` | The jobs Hermes does: scouting, fit analysis, tailoring, applying, Gmail, LinkedIn, autopilot. |
| `server/sources/` | Job-board adapters (public, key-free feeds) and company career pages. |
| `server/lib/` | Hermes bridge, JSON store, browser automation, LaTeX and PDF rendering. |
| `server/mcp.ts` | MCP server that lets Hermes chat with your board. |
| `shared/` | Types shared by server and web. |
| `web/src/` | The React app: `views/` are pages, `components/` are building blocks. |

### Environment variables

All optional. Copy `.env.example` for a list; the launchers don't load it, so set them in your shell.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TALARIA_PORT` | `5178` | Port the server listens on. |
| `TALARIA_DATA_DIR` | `./data` | Where your profile, jobs and drafts are stored. |
| `TALARIA_HERMES_PROFILE` | `talaria` | Hermes profile used for agent calls. Set it empty to use your default profile. |
| `TALARIA_HEADLESS` | unset | `1` hides the browser window while applying. |
| `TALARIA_BROWSER_PROFILE` | `data/browser-profile` | Folder for the automation browser's sign-ins. |
| `HERMES_HOME` | Hermes default | Where Hermes keeps its config. |

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

[MIT](LICENSE). Free to use, change and share.

## Disclaimer

Talaria is a personal tool, not affiliated with LinkedIn, Greenhouse, Lever, Ashby, OpenAI, GitHub or Nous Research. Review every application before it goes out; you are responsible for what you submit. Automated access to some websites may be against their terms of service. Use the optional connections at your own risk.
