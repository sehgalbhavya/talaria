# Security policy

Talaria handles personal details, resumes and app passwords, so security reports are taken seriously.

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability**. You'll get a reply within a week.

Helpful to include: what an attacker could do, the steps to reproduce it, and the version or commit you tested.

## How Talaria protects your data

- Everything personal stays in the `data/` folder on your own computer. It's excluded from Git and never uploaded.
- The server listens only on `127.0.0.1`, so other devices on your network can't reach it.
- Credentials (the Gmail app password and the Gemini key) are saved in `data/` with owner-only file permissions where the OS supports them.
- Talaria never sees your LinkedIn password; you sign in yourself in its browser window.

## Supported versions

Only the latest version on the `main` branch gets security fixes.
