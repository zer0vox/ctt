# Token Pup 🐶

A pixel-art German Shepherd for your Windows desktop (sitting side-on by its bowl, face turned to you) whose mood tracks how much Claude usage you have left. A full bowl means a happy pup; an empty bowl means a sleepy one.

| Remaining | Mood | What the pup does |
|---|---|---|
| ≥ 80% | Ecstatic | bounces, tongue out, tail going full tilt, floating hearts |
| 60–80% | Happy | panting, wagging |
| 40–60% | Content | sits tall, an ear swivels now and then, lazy tail thump |
| 20–40% | Anxious | ears pinned back, worried brows, licks its nose, tail low, keeps glancing at the bowl |
| 5–20% | Sad | lying with its head on its paws, puppy eyes, a tear |
| < 5% | Exhausted | asleep with zzz and a "wakes in 1h 12m" countdown |
| no data | Sniffing | cocks one ear, then the other, "?" |

When a limit resets, the pup jumps for joy. Click it to pet it, drag it anywhere, and right-click for the menu.

## Data sources

| Source | What it measures | Setup |
|---|---|---|
| **Claude plan limits** (Pro, Max, Team, Enterprise) | 5-hour and weekly usage %, with reset times | Settings › tick **Live updates** |
| **Claude Code logs** | Tokens and estimated $ from `~/.claude/projects/**/*.jsonl` | Automatic; set a budget to let it drive the mood |
| **Anthropic API credits** | Month-to-date spend via the Admin API | Settings › paste an Admin key (`sk-ant-admin…`), then set a monthly budget or your current balance |

By default the mood follows **whichever source has the least left**. You can change that in Settings.

### Where plan limits come from

Token Pup merges three sources and always uses the newest reading:

1. **Live updates** (opt-in, recommended)
   - Every 5 minutes, and soon after new Claude Code activity, Token Pup makes the same read-only request Claude Code makes for `/usage` (`GET api.anthropic.com/api/oauth/usage`).
   - It uses the login Claude Code saved: `~/.claude/.credentials.json` on Windows and Linux, the Keychain on macOS.
   - It works however you run Claude Code (VS Code panel, terminal, JetBrains, desktop app) and includes claude.ai usage.
   - The token is read fresh each time, sent only to api.anthropic.com, and never stored, logged or refreshed by Token Pup.
   - If the login has expired, Token Pup waits for Claude Code to renew it.
   - **Unofficial:** the endpoint is undocumented and could change.
2. **Claude Code's usage cache**
   - Read from `cachedUsageUtilization` in `~/.claude.json`. Only the percentages are kept.
   - Always on, but it only refreshes when Claude Code checks usage (the usage banner, `/usage`).
3. **Status line bridge** (Pro/Max in a terminal)
   - Claude Code passes `rate_limits` to its [status line](https://code.claude.com/docs/en/statusline) command. The bridge (`bridge/statusline.mjs`) saves those numbers and prints `🐶 5h 42% · 7d 18%`. If you already had a status line, it shows that one's output instead.
   - The VS Code panel doesn't run status lines, and the docs only list Pro and Max for `rate_limits`.

Once a reset time passes, the widget treats that window as fresh.

The API has no endpoint for your prepaid balance. Enter the balance from Console › Billing and Token Pup subtracts spend since that date.

## Run it

```powershell
npm install
npm run dev        # development, with hot reload
npm test           # unit tests
npm run typecheck
npm run sprites    # re-render scripts/preview-out/moods.png and build/icon.png
npm run dist       # dist\Token Pup Setup x.y.z.exe (installer) and a portable .exe
```

> If Electron starts as plain Node (`electron --version` prints a Node version), your shell has `ELECTRON_RUN_AS_NODE=1` set. This is common in terminals launched from editor extensions. Unset it first: `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

## Layout

```
bridge/statusline.mjs        Claude Code status line → plan-state.json
src/shared/                  Types, mood engine, formatting; runs in every process
  sprites/                   Palette, pixel grids, compositor, per-mood animation
src/main/                    Electron main process
  providers/                 planLimits, ccLogs (incremental JSONL tailer), apiAdmin, pricing
  aggregator.ts              Snapshots → primary reading → mood (with hysteresis) → notifications
  installBridge.ts           Safe edit of ~/.claude/settings.json (backup, chain, restore)
  window.ts, tray.ts         Transparent always-on-top pet, settings window, tray icon
src/preload/                 Narrow typed IPC bridge (window.pup)
src/renderer/                Pet canvas + HUD, settings page
tests/                       Vitest
```

The dog is drawn entirely in code. Each part (head, ears, eyes, brows, mouth, body poses, tail frames) is a grid of palette characters in `src/shared/sprites/parts.ts`; symmetric parts are drawn as the left half and mirrored. The parts are layered and outlined automatically (lines inside the dog use a darker shade of the fur underneath, so only the silhouette gets the dark outline), then drawn to a canvas with whole-device-pixel scaling so edges stay crisp at any Windows display scale. To change the look, edit the grids or the palette and run `npm run sprites` to preview.

## Privacy

- From the session logs, only token counts, timestamps, model ids and message ids are read. Prompt and response text is never stored or sent anywhere.
- With live updates on, your Claude Code login is read for each request and sent only to `api.anthropic.com`. Token Pup never writes it anywhere and never refreshes it.
- The bridge discards paths, session ids and transcript content.
- The Admin key is encrypted with Windows DPAPI (`safeStorage`) and only ever sent to `api.anthropic.com`. The renderer never sees it.
- Nothing else leaves your machine.

Cost estimates use Anthropic list prices in `src/main/providers/pricing.ts` (checked 2026-10). Update them there if prices change.
