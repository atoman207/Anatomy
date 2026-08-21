import { avatarFor } from "@/lib/ai/reviewerProfiles";

/**
 * A generated avatar for one reviewer - a colored circle, a subtle rotated
 * ring motif, and the first character of the reviewer's name. Deterministic
 * from the name (see `avatarFor`), so renaming a reviewer on the admin page
 * changes its avatar automatically and there is never an image file behind
 * it.
 */
export function ReviewerAvatar({
  name, size = 40,
}: {
  name: string;
  size?: number;
}) {
  const { bg, fg, glyph, patternRotation } = avatarFor(name);

  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      role="img"
      aria-label={`${name}のアバター`}
      className="shrink-0 rounded-full"
    >
      <circle cx="20" cy="20" r="20" fill={bg} />
      <g
        transform={`rotate(${patternRotation} 20 20)`}
        stroke={fg}
        strokeOpacity="0.28"
        strokeWidth="1.2"
        fill="none"
      >
        <circle cx="20" cy="20" r="15.5" />
        <path d="M20 4.5 A15.5 15.5 0 0 1 33.4 27.8" />
      </g>
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        fill={fg}
        fontSize="17"
        fontFamily="var(--font-noto-serif-jp), serif"
        fontWeight="600"
      >
        {glyph}
      </text>
    </svg>
  );
}
