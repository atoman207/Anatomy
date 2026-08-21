/**
 * Seeds the deployment: the first Administrator, and a laboratory for them.
 *
 *   npm run db:seed
 *
 * The account is created already confirmed (a fresh Supabase project's mailer
 * is rate-limited to a handful of messages an hour, which makes bootstrapping
 * through the sign-up form unreliable), and its `profiles.platform_role` is
 * set to 'admin'.
 *
 * The password is read from the environment rather than hard-coded here, so a
 * real credential never enters git history. Set SEED_ADMIN_PASSWORD in
 * .env.local; SEED_ADMIN_EMAIL and SEED_ADMIN_NAME are optional overrides.
 *
 * Safe to re-run: an existing account is updated in place, never duplicated.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.\n",
  );
  process.exit(1);
}

const email = (process.env.SEED_ADMIN_EMAIL ?? "hira.sui.456@gmail.com").trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const name = process.env.SEED_ADMIN_NAME ?? "Administrator";
const labName = process.env.SEED_LAB_NAME ?? "";

if (!password || password.length < 8) {
  console.error(
    "\nSEED_ADMIN_PASSWORD is not set (or is shorter than 8 characters).\n\n" +
      "Add it to .env.local, for example:\n" +
      `  SEED_ADMIN_EMAIL=${email}\n` +
      "  SEED_ADMIN_PASSWORD=your-password-here\n\n" +
      "then run: npm run db:seed\n",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Finds an auth user by email, paging until found. */
async function findUserByEmail(target) {
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
    page++;
  }
  return null;
}

try {
  let user = await findUserByEmail(email);

  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, display_name: name },
    });
    if (error) throw new Error(error.message);
    console.log(`Account ${email} already existed — password reset and confirmed.`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error) throw new Error(error.message);
    user = data.user;
    console.log(`Created ${email} (confirmed).`);
  }

  if (!user) throw new Error("No user was created.");

  // The profiles row normally arrives from the on_auth_user_created trigger.
  // Upsert covers an account that predates it, and carries the role in the
  // same statement so a half-seeded state cannot linger.
  const { error: profileError } = await supabase
    .from("profiles")
    .upsert(
      { id: user.id, email, display_name: name, platform_role: "admin" },
      { onConflict: "id" },
    );
  if (profileError) {
    if (/platform_role/.test(profileError.message)) {
      throw new Error(
        `${profileError.message}\n\n` +
          "The platform_role column is missing. Apply the migrations first:\n" +
          "  npm run db:push",
      );
    }
    throw new Error(profileError.message);
  }
  console.log(`Granted platform_role='admin' to ${email}.`);

  const trimmedLab = labName.trim();
  if (trimmedLab) {
    const { data: existing } = await supabase
      .from("laboratories")
      .select("id")
      .eq("name", trimmedLab)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("lab_members")
        .upsert(
          { lab_id: existing.id, user_id: user.id, role: "owner" },
          { onConflict: "lab_id,user_id" },
        );
      console.log(`Laboratory "${trimmedLab}" already existed — membership ensured.`);
    } else {
      const { data: lab, error: labError } = await supabase
        .from("laboratories")
        .insert({ name: trimmedLab, owner_id: user.id })
        .select("id")
        .single();
      if (labError) throw new Error(labError.message);

      const { error: memberError } = await supabase
        .from("lab_members")
        .insert({ lab_id: lab.id, user_id: user.id, role: "owner" });
      if (memberError) {
        // Roll back, so a laboratory without an owner never exists.
        await supabase.from("laboratories").delete().eq("id", lab.id);
        throw new Error(memberError.message);
      }
      console.log(`Created laboratory "${trimmedLab}" with ${email} as owner.`);
    }
  }

  console.log(`\nDone. Sign in at /login as ${email}.`);
} catch (err) {
  console.error(`\nSeed failed: ${err.message}\n`);
  process.exitCode = 1;
}
