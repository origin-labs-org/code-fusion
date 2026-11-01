import { appendFile, access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
if (input.tool_input?.command === "echo E2E_STOP_RESULTS_DB_OUTPUT") {
  if (input.hook_event_name === "PreToolUse") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      }),
    );
  } else {
    await appendFile(
      process.argv[2],
      JSON.stringify({
        phase: "text_bash_completed",
        at: new Date().toISOString(),
        hook_event_name: input.hook_event_name,
        session_id: input.session_id,
        tool_use_id: input.tool_use_id,
        tool_response: input.tool_response,
      }) + "\n",
    );
    while (true) {
      try {
        await access(process.argv[3]);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await setTimeout(100);
    }
    process.stdout.write("{}");
  }
} else {
  process.stdout.write("{}");
}
