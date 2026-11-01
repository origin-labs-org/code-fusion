---
name: computer-use
description: Control local Windows apps through CodeFusion Computer Use when a task requires reading or operating app UI. Prefer purpose-built connectors, APIs, or CLIs when available.
---

# Computer Use

- Inspect the target with `get_app_state` before acting and refresh state after actions.
- Prefer element-index actions over screenshot coordinates when accessibility elements are available.
- Use screenshots when UI Automation state is incomplete.
- Prefer purpose-built connectors, APIs, or CLIs for stable semantic operations.
