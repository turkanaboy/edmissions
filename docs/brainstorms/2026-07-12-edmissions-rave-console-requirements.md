---
date: 2026-07-12
topic: edmissions-rave-console
---

# EDMissions — Rave Console Requirements

## Summary

EDMissions is a login-gated, single-tenant web dashboard for a higher-ed enrollment professional: mode-switched music with an audio-reactive visualizer, an enrollment-ranked higher-ed news feed, article starring and capture into a subject-tagged research hub with optional AI summaries, a messaging-campaign builder, and a manual task list. One Node process with an embedded database, running identically on localhost and as a Docker container on the owner's existing Hetzner server.

## Problem Frame

The primary user works in higher-ed enrollment. Staying current on admissions, financial aid, and student-services news means checking many sites daily, and the notes and campaign drafts that work produces live scattered across documents and chat sessions. Nothing about that routine is enjoyable, so it gets skipped. The music and visuals are not decoration — they are the reason the dashboard gets opened every day. The owner builds and hosts it as a gift; the friend uses it.

---

## Key Decisions

- **Jamendo over Spotify for streaming.** Spotify playback is DRM-protected, so browser audio analysis cannot read it and the visualizer would be fake. It also requires a Premium subscription per user, and its beat-analysis endpoints were deprecated for new apps in 2024. Jamendo offers a Creative Commons catalog with raw audio streams the visualizer can read, plus tag-based search for discovery, on a free API.
- **Single-tenant app with env-configured credentials.** No user tables, roles, or registration. Isolation between the friend's workspace and the owner's personal services is handled by container and subdomain separation on the server, not by application roles.
- **Deploy to the existing Hetzner server, not a new one.** The app is a single ~100MB-RAM container behind a reverse-proxy subdomain. Moving it to its own server later is a container-plus-database-file migration.
- **Campaign AI is handoff-first with optional one-shot.** The builder always renders a copy-ready brief for external AI chat. An in-app "Generate campaign" path exists alongside it when an API key is configured. The user chooses per campaign.
- **Keyword scoring, not AI classification, ranks the feed.** A configurable keyword list is cheap, transparent, and good enough at this scale. AI classification is a later upgrade if scoring disappoints.
- **One Node process with a SQLite file.** One moving part; local-to-server portability is copying a file. No external database service.
- **Anthropic Haiku behind one small AI module.** Summaries and campaign generation route through a single function. Swapping providers (e.g., a cheaper model) later is a localized change; no provider abstraction is built now.

---

## Actors

- A1. **The friend** — primary user; higher-ed enrollment professional; uses the deployed instance daily with her own credentials.
- A2. **The owner** — builds, deploys, and maintains the instance; supplies API keys; logs in with separate credentials for testing and review only.

---

## Requirements

**Music and modes**

- R1. The player streams music from Jamendo with in-app discovery (search and genre-tag browsing) and basic controls (play, skip, queue).
- R2. Three intensity modes plus off are switchable from the main view: intense focus, vibing, chill. Each mode pairs a genre pool with a matching visual level.
- R3. Default genre pools: intense focus → hard EDM/techno; vibing → melodic house/electronic; chill → lofi/ambient/bluegrass. Pools are editable via instance configuration, not code.
- R4. The visualizer renders from real audio analysis of the playing stream: full reactive visualizer in intense focus, moderate in vibing, slow animated background in chill.
- R5. Off mode silences audio and shows a static background; the rest of the app is unaffected.
- R6. The player can also play tracks from a local folder, serving as the fallback when Jamendo is unreachable.

**Article feed**

- R7. The server polls configured RSS sources on an interval and stores articles. Launch sources: Inside Higher Ed, Higher Ed Dive, The Chronicle of Higher Education, EAB, Times Higher Education, NPR Education. The source list is config-editable.
- R8. The feed ranks enrollment-related articles above general news via keyword scoring (enrollment, admissions, yield, melt, FAFSA, financial aid, demographic cliff, retention, transfer, test-optional). The keyword list is config-editable.
- R9. Feed items show headline, source, date, and excerpt, and link out to the original. Full article text is neither stored nor displayed.
- R10. Articles can be starred, and starred articles are viewable as a filtered list.
- R11. Each article has an add-to-notes action that creates a research-hub note pre-filled with the article's title, link, and excerpt, ready for the user's comments.

**Research hub**

- R12. Notes store raw text and can be created from scratch, by pasting external content, or via add-to-notes.
- R13. Notes carry subject tags from a configurable list (initial: admissions, financial aid, student records, housing, orientation, HR), and the hub filters by tag.
- R14. When an AI key is configured, a note can be summarized on demand; the raw text and the summary are both kept and both visible.

**Campaign builder**

- R15. The campaign form captures purpose, call to action, CTA link, and number of messages.
- R16. "Generate handoff document" renders the form and template into a structured brief the user copies into an external AI chat. This path requires no API key.
- R17. "Generate campaign" produces the message sequence in-app via the configured AI key, and is offered only when a key is present.
- R18. Campaign templates can be saved and reused; generated briefs and campaigns are saved and reviewable.

**Tasks**

- R19. A manual task list supports add, edit, complete, and delete. No automation, reminders, or integrations.

**Access and deployment**

- R20. The app requires login. Credentials are username/password pairs defined in environment configuration; there is no self-registration and there are no roles.
- R21. The app is single-tenant: all logged-in users share the instance's workspace.
- R22. The same codebase runs locally for development and testing and as a Docker container on the existing Hetzner server behind a reverse-proxy subdomain.
- R23. All environment variables carry an `EDMISSIONS_` prefix to avoid collisions in shared env files.
- R24. Every AI feature degrades gracefully when no key is configured: AI controls are hidden and everything else is fully functional. Running without a key is the "lite" configuration; there is no separate lite build.

---

## Key Flows

- F1. **Daily session**
  - **Trigger:** The friend logs in to start a work block.
  - **Steps:** Picks vibing mode; music and visuals start. Scans the feed, stars one article, uses add-to-notes on another, tags the new note "admissions," and adds her comments.
  - **Covers:** R1, R2, R8, R10, R11, R13
- F2. **Research capture**
  - **Trigger:** The friend finishes a brainstorm in an external AI chat.
  - **Steps:** Pastes the output into a new note, tags it, and (key configured) summarizes it. Raw and summary are stored together.
  - **Covers:** R12, R13, R14
- F3. **Campaign drafting**
  - **Trigger:** The friend needs a message sequence for an admissions push.
  - **Steps:** Opens the builder, loads a saved template, fills purpose, CTA, link, and message count. Chooses "Generate handoff document," copies the brief, iterates externally, and pastes the final copy back as a note — or chooses "Generate campaign" and reviews the sequence in-app.
  - **Covers:** R15, R16, R17, R18
- F4. **Shutting it off**
  - **Trigger:** A meeting starts.
  - **Steps:** Toggles mode to off; audio stops and the background goes static while feed, notes, and tasks remain usable.
  - **Covers:** R5

---

## Acceptance Examples

- AE1. **Covers R16, R17, R24.** Given no `EDMISSIONS_ANTHROPIC_KEY` is set, when the friend opens a note or the campaign builder, then no summarize control appears and only "Generate handoff document" is offered — nothing else in the app is degraded.
- AE2. **Covers R17.** Given a key is set, when the friend opens the campaign builder, then both "Generate handoff document" and "Generate campaign" are offered.
- AE3. **Covers R8.** Given the feed holds "FAFSA delays reshape yield models" and "New dining hall opens downtown," the FAFSA article ranks higher.
- AE4. **Covers R6.** Given Jamendo is unreachable, when the friend presses play, then tracks from the local folder play and the visualizer still reacts.

---

## Scope Boundaries

**Deferred for later**

- The owner's own separate instance (v1 deploys one instance, the friend's, which the owner accesses for review)
- Per-user accounts, roles, or separated data within an instance
- Cloud sync or multi-device database
- AI classification of feed articles (keyword scoring first)
- Automated import from AI chat sessions (paste and add-to-notes cover it)
- Mobile-optimized layout (dashboard is desktop-first)

**Outside this product's identity**

- Sending campaigns. The builder drafts message sequences; it never sends email or SMS, and no delivery integrations will be added.
- DRM streaming integrations (Spotify or similar). The visualizer must read real audio; that rules out encrypted playback permanently.
- Storing or republishing full article text.

---

## Dependencies / Assumptions

- Jamendo's free API tier (client ID registration required) permits streaming with attribution at this usage level; rate limits are assumed comfortable for one or two users. Unverified assumption — confirm current terms during planning.
- The named RSS feeds exist and remain publicly available; exact feed URLs are confirmed during planning.
- The existing Hetzner server runs Docker and a reverse proxy capable of adding a TLS subdomain. Unverified assumption — confirm during deployment planning.
- The owner supplies a new Anthropic API key. Expected AI cost at one or two users is under a dollar a month (roughly $0.002 per summary, about a penny per campaign).
- The friend uses a modern desktop browser.

---

## Outstanding Questions

**Deferred to planning**

- Exact Jamendo tag sets per mode and the configuration shape for editing them.
- Which reverse proxy the Hetzner server runs, and the subdomain name.
- Feed poll interval default.
- Whether add-to-notes opens the new note for immediate editing or saves silently.

---

## Sources / Research

- Jamendo developer API (developer.jamendo.com): tracks endpoint supports tag filtering and returns streamable audio; requires a registered client ID.
- Spotify rejection basis: Web Playback SDK output is DRM-protected (EME), so Web Audio analysis reads silence; audio-features/audio-analysis endpoints deprecated for new apps in November 2024; playback requires Premium per user.
- Candidate feeds: insidehighered.com and highereddive.com publish site-wide RSS; The Chronicle, EAB, Times Higher Education, and NPR (education topic feed) all offer feeds — verify exact URLs at planning.
