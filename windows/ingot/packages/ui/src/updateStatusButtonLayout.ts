export function resolveUpdateButtonResponsiveClasses({
  isMacDesktop,
  isWindowsDesktop,
}: {
  isMacDesktop: boolean;
  isWindowsDesktop: boolean;
}) {
  if (isMacDesktop) {
    return {
      expandWidthClass: "@min-[280px]/topoverlayer:w-auto",
      hideIconClass: "@min-[280px]/topoverlayer:hidden",
      revealTextClass: [
        "@min-[280px]/topoverlayer:opacity-100",
        "@min-[280px]/topoverlayer:w-auto",
        "@min-[280px]/topoverlayer:relative",
      ],
    };
  }

  if (isWindowsDesktop) {
    return {
      expandWidthClass: "@min-[216px]/topoverlayer:w-auto",
      hideIconClass: "@min-[216px]/topoverlayer:hidden",
      revealTextClass: [
        "@min-[216px]/topoverlayer:opacity-100",
        "@min-[216px]/topoverlayer:w-auto",
        "@min-[216px]/topoverlayer:relative",
      ],
    };
  }

  return {
    expandWidthClass: "@min-[280px]/topoverlayer:w-auto",
    hideIconClass: "@min-[280px]/topoverlayer:hidden",
    revealTextClass: [
      "@min-[280px]/topoverlayer:opacity-100",
      "@min-[280px]/topoverlayer:w-auto",
      "@min-[280px]/topoverlayer:relative",
    ],
  };
}
