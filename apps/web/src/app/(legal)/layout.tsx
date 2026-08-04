import Link from "next/link";

/**
 * Shared shell for the policy pages. Prose-width rather than the 6xl the market pages use —
 * these are read, not scanned, and full-width paragraphs of monospace are punishing.
 */
const PAGES = [
  { href: "/about", label: "About" },
  { href: "/terms", label: "Terms of use" },
  { href: "/privacy", label: "Privacy" },
  { href: "/credits", label: "Credits" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-6 flex flex-wrap gap-x-4 gap-y-2 border-b border-line pb-3 text-xs">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="text-ink-dim hover:text-accent">
            {p.label}
          </Link>
        ))}
      </nav>
      <article className="space-y-5 text-sm leading-relaxed text-ink-dim [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-ink [&_a]:underline [&_a:hover]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink">
        {children}
      </article>
    </div>
  );
}
