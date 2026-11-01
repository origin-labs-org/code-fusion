import { ipcRenderer } from "electron";

const RECORDER_PORT_CHANNEL = "cf-browser-video-recorder:port";

ipcRenderer.once(RECORDER_PORT_CHANNEL, (event) => {
  const [port] = event.ports;
  if (port) window.postMessage(RECORDER_PORT_CHANNEL, "*", [port]);
});
