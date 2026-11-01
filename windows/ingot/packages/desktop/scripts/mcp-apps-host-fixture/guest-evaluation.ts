import type { WebContents } from "electron";

export function evaluateGuest(guest: WebContents, code: string): Promise<any> {
  const frame = guest.mainFrame.frames.find((candidate) => candidate.url.includes("/instance/"))!;
  let closed!: () => void;
  const destroyed = new Promise<never>((_resolve, reject) => {
    closed = () => reject(new Error("fixture page was destroyed"));
    guest.once("destroyed", closed);
  });
  return Promise.race([frame.executeJavaScript(code), destroyed]).finally(() =>
    guest.removeListener("destroyed", closed),
  );
}
