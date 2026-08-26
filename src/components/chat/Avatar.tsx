import { cx } from "@/components/ui";

/**
 * A person's real avatar image when they have one set, used as-is (no
 * cropping beyond a simple cover-fit, no generated/stylized fallback
 * avatar) - only when `avatarUrl` is empty does this fall back to an
 * initial-letter tile, matching the same pattern `Header.tsx`'s own
 * account button already uses.
 */
export function Avatar({
  name,
  avatarUrl,
  size = 36,
  className,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const initial = name.trim().slice(0, 1).toUpperCase() || "?";

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar sources are arbitrary user uploads, not app assets next/image can optimise
      <img
        src={avatarUrl}
        alt=""
        style={{ width: size, height: size }}
        className={cx("shrink-0 rounded-md object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) }}
      className={cx("grid shrink-0 place-items-center rounded-md bg-accent-soft font-bold text-accent", className)}
    >
      {initial}
    </span>
  );
}
