#!/usr/bin/env python3
"""Submit测验Answer并评分。

用法：python3 submit_answers.py <user_id> <document_id> <session_id> <answers_json>

参Count：
  user_id:      UserLabel识
  document_id:  DocumentationLabel识
  session_id:   测验Session ID
  answers_json: JSON 格式的AnswerCharacter典，如 '{"q_001":"A","q_002":"True"}'

Output：评分Result JSON（score, total, accuracy, results）。
"""
from pathlib import Path
import json
import sys

sys.path.append(str(Path(__file__).resolve().parents[1] / "src"))

from quiz_mastery import QuizMasteryService


def main() -> None:
    if len(sys.argv) < 5:
        print("Usage: submit_answers.py <user_id> <document_id> <session_id> <answers_json>")
        sys.exit(1)

    user_id = sys.argv[1]
    document_id = sys.argv[2]
    session_id = sys.argv[3]
    answers = json.loads(sys.argv[4])

    service = QuizMasteryService(
        base_dir=Path(__file__).resolve().parents[1] / "data"
    )

    result = service.submit_quiz_answers(
        user_id=user_id,
        document_id=document_id,
        session_id=session_id,
        answers=answers,
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
