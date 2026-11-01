import plugin from "tailwindcss/plugin";
import flattenColorPalette from "tailwindcss/lib/util/flattenColorPalette";

export default plugin(({ matchUtilities, theme, addBase, addUtilities }) => {
  matchUtilities(
    {
      text: (value) => {
        if (
          [
            "inherit",
            "currentColor",
            "currentcolor",
            "var(--color-inherit)",
            "var(--color-current)",
          ].includes(value)
        ) {
          return { "--lucide-stroke": "inherit", "--lucide-filter": "inherit" };
        }
        const mixed = value.match(
          /^color-mix\(in oklab, (var\(--color-foreground-subt(?:le|lest)\)) ([\d.]+)%, transparent\)$/,
        );
        const color = mixed?.[1] ?? value;
        const tone =
          color === "var(--color-foreground-subtle)"
            ? "0.6"
            : color === "var(--color-foreground-subtlest)"
              ? "var(--lucide-subtlest-opacity)"
              : null;
        const alpha = mixed ? `calc(${tone} * ${Number(mixed[2]) / 100})` : tone;
        return {
          "--lucide-stroke": tone ? "rgb(from currentColor r g b / 1)" : "currentColor",
          "--lucide-filter": tone ? `opacity(${alpha})` : "initial",
        };
      },
    },
    {
      values: Object.fromEntries(
        Object.keys(flattenColorPalette(theme("colors"))).map((name) => [
          name,
          `var(--color-${name})`,
        ]),
      ),
      type: "color",
    },
  );
  const relativeColorSupport = "@supports (color: rgb(from red r g b / 1))";
  addBase({
    [relativeColorSupport]: {
      'svg.lucide[stroke="currentColor"]': {
        stroke: "var(--lucide-stroke, currentColor)",
        filter: "var(--lucide-filter, none)",
      },
      'svg.lucide[stroke="currentColor"][fill="currentColor"]': {
        fill: "var(--lucide-stroke, currentColor)",
      },
    },
  });
  addUtilities({
    ".fill-current": {
      [relativeColorSupport]: {
        '&:is(.lucide):where(svg[stroke="currentColor"])': {
          fill: "var(--lucide-stroke, currentColor)",
        },
      },
    },
  });
});
