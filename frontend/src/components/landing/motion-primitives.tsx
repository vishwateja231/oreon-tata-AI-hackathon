import { motion, useInView } from "framer-motion";
import { useRef, type ReactNode } from "react";

/* Fade up on scroll into view */
export function Reveal({
  children, delay = 0, y = 24, className = "",
}: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px -10% 0px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Stagger children */
export function Stagger({
  children, className = "", delay = 0,
}: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.07, delayChildren: delay } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className = "", y = 16 }: { children: ReactNode; className?: string; y?: number }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Section wrapper with eyebrow + title */
export function Section({
  eyebrow, title, lead, children, className = "",
}: {
  eyebrow?: string; title?: ReactNode; lead?: ReactNode;
  children: ReactNode; className?: string;
}) {
  return (
    <section className={`relative mx-auto max-w-[1600px] px-8 py-32 ${className}`}>
      {(eyebrow || title || lead) && (
        <header className="mb-16 max-w-4xl">
          {eyebrow && (
            <Reveal>
              <div className="eyebrow">{eyebrow}</div>
            </Reveal>
          )}
          {title && (
            <Reveal delay={0.05}>
              <h2 className="mt-5 h-display text-[44px] sm:text-[64px] leading-[0.95]">{title}</h2>
            </Reveal>
          )}
          {lead && (
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-2xl text-base leading-relaxed text-[var(--ink-dim)]">{lead}</p>
            </Reveal>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
