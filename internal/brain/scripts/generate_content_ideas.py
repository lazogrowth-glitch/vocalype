from __future__ import annotations

from datetime import date

from brain import ensure_brain_structure, write_text


TARGET_USERS = [
    "developers",
    "students",
    "writers",
    "founders",
    "doctors",
    "lawyers",
    "productivity users",
    "ChatGPT power users",
    "people with wrist pain",
    "people who hate typing",
]

HOOK_TEMPLATES = [
    "I replaced {old_behavior} with {voice_behavior} for 24 hours.",
    "I wrote {thing} without touching my keyboard.",
    "This is how I use my voice to {outcome}.",
    "I stopped typing and started {voice_workflow}.",
    "Most people type their ChatGPT prompts. I just speak them.",
    "Offline voice typing is underrated.",
    "This app turns your voice into text anywhere.",
]

USER_CONTEXT = {
    "developers": ("typing code comments", "dictating into VS Code", "a pull request summary", "draft code faster", "voice-to-code notes"),
    "students": ("typing study notes", "speaking lecture summaries", "revision notes", "capture study notes", "voice study sessions"),
    "writers": ("typing first drafts", "dictating rough paragraphs", "a blog intro", "draft without stopping", "voice drafting"),
    "founders": ("typing investor updates", "speaking updates into Gmail", "a weekly update", "clear my inbox faster", "voice email workflow"),
    "doctors": ("typing notes", "dictating private local notes", "a patient note draft", "document faster", "voice notes"),
    "lawyers": ("typing memos", "dictating private drafts", "a client memo outline", "draft documents faster", "voice legal drafting"),
    "productivity users": ("typing every note", "capturing thoughts by voice", "a daily plan", "move faster across apps", "voice productivity"),
    "ChatGPT power users": ("typing prompts", "speaking prompts into ChatGPT", "a detailed ChatGPT prompt", "prompt faster", "voice prompting"),
    "people with wrist pain": ("painful typing", "hands-free dictation", "an email", "reduce typing strain", "hands-free writing"),
    "people who hate typing": ("keyboard grinding", "voice typing anywhere", "a message", "write without typing", "voice-first writing"),
}

PLATFORMS = ["TikTok", "Instagram Reels", "YouTube Shorts", "X", "LinkedIn"]


def make_idea(index: int, target: str, template: str) -> dict[str, str]:
    old_behavior, voice_behavior, thing, outcome, voice_workflow = USER_CONTEXT[target]
    hook = template.format(
        old_behavior=old_behavior,
        voice_behavior=voice_behavior,
        thing=thing,
        outcome=outcome,
        voice_workflow=voice_workflow,
    )
    platform = PLATFORMS[index % len(PLATFORMS)]
    return {
        "platform": platform,
        "target_user": target,
        "hook": hook,
        "demo_scene": f"Show Vocalype turning speech into text inside a real app used by {target}.",
        "cta": "Try Vocalype for offline voice typing.",
        "metric": "view_to_download_click_rate",
    }


def main() -> None:
    ensure_brain_structure()
    ideas: list[dict[str, str]] = []
    index = 0
    for target in TARGET_USERS:
        for template in HOOK_TEMPLATES:
            ideas.append(make_idea(index, target, template))
            index += 1
    ideas = ideas[:70]

    lines = [
        "# Vocalype Brain - Growth Report",
        "",
        f"Date: {date.today().isoformat()}",
        "",
        "## Demo-Based Content Ideas",
        "",
    ]
    for number, idea in enumerate(ideas, start=1):
        lines.extend(
            [
                f"### {number}. {idea['hook']}",
                "",
                f"Platform: {idea['platform']}",
                f"Target user: {idea['target_user']}",
                f"Demo scene: {idea['demo_scene']}",
                f"CTA: {idea['cta']}",
                f"Metric to track: {idea['metric']}",
                "",
            ]
        )
    write_text("outputs/growth_report.md", "\n".join(lines).rstrip() + "\n")
    print(f"Generated internal/brain/outputs/growth_report.md with {len(ideas)} ideas")


if __name__ == "__main__":
    main()
