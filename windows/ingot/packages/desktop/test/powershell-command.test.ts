import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createEncodedPowerShellArgs,
  createWindowsPowerShellSecurityArgs,
} from "../scripts/powershell-command.mjs";

function decodeCommand(args: string[]): string {
  expect(args.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand"]);
  expect(args).toHaveLength(5);
  return Buffer.from(args[4]!, "base64").toString("utf16le");
}

describe("powershell-command", () => {
  it("Encode dynamic values into script and no longer rely on trailing arguments of regular -Command", () => {
    const values = ["C:\\Program Files\\Z'Code;Tests\\helper.exe", "value with spaces & symbols"];
    const args = createEncodedPowerShellArgs(
      "[Console]::Out.Write($cfArg0 + '|' + $cfArg1)",
      values,
    );

    const command = decodeCommand(args);
    expect(command).not.toContain("$args");
    for (const [index, value] of values.entries()) {
      expect(command).not.toContain(value);
      expect(command).toContain(`$cfArg${index}=`);
      expect(command).toContain(Buffer.from(value, "utf8").toString("base64"));
    }
  });

  it("从 PSHOME 显式加载 Windows PowerShell Security 模块", () => {
    const command = decodeCommand(
      createWindowsPowerShellSecurityArgs("[Console]::Out.Write('loaded')"),
    );

    expect(command).toContain(
      "[IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Security'",
    );
    expect(command).toContain("Import-Module -Name $cfSecurityModule -Force -ErrorAction Stop");
    expect(command).toContain("Windows PowerShell Security module load failed");
    expect(command).toContain("exit 26");
    expect(command).not.toContain("$env:PSModulePath");
  });

  it.runIf(process.platform === "win32")(
    "Windows PowerShell can restore dynamic values containing spaces and script metacharacters",
    () => {
      const values = ["C:\\Program Files\\Z'Code;Tests\\helper.exe", "value with spaces & symbols"];
      const output = execFileSync(
        "powershell.exe",
        createEncodedPowerShellArgs(
          "[Console]::Out.Write($cfArg0 + [Environment]::NewLine + $cfArg1)",
          values,
        ),
        { encoding: "utf8" },
      );

      expect(output.split(/\r?\n/)).toEqual(values);
    },
  );

  it.runIf(process.platform === "win32")(
    "Windows PowerShell still loads system Security module when PSModulePath is tainted",
    () => {
      const output = execFileSync(
        "powershell.exe",
        createWindowsPowerShellSecurityArgs(
          [
            "$signature=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $cfArg0;",
            "[Console]::Out.Write($null -ne $signature)",
          ].join(""),
          [process.execPath],
        ),
        {
          encoding: "utf8",
          env: { ...process.env, PSModulePath: "Z:\\cf-invalid-psmodulepath" },
        },
      );

      expect(output).toBe("True");
    },
  );
});
