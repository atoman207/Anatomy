# chondro — 研究データ管理 / Research data workbench

Raw file organization, statistics, publication figures, and experiment notebook
automation for a wet lab. Built with Next.js (App Router) and Supabase.

Statistics and plotting run **entirely in the browser**. Nothing is uploaded
unless you explicitly save it, with one exception: `.xlsx` workbooks are parsed
on the server (the Excel reader is a Node library) and discarded immediately
after the response.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # then fill in the Supabase values
npm run dev                    # http://localhost:3000
```

Open **統計・図 / Analyze → デモデータ / Load demo data** to exercise every
feature immediately — no file and no login required.

---

## What it does

### データ整理 / Data organization (`/organize`)

| Feature | Detail |
|---|---|
| **Rawファイル一覧作成** | Drop files, pick a folder, or paste a list of names. Produces an inventory with platform detection, duplicate and zero-byte checks, size-outlier warnings, and group/replicate inferred from the filename. Exports CSV. |
| **サンプルシート作成** | Derived from the inventory and fully editable. Validates duplicate IDs, one-file-per-sample, groups with n<2 (error) or n=2 (warning), batch confounding, and grouped-rather-than-interleaved run order. Exports CSV. |
| **ファイル名変更** | Rule-based batch rename with presets, find/replace, numbering and sample-sheet templates. Preview-then-apply: extensions are always preserved, collisions and Windows reserved names are blocked, and the mapping exports as CSV or a reviewable PowerShell script. Nothing is written to disk by the app. |

### 統計解析 / Statistics (`/analyze` → 統計解析)

- **t検定** — Welch (default), Student, paired, and Mann-Whitney U. Reports t, df,
  p, 95% CI of the difference, and Cohen's d.
- **ANOVA** — one-way with the full SS/df/MS table, η² and ω², Tukey HSD
  post-hoc with simultaneous confidence intervals, plus Kruskal-Wallis.
- **PCA** — scores, loadings, eigenvalues and explained variance, with optional
  centring and scaling.
- **クラスタリング** — k-means (k-means++ seeding, 10 restarts, seeded and
  reproducible) with silhouette scoring, and hierarchical clustering with
  single / complete / average / Ward linkage over four distance metrics.
- **差次発現** — per-feature testing across the whole matrix with
  Benjamini-Hochberg, Benjamini-Yekutieli, Holm or Bonferroni correction.

Preprocessing before any analysis: completeness filter → transform (log2/log10/
ln/sqrt/z-score) → normalize (median, total sum, quantile, median shift) →
impute (row mean/median, kNN, half-min, min, zero).

### 図作成 / Figures (`/analyze` → 図作成)

- **Volcano plot** — log2 fold change against FDR-controlled significance,
  diverging colour by direction, threshold guides, and selective direct labels.
- **Heatmap** — row or column z-scores with row and column dendrograms, a group
  annotation strip, and a colour bar.
- **PCA plot** — explained variance in the axis labels, 95% confidence
  ellipses, and group identity carried by colour plus marker shape.

Every figure exports as SVG or PNG (×2, ×4). The rendered string and the
exported file are the same, so what you review is what you publish.

### 実験ノート自動化 / Notebook automation (`/notebook`)

Four built-in templates (general, TMT labeling, cell treatment, LC-MS run) with
typed fields and `{{placeholder}}` / `{{#each}}` rendering. Measurement info
flows in from the sample sheet, and any result from the organize or analyze
pages can be queued with **ノートへ / To notebook** and assembled into one
Markdown entry.

---

## Colour and accessibility

Chart colours are not chosen by eye. The categorical palette was run through a
CVD/contrast validator: the first three slots separate by colour alone, slots
four and five are only used alongside a distinct marker shape (the CVD margin
there needs the second channel), and a sixth group folds into "Other" rather
than reusing a hue. Heatmaps and volcano plots use a diverging ramp with a
neutral grey midpoint; every figure carries a legend and direct labels so
identity is never colour-alone.


---

## AI features

Three features use OpenAI. Each is built so the model does the part it is good
at and nothing more.

### 音声メモ (`/voice`)

Record while you work, then get a structured notebook entry.

```
録音 (MediaRecorder)
  → /api/voice/transcribe   gpt-4o-transcribe    音声 → 書き起こし
  → 研究者が書き起こしを確認・修正
  → /api/voice/structure    gpt-5.6-luna         書き起こし → JSON (Structured Outputs)
  → ノートの Markdown
```

Four layers are kept separate — audio, raw transcript, AI structure, and the
researcher's confirmed version. If the model mishears "10 μL" as "100 μL", the
original recording and the original transcript are both still there. The page
shows the raw transcript beside the edited one whenever they differ.

Every field in the schema is nullable, and the prompt forbids filling gaps.
A concentration that was never spoken comes back as `null` and renders as
**未記録**, not as a plausible number. Terms the transcriber rendered
ambiguously are listed under 要確認 for you to check.

Katakana is normalized in the structuring pass rather than during
transcription: `トリプシン` → `Trypsin`, `ロットA123` → lot `A123`. The
transcriber stays faithful to what was said; normalization happens where a
schema can validate it.

`gpt-live-transcribe` is a **realtime/WebRTC** model and returns 404 on the
file-upload endpoint. A recorded memo is uploaded whole, so `gpt-4o-transcribe`
is what runs here. It was the most accurate of the file-based models on
Japanese lab speech — the only one to get both `TMT標識` and `IL-1β` right.

### 論文検索 (`/literature`)

```
日本語の質問
  → gpt-5.6-luna             → PubMed 検索式 (MeSH + Title/Abstract)
  → NCBI E-utilities         → 実在する論文（書誌 + 抄録）
  → gpt-5.6-terra (任意)      → 取得した抄録のみに基づく要約
  → Crossref (任意)           → DOI の照合
```

**The model never produces citations.** Asked for "ten relevant papers" a
language model will emit ten plausible references, and some will not exist.
Here it writes a query; PubMed returns the records. Nothing reaches the screen
that did not come out of the index.

Three further guards:

- The generated query is shown and is **editable** — you can see exactly what
  was searched and change it, with 条件を広げる / 条件を絞る as one-click
  alternatives.
- The summary is grounded only in retrieved abstracts, and any PMID it cites
  that was not in the result set is **stripped before display**, with a warning.
  Structured Outputs guarantees the shape of a response, not the truth of the
  strings in it.
- **DOIを照合** checks each DOI against Crossref and compares titles, so a
  mistyped identifier is caught before it reaches a manuscript.

Voice and literature degrade rather than fail: without `OPENAI_API_KEY`, the
voice page still accepts a pasted transcript and literature search passes your
text straight to PubMed as a literal query. AI Peer Review has no such
fallback — three model calls are the feature — so it returns 503 while
unconfigured and requires a Pro-plan-or-above laboratory once billing is set up
(see Billing below).

### AI査読 (`/peer-review`)

Three independent reviewers, not one blended opinion — the same reason a real
journal sends a manuscript to a panel instead of one reader:

```
論文PDF
  → unpdf                         PDF → 本文テキスト（サーバー側で抽出、原本は保持しない）
  → gpt-5.6-terra × 3（順に実行）  Reviewer 1: 方法・統計
                                   Reviewer 2: 研究内容・新規性
                                   Reviewer 3: 論文構成・論理
  → 集計（アプリ側で計算）          9項目のカテゴリスコア + 総合評価
```

Each reviewer runs its own model call with its own system prompt and never
sees the other two reviewers' output, so a harsh statistics review cannot talk
a lenient novelty review into agreeing with it. The **総合評価** is the plain
arithmetic mean of the three reviewers' scores, computed in application code
rather than by a fourth model call summarizing the other three: a number a
researcher can recompute by hand from the three scores next to it is more
trustworthy than one only the model can explain.

Every prompt opens with the same grounding rule as the voice structuring
prompt: judge only what the text actually says, and when there is not enough
information to judge a criterion, say so in `minor_concerns` rather than
guessing or defaulting to a middling score. A review tool that invents a
"major concern" about content the paper never contained is worse than no
review at all — the researcher has no easy way to notice the fabrication
without re-reading the whole paper.

Like the `.xlsx` exception this README opens with, the uploaded PDF is parsed
on the server and never written to disk or stored — only the extracted text is
kept (in `peer_reviews.extracted_text`), so a review is always traceable to
exactly what was reviewed without a multi-megabyte file sitting in the
database.

**再査読**: revising a manuscript and reviewing the new draft chains the two
records together (`previous_review_id`), so a laboratory can see whether a
score actually improved after addressing the concerns, not just look at two
unconnected reports.

Gated the same way as voice and literature: `requireAiAccess` checks the
laboratory's plan before the PDF is even read, since three sequential model
calls cost meaningfully more than the single-call AI features.

### Models

Configured in `.env.local`, verified against the live API on startup and shown
on the dashboard:

| Variable | Value | Used for |
|---|---|---|
| `OPENAI_MODEL_TEXT` | `gpt-5.6-terra` | AI Peer Review's three reviewers, literature summarization |
| `OPENAI_MODEL_CHEAP` | `gpt-5.6-luna` | PubMed query building, voice memo structuring |
| `OPENAI_MODEL_TRANSCRIBE` | `gpt-4o-transcribe` | File-upload transcription |
| `OPENAI_MODEL_REALTIME` | `gpt-live-transcribe` | Streaming (not yet wired up) |
| `OPENAI_MODEL_IMAGE` | `gpt-image-2` | Reserved for figure illustrations |

The two text tiers are chosen per task, not per feature: whichever one is
cheaper that still holds up on that specific job. `TEXT` is reserved for work
where a wrong answer looks just as confident as a right one and nothing
downstream catches it - judging a manuscript, synthesizing across abstracts.
`CHEAP` runs the well-specified, mechanical tasks a researcher already
reviews before anything is saved - a PubMed query shown as an editable field,
a structured voice note checked against its own transcript. Downgrading
those two cut the model-tier cost of every voice memo and literature search
without touching the one place accuracy is worth paying for.

### What is sent where

Audio goes to OpenAI and is discarded after transcription; only text is kept.
Transcripts and questions go to OpenAI. Search terms go to NCBI and Crossref,
both of which receive your `NCBI_EMAIL` / `CROSSREF_MAILTO` as courtesy
identification. Nothing else leaves the browser.

---

## Login and administration

### Access model

Two independent levels of authority:

| Level | Source of truth | Grants |
|---|---|---|
| **Platform role** | `profiles.platform_role` in the database | The deployment itself: every user, laboratory, experiment and template |
| **Laboratory role** | `lab_members.role` in the database | Access to one laboratory's data, enforced by row-level security |

There are exactly two platform roles, and they are the two the product talks
about:

| Platform role | Japanese | What it can do |
|---|---|---|
| `admin` | 管理者 | The whole administration area: full CRUD over accounts, laboratories, experiments and templates, plus the audit trail |
| `user` | ユーザー | Research tools only. No administration area, and no laboratory creation |

Being an owner or 管理者 *of a laboratory* does not open the administration
area. Those are research roles; running the deployment is a platform role. That
separation is what makes `/admin` a genuinely different surface rather than a
superset of the user one.

**A user cannot grant themselves the role.** `profiles.platform_role` is
writable only by the service role - a trigger in migration `0002` rejects the
write otherwise - so the ordinary "edit your own profile" policy is not a
privilege-escalation path. The role changes only through 管理 → ユーザー, which
re-checks the caller first.

`PLATFORM_ADMIN_EMAILS` is still read, but only as a lockout-recovery path: a
listed address is an administrator even if its row says otherwise. It can add an
administrator, never remove one, so a bad seed cannot lock everyone out.

Laboratory roles, from least to most: **閲覧者** (read-only) → **メンバー**
(create and edit) → **管理者** (manage members) → **オーナー** (also delete or
transfer the laboratory).

### Pages

| Route | Who can reach it |
|---|---|
| `/login` | Anyone — sign in, sign up, request a password reset |
| `/auth/callback` | Lands every emailed link (confirmation, recovery, invitation) |
| `/auth/reset` | Set a new password after a recovery link |
| `/` | Any visitor — research tools; 管理者 additionally see the management tiles |
| `/account` | Any signed-in user — display name, password, memberships, own role |
| `/admin` | **管理者 only** — deployment-wide statistics and recent activity |
| `/admin/users` | **管理者 only** — every account: create, confirm, re-role, reset, delete |
| `/admin/labs` | **管理者 only** — create, rename and delete laboratories |
| `/admin/members` | **管理者 only** — add, re-role and remove members; transfer ownership |
| `/admin/experiments` | **管理者 only** — every experiment in every laboratory |
| `/admin/templates` | **管理者 only** — create, view, edit and delete any template |
| `/admin/audit` | **管理者 only** — append-only record of every administrative action |

Enforcement happens in three independent places: the proxy redirects signed-out
visitors, the server layout refuses to render, and every server action
re-derives the caller's role from the database before touching anything. A
laboratory id posted from the browser is treated as a request, never as proof of
authority.

### First administrator

This project requires email confirmation, and a new Supabase project's built-in
mailer is rate-limited to a few messages an hour — which makes bootstrapping the
very first account through the sign-up form unreliable. Create it directly:

```bash
npm run admin:create -- --email you@example.com --password 'your-password' \
                        --name 'Your Name' --lab 'Cartilage Biology Lab'
```

The account is created already confirmed, but `admin:create` does not grant the
platform role. Prefer `npm run db:seed`, which does both.

Put the credentials in `.env.local` (git-ignored, which is why the password is
not written into a committed migration):

```ini
SEED_ADMIN_EMAIL=you@example.com
SEED_ADMIN_PASSWORD=your-password
SEED_ADMIN_NAME=Administrator
SEED_LAB_NAME=          # optional: also create this lab, owned by the admin
```

Then apply the schema and seed, **in that order** - the seed writes
`platform_role`, so the migration has to land first:

```bash
npm run db:push   # needs SUPABASE_DB_URL, or paste the SQL into the SQL Editor
npm run db:seed
```

Both are safe to re-run: an existing account has its password reset and its role
re-applied rather than being duplicated.

Once signed in, further accounts can be created from 管理 → ユーザー without
touching email at all, and promoted or demoted from the same page.

### Testing it

```bash
npm run test:e2e:auth   # needs a server on :3210 and the seeded test accounts
```

The suite asserts both directions: that an admin can create a laboratory, add a
member and read the audit trail, **and** that a plain member is refused the
admin area and the platform pages. The second half is the point — it caught a
real escalation bug where an unfiltered `lab_members` query let any member
inherit the highest role present in their laboratory.

---

## Billing (Stripe)

Plans are **per laboratory**, not per user. Everything in the schema is
lab-scoped and access is granted through `lab_members`, so the laboratory is
the only unit where "is this allowed?" has one answer. The owner subscribes,
and every member of that lab gets the plan.

Billing is optional: with no Stripe keys configured every laboratory sits on
the free plan and the app behaves exactly as it did before.

### Plans

> **Beta pricing.** Every price is deliberately under ¥100 so the whole
> subscribe → renew → cancel path can be exercised with real cards for
> almost nothing. ¥50 is Stripe's minimum charge for JPY, so the cheapest paid
> plan sits exactly on that floor. These are not the intended production
> prices.

| | フリー | プロ | チーム |
|---|---|---|---|
| Price (monthly) | 無料 | **¥50** | **¥90** |
| Members | 3 | 10 | unlimited |
| Experiments | 20 | 200 | unlimited |
| Datasets | 20 | 200 | unlimited |
| AI features | — | ✓ | ✓ |

JPY is a zero-decimal currency, so `unit_amount: 50` is ¥50 — not 50 sen.

### What the paid plans gate

Both gates are enforced on the server; neither is a disabled button.

- **AI features** — voice transcription and structuring, literature
  summarisation, and AI query building. These spend money per call on the
  deployment's OpenAI key, so the route handlers check the lab's plan before
  forwarding anything (`requireAiAccess`). Literature *search* degrades
  instead of failing: PubMed itself costs nothing, so a free lab still gets
  results with the question passed through as a literal query.
- **Row quotas** — members, experiments and datasets are capped by
  `BEFORE INSERT` triggers in the database, not by application code.
  Experiments are inserted straight from the browser through RLS, and members
  are added by a service-role action that bypasses RLS entirely; a check in
  either one would leave the other open. The trigger is the only place both
  paths must pass through.

Lowering a plan never deletes anything. Existing rows stay; only new inserts
are refused.

### Setting it up

```bash
# 1. Test-mode secret key from the Stripe dashboard
echo 'STRIPE_SECRET_KEY=sk_test_...' >> .env.local

# 2. Create the products and the ¥50 / ¥90 monthly prices. With Supabase
#    configured here, the script also writes them into plan_prices - nothing
#    to paste anywhere.
npm run stripe:setup

# 3. Forward webhooks while developing, and copy the printed signing secret
#    into STRIPE_WEBHOOK_SECRET
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

`npm run stripe:setup` reads its starting amounts from
`src/lib/billing/plans.ts`. A test asserts the two agree, and that no plan
exceeds the beta ceiling.

### Changing a price

Prices are defined in `src/lib/billing/plans.ts`. Changing one is a code
change and a deploy, not an admin-panel action: edit the amount there, ship
it, and the next checkout for that plan finds-or-creates a matching Stripe
Price automatically and caches its id in `plan_prices` (no manual step, no
`/admin/billing/prices` page — that page was removed since checkout keeps
itself in sync with the catalogue on its own).

A few things worth knowing before you do:

- **Existing subscribers keep their price.** Stripe prices are immutable, so a
  change creates a *new* Price and points new sign-ups at it. Anyone already
  subscribed keeps paying what they agreed to until they are migrated in the
  Stripe dashboard. That is deliberate — silently re-pricing existing
  customers is how chargebacks start.
- **The pricing page follows automatically.** `/billing` shows the amount
  Stripe actually holds for the plan's primary interval, so the cards and the
  Checkout session can no longer disagree.
- **`STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM` etc. still work**, as a fallback
  checked before the catalogue lookup, for a deployment configured before
  `plan_prices` existed. `/admin/billing` labels which source each plan is
  using.

In production, add the endpoint at
`https://<your-host>/api/stripe/webhook` under Developers → Webhooks, and
subscribe it to `checkout.session.completed`,
`customer.subscription.created|updated|deleted` and `invoice.payment_failed`.

### Going live

Switching `STRIPE_SECRET_KEY` from `sk_test_...` to `sk_live_...` is the only
switch: every code path reads `isStripeConfigured()` and behaves identically
either way, so nothing else needs to change in the app itself. A few things
around it do:

- **No publishable key is used anywhere.** This app never loads Stripe.js in
  the browser - Checkout and the billing portal are both server-initiated
  redirects to a Stripe-hosted page - so there is nothing to do with a
  `pk_live_...` key even if you have one.
- **The mock checkout is off in production.** Without keys, development falls
  back to an in-app page that grants a plan with no payment behind it. A
  production build refuses instead (`isMockCheckoutAllowed`), because missing
  environment variables on a live host would otherwise hand every visitor a
  free paid subscription while looking like it was working.
- **`NEXT_PUBLIC_SITE_URL` has to be your real `https://` domain.** Checkout's
  `success_url`/`cancel_url` and the billing portal's `return_url` are built
  from it; left at `http://localhost:3000` in production, a customer would be
  sent to your laptop after paying. A production build will not do that: it
  prefers the configured value, falls back to the host headers the platform
  sets, and otherwise refuses to create the session with an error naming the
  variable rather than charging a card it cannot return from.
- **Set the real prices.** The catalogue still holds the beta amounts, ¥50 and
  ¥90 per month, and they are real charges now. Set what you actually intend
  to charge at `/admin/billing` before announcing the site. Doing it later
  does not re-price existing subscribers - Stripe prices are immutable, so a
  change means a new price and a migration for anyone already subscribed.
- **Run `npm run stripe:setup` again with the live key.** Test-mode and
  live-mode prices are different objects even for the same amount, and
  `plan_prices` holds whichever mode it was last written in. Re-running with
  the live key replaces the stored ids with live ones; a test-mode id left
  behind fails at checkout.
- **The billing portal configuration is per-mode.** A configuration saved
  under Developers → Test mode does not carry over; save one under Live mode
  too (Settings → Billing → Customer portal), or `openBillingPortal` will
  fail with the same "no configuration" error the app already explains.
- **Reset any labs still on a mock subscription.** Before Stripe was
  connected, `startCheckout` sent the browser to an in-app mock payment page
  instead (`/billing/checkout`); "paying" there wrote a plan directly with no
  real Stripe object behind it. Nothing about adding live keys retires those
  rows on its own, so run this once to find and clear them:

  ```bash
  npm run stripe:reset-mock              # lists affected labs; changes nothing
  npm run stripe:reset-mock -- --apply   # resets them to the free plan
  ```

### How state stays correct

Stripe is the source of truth for money; `lab_subscriptions` mirrors it, so an
entitlement check is one local read rather than an API call per request — and
a Stripe outage degrades to "the plan we last knew about" rather than to a
broken app.

The webhook defends itself on three fronts:

1. **Signature** — the raw body is verified against `STRIPE_WEBHOOK_SECRET`
   before it is parsed. The endpoint is public; without this anyone could post
   themselves a subscription.
2. **Idempotency** — each event id is inserted into `billing_events` first. A
   retried delivery loses on the primary key and stops there.
3. **Ordering** — deliveries are not ordered, so every write records the
   event's own timestamp and an event older than the stored one is discarded.
   Otherwise a retried `updated` from ten minutes ago would resurrect a
   subscription that has since been cancelled.

`past_due` still grants the plan. Stripe retries a failed payment for days, and
locking a lab out of its own experiment records the morning a card expires is
the worse failure. `public.lab_plan()` and `statusGrantsAccess()` implement the
same window, and a test fails if they drift.

### Who can pay

Only the laboratory's **owner** (or a platform administrator). Lab admins
manage members and data, but spending the lab's money is the owner's decision.
Every billing server action re-derives that from the database rather than
trusting the lab id it was handed.

`lab_subscriptions` has row-level security with a select policy and **no write
policy** — the webhook writes it with the service-role key. A user cannot
grant their own laboratory a paid plan by writing that row.

### Pages

| Path | What |
|---|---|
| `/billing` | Plans, current subscription, usage against each quota, upgrade and portal buttons |
| `/api/stripe/webhook` | Stripe → app. The only unauthenticated writer of subscription state |
| `/admin/labs` | Platform administrators see every lab's plan and status |

Cancelling, changing the card and downloading receipts happen in the Stripe
billing portal rather than being rebuilt here.

---

## Database

The app is fully usable without Supabase. The database is only needed to save
experiments, notebook entries, datasets, analyses and figures.

### Applying the schema

`supabase/migrations/all.sql` is the single schema file: core tables, enums,
triggers, RLS, billing quotas, peer review, and reviewer profiles. Everything
is scoped to a laboratory; RLS is enforced on every table, so a leaked
publishable key cannot read another lab's data.

Append new schema changes to the end of `all.sql` — do not add numbered
migration files. Either paste the file into the Supabase SQL editor, or:

```bash
# Project Settings -> Database -> Connection string -> URI
echo 'SUPABASE_DB_URL=postgresql://...' >> .env.local
npm run db:push
```

The dashboard shows connection status and tells you if the schema is missing.

### Schema

```
profiles · laboratories · lab_members          identity, platform role, membership
projects · experiments                         the work
notebook_templates · notebook_entries          the record
raw_files · sample_sheets · rename_operations  data organization + provenance
datasets · analyses · figures                  results
audit_logs                                     append-only trail
plan_limits · lab_subscriptions · billing_events   plans, Stripe mirror, webhook log
peer_reviews                                    AI peer review reports, chained by re-review
```

`rename_operations` stores the full before/after mapping so a batch rename can
be audited or reversed months later.

---

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | for saving | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | for saving | Publishable key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Health check and admin operations. **Never expose to the browser.** |
| `SUPABASE_DB_URL` | migrations only | Direct Postgres URI for `npm run db:push` |
| `PLATFORM_ADMIN_EMAILS` | optional | Lockout recovery only. Comma-separated addresses treated as 管理者 regardless of `profiles.platform_role`. **Server-only — never give it a `NEXT_PUBLIC_` prefix.** |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | for `db:seed` | The first administrator. Kept out of committed SQL on purpose |
| `SEED_ADMIN_NAME` / `SEED_LAB_NAME` | optional | Display name, and a laboratory to create alongside |
| `NEXT_PUBLIC_SITE_URL` | for email links | Public origin used in confirmation, recovery and invitation links |
| `OPENAI_API_KEY` | optional | AI features stay disabled while unset |
| `OPENAI_MODEL_*` | optional | Model IDs are configurable rather than hard-coded |
| `NCBI_API_KEY` / `NCBI_EMAIL` | optional | PubMed lookups |
| `STRIPE_SECRET_KEY` | optional | Billing stays disabled while unset; every lab is on the free plan. **Server-only.** |
| `STRIPE_WEBHOOK_SECRET` | with Stripe | Verifies webhook signatures. The endpoint rejects every request without it |
| `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAM` | optional | Fallback price IDs. Prices normally live in `plan_prices` and are set at `/admin/billing`; a stored price wins over these |

---

## Commands

```bash
npm run dev            # development server
npm run build          # production build
npm run check          # typecheck + lint + unit tests
npm test               # unit tests (236)
npm run test:e2e       # browser smoke test; needs a server on :3210
npm run test:e2e:auth  # login, administration and permission denials
npm run test:e2e:ai    # voice structuring and literature search (uses real API calls)
npm run admin:create   # create the first administrator account
npm run db:push        # apply migrations (needs SUPABASE_DB_URL)
npm run stripe:setup       # create the Stripe products and prices (needs STRIPE_SECRET_KEY)
npm run stripe:reset-mock  # clear any labs still on a mock (pre-Stripe) subscription
```

### Testing

`tests/stats.test.ts` validates the statistics against closed forms and
published reference values rather than against itself: the t distribution
against the Cauchy and df=2 closed forms, F against `F(1,d) = t(d)²`, ANOVA
against `F = t²` for two groups, Benjamini-Hochberg against the original 1995
worked example, Tukey's q against published tables and `q(2,df) = √2 · t`, and
Welch against a fully worked example.

`tests/auth.test.ts` pins the authorization rules: role ranking, the
platform-admin allowlist (including that substring and prefix matches are
refused), redirect-target sanitising, and that a user never inherits a role from
someone else's row in the same laboratory.

`tests/ai.test.ts` covers the parts of the AI features that must not drift:
per-article abstract attribution, removal of any PMID the model cited that was
not retrieved, and that every voice-note field is nullable so "not said" stays
representable.

`tests/e2e.mjs`, `tests/e2e-auth.mjs` and `tests/e2e-ai.mjs` drive the real UI
in Chromium and fail on any console error, page error or failed request. The AI
suite makes live API calls and asserts that no cited PMID falls outside the
retrieved result set.

---

## Where AI is deliberately not used

The statistics, figures and file-organization features never call a model, and
that is a design decision rather than an omission. A t-test should be computed,
not predicted: the value of a p-value is that it follows from the data by a
rule you can check, and a model that returns one gives you a number with no
provenance. Those modules are validated against closed forms and published
reference values instead (see Testing).

AI is used where the task is genuinely linguistic — turning speech into text,
normalizing spoken jargon into standard notation, and translating a question
into a search query. Even there, the output is constrained by a JSON schema and
cross-checked against a real index before it is shown.

Model IDs are read from the environment rather than hard-coded, so swapping one
is a `.env.local` edit with no code change, and every AI path is inert while
`OPENAI_API_KEY` is unset.
