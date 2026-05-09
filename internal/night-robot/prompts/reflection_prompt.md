## Task: Write One Lesson Learned

You will receive a summary of the completed cycle including:
- The hypothesis that was tested
- The patch that was applied (or skipped)
- Files touched
- Benchmark before and after
- The verdict (ACCEPT / REJECT / NEUTRAL / SKIPPED / PATCH_FAILED)

Write exactly 2-3 sentences capturing the most useful lesson for future cycles.

## Requirements

- Be specific: name files, functions, metrics, thresholds.
- Explain WHY something worked or failed, not just what happened.
- If the patch was rejected, explain what evidence was missing.
- If the patch was accepted, explain what made the approach effective.
- If the patch failed to apply, explain what went wrong with the diff.
- Do not repeat the facts — extract the insight.

## Examples of Good Lessons

"The VAD silence threshold in `managers/audio.rs:142` is too aggressive for recruiter-style
pauses (>500ms). Raising it from 300ms to 600ms showed improvement in the benchmark.
Future cycles should focus on the relationship between pause duration and chunk flush timing."

"The LLM proposed modifying `transcription.rs` but the diff had wrong line numbers because
the file was summarized rather than read fully. Future cycles should request full file content
for files under 200 lines before producing a diff."

"No benchmark is configured, so behavior changes cannot be verified. The safest next step
is to add a WER benchmark fixture before making further pipeline changes."
