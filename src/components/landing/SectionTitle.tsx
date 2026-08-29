import { cx } from "@/components/ui";

/**
 * Bilingual landing section heading: Japanese primary line plus English
 * subtitle in accent color with a red underline that shortens on hover.
 */
export function SectionTitle({
  japanese,
  english,
  className,
  centered = true,
  as: Tag = "h2",
}: {
  japanese: string;
  english: string;
  className?: string;
  centered?: boolean;
  as?: "h2" | "p";
}) {
  return (
    <Tag
      className={cx(
        "group font-serif font-semibold text-ink",
        Tag === "h2" ? "text-3xl" : "text-[13px] font-medium tracking-[0.14em]",
        centered && "mx-auto w-full text-center",
        className,
      )}
    >
      <span className="block">{japanese}</span>
      <span
        className={cx(
          "landing-section-title-en relative mt-1 inline-block font-sans font-medium tracking-[0.12em] text-accent",
          Tag === "h2" ? "text-[15px]" : "text-[12px]",
        )}
      >
        {english}
      </span>
    </Tag>
  );
}
