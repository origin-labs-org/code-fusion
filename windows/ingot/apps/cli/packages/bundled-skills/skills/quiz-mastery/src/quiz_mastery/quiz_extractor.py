from __future__ import annotations

import json
from .models import Question


def build_extraction_prompt(content: str) -> dict:
    """Build a prompt for LLM to parse questions from a question file.

    Args:
        content: Raw text content containing questions.

    Returns:
        dict with 'system_prompt' and 'user_prompt' keys.
    """
    system_prompt = (
        "你YesOne个Professional的题目解析助手。从User提供的题目FileMedium识别并解析所有题目。\n"
        "严格按照要求的 JSON 格式Output，不要Output任何Otherinner容。"
    )

    user_prompt = f"""请从以下题目Fileinner容Medium解析出所有题目。

## 题目Fileinner容

{content}

## 解析要求
1. 识别每道题的类型：
   - single_choice: 选择题（有 A/B/C/D 等选项）
   - true_false: 判断题（判断对Wrong）
   - fill_blank: 填空题（有空格需要填写）
   - short_answer: 简Answer题（需要TextCharacterAnswer）
2. 提取题目的所有Letter息
3. 如果题目有Answerand解析，也One并提取
4. 为每道题分配唯One ID

## Output格式
Output纯 JSON Array，每个元素格式如下：
```json
[
  {{
    "id": "q_001",
    "knowledge_point_ids": [],
    "level": 1,
    "type": "single_choice",
    "prompt": "题目inner容",
    "options": ["A. 选项One", "B. 选项Two", "C. 选项Three", "D. 选项四"],
    "answer": "A",
    "explanation": "解析inner容（如果有）"
  }}
]
```

注意：
- type 必须Yes single_choice, true_false, fill_blank, short_answer 之One
- 选择题的 answer 填选项Character母（A/B/C/D）
- 判断题的 answer 填 "True" or "False"
- 填空题的 answer 填正确AnswerText
- 简Answer题的 answer 填Reference Answers（如果有）
- 如果无法OK knowledge_point_ids，留空Array
- level Default为 1，如果能从题目难度判断则E应调整

请直接Output JSON Array，不要包含 markdown 代码块Label记orOtherTextCharacter。"""

    return {
        "system_prompt": system_prompt,
        "user_prompt": user_prompt,
    }


def parse_questions_json(json_str: str) -> list[Question]:
    """Parse LLM-returned JSON string into a list of Question objects.

    Args:
        json_str: JSON string containing a list of question dicts.

    Returns:
        List of Question objects.

    Raises:
        json.JSONDecodeError: If json_str is not valid JSON.
        ValueError: If the parsed data is not a list.
    """
    # Try to extract JSON from possible markdown code blocks
    cleaned = json_str.strip()
    if cleaned.startswith("```"):
        # Remove markdown code block markers
        lines = cleaned.split("\n")
        # Remove first line (```json or ```)
        lines = lines[1:]
        # Remove last line (```)
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines)

    data = json.loads(cleaned)
    if not isinstance(data, list):
        raise ValueError(f"Expected a JSON array, got {type(data).__name__}")

    questions: list[Question] = []
    for item in data:
        q = Question(
            id=item.get("id", "q_unknown"),
            knowledge_point_ids=item.get("knowledge_point_ids", []),
            level=item.get("level", 1),
            type=item.get("type", "single_choice"),
            prompt=item.get("prompt", ""),
            options=item.get("options", []),
            answer=item.get("answer"),
            explanation=item.get("explanation", ""),
            source_refs=item.get("source_refs", []),
        )
        questions.append(q)

    return questions
