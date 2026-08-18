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

Two features use OpenAI. Both are built so the model does the part it is good
at and nothing more.

### 音声メモ (`/voice`)

Record while you work, then get a structured notebook entry.

```
録音 (MediaRecorder)
  → /api/voice/transcribe   gpt-4o-transcribe    音声 → 書き起こし
  → 研究者が書き起こしを確認・修正
  → /api/voice/structure    gpt-5.6-terra        書き起こし → JSON (Structured Outputs)
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
  → gpt-5.6-terra            → PubMed 検索式 (MeSH + Title/Abstract)
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

Both features degrade rather than fail: without `OPENAI_API_KEY`, the voice page
still accepts a pasted transcript and literature search passes your text
straight to PubMed as a literal query.

### Models

Configured in `.env.local`, verified against the live API on startup and shown
on the dashboard:

| Variable | Value | Used for |
|---|---|---|
| `OPENAI_MODEL_TEXT` | `gpt-5.6-terra` | Structuring, query building, summarizing |
| `OPENAI_MODEL_CHEAP` | `gpt-5.6-luna` | Reserved for bulk/low-stakes work |
| `OPENAI_MODEL_TRANSCRIBE` | `gpt-4o-transcribe` | File-upload transcription |
| `OPENAI_MODEL_REALTIME` | `gpt-live-transcribe` | Streaming (not yet wired up) |
| `OPENAI_MODEL_IMAGE` | `gpt-image-2` | Reserved for figure illustrations |

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
| **Laboratory role** | `lab_members.role` in the database | Access to one laboratory's data, enforced by row-level security |
| **Platform admin** | `PLATFORM_ADMIN_EMAILS` in the server environment | Every laboratory, plus user management |

Platform access is deliberately **not** a database column. A row an attacker
could flip would be a privilege-escalation path; an environment variable with no
`NEXT_PUBLIC_` prefix never reaches the browser and cannot be changed by anyone
who gains write access to the database.

Laboratory roles, from least to most: **閲覧者** (read-only) → **メンバー**
(create and edit) → **管理者** (manage members) → **オーナー** (also delete or
transfer the laboratory).

### Pages

| Route | Who can reach it |
|---|---|
| `/login` | Anyone — sign in, sign up, request a password reset |
| `/auth/callback` | Lands every emailed link (confirmation, recovery, invitation) |
| `/auth/reset` | Set a new password after a recovery link |
| `/admin` | Lab admins and owners; platform admins see every laboratory |
| `/admin/members` | Add, re-role and remove members; transfer ownership |
| `/admin/labs` | Create, rename and delete laboratories |
| `/admin/users` | **Platform admins only** — every account on the deployment |
| `/admin/audit` | Append-only record of every administrative action |
| `/admin/account` | Any signed-in user — display name, password, memberships |

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

The account is created already confirmed. Add the same address to
`PLATFORM_ADMIN_EMAILS` in `.env.local` and restart to grant platform access.

Once signed in, further accounts can be created from 管理 → ユーザー without
touching email at all.

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

## Database

The app is fully usable without Supabase. The database is only needed to save
experiments, notebook entries, datasets, analyses and figures.

### Applying the schema

`supabase/migrations/0001_init.sql` creates 14 tables, enum types, triggers,
helper functions and row-level security policies. Everything is scoped to a
laboratory; RLS is enforced on every table, so a leaked publishable key cannot
read another lab's data.

Either paste the file into the Supabase SQL editor, or:

```bash
# Project Settings -> Database -> Connection string -> URI
echo 'SUPABASE_DB_URL=postgresql://...' >> .env.local
npm run db:push
```

The dashboard shows connection status and tells you if the schema is missing.

### Schema

```
profiles · laboratories · lab_members          identity and membership
projects · experiments                         the work
notebook_templates · notebook_entries          the record
raw_files · sample_sheets · rename_operations  data organization + provenance
datasets · analyses · figures                  results
audit_logs                                     append-only trail
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
| `PLATFORM_ADMIN_EMAILS` | for admin | Comma-separated addresses with platform-wide rights. **Server-only — never give it a `NEXT_PUBLIC_` prefix.** |
| `NEXT_PUBLIC_SITE_URL` | for email links | Public origin used in confirmation, recovery and invitation links |
| `OPENAI_API_KEY` | optional | AI features stay disabled while unset |
| `OPENAI_MODEL_*` | optional | Model IDs are configurable rather than hard-coded |
| `NCBI_API_KEY` / `NCBI_EMAIL` | optional | PubMed lookups |

---

## Commands

```bash
npm run dev            # development server
npm run build          # production build
npm run check          # typecheck + lint + unit tests
npm test               # unit tests (132)
npm run test:e2e       # browser smoke test; needs a server on :3210
npm run test:e2e:auth  # login, administration and permission denials
npm run test:e2e:ai    # voice structuring and literature search (uses real API calls)
npm run admin:create   # create the first administrator account
npm run db:push        # apply migrations (needs SUPABASE_DB_URL)
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
