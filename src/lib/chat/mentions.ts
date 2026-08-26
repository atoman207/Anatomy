/**
 * Slack-style @mentions for chat.
 *
 * Composer shows `@Display Name`; on send we rewrite known names to stable
 * `<@userId>` tokens so renames don't break old messages. Rendering resolves
 * tokens back to `@Display Name` chips (and still highlights legacy plain
 * `@Name` text for messages sent before this landed).
 */

export type MentionMember = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
};

export type MentionQuery = {
  /** Start index of the `@` in the full string. */
  atIndex: number;
  /** Text typed after `@` (may be empty). */
  query: string;
};

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string; displayName: string };

const TOKEN_RE = /<@([0-9a-fA-F-]{36})>/g;

/** Finds an active `@query` immediately before the caret, if any. */
export function findActiveMention(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = before.match(/@([^\s@]*)$/);
  if (!match || match.index === undefined) return null;
  // Don't treat an email-like fragment as a mention start.
  const atIndex = match.index;
  if (atIndex > 0 && /[A-Za-z0-9._-]/.test(before[atIndex - 1]!)) return null;
  return { atIndex, query: match[1] ?? "" };
}

export function filterMentionMembers(
  members: MentionMember[],
  query: string,
): MentionMember[] {
  const q = query.trim().toLowerCase();
  const sorted = [...members].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "ja"),
  );
  if (!q) return sorted;
  return sorted.filter((m) => m.displayName.toLowerCase().includes(q));
}

/** Replaces the active `@query` with `@Display Name ` and returns the new caret. */
export function insertMention(
  text: string,
  caret: number,
  member: MentionMember,
): { text: string; caret: number } {
  const active = findActiveMention(text, caret);
  if (!active) {
    const insert = `@${member.displayName} `;
    const next = text.slice(0, caret) + insert + text.slice(caret);
    return { text: next, caret: caret + insert.length };
  }
  const insert = `@${member.displayName} `;
  const next =
    text.slice(0, active.atIndex) + insert + text.slice(caret);
  return { text: next, caret: active.atIndex + insert.length };
}

/**
 * Rewrites `@Display Name` (exact, longest names first) into `<@userId>`
 * so stored messages stay stable if someone renames later.
 */
export function serializeMentions(text: string, members: MentionMember[]): string {
  const byLength = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  let out = text;
  for (const m of byLength) {
    const name = m.displayName;
    if (!name) continue;
    const needle = `@${name}`;
    let i = 0;
    let built = "";
    while (i < out.length) {
      const idx = out.indexOf(needle, i);
      if (idx === -1) {
        built += out.slice(i);
        break;
      }
      const beforeOk = idx === 0 || /\s/.test(out[idx - 1]!) || out[idx - 1] === "(";
      const afterIdx = idx + needle.length;
      const afterOk =
        afterIdx >= out.length ||
        /\s/.test(out[afterIdx]!) ||
        /[.,!?;:)\]}]/.test(out[afterIdx]!);
      if (beforeOk && afterOk) {
        built += out.slice(i, idx) + `<@${m.userId}>`;
        i = afterIdx;
      } else {
        built += out.slice(i, idx + 1);
        i = idx + 1;
      }
    }
    out = built;
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a stored body into plain text and mention parts for rendering. */
export function parseMessageParts(
  body: string,
  nameById: Map<string, string>,
  members: MentionMember[] = [],
): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(body)) !== null) {
    if (match.index > last) {
      parts.push(...splitPlainWithLegacyMentions(body.slice(last, match.index), members, nameById));
    }
    const userId = match[1]!;
    parts.push({
      type: "mention",
      userId,
      displayName: nameById.get(userId) ?? "ユーザー",
    });
    last = match.index + match[0].length;
  }
  if (last < body.length) {
    parts.push(...splitPlainWithLegacyMentions(body.slice(last), members, nameById));
  }
  return parts.length > 0 ? parts : [{ type: "text", text: body }];
}

/** Expands `<@userId>` tokens back to `@Display Name` for the edit textarea. */
export function deserializeMentions(
  text: string,
  nameById: Map<string, string>,
): string {
  return text.replace(/<@([0-9a-fA-F-]{36})>/g, (_full, id: string) => {
    return `@${nameById.get(id) ?? "ユーザー"}`;
  });
}

/** Highlights plain `@Name` for messages that were never serialized. */
function splitPlainWithLegacyMentions(
  text: string,
  members: MentionMember[],
  nameById: Map<string, string>,
): MessagePart[] {
  if (!text) return [];
  if (members.length === 0) return [{ type: "text", text }];

  const byLength = [...members].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  const pattern = byLength
    .map((m) => escapeRegExp(m.displayName))
    .filter(Boolean)
    .join("|");
  if (!pattern) return [{ type: "text", text }];

  const re = new RegExp(`@(?:${pattern})(?=$|\\s|[.,!?;:)\\]}])`, "g");
  const parts: MessagePart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: "text", text: text.slice(last, m.index) });
    const displayName = m[0]!.slice(1);
    const member = byLength.find((x) => x.displayName === displayName);
    parts.push({
      type: "mention",
      userId: member?.userId ?? "",
      displayName: member
        ? nameById.get(member.userId) ?? member.displayName
        : displayName,
    });
    last = m.index + m[0]!.length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts.length > 0 ? parts : [{ type: "text", text }];
}
