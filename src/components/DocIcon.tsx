import { cn } from "@/lib/utils";

// DevDocs icons (32×32), named after the slug without its version. See THIRD_PARTY_NOTICES.md.
const ICONS = import.meta.glob<string>("@/assets/doc-icons/*.png", {
  eager: true,
  import: "default",
});
const BY_NAME = new Map(
  Object.entries(ICONS).map(([path, url]) => [path.replace(/^.*\/|\.png$/g, ""), url]),
);
/** Docs whose DevDocs icon has another name. */
const ALIASES: Record<string, string> = {
  browser_support_tables: "support_tables",
  xslt_xpath: "xpath",
};

/** The doc's logo, or its initial on a colored tile when DevDocs has none. */
export function DocIcon({
  slug,
  name,
  className,
}: {
  slug: string;
  name: string;
  className?: string;
}) {
  const base = slug.split("~")[0] ?? slug;
  const url = BY_NAME.get(ALIASES[base] ?? base);
  const box = cn("size-4 shrink-0 rounded-[3px]", className);
  if (url) {
    // Many logos are dark: a light tile keeps them visible in dark mode.
    return <img src={url} alt="" className={cn(box, "dark:bg-white dark:p-px")} />;
  }
  const hue = [...base].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span
      aria-hidden
      className={cn(
        box,
        "inline-flex items-center justify-center font-semibold text-[10px] text-white",
      )}
      style={{ backgroundColor: `hsl(${hue} 55% 45%)` }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
