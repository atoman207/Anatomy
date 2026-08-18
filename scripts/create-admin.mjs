/**
 * Creates the first administrator account.
 *
 * This project requires email confirmation, and a new Supabase project's
 * built-in mailer is rate-limited to a handful of messages per hour - which
 * makes bootstrapping the very first account through the sign-up form
 * unreliable. This creates the account already confirmed, using the service
 * role key, and optionally sets up a laboratory for it.
 *
 *   npm run admin:create -- --email you@example.com --password 'secret123' \
 *                           --name 'Your Name' --lab 'Cartilage Biology Lab'
 *
 * Platform-admin rights come from PLATFORM_ADMIN_EMAILS in .env.local, not
 * from this script; it prints a reminder when the address is not listed.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ quiet: true });

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "\nNEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.\n",
  );
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });

try {
  const email = (arg("email") ?? (await rl.question("Email: "))).trim().toLowerCase();
  if (!email.includes("@")) throw new Error("That is not a valid email address.");

  const password = arg("password") ?? (await rl.question("Password (min 8 chars): "));
  if (!password || password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const name = arg("name") ?? email.split("@")[0];
  const labName = arg("lab") ?? (await rl.question("Laboratory name (blank to skip): "));

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Reuse the account if it already exists, so the script is safe to re-run.
  let user = null;
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    user = data.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
    if (user || data.users.length < 200) break;
    page++;
  }

  if (user) {
    console.log(`\nAccount already exists for ${email} - updating password and confirming it.`);
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, display_name: name },
    });
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    });
    if (error) throw new Error(error.message);
    user = data.user;
    console.log(`\nCreated ${email} (confirmed).`);
  }

  if (!user) throw new Error("No user was created.");

  // The profiles row normally comes from the on_auth_user_created trigger;
  // upsert covers the case where the account predates the trigger.
  await supabase
    .from("profiles")
    .upsert({ id: user.id, email, display_name: name }, { onConflict: "id" });

  const trimmedLab = (labName ?? "").trim();
  if (trimmedLab) {
    const { data: existing } = await supabase
      .from("laboratories")
      .select("id, name")
      .eq("name", trimmedLab)
      .maybeSingle();

    if (existing) {
      console.log(`Laboratory "${trimmedLab}" already exists - ensuring membership.`);
      await supabase
        .from("lab_members")
        .upsert(
          { lab_id: existing.id, user_id: user.id, role: "owner" },
          { onConflict: "lab_id,user_id" },
        );
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
        await supabase.from("laboratories").delete().eq("id", lab.id);
        throw new Error(memberError.message);
      }
      console.log(`Created laboratory "${trimmedLab}" with you as owner.`);
    }
  }

  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  console.log("\nDone. Sign in at /login with that address.");
  if (!admins.includes(email)) {
    console.log(
      "\nNote: this address is NOT in PLATFORM_ADMIN_EMAILS, so it will not have\n" +
        "platform-wide access (all users, all laboratories). To grant it, add to .env.local:\n" +
        `  PLATFORM_ADMIN_EMAILS=${email}\n` +
        "then restart the server.",
    );
  } else {
    console.log("This address is listed in PLATFORM_ADMIN_EMAILS, so it has platform access.");
  }
} catch (err) {
  console.error(`\nFailed: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
