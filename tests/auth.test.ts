import test from "node:test";
import assert from "node:assert/strict";

import {
  LAB_ROLES, LAB_ROLE_LABELS, roleAtLeast, canManageMembers, canWrite,
  platformAdminEmails, isPlatformAdminEmail,
} from "../src/lib/auth/roles";
import type { LabRole } from "../src/lib/supabase/types";

/**
 * Authorization is the one place where a quiet mistake becomes a security
 * hole rather than a wrong number, so the rules are pinned down here.
 */

/* ------------------------------------------------------------------ */
/* Role ranking                                                        */
/* ------------------------------------------------------------------ */

test("role ranking is a total order from viewer up to owner", () => {
  const ascending: LabRole[] = ["viewer", "member", "admin", "owner"];
  for (let i = 0; i < ascending.length; i++) {
    for (let j = 0; j < ascending.length; j++) {
      assert.equal(
        roleAtLeast(ascending[i], ascending[j]),
        i >= j,
        `${ascending[i]} >= ${ascending[j]}`,
      );
    }
  }
});

test("a missing role never satisfies a requirement", () => {
  for (const min of LAB_ROLES) {
    assert.equal(roleAtLeast(null, min), false, `null should not satisfy ${min}`);
    assert.equal(roleAtLeast(undefined, min), false, `undefined should not satisfy ${min}`);
  }
});

test("only admins and owners manage members", () => {
  assert.equal(canManageMembers("owner"), true);
  assert.equal(canManageMembers("admin"), true);
  assert.equal(canManageMembers("member"), false);
  assert.equal(canManageMembers("viewer"), false);
  assert.equal(canManageMembers(null), false);
});

test("viewers cannot write, everyone above them can", () => {
  assert.equal(canWrite("owner"), true);
  assert.equal(canWrite("admin"), true);
  assert.equal(canWrite("member"), true);
  assert.equal(canWrite("viewer"), false);
  assert.equal(canWrite(undefined), false);
});

test("every role has a label and a description", () => {
  const seen = new Set<string>();
  for (const r of LAB_ROLES) {
    const label = LAB_ROLE_LABELS[r];
    assert.ok(label, `${r} has no label`);
    assert.ok(label.ja.length > 0, `${r} has no label text`);
    assert.ok(label.hint.length > 10, `${r} has no useful description`);
    // Two roles sharing a label would make the member table ambiguous.
    assert.ok(!seen.has(label.ja), `duplicate label for ${r}: ${label.ja}`);
    seen.add(label.ja);
  }
});

/* ------------------------------------------------------------------ */
/* Platform admin allowlist                                            */
/* ------------------------------------------------------------------ */

function withEnv(value: string | undefined, fn: () => void) {
  const previous = process.env.PLATFORM_ADMIN_EMAILS;
  if (value === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = previous;
  }
}

test("an unset allowlist grants nobody platform access", () => {
  withEnv(undefined, () => {
    assert.deepEqual(platformAdminEmails(), []);
    assert.equal(isPlatformAdminEmail("anyone@example.com"), false);
  });
  withEnv("", () => {
    assert.equal(isPlatformAdminEmail("anyone@example.com"), false);
  });
});

test("the allowlist accepts commas, spaces and semicolons", () => {
  withEnv("a@x.com, b@y.com;c@z.com   d@w.com", () => {
    assert.deepEqual(platformAdminEmails(), [
      "a@x.com", "b@y.com", "c@z.com", "d@w.com",
    ]);
  });
});

test("allowlist matching ignores case and surrounding whitespace", () => {
  withEnv("  Admin@Example.COM  ", () => {
    assert.equal(isPlatformAdminEmail("admin@example.com"), true);
    assert.equal(isPlatformAdminEmail("ADMIN@EXAMPLE.COM"), true);
    assert.equal(isPlatformAdminEmail(" admin@example.com "), true);
  });
});

test("a non-listed address is never a platform admin", () => {
  withEnv("admin@example.com", () => {
    assert.equal(isPlatformAdminEmail("attacker@example.com"), false);
    assert.equal(isPlatformAdminEmail(""), false);
    assert.equal(isPlatformAdminEmail(null), false);
    assert.equal(isPlatformAdminEmail(undefined), false);
  });
});

test("a partial or substring match does not grant access", () => {
  withEnv("admin@example.com", () => {
    // Prefix, suffix and containment must all fail; only equality counts.
    assert.equal(isPlatformAdminEmail("admin@example.com.evil.com"), false);
    assert.equal(isPlatformAdminEmail("notadmin@example.com"), false);
    assert.equal(isPlatformAdminEmail("admin@example.co"), false);
  });
});

test("entries without an @ are ignored rather than matched loosely", () => {
  withEnv("garbage, admin@example.com, *", () => {
    assert.deepEqual(platformAdminEmails(), ["admin@example.com"]);
    assert.equal(isPlatformAdminEmail("garbage"), false);
    assert.equal(isPlatformAdminEmail("*"), false);
  });
});

/* ------------------------------------------------------------------ */
/* Redirect-target safety                                              */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the `next` sanitiser used by the login page and the auth callback.
 * Kept in the test as an executable statement of the rule they both follow.
 */
function safeNext(value: string | null, fallback = "/experiments"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

test("only same-site paths survive as a post-login redirect", () => {
  assert.equal(safeNext("/admin/members"), "/admin/members");
  assert.equal(safeNext("/admin?lab=1"), "/admin?lab=1");

  // Anything that could leave the site falls back.
  assert.equal(safeNext("https://evil.example.com"), "/experiments");
  assert.equal(safeNext("//evil.example.com"), "/experiments");
  assert.equal(safeNext("http://evil.example.com"), "/experiments");
  assert.equal(safeNext("javascript:alert(1)"), "/experiments");
  assert.equal(safeNext(""), "/experiments");
  assert.equal(safeNext(null), "/experiments");
});

/* ------------------------------------------------------------------ */
/* Membership derivation                                               */
/* ------------------------------------------------------------------ */

/**
 * Mirrors how getSessionContext turns lab_members rows into this user's own
 * memberships.
 *
 * This exists because of a real escalation bug: the query originally had no
 * user_id filter, and the RLS policy on lab_members intentionally lets any
 * member read their laboratory's whole roster. Every row in the lab - the
 * owner's included - was folded into the signed-in user's memberships, so a
 * plain member inherited the owner's role and reached the admin area.
 */
interface MemberRowFixture {
  user_id: string;
  lab_id: string;
  role: LabRole;
}

function ownMemberships(rows: MemberRowFixture[], userId: string) {
  return rows.filter((r) => r.user_id === userId);
}

test("a member does not inherit roles from other rows in the same lab", () => {
  const roster: MemberRowFixture[] = [
    { user_id: "owner-id", lab_id: "lab-1", role: "owner" },
    { user_id: "admin-id", lab_id: "lab-1", role: "admin" },
    { user_id: "member-id", lab_id: "lab-1", role: "member" },
    { user_id: "viewer-id", lab_id: "lab-1", role: "viewer" },
  ];

  const mine = ownMemberships(roster, "member-id");
  assert.equal(mine.length, 1, "only this user's own row counts");
  assert.equal(mine[0].role, "member");

  const adminLabs = mine.filter((m) => canManageMembers(m.role));
  assert.equal(adminLabs.length, 0, "a member must not gain an administrable lab");

  // The unfiltered query is what the bug looked like; assert it would fail.
  const unfiltered = roster.filter((m) => canManageMembers(m.role));
  assert.ok(
    unfiltered.length > 0,
    "sanity: an unfiltered roster does contain admin rows, which is why the filter matters",
  );
});

test("a viewer stays a viewer even in a lab full of owners", () => {
  const roster: MemberRowFixture[] = [
    { user_id: "a", lab_id: "lab-1", role: "owner" },
    { user_id: "b", lab_id: "lab-1", role: "owner" },
    { user_id: "me", lab_id: "lab-1", role: "viewer" },
  ];
  const mine = ownMemberships(roster, "me");
  assert.equal(mine[0].role, "viewer");
  assert.equal(canWrite(mine[0].role), false);
  assert.equal(canManageMembers(mine[0].role), false);
});

test("an admin in one lab gains nothing in another", () => {
  const roster: MemberRowFixture[] = [
    { user_id: "me", lab_id: "lab-1", role: "admin" },
    { user_id: "me", lab_id: "lab-2", role: "viewer" },
    { user_id: "other", lab_id: "lab-2", role: "owner" },
  ];
  const mine = ownMemberships(roster, "me");
  assert.equal(mine.length, 2);

  const manageable = mine.filter((m) => canManageMembers(m.role)).map((m) => m.lab_id);
  assert.deepEqual(manageable, ["lab-1"], "lab-2 must not become manageable");
});
