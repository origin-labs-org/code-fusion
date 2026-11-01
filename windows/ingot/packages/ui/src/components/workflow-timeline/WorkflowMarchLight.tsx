
export interface MarchLightProps {
  
  d: string;
  
  from: { x: number; y: number };
  
  to: { x: number; y: number };
  id: string;
}

export function MarchLight({ d, from, id, to }: MarchLightProps) {
  const alongY = from.x === to.x;
  return (
    <>
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={id}
          x1={alongY ? 0 : from.x}
          x2={alongY ? 0 : to.x}
          y1={alongY ? from.y : 0}
          y2={alongY ? to.y : 0}
        >
          <stop offset={0} stopColor="var(--color-warning)" stopOpacity={0} />
          <stop offset={0.8} stopColor="var(--color-warning)" />
        </linearGradient>
      </defs>
      <path
        className="wf-lit"
        d={d}
        data-testid="workflow-march-light"
        fill="none"
        stroke={`url(#${id})`}
      />
    </>
  );
}
