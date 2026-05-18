# Expo Dashboard Research — @jmango/aaf

Source: https://expo.dev/accounts/jmango/projects/aaf
Goal: research UI/UX + functionality patterns to improve better-update

## Sidebar IA (left nav, top to bottom)

| Group   | Item                  | Path                   | Notes                              |
| ------- | --------------------- | ---------------------- | ---------------------------------- |
| Project | Overview              | /                      | Default landing                    |
|         | Insights              | /insights              | Analytics dashboard                |
|         | Usage                 | /usage                 | EAS quota / billing usage          |
|         | Workflows             | /workflows             | CI workflows (skip — out of scope) |
| Build   | Development builds    | /development-builds    | Internal dev distribution          |
|         | Builds                | /builds                | Production builds                  |
|         | Submissions           | /submissions           | App store submissions (skip)       |
| OTA     | Over-the-air updates  | (expandable group)     | Most relevant for better-update    |
|         | — Channels            | /channels              | Release channels                   |
|         | — Update groups       | /updates               | Individual updates                 |
|         | — Branches            | /branches              | Branch list                        |
|         | — Runtimes            | /runtimes              | Runtime version registry           |
| Other   | Hosting               | /hosting               | Web hosting (skip)                 |
|         | Push notifications    | /push-notifications    | Expo push                          |
|         | Fingerprints          | /fingerprints          | Native fingerprint hashes          |
| Config  | General               | /settings              | Project settings                   |
|         | Credentials           | /credentials           | iOS/Android cert store             |
|         | Environment variables | /environment-variables | Build-time env                     |
|         | GitHub                | /github                | GitHub integration                 |

**Header bar:** Account switcher → Project switcher; right side: Notifications bell, global Search, user menu.

**Project header (sticky):** Project name + Pin button (favorite), Details drawer trigger, view toggle (Overview / Activity).

## Overview page layout

Card-based grid, organized in 3 super-sections:

### 1. "Develop & deploy" (customizable — gear icon)

Each subsection shows last 3 items + "View all" link.

- Development builds (cards: status + platform + author avatar + relative time + duration + git SHA)
- Production builds (same card format; some show "Expired" tag)
- Submissions (cards: status + store + author + version + git SHA hash short)
- Updates (cards: message + author + time + git SHA + channel badge)
- Workflows (empty state CTA)
- Hosting deployments (empty state CTA, links docs)

### 2. "Insights" (customizable)

- Date range dropdown (default: 30 Days)
- View toggle: App usage / Workflows
- Set Up Insights CTA card if not configured

### 3. "More"

Resource link cards: Connect GitHub, Visit docs, Read blog, Changelog, Discord, Newsletter signup.

## Project details drawer

Triggered by "Details" button in project header. Right-side drawer with:

- Slug (with copy button)
- ID UUID (in `<code>` block + copy button)
- Owner (with copy button)
- Closes via X or Escape
- Resizable (drag handle)

## Status badge vocabulary observed

- Finished (success — green)
- Errored (red)
- Expired (warning — after build artifact retention window)
- Status appears as text prefix on card "Finished iOS App Store build…"

## Card design pattern (uniform across builds/submissions/updates)

```
[StatusBadge] [Type label] [Avatar] [author] [relative time] [duration | tag] [gitSHA short]
```

The whole card is one clickable link to detail page.
