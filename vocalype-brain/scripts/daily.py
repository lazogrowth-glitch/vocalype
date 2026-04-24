from __future__ import annotations

from brain import ensure_brain_structure, generate_daily_report, read_jsonl, save_actions, score_action, write_text


STARTER_ACTIONS = [
    {
        "agent": "product_agent",
        "title": "Improve first successful dictation flow",
        "problem": "New users may not reach a successful dictation quickly enough.",
        "why_it_matters": "First successful dictation is the activation event that proves Vocalype's promise.",
        "expected_impact": "critical",
        "difficulty": "medium",
        "urgency": "critical",
        "area": "onboarding, dictation flow",
        "suggested_files": [],
        "action": "Audit the first-run path and remove one step between launch and first successful dictation.",
        "validation_test": "Fresh install user can dictate and paste text into another app in under 3 minutes.",
        "metric": "first_dictation_success_rate",
    },
    {
        "agent": "product_agent",
        "title": "Audit activation and license error messages",
        "problem": "Confusing activation failures can block paying users.",
        "why_it_matters": "License friction creates refunds, support load, and lost trust.",
        "expected_impact": "high",
        "difficulty": "easy",
        "urgency": "high",
        "area": "activation, license flow, error messages",
        "suggested_files": [],
        "action": "List every activation error and rewrite each message with cause, fix, and support path.",
        "validation_test": "Trigger each license error state and confirm the user gets a clear next step.",
        "metric": "activation_support_tickets_per_100_users",
    },
    {
        "agent": "saas_agent",
        "title": "Add or improve demo video above fold",
        "problem": "Visitors may not understand Speak -> text appears -> paste anywhere fast enough.",
        "why_it_matters": "A visible demo can increase download intent and trust.",
        "expected_impact": "high",
        "difficulty": "medium",
        "urgency": "high",
        "area": "landing page, website hero",
        "suggested_files": [],
        "action": "Add a 20-second demo showing Vocalype dictating into ChatGPT, Gmail, and VS Code.",
        "validation_test": "A/B compare download button CTR before and after adding the demo.",
        "metric": "download_button_ctr",
    },
    {
        "agent": "model_agent",
        "title": "Create benchmark for French dictation",
        "problem": "French accuracy cannot improve without repeatable benchmark cases.",
        "why_it_matters": "French mode can become a clear niche advantage if measured and improved.",
        "expected_impact": "high",
        "difficulty": "medium",
        "urgency": "medium",
        "area": "model benchmarks, French mode",
        "suggested_files": [],
        "action": "Create 25 French casual speech samples and test each supported model.",
        "validation_test": "Run the same samples across models and rank WER estimate plus latency.",
        "metric": "french_wer_estimate",
    },
    {
        "agent": "model_agent",
        "title": "Create benchmark for developer code dictation",
        "problem": "Code dictation quality is unknown and likely fragile.",
        "why_it_matters": "Developers are a strong niche if Vocalype can handle identifiers, punctuation, and commands.",
        "expected_impact": "high",
        "difficulty": "medium",
        "urgency": "medium",
        "area": "model benchmarks, developer mode",
        "suggested_files": [],
        "action": "Build 20 developer dictation prompts for VS Code comments, function names, and commands.",
        "validation_test": "Measure exact-match rate for code-related punctuation and identifiers.",
        "metric": "code_dictation_exact_match_rate",
    },
    {
        "agent": "growth_agent",
        "title": "Write 10 demo-based TikTok hooks",
        "problem": "Generic startup content will not show the product promise.",
        "why_it_matters": "Demo-based hooks can create faster understanding and stronger download intent.",
        "expected_impact": "medium",
        "difficulty": "easy",
        "urgency": "medium",
        "area": "distribution, content",
        "suggested_files": [],
        "action": "Write and record 10 hooks that show Vocalype replacing typing in real apps.",
        "validation_test": "Publish 3 variants and compare 3-second hold rate and profile click rate.",
        "metric": "profile_click_rate",
    },
    {
        "agent": "saas_agent",
        "title": "Clarify offline and private positioning on landing page",
        "problem": "Users may not immediately understand that Vocalype is offline by default and private.",
        "why_it_matters": "Privacy clarity increases trust and differentiates against cloud dictation tools.",
        "expected_impact": "high",
        "difficulty": "easy",
        "urgency": "high",
        "area": "landing page, trust messaging",
        "suggested_files": [],
        "action": "Add concise above-fold trust copy: Offline by default. Your voice stays on your machine.",
        "validation_test": "Run a 5-second test and ask users to name the main privacy benefit.",
        "metric": "privacy_message_recall_rate",
    },
    {
        "agent": "saas_agent",
        "title": "Track download click rate",
        "problem": "Distribution work cannot be judged without download intent data.",
        "why_it_matters": "Download CTR shows whether positioning and content convert attention into action.",
        "expected_impact": "medium",
        "difficulty": "easy",
        "urgency": "high",
        "area": "analytics, landing page",
        "suggested_files": [],
        "action": "Add a lightweight local or privacy-friendly event for homepage download button clicks.",
        "validation_test": "Click download in staging and confirm the event appears in reporting.",
        "metric": "download_button_ctr",
    },
    {
        "agent": "product_agent",
        "title": "Track first dictation success rate",
        "problem": "The core activation event is not visible as a metric.",
        "why_it_matters": "Without this metric, onboarding and dictation fixes cannot be prioritized correctly.",
        "expected_impact": "critical",
        "difficulty": "medium",
        "urgency": "critical",
        "area": "analytics, onboarding, dictation",
        "suggested_files": [],
        "action": "Record whether a new user completes first successful dictation during first session.",
        "validation_test": "Complete a new-user dictation and confirm the metric increments once.",
        "metric": "first_dictation_success_rate",
    },
    {
        "agent": "saas_agent",
        "title": "Track upgrade conversion",
        "problem": "Trial-to-paid performance is not actionable without a conversion metric.",
        "why_it_matters": "Upgrade conversion links product activation to revenue growth.",
        "expected_impact": "high",
        "difficulty": "medium",
        "urgency": "high",
        "area": "pricing, checkout, analytics",
        "suggested_files": [],
        "action": "Track trial starts, upgrade clicks, checkout starts, and paid activations.",
        "validation_test": "Run a test upgrade path and verify each funnel event is recorded.",
        "metric": "trial_to_paid_conversion_rate",
    },
]


def main() -> None:
    ensure_brain_structure()
    actions = read_jsonl("data/actions.jsonl")
    if not actions:
        actions = STARTER_ACTIONS
    for action in actions:
        score_action(action)
    save_actions(actions)
    report = generate_daily_report(actions)
    write_text("outputs/daily_actions.md", report)
    print("Generated vocalype-brain/outputs/daily_actions.md")


if __name__ == "__main__":
    main()
