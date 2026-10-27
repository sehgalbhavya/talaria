# Talaria

[![CI](https://github.com/sehgalbhavya/talaria/actions/workflows/ci.yml/badge.svg)](https://github.com/sehgalbhavya/talaria/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A job-hunt board that runs on your own computer.** An AI assistant finds jobs that fit you, tells you honestly where you stand, tailors your resume, writes your cover letters, and fills in application forms. **Nothing is ever sent to an employer until you say so.**

You don't need to know anything about AI or programming to use it. This guide starts from zero and walks you through every step. Set aside about **20 to 30 minutes** the first time.

**Contents:** [What you get](#what-you-get) · [Before you start](#what-you-need-before-you-start) · [Setup](#setup-step-by-step) · [Daily use](#using-talaria-day-to-day) · [Troubleshooting](#troubleshooting) · [Privacy](#your-data-and-privacy) · [Developers](#for-developers)

### Already comfortable with a terminal?

You need [Node.js](https://nodejs.org) 20.19+ and [Hermes Agent](https://github.com/NousResearch/hermes-agent) signed in to an AI provider (step 3 below). On Windows, double-clicking `Talaria.bat` installs both for you. Otherwise:

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

1. **A computer** with an internet connection. Windows 10/11 is the best-tested. Mac and Linux should work too (see the notes in step 2).
2. **An AI account you already pay for or get free.** Pick **one**:
   - a **ChatGPT** plan (Plus, Pro or Business), which also covers Codex, **or**
   - **GitHub Copilot** (free for verified students and teachers), **or**
   - an **API key** from a provider such as OpenRouter, Google Gemini, Anthropic or OpenAI. (An API key is a long password that lets a program use an AI service. It's usually billed per use.)
3. **Your resume** as a PDF, Word file, text, or LaTeX file (`.tex` or an Overleaf `.zip`).
4. **Google Chrome is not required.** Talaria brings its own browser window for submitting forms.

---

## Setup, step by step

### Step 1: Download Talaria

**Easiest way (no extra software):**

1. On this GitHub page, click the green **Code** button, then **Download ZIP**.
2. Right-click the ZIP file, choose **Extract All**, and pick a place you'll remember, such as your Desktop.
3. You now have a folder called `talaria-main` (or similar). This is "the Talaria folder".

**If you already use Git:**

```bash
git clone https://github.com/sehgalbhavya/talaria.git
```

### Step 2: Install everything and start Talaria

#### Windows: one double-click

Open the Talaria folder and **double-click `Talaria.bat`**.

The first time, a **Set up Talaria** window opens. It checks your computer and lists what Talaria needs, what each part is for and how big it is:

| Part | What it's for | Size |
| --- | --- | --- |
| **Node.js** | Runs Talaria. A private copy goes inside the Talaria folder; nothing else on your computer changes. | about 30 MB |
| **Hermes** | The AI assistant that reads your resume, scores jobs and writes your applications. Installed by its own official installer. | about 1 GB |
| **Talaria's packages** | The building blocks Talaria is made of. | about 200 MB |
| **Browser for applications** *(optional, ticked)* | A separate browser Talaria uses to fill in and submit application forms. | about 150 MB |
| **MiKTeX** *(optional)* | Only if your resume is a LaTeX file: keeps its exact design. | about 250 MB |

Anything you already have shows a green tick and is left alone. **Nothing is downloaded until you press Install.** Then two progress bars show which step it's on and how far the current download is. **Show details** shows every message as it happens; the same is saved in `data\setup-log.txt`. Installing Hermes takes longest, often 5 to 15 minutes. No admin rights are needed, except for MiKTeX, where Windows may ask you to allow it. If something fails, the window tells you what happened, and **Try again** carries on from that step.

When it says *You're ready to go*, press **Start Talaria**. A black window appears and fills with text; that's normal. When it's ready, your web browser opens Talaria at **http://127.0.0.1:5178**.

**Keep the black window open while you use Talaria.** Closing it stops the app. Next time, double-click `Talaria.bat` again and you're back where you left off; the setup window only comes back if something it needs has gone missing. To add MiKTeX or the browser for applications later, double-click **Run setup** in the `setup` folder.

> **Windows antivirus warning?** Some antivirus programs wrongly flag a file called `uv.exe` that Hermes installs. It's a safe, well-known tool. See the [Hermes README](https://github.com/NousResearch/hermes-agent) if yours complains.

#### Mac or Linux: two installs, then one command

1. Install **Node.js**: go to **https://nodejs.org**, download the **LTS** version and run the installer (version 20.19 or higher).
2. Install **Hermes** by pasting this into a terminal, then close the terminal and open a new one:

   ```bash
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   ```

3. Open a terminal *inside the Talaria folder* and run:

   ```bash
   ./talaria.sh
   ```

   It installs Talaria's packages on the first run, starts Talaria and opens your browser at http://127.0.0.1:5178. (If you see *permission denied*, run `chmod +x talaria.sh` once first.)

Optional extras: for submitting applications, run `npx playwright install chromium` in the Talaria folder (about 150 MB). To keep a LaTeX resume's exact design, install **TeX Live** (or MacTeX on a Mac). Talaria is built and tested on Windows, so please [report any Mac or Linux problems](https://github.com/sehgalbhavya/talaria/issues).

### Step 3: Sign in to your AI account

You only do this once, in a terminal (Windows: press the **Windows key**, type `PowerShell`, press Enter). Pick the option that matches what you have.

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

> You can also do this step later, from inside Talaria's setup screen (step 4). It shows the same commands with a **Copy** button and a **Test the connection** button.

### Step 4: First-time setup in Talaria

The first time you open Talaria, a guided setup gets to know you. It takes about 10 minutes, and if you close the window halfway it picks up where you left off.

1. **Welcome.** What Talaria will ask you and what to have ready.
2. **Connect the AI.** Talaria checks that Hermes is installed, asks which AI account you have, and shows you the exact sign-in command. Press **Test the connection**. When it says *It works!*, continue.
3. **Your resume.** Drag your resume in (or paste its text). Hermes reads it in the background while you carry on, and a note at the top of the screen tells you when it's done. It never invents experience you don't have.
4. **Your story.** Four short questions in your own words: why you do this work, what you're proudest of, what you want next, and who you are outside work. Your cover letters are written from this. Skip any you like.
5. **What you're after.** The roles and level you want; where and how you want to work (locations, remote, visa sponsorship, salary); and what matters to you (topics you'd love, deal-breakers, companies to skip). Hermes fills in suggestions from your resume, but never overwrites what you've chosen.
6. **Is this you?** Check and fix what Hermes took from your resume: your details, headline, summary and skills.
7. **Where to look.** Choose the job boards to search, and add your own sources: any company by name, or the link to its careers page. **Suggest companies** asks Hermes for ones that fit you. Under **Your job boards** you can also add any other job board by pasting its link (a niche board, a country's job site, a community's jobs page). Talaria reads its job feed or its listings, or has Hermes search within the site when neither can be read. Put `{query}` in the link where the search words go to search it once for each of your roles.
8. **Review & start.** A summary of everything, with an **Edit** link for each part, and whether **Autopilot** should search for new matches every few hours.

Then press **Start the hunt**. A short tour of the board follows, and the first jobs show up in a minute or two.

---

## Using Talaria day to day

1. **Open `Talaria.bat`** and look at **Discovered**. Click a card to read the job and see your fit: why you'd get it, why you might not, and how to improve your odds.
2. **Not interested?** Dismiss it. **Interested?** Hand it to Hermes.
3. **Open the cards in "Needs you."** Answer Hermes's questions. It then drafts your resume and cover letter. In the workspace you can say things like *"lead with my design work"* or *"make the cover letter warmer"*. Every version is saved under **Versions**, so you can go back.
4. **Press Finalize & submit** when you're happy. Talaria opens the company's form in its own browser window, fills every field, attaches your files and submits. It saves a screenshot of every submission in `data/applications/`.
5. **Track replies.** Move cards to Interviewing or Offer, or let the Gmail connection do it.

### PhD positions

Talaria can look for funded PhD positions alongside jobs, on their own side of the board.

1. Turn on **Profile → Sources → PhD positions** and list your research fields (for example *haptics*, *XR*, *automotive HMI*, *generative UI*). Optionally add countries; empty means anywhere in Europe.
2. Switch the board to **PhDs** and press **Find PhDs**. Hermes searches academic job boards (EURAXESS, Academic Positions, jobs.ac.uk, FindAPhD, Varbi) and university and lab pages, one focused search per pair of fields. Closed positions and duplicates are skipped. PhDs are also searched with every normal job search while this is on.
3. PhD cards carry a **PhD** tag and their application deadline. Hermes judges them on research fit, asks you research questions (what excites you in the project, an idea you'd bring), builds an academic CV that leads with your research work, and writes a **motivation letter** instead of a cover letter.

Use **All / Jobs / PhDs** at the top of the board to see one kind or both.

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
| **`node` is not recognized** | On Windows, double-click `Talaria.bat`: its setup window installs Node.js. On Mac or Linux, close the terminal and open a new one, or reinstall Node.js (step 2). |
| **`hermes` is not recognized** | Close the terminal and open a new one. If it still fails, double-click `Talaria.bat` (Windows) or run the Hermes install line (step 2) again. |
| **Setup stopped with an error** | Press **Try again**. If it keeps failing, open `data\setup-log.txt` in the Talaria folder: the last lines say what went wrong. |
| **The black window closes right away** | Open a terminal in the Talaria folder and run `npm install`, then `npm start`. Read the message it prints. |
| **The page says "Waiting for the Talaria server…"** | The black window was closed or is still starting. Reopen `Talaria.bat` and wait a minute. |
| **"Test the connection" fails for ChatGPT/Codex** | Run `hermes auth add openai-codex --type oauth` again and finish the browser sign-in. |
| **"Test the connection" fails for Copilot** | Run `gh auth login` again, and check Copilot is switched on at github.com/settings/copilot. The model may also need enabling there. |
| **Answers are very slow or paused** | Your AI plan's limit was reached. Talaria pauses and retries when it resets. You can switch models in **Settings**. |
| **Resume won't upload** | If it's a scanned PDF, paste the text instead. Photos of text can't be read. |
| **LaTeX resume won't compile** | Install MiKTeX: on Windows, open the `setup` folder, double-click **Run setup** and switch MiKTeX on. Or get it from https://miktex.org. Then restart Talaria. |
| **Applications won't submit** | The browser for applications may be missing: on Windows, double-click **Run setup** in the `setup` folder and switch it on (or run `npx playwright install chromium` in the Talaria folder), then restart. Then check **Settings → Applying → Submit applications for me** is on. |
| **Port 5178 is already in use** | Talaria is probably already running in another window. Close it, or open http://127.0.0.1:5178. |
| **Something else is wrong** | Open the **Activity** page in Talaria. It shows what every Hermes task did and any error it hit. |

---

## Your data and privacy

Everything Talaria stores lives in the **`data/`** folder next to the app: your profile, jobs, drafts, screenshots, and (if you connect it) your Gmail app password. This folder is **not** part of the GitHub repository and is never uploaded. Back it up if you care about your history, and **never share it**, because it contains your personal details.

Messages to your AI provider (your resume text, the job text, your answers) pass through Hermes. Nothing goes to an employer until you press Finalize.

To start completely fresh, use **Settings → Start over**.

---

## Updating Talaria

Updates never touch your data: your profile, jobs and drafts live in `data/`, which updates don't include. Close Talaria's window first, then:

- **If you used Git:** run `git pull` in the Talaria folder, then start Talaria again.
- **If you downloaded the ZIP:** download the new ZIP, extract it, and copy your old `data/` folder into the new folder. Then start Talaria from the new folder.

The launcher (`Talaria.bat` or `talaria.sh`) rebuilds the app on every start and installs any new packages an update brings, so there's nothing else to do. The first start after such an update takes a minute longer.

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
