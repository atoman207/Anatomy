import "server-only";

/**
 * Does the sending domain actually authenticate its mail?
 *
 * SPF, DKIM and DMARC are the three records a receiving provider checks
 * before it weighs anything else, and all three live in DNS - outside this
 * repository, changed by hand in a registrar's control panel, and silently
 * lost when a domain is moved. That makes them exactly the kind of setting
 * that is "done" once and broken later without anyone noticing until mail
 * starts landing in spam.
 *
 * So the administrator page reads them live rather than trusting a checklist.
 * Everything here is a plain DNS lookup: no credentials, no third-party
 * service, and it can run against whatever domain the From address uses.
 *
 * What it cannot see: whether outgoing mail is really *signed* with the DKIM
 * key that is published, which only a received message's
 * `Authentication-Results` header proves. The page says so, and the test-send
 * button is how that gets verified.
 */

import { resolveMx, resolveTxt } from "node:dns/promises";

export type CheckState = "pass" | "warn" | "fail" | "unknown";

export interface AuthCheck {
  /** "SPF", "DKIM", "DMARC", "MX". */
  name: string;
  state: CheckState;
  /** The record found, trimmed for display. */
  value: string | null;
  /** One sentence: what this means, and what to do when it is not a pass. */
  detail: string;
}

export interface EmailAuthReport {
  domain: string;
  checks: AuthCheck[];
  /** Worst state across the checks - what the page badges. */
  overall: CheckState;
  checkedAt: string;
}

/**
 * DKIM selectors worth probing. A selector is chosen by whoever generated the
 * key, so there is no way to enumerate them from DNS - these are the ones the
 * providers this deployment can be configured with actually use, plus
 * `EMAIL_DKIM_SELECTOR` for anything else.
 */
const DKIM_SELECTORS = [
  "privateemail", // Namecheap Private Email
  "resend",
  "default",
  "google",
  "selector1",
  "s1",
  "k1",
  "mail",
];

async function txt(name: string): Promise<string[]> {
  try {
    // Each record arrives as an array of strings (long records are split at
    // 255 bytes), so the chunks are joined before anything is matched.
    return (await resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

async function checkSpf(domain: string): Promise<AuthCheck> {
  const records = (await txt(domain)).filter((r) => r.toLowerCase().startsWith("v=spf1"));
  if (records.length === 0) {
    return {
      name: "SPF",
      state: "fail",
      value: null,
      detail:
        "SPFレコードがありません。送信サーバーを許可する TXT レコード（v=spf1 …）を DNS に追加してください。",
    };
  }
  if (records.length > 1) {
    return {
      name: "SPF",
      state: "fail",
      value: records.join(" / "),
      detail:
        "SPFレコードが複数あります。RFC 7208 では1つだけ有効で、複数あると SPF 全体が permerror になります。1つに統合してください。",
    };
  }
  const record = records[0];
  const all = /[~\-?+]all/.exec(record)?.[0] ?? null;
  if (all === "+all") {
    return {
      name: "SPF",
      state: "fail",
      value: record,
      detail: "「+all」は誰でも差出人を偽装できる設定です。「~all」または「-all」に変更してください。",
    };
  }
  if (!all) {
    return {
      name: "SPF",
      state: "warn",
      value: record,
      detail: "末尾に「~all」または「-all」がありません。許可外の送信元の扱いが決まりません。",
    };
  }
  return {
    name: "SPF",
    state: "pass",
    value: record,
    detail: `送信元が宣言されています（${all}）。`,
  };
}

async function checkDkim(domain: string): Promise<AuthCheck> {
  const configured = (process.env.EMAIL_DKIM_SELECTOR ?? "").trim();
  const selectors = configured ? [configured, ...DKIM_SELECTORS] : DKIM_SELECTORS;

  for (const selector of selectors) {
    const records = await txt(`${selector}._domainkey.${domain}`);
    const key = records.find((r) => r.toLowerCase().includes("v=dkim1") || r.includes("p="));
    if (key) {
      return {
        name: "DKIM",
        state: "pass",
        value: `${selector}: ${key.slice(0, 80)}…`,
        detail:
          `セレクタ「${selector}」に公開鍵が published されています。` +
          "実際に署名されているかは、受信したメールの Authentication-Results で確認してください。",
      };
    }
  }
  return {
    name: "DKIM",
    state: "fail",
    value: null,
    detail:
      "DKIM公開鍵が見つかりません（一般的なセレクタを探索）。メール提供元の管理画面でDKIMを有効化し、" +
      "指示された TXT レコードを追加してください。別名のセレクタを使っている場合は EMAIL_DKIM_SELECTOR に設定してください。",
  };
}

async function checkDmarc(domain: string): Promise<AuthCheck> {
  const records = (await txt(`_dmarc.${domain}`)).filter((r) =>
    r.toLowerCase().startsWith("v=dmarc1"),
  );
  if (records.length === 0) {
    return {
      name: "DMARC",
      state: "fail",
      value: null,
      detail:
        "DMARCレコードがありません。_dmarc の TXT に「v=DMARC1; p=none; rua=mailto:…」を追加してください。" +
        "Gmail・Yahoo は一括送信者にDMARCを要求しています。",
    };
  }
  const record = records[0];
  const policy = /\bp\s*=\s*(none|quarantine|reject)/i.exec(record)?.[1]?.toLowerCase() ?? null;
  const hasRua = /\brua\s*=/i.test(record);

  if (policy === "none") {
    return {
      name: "DMARC",
      state: "warn",
      value: record,
      detail:
        "p=none は監視のみで、なりすましを拒否しません。レポートでSPF/DKIMの整合を2〜4週間確認したあと、" +
        "p=quarantine → p=reject に上げてください。" +
        (hasRua ? "" : " rua= のレポート送信先も未設定です。"),
    };
  }
  if (!policy) {
    return {
      name: "DMARC",
      state: "warn",
      value: record,
      detail: "p= が読み取れません。「v=DMARC1; p=none; rua=mailto:…」の形式を確認してください。",
    };
  }
  return {
    name: "DMARC",
    state: "pass",
    value: record,
    detail: `ポリシー p=${policy} が有効です。${hasRua ? "" : "rua= を設定するとレポートが受け取れます。"}`,
  };
}

async function checkMx(domain: string): Promise<AuthCheck> {
  try {
    const records = await resolveMx(domain);
    if (records.length === 0) throw new Error("no mx");
    return {
      name: "MX",
      state: "pass",
      value: records.map((r) => r.exchange).join(", "),
      detail: "返信を受け取れる状態です。",
    };
  } catch {
    return {
      name: "MX",
      state: "warn",
      value: null,
      detail:
        "MXレコードがありません。差出人ドメインで受信できないと、返信も配信不能通知も受け取れず、" +
        "受信側からも不自然に見えます。",
    };
  }
}

const RANK: Record<CheckState, number> = { pass: 0, unknown: 1, warn: 2, fail: 3 };

/** A few minutes is plenty: DNS changes are not made during one page visit. */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { key: string; at: number; report: EmailAuthReport } | null = null;

/**
 * Checks the domain of the From address, or an explicitly given one.
 *
 * Returns `unknown` checks rather than throwing when there is no domain to
 * check at all - an unconfigured deployment should read as "not set up", not
 * as a page that crashed.
 */
export async function checkEmailAuth(fromAddress: string | null): Promise<EmailAuthReport> {
  const domain = (fromAddress ?? "").split("@")[1]?.trim().toLowerCase() ?? "";
  const now = Date.now();
  if (cached && cached.key === domain && now - cached.at < CACHE_TTL_MS) return cached.report;

  if (!domain) {
    const report: EmailAuthReport = {
      domain: "",
      checks: [
        {
          name: "SPF",
          state: "unknown",
          value: null,
          detail: "差出人アドレスが未設定のため確認できません。",
        },
      ],
      overall: "unknown",
      checkedAt: new Date(now).toISOString(),
    };
    return report;
  }

  const checks = await Promise.all([
    checkSpf(domain),
    checkDkim(domain),
    checkDmarc(domain),
    checkMx(domain),
  ]);
  const overall = checks.reduce<CheckState>(
    (worst, c) => (RANK[c.state] > RANK[worst] ? c.state : worst),
    "pass",
  );

  const report: EmailAuthReport = {
    domain,
    checks,
    overall,
    checkedAt: new Date(now).toISOString(),
  };
  cached = { key: domain, at: now, report };
  return report;
}
