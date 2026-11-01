
interface TechStack {
  renderer: string;
  libraries: string[];
  fileStructure: string[];
}

interface Milestone {
  name: string;
  scope: string[];
}

interface Risk {
  risk: string;
  mitigation: string;
}

interface GamePlan {
  title: string;
  genre: string;
  concept: string;
  coreLoop: string[];
  mechanics: string[];
  techStack: TechStack;
  controls: string[];
  progression: string[];
  artStyle: string;
  ui: string[];
  milestones: Milestone[];
  risks: Risk[];
  acceptanceCriteria: string[];
}

interface ReviewIssue {
  severity: "blocker" | "major" | "minor";
  area: string;
  description: string;
  suggestion: string;
}

interface ReviewVerdict {
  verdict: "approve" | "revise";
  score: number;
  strengths: string[];
  issues: ReviewIssue[];
  focusNext: string[];
}

const planner = agent("Planner", {
  system:
    "You are a senior game designer and frontend 3D engineer. Create a development plan for a 3D mini-game that can run directly in the browser." +
    "Hard constraints: pure frontend, Three.js via CDN, single HTML file preferred, no build step, target 60fps." +
    "The plan must be specific, actionable, and scope-controlled (1-3 days to complete a playable prototype), with clear win/loss conditions and measurable acceptance criteria.",
});

const reviewer = agent("Reviewer", {
  system:
    "You are a strict game plan reviewer, reviewing solely based on the provided plan text without speculating on content outside the plan." +
    "Review dimensions: 1) Feasibility (pure frontend / no build / runnable in browser) 2) Gameplay fun and whether core loop is clear " +
    "3) Correctness of technical solution 4) Scope control 5) Measurability of acceptance criteria." +
    "Approve only when score>=8 and there are no blockers; otherwise must revise and provide actionable suggestions for modification.",
});

const MAX_ROUNDS = 3;

log("第 1 轮: Planner 生成初版计划");
let plan: GamePlan = await planner.ask<GamePlan>(
  "Please create a complete development plan for a 3D HTML mini-game: choose a specific game concept and explain the rationale, " +
  "覆盖玩法核心循环、机制、技术栈(Three.js CDN)、操作、难度进程、美术风格、UI、" +
  "里程碑、风险与验收标准。输出 GamePlan。"
);

log("Round 1: Reviewer review");
let verdict: ReviewVerdict = await reviewer.ask<ReviewVerdict>(
  "请评审以下游戏开发Plan:\n" + JSON.stringify(plan, null, 2)
);

let round = 1;
while (verdict.verdict !== "approve" && round < MAX_ROUNDS) {
  round = round + 1;
  log(
    "Reviewer 要求修订(得分 " + verdict.score + "/10, " +
    verdict.issues.length + " issues), entering Round " + round + ""
  );
  plan = await planner.ask<GamePlan>(
    "根据评审Feedback修订Plan, 重点解决 focusNext 与 blocker/major Issue, 保持 GamePlan Structures:\n" +
    "评审Feedback:\n" + JSON.stringify(verdict, null, 2) +
    "\n\nCurrentPlan:\n" + JSON.stringify(plan, null, 2)
  );
  verdict = await reviewer.ask<ReviewVerdict>(
    "Please review the revised game development plan for Round " + round + " 修订后的游戏开发Plan:\n" + JSON.stringify(plan, null, 2)
  );
}

log("评审结束: " + verdict.verdict + ", 最终得分 " + verdict.score + "/10, 共 " + round + "");
return { finalPlan: plan, finalReview: verdict, rounds: round };
