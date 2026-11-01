import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function stageE2EAppOutput(sourceDir: string, destinationDir: string) {
  await mkdir(destinationDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = join(sourceDir, entry.name);
      const destinationPath = join(destinationDir, entry.name);
      if (entry.isDirectory()) {
        await stageE2EAppOutput(sourcePath, destinationPath);
        return;
      }
      if (!entry.isFile()) {
        throw new Error(`Unsupported E2E app output entry: ${sourcePath}`);
      }
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_FICLONE);
    }),
  );
}
