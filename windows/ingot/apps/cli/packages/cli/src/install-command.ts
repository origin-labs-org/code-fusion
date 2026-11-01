import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { color } from "@origin-ai/cf-core";

const CF_DESKTOP_DOWNLOAD_URL = "https://cf.z.ai/docs/download";

type InstallChoice = "desktop" | "tui" | "both";

const CHOICE_MENU = `${color.bold("CodeFusion install")}

What would you like to install?

  ${color.cyan("1")}  Desktop app        - the CodeFusion desktop application (GUI)
  ${color.cyan("2")}  CLI / TUI          - the terminal interface (already available via npm)
  ${color.cyan("3")}  Both               - desktop app + CLI / TUI

Choose [1-3]: `;

function parseInstallFlags(args: string[]): InstallChoice | null {
  const flat = args.filter((a) => a.startsWith("--"));
  if (flat.includes("--desktop") && flat.includes("--tui")) return "both";
  if (flat.includes("--desktop")) return "desktop";
  if (flat.includes("--tui")) return "tui";
  if (flat.includes("--both")) return "both";
  return null;
}

async function promptChoice(
  ctx: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream },
): Promise<InstallChoice | null> {
  const rl = createInterface({ input: ctx.stdin, output: ctx.stdout });
  try {
    const answer = (await rl.question(CHOICE_MENU)).trim();
    if (answer === "1" || /^desk/i.test(answer)) return "desktop";
    if (answer === "2" || /^(cli|tui)/i.test(answer)) return "tui";
    if (answer === "3" || /^both/i.test(answer)) return "both";
    return null;
  } finally {
    rl.close();
  }
}

/**
 * Open a fixed https URL in the default browser. No shell, no string commands:
 * each platform uses its literal opener binary with the URL as the only argument.
 */
function openUrl(url: string): boolean {
  if (!/^https:\/\//.test(url)) {
    return false;
  }
  try {
    let child: ReturnType<typeof spawn>;
    if (process.platform === "win32") {
      child = spawn("explorer", [url], { shell: false, detached: true, stdio: "ignore" });
    } else if (process.platform === "darwin") {
      child = spawn("open", [url], { shell: false, detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [url], { shell: false, detached: true, stdio: "ignore" });
    }
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function installDesktop(ctx: { stdout: NodeJS.WritableStream }) {
  ctx.stdout.write("\nDesktop app install\n");
  ctx.stdout.write("-------------------\n");
  const platform =
    process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  ctx.stdout.write(`Detected platform: ${platform}\n`);
  const opened = openUrl(CF_DESKTOP_DOWNLOAD_URL);
  if (opened) {
    ctx.stdout.write(`Opening the download page: ${CF_DESKTOP_DOWNLOAD_URL}\n`);
  } else {
    ctx.stdout.write(`Download the installer here:\n  ${CF_DESKTOP_DOWNLOAD_URL}\n`);
  }
  ctx.stdout.write("Run the installer, then sign in with your CodeFusion account.\n");
}

function installTui(ctx: { stdout: NodeJS.WritableStream }) {
  ctx.stdout.write("\nCLI / TUI install\n");
  ctx.stdout.write("-----------------\n");
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (nodeMajor >= 20) {
    ctx.stdout.write(`Node.js ${process.versions.node} detected - OK.\n`);
  } else {
    ctx.stdout.write(
      `Node.js ${process.versions.node} detected - the CodeFusion CLI needs Node.js 20 or newer.\n`,
    );
  }
  ctx.stdout.write("The CLI / TUI is already installed with this package. Get started:\n");
  ctx.stdout.write(`  ${color.cyan("cf")}          start the interactive TUI\n`);
  ctx.stdout.write(`  ${color.cyan("cf doctor")}  run environment diagnostics\n`);
  ctx.stdout.write(`  ${color.cyan("cf login")}   sign in to your CodeFusion account\n`);
}

export async function runInstallCommand(
  ctx: { stdin: NodeJS.ReadableStream; stdout: NodeJS.WritableStream },
  _options: unknown,
  _commandDeps: unknown,
  args: string[],
): Promise<number> {
  let choice = parseInstallFlags(args);
  if (!choice) {
    if (!ctx.stdin.isTTY) {
      ctx.stdout.write(
        "cf install: non-interactive terminal. Use one of: --desktop | --tui | --both\n",
      );
      return 1;
    }
    choice = await promptChoice(ctx);
  }
  if (!choice) {
    ctx.stdout.write("No valid choice made. Run `cf install` again.\n");
    return 1;
  }
  if (choice === "desktop" || choice === "both") installDesktop(ctx);
  if (choice === "tui" || choice === "both") installTui(ctx);
  ctx.stdout.write("\nDone. Welcome to CodeFusion!\n");
  return 0;
}
