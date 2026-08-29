const JP_DIAL = "+81";

/** Builds +81… from a national number typed without the country code. */
export function japanPhone(national: string): string | null {
  const raw = national.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.startsWith("+")) return `+${digits}`;
  const rest = digits.startsWith("0")
    ? digits.slice(1)
    : digits.startsWith("81")
      ? digits.slice(2)
      : digits;
  return rest ? `${JP_DIAL}${rest}` : null;
}

/** Strips +81 for editing in a national-number field. */
export function phoneNationalPart(phone: string | null | undefined): string {
  if (!phone) return "";
  const trimmed = phone.trim();
  if (trimmed.startsWith("+81")) return trimmed.slice(3);
  if (trimmed.startsWith("81")) return trimmed.slice(2);
  return trimmed;
}

export const JP_DIAL_CODE = JP_DIAL;
