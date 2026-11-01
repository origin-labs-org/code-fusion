declare const __CF_VERSION__: string;
declare const __CF_COMMIT__: string;
declare const __CF_BUILD_TIME__: string;

export const CF_VERSION: string =
  typeof __CF_VERSION__ !== "undefined" ? __CF_VERSION__ : "0.0.0-dev";
export const CF_COMMIT: string =
  typeof __CF_COMMIT__ !== "undefined" ? __CF_COMMIT__ : "unknown";
export const CF_BUILD_TIME: string =
  typeof __CF_BUILD_TIME__ !== "undefined" ? __CF_BUILD_TIME__ : "unknown";
