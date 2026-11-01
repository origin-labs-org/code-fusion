import { expect, it } from "vitest";
import { countRendererReloadAcks } from "#e2e/helpers/remote-renderer-ready-evidence";

const prefix = "[2026-10-11 12:00:00.000] [info] [pid:100] [main] [window-host-remote]";
const ack = (id: string, reason = "local-1:renderer-reload") =>
  `${prefix} renderer attachment ready, sessionId=${id}, reason=${reason}`;

it("Simultaneous recovery is only proven when two different sessions each receive a valid reload ACK", () => {
  const counts = countRendererReloadAcks(
    [
      ack("a", "connect"),
      `${prefix} ignore stale renderer attachment ready, sessionId=b`,
      ack("a"),
      ack("a"),
      ack("b"),
      "",
    ].join("\n"),
  );
  expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1 });
});

it("Partial lines and text relayed by other processes cannot be used as evidence that Main is ready", () => {
  const content = `[agent] ${ack("a")}\n${ack("b")}`;
  expect([...countRendererReloadAcks(content)]).toEqual([]);
});
