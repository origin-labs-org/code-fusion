
function noop(): void {}

const armsRumElectronStub = {
  init: async () => {},
  sendCustom: noop,
  sendEvent: noop,
  setConfig: noop,
  getConfig: () => ({}),
  instrumentTRPC: <T>(t: T) => t,
};

export default armsRumElectronStub;
