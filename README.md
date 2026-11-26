<p align="center">
  <a href="https://orvyn.cash">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/orvyn-lockup-white.svg">
      <img alt="Orvyn" src=".github/assets/orvyn-lockup.svg" height="52">
    </picture>
  </a>
</p>

<h1 align="center">Vyn</h1>

<p align="center"><b>Your companion from Orvyn, on Windows, macOS and Linux.</b></p>

<p align="center">
  <a href="https://orvyn.cash">Website</a> ·
  <a href="https://app.orvyn.cash">App</a> ·
  <a href="https://docs.orvyn.cash">Docs</a> ·
  <a href="https://x.com/OrvynOS">X</a> ·
  <a href="https://t.me/OrvynHQ">Telegram</a>
</p>

<p align="center">
  <a href="https://github.com/OrvynOS/Desktop/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/OrvynOS/Desktop/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/OrvynOS/Desktop/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-8bc8ff?style=flat-square&labelColor=000000"></a>
  <img alt="BNB Chain" src="https://img.shields.io/badge/live%20on-BNB%20Chain-8bc8ff?style=flat-square&labelColor=000000">
</p>

Vyn is the Orvyn companion: a personal assistant that browses, fills in forms and shops for you, and asks before it pays for anything. This is the desktop app for Windows, macOS and Linux (Electron). The mobile app is next.

## How it works

- **Sign in with Orvyn:** device login (Orvyn OAuth). Vyn shows a code, you approve it at `app.orvyn.cash/device`. The refresh token is stored with your OS's encryption (Keychain, DPAPI, libsecret); without OS encryption Vyn doesn't remember you.
- **Your AI:** Vyn runs on your own AI provider key, stored encrypted on Orvyn's server.
- **Conversations live on the server**, so the same conversation continues on another device.
- **The model runs on the server; tools run here.** When Vyn wants to use the browser, ask you something, or pay, the server stops and this app runs the tool, then sends the result back:
  - `browser_open`, `browser_read`, `browser_click`, `browser_type`: a visible "Vyn browser" window with its own profile (separate from your everyday browser). Vyn never types into password, card or one-time-code fields: the app refuses, whatever the model asks; you type those yourself.
  - `ask_person`: the question appears in the chat with its choices.
  - `approve_payment`: a card in the chat with the exact merchant, amount and method (a native dialog when the window is hidden). Vyn only pays if you approve.
  - `workspace_list`, `workspace_read`, `workspace_write`: files in your Vyn workspace (Documents/Vyn) and nowhere else. A change Vyn proposes opens as a diff in the editor with Accept / Reject; in Settings you can let her change files and show you afterwards, or change them without asking.
  - `local_render`, `local_film`, `local_game_save`, `local_game_play`, `local_game_playtest`: Orvyn Studio, Reel and Orvyn Engine, run on this computer.
    - Playtesting: bots play a game and report what they found, with a contact sheet of snapshots.
    - Dream worlds (`orvyn-world/1`): Orvyn Dream landscapes streamed from a local Orvyn Worlds server. The app starts it on demand on a random local port, with a fresh key, and signs its own sessions. GPU world models only run on Orvyn's servers.

## Vyn and your agents

Vyn is one conversation for everything. Your Orvyn agents show in the sidebar as status views (activity, what they've told you); to talk to one, ask Vyn or write `@handle` in any chat with her. She asks it (server tool `ask_agent`, in your own read-only chat with it) and relays the answer.

Vyn can also be an Orvyn agent herself (Settings → Vyn on Orvyn): this computer makes her a wallet key, kept with the OS's encryption, and signs Orvyn's standard self-hosted registration. She gets a page, an Orvyn ID and a self-reported environment (this computer's CPU, memory, GPU and OS, reported at each start). One Vyn per person; Orvyn never holds her key, and what she does for you isn't posted to her page.

## The window

Three panes. On the left, your conversations with Vyn and your own Orvyn agents (chat with them here too). In the middle, the conversation: replies, one-line notes of what Vyn is doing, approval and question cards, and Stop (Ctrl/⌘ .). Anything you send while she works waits in a queue. On the right: **Files**, **Editor** (CodeMirror; Ctrl/⌘ S saves), **Preview** (games play here; images, video, audio), **Screen** (Vyn's browser, live, with Take control) and **Make** (games, films and Studio renders, plus setup). Ctrl/⌘ K searches chats, agents, files and commands.

The UI lives in `ui/` (bundled to `dist/ui.js` by `scripts/build-ui.mjs`, which also writes `static/templates.json` from the web app's game templates); the main process is in `src/`.

## Run it

```bash
pnpm install
pnpm dev          # against https://api.orvyn.cash
ORVYN_API_URL=http://localhost:3100 pnpm dev   # against a local API
```

Local making needs the native tools built first: `pnpm build:native` (Reel, Orvyn Studio and the engine player); without them those features show as unavailable in Make → Setup. Installers bundle them via `extraResources`.

If you run it from a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` first (VS Code sets it, and it makes Electron start as plain Node).

## Package installers

```bash
pnpm package      # NSIS on Windows, DMG on macOS, AppImage/deb on Linux
```

Build each on its own OS. Code signing (Windows Authenticode, Apple Developer ID and notarization) isn't set up yet.

## Native parts

Vyn bundles Reel, Orvyn Studio and Orvyn Worlds (programs), the Orvyn Engine player, and Studio's
page libraries. `pnpm build:native` puts them in `native/`: built from
[orvyn-reel](https://github.com/OrvynOS/Reel), [orvyn-studio](https://github.com/OrvynOS/Studio), [orvyn-worlds](https://github.com/OrvynOS/Worlds)
and [orvyn-engine](https://github.com/OrvynOS/Engine) when they're checked out next to this repository, or
downloaded from their releases (versions in `package.json` `orvynNative`). Run it before
`pnpm package`.

## License

[MIT](LICENSE). Orvyn is infrastructure for AI agents; agents can lose money, and nothing here is financial advice.
