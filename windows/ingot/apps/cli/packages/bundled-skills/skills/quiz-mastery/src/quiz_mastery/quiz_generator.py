from __future__ import annotations

import json
from .models import KnowledgePoint


# Maximum questions per quiz round
MAX_QUESTIONS_PER_ROUND = 15

# Question type distribution by level
LEVEL_DISTRIBUTION = {
    1: {"single_choice": 70, "true_false": 30},
    2: {"single_choice": 50, "fill_blank": 30, "true_false": 20},
    3: {"single_choice": 40, "fill_blank": 20, "true_false": 20, "short_answer": 20},
}


class QuizGenerator:
    """Builds prompt templates for LLM-based quiz generation.

    This module does NOT call any LLM API. It constructs system_prompt and
    user_prompt that should be sent to an LLM by the caller (agent).
    """

    def generate_quiz(
        self,
        knowledge_points: list[KnowledgePoint],
        level: int = 1,
        num_questions: int | None = None,
    ) -> dict:
        """Build prompts for quiz generation.

        Args:
            knowledge_points: List of knowledge points to quiz on.
            level: Difficulty level (1, 2, or 3).
            num_questions: Number of questions to generate (max 15).

        Returns:
            dict with 'system_prompt' and 'user_prompt' keys.
        """
        level = max(1, min(3, level))
        if num_questions is None:
            num_questions = 3  # Default: 3 questions per round for efficiency
        num_questions = min(num_questions, MAX_QUESTIONS_PER_ROUND)

        distribution = LEVEL_DISTRIBUTION[level]
        distribution_text = "\n".join(
            f"  - {qtype}: {pct}%" for qtype, pct in distribution.items()
        )

        # Build knowledge point descriptions for the prompt
        kp_descriptions = []
        for kp in knowledge_points:
            desc_parts = [f"- **{kp.title}** (ID: {kp.id})"]
            if kp.definition:
                desc_parts.append(f"  定义: {kp.definition}")
            if kp.description:
                desc_parts.append(f"  描述: {kp.description}")
            if kp.source and kp.source.snippets:
                desc_parts.append(f"  Original textSegments: {'; '.join(kp.source.snippets)}")
            kp_descriptions.append("\n".join(desc_parts))

        kp_text = "\n\n".join(kp_descriptions)

        level_desc = {
            1: "识记（基础Memoryand理解，考察Concepts辨认and基本事实）",
            2: "理解（深层理解，考察Concepts区分、原理解释and简单应用）",
            3: "应用（综合运用，考察实际场景应用、AnalyticsandIssue解决）",
        }

        system_prompt = (
            "你YesOne个Professional的出题助手。根据提供的知识点Letter息，生成High质量的测验题目。\n"
            "严格按照要求的 JSON 格式Output，不要Output任何Otherinner容。\n"
            "题目必须紧扣知识点的Name、定义andOriginal text描述，不能出脱离Original text的题目。"
        )

        user_prompt = f"""请根据以下知识点生成 {num_questions} 道测验题。

## 难度级别
Level {level}: {level_desc[level]}

## 题型分配
{distribution_text}

## 知识点Letter息

{kp_text}

## 出题要求
1. 每道题必须关联至少One个知识点 ID
2. 选择题 (single_choice)：4 个选项 A/B/C/D，answer 填正确选项Character母
3. 判断题 (true_false)：answer 填 "True" or "False"
4. 填空题 (fill_blank)：prompt Medium用 ____ Label记空白处，answer 填正确AnswerText
5. 简Answer题 (short_answer)：answer 填Reference Answers
6. 每道题必须包含 explanation（解析）
7. 题目inner容必须基于上述知识点的Name、定义and描述，不要超出范围
8. **每道题必须填写 `category` and `knowledge_point` Character段**（用于分类筛选andSidebargrouping）：
   - `category`：One级分类，**短词**（建议 2-6 Character），用于顶部分类筛选 chip。
     例：物理 / Count学 / 法律 / 历史 / 编程 / 通用 等。
     **不要**写成Long串、不要含Date、不要含编Number、不要含书名Numberor斜杠。
   - `knowledge_point`：所属知识点Name（直接用关联知识点的 title 即可），用于Sidebargrouping。
9. 总题Count：{num_questions} 道

## Output格式
Output纯 JSON Array，每个元素格式如下：
```json
[
  {{
    "id": "q_001",
    "knowledge_point_ids": ["kp_id"],
    "category": "物理",
    "knowledge_point": "牛顿第Two定律",
    "level": {level},
    "type": "single_choice",
    "prompt": "题目inner容",
    "options": ["A. 选项One", "B. 选项Two", "C. 选项Three", "D. 选项四"],
    "answer": "A",
    "explanation": "解析inner容"
  }}
]
```

请直接Output JSON Array，不要包含 markdown 代码块Label记orOtherTextCharacter。"""

        return {
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
        }
