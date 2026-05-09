from __future__ import annotations

from brain import ensure_brain_structure, read_jsonl, save_actions, score_action


def main() -> None:
    ensure_brain_structure()
    actions = read_jsonl("data/actions.jsonl")
    for action in actions:
        score_action(action)
    save_actions(actions)
    print(f"Scored {len(actions)} actions in internal/brain/data/actions.jsonl")


if __name__ == "__main__":
    main()
