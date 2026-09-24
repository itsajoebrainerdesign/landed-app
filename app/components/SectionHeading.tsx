export function SectionHeading({
  children,
  hideArrow = false,
  size,
}: {
  children: React.ReactNode;
  hideArrow?: boolean;
  size?: number;
}) {
  const fontSize = size || 38;
  return (
    <div className="flex flex-col gap-2.5">
      {!hideArrow && <span className="font-semibold text-[22px] leading-none text-ink">↘</span>}
      <span className="font-semibold text-ink leading-none" style={{ fontSize }}>{children}</span>
    </div>
  );
}
