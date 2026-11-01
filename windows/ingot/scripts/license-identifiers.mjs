const reviewed = new Set(["buffers@0.1.1", "chainsaw@0.1.0"]);

export function legacyLicenseIdentifier(pkg) {
  return pkg.name === "buffers" && pkg.version === "0.1.1" ? "MIT/X11" : undefined;
}

export function isReviewedLegacyLicense(pkg) {
  return reviewed.has(`${pkg.name}@${pkg.version}`) && pkg.license === "MIT/X11";
}

export function isReviewedBundledFontLicense(pkg) {
  return (
    pkg.name === "@fontsource/noto-sans-sc" && pkg.version === "5.3.1" && pkg.license === "OFL-1.1"
  );
}
