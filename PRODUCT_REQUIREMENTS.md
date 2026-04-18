# Vocalype Product Requirements

These are the non-negotiable requirements for developers who prompt, write, and review text all day. Features that do not improve one of these points should stay hidden from the launch path.

## Core Requirements

1. Global shortcut reliability
   - Target: works in more than 99% of normal attempts.
   - Must work from IDEs, browsers, chat tools, notes, and email.
   - The user must always know whether Vocalype is listening.

2. Instant perceived response
   - Shortcut to visible recording feedback: under 100 ms.
   - Shortcut to microphone capture start: under 150-250 ms.
   - Release to inserted short text: ideally under 500 ms.

3. Paste anywhere without focus bugs
   - Must preserve the active app and field.
   - Must not double paste, paste into the wrong window, or lose line breaks.
   - Primary apps: Cursor, VS Code, ChatGPT, Claude, Slack, Gmail, Linear, GitHub, Notion.

4. Local privacy by default
   - Audio and transcripts stay on the device unless the user explicitly selects a cloud provider.
   - No telemetry may include dictated text, audio, prompts, client names, or code.
   - History must be easy to disable, export, or delete.

5. Developer vocabulary accuracy
   - Must handle acronyms, libraries, variables, and mixed French/English speech.
   - Examples: API, JWT, SDK, CLI, SQL, OAuth, React, Next.js, Prisma, Tauri, userId, authToken.
   - Custom dictionary and learned corrections should be prioritized over generic language guesses.

6. Correction must be faster than typing
   - Undo the last insertion immediately.
   - Replace or retry the last dictation without hunting through settings.
   - Learn repeated corrections locally.

7. First success in under 60 seconds
   - Download.
   - Permissions.
   - Shortcut.
   - First dictation pasted into the app where the user already works.

## Launch Rule

If a screen, setting, or feature does not support one of the requirements above, it should not appear in the first-run path.

