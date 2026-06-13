/**
 * OreonWord — the OREON brand wordmark: "ORE" in polished silver steel,
 * "ON" in solid white. Shared so the hero, landing header, app sidebar and the
 * "Ask OREON" nav entry all render the mark with the same colour treatment.
 */
export function OreonWord({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-steel">ORE</span>
      <span className="text-foreground">ON</span>
    </span>
  );
}
