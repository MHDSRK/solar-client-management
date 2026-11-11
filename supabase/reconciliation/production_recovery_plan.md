# Production Recovery Plan — Two-Admin Candidate

**Status: NO-GO.** This is a review artifact, not deployment authorization. The
candidate and the compensating SQL remain outside `supabase/migrations`.

## Evidence and decision matrix

| Recovery path | Evidence | Decision |
|---|---|---|
| Supabase PITR | Dashboard inspection of project `rfcgmfmzfkqinkopzabt` showed the Free plan does not include scheduled project backups; the PITR page identifies PITR as a Pro add-on. No project backup or restorable point was displayed or verified. External backups were not assessed. | No Supabase-managed restore point is available in the evidence. Do not plan a PITR restore unless plan/backup availability changes and a specific restore point is verified. |
| Existing production snapshot | A catalog/data snapshot was supplied for project `rfcgmfmzfkqinkopzabt`, captured on 2026-11-09. It records the profile roles/active states, catalog objects, grants, triggers, and sequence values. It is not a verified restorable backup. | Use as review evidence only. Preserve an approved, exact pre-deployment snapshot outside Git before any deployment decision. |
| Compensating migration | Drafted in [`compensating_two_admin_security.sql`](./compensating_two_admin_security.sql) using the supplied production baseline. It is fail-closed for unexpected profile or candidate-object state and preserves audit rows and sequence state. | Candidate path for isolated testing and independent review only. Not ready to apply. |

Reference: [Supabase Database Backups and PITR](https://supabase.com/docs/guides/platform/backups).

## Restore impact

A restore to an earlier database point replaces the current database state.
Changes after the recovery point—including customer rows, profile changes,
audit history, and sequence state—would be lost. A database restore does not
undo external side effects such as notifications, integrations, or files stored
through Supabase Storage. It also incurs project downtime.

The supplied migration-time snapshot has no demonstrated restore procedure and
must not be treated as a backup.

## Recovery-point decision

There is no verified production recovery point in the evidence available now.
Therefore, no production restore point can be selected and deployment remains
NO-GO.

If backup/PITR becomes available, first verify its exact restore window in the
Dashboard and rehearse a restore to a separate project. Prefer the latest
verified point before deployment, but account for every legitimate write since
that point; an in-place restore may discard them. Do not select or execute an
in-place restore based only on the timestamp of the supplied catalog snapshot.

## Compensating migration draft

The draft is based on the six supplied reference migrations and the supplied
production inventory. It is intended to:

- Restore baseline signup, customer-guard, and customer-RPC behavior, retaining
  the pinned empty `search_path` from migration `20261106142827`. The draft
  reformats function source, so byte-for-byte identity is not claimed.
- Remove the added Auth email-sync trigger/function and UUID authorization
  helper.
- Restore the captured policy model, table grants, sequence ACLs, and remove
  `customers_created_by_idx`.
- Restore the second approved profile to `staff` / inactive, but only if both
  approved profiles are still in the expected post-candidate state and the
  profile table still contains the two captured rows.
- Preserve customer data, current Auth/profile email values, activity log
  rows, sequence values, and all other data. It does not attempt to delete or
  rewrite audit history or reset identity sequences.

The profile update performed by compensation will itself be audited and
advance the activity-log identity sequence. If email changed after deployment,
the Auth email is retained; after removal of the sync trigger, an operator must
compare and reconcile Auth/profile email deliberately. The script aborts if
profile state or candidate objects differ from its assumptions. An abort
requires investigation, not bypassing the guard.

**Security regression:** restoring `handle_new_user()` also restores the
baseline first-user-admin signup behavior. If the profiles table is empty, the
next Auth signup becomes an active Admin. Public signup must be disabled (or
strictly restricted to operator-controlled invites) before compensation and
remain restricted until the signup behavior is independently secured. This
deviation is intentional for rollback fidelity, but it has not been accepted
as an operational risk and is not safe to leave unmitigated.

### Required pre-deployment snapshot

Before any future deployment decision, capture and retain outside Git:

- Every profile row’s `user_id`, `full_name`, `email`, `role`, `active`,
  `created_at`, and `updated_at`, plus the exact set/count of rows.
- Exact function definitions, owners, `prosecdef`, `proconfig`, and ACLs for
  all functions the candidate replaces or adds.
- Exact policies, relation/column grants, RLS/force-RLS flags, triggers, and
  affected indexes.
- All three sequence values and `is_called` flags, without planning to reset
  them during compensation.
- Customer, audit, and sync-queue state/counts sufficient to detect concurrent
  changes.
- Current migration ledger, and evidence that the recovery snapshot is
  actually restorable.

The compensating SQL intentionally does not blindly restore `full_name`,
`email`, or timestamps. Those values may have legitimate post-deployment
changes; the operator must compare them with the retained snapshot and decide
what, if anything, to reconcile.

The supplied pre-deployment snapshot recorded these profile values:

| Auth user ID | `full_name` | `email` | `role` | `active` | `created_at` / `updated_at` |
|---|---|---|---|---|---|
| `6c613a5d-9bd6-4449-9cb3-cb0f1baf7e0f` | `NULL` | `solar.disunenergy@gmail.com` | `admin` | `true` | `2026-11-09 14:36:44.071895+00` / same |
| `d2914556-10a7-4954-8ee0-8cdbdb649830` | `NULL` | `mhdsharookh@gmail.com` | `staff` | `false` | `2026-11-09 14:37:07.292531+00` / same |

These are historical values from the supplied snapshot, not a fresh
pre-deployment capture. Compensation restores only the second account's role
and active flag. The normal profile update trigger changes `updated_at` and
appends an audit record; the original timestamp is not restored.

## Isolated test and failure behavior

**No production SQL or migration was applied.** Public signup was disabled
separately after explicit user approval, as documented below. CLI and SQL tests
used a disposable PostgreSQL 17.11 instance; they are not a production recovery
rehearsal or deployment approval.

Artifact identity:

- The versioned forward file and reviewed source have the same SHA-256:
  `639CDA131386489C7F0DFF0C96727CECB2BB3E11DF42DE2D2B8902029CE7D1E7`.
- The current compensation file has SHA-256:
  `435448A24A7DA05C8D96DD7ED46BD17B96DDE63A79AA899D5B66CE9EB3528142`.
- The compensation file tested through the CLI was copied from this exact
  revision. Its test-only migration version was `20261110170000`; it remains
  outside `supabase/migrations`.

The current revision was rehearsed through **Supabase CLI 3.1.0** using
`supabase db push --remote=<disposable PostgreSQL 17.11 URL>`. The isolated
database was initialized with the six supplied reference migrations, then the
exact forward candidate and compensation were run by the CLI. The first
compensation attempt exposed that CLI migration bodies are not automatically
wrapped in a transaction: `LOCK TABLE` failed outside a transaction. The
explicit `BEGIN`/`COMMIT` boundaries in the current draft fixed that issue.
The exact current compensation then completed through `db push`, and
`supabase migration list` showed the six baseline versions plus candidate
`20261109165000` and test compensation `20261110170000` recorded.

Failure behavior was tested through that runner:

- An injected error before `COMMIT` rolled back compensation catalog/profile
  changes and did not record the compensation ledger entry.
- An injected division-by-zero immediately after `COMMIT` returned CLI failure
  while the compensation state was fully committed and the ledger row was
  absent. After independently verifying the compensated state, the isolated
  rehearsal repaired the test ledger with
  `supabase migration repair --status applied 20261110170000`; the ledger then
  showed the version as applied. This is a demonstrated runner/ledger gap, not
  an atomic transaction spanning SQL and migration history.
- Therefore, a production `db push` error must **not** be followed by a blind
  retry. Verify the complete database state and ledger first. Only if the
  entire compensation is independently verified as complete and the expected
  ledger row is absent may a separately approved `migration repair` be
  considered. Any partial or unexpected state is a stop-and-escalate condition.

The current PGlite regression log records exit code 0. The assertions cover
candidate authorization and sequence-consumption behavior, direct execution
denial for API roles on trigger functions in the forward state, exact policy
and privilege expectations, rollback behavior, profile/audit changes, and
sequence state. PostgreSQL 17.11 rehearsal additionally verified candidate
function/policy fingerprints, compensation success, mismatch refusal, and
failure behavior.

Independent baseline review:

- The column-level `UPDATE (full_name, role, active)` grant on `profiles` is
  present in the supplied baseline migration and matches the captured profile
  privileges. It is not a mismatch with the baseline.
- Restored table, sequence, and RPC grants were checked against the supplied
  production ACL snapshot. The SQL-only reference database does not reproduce
  all Supabase-managed default privileges, so its raw ACL text is not a
  substitute for the captured live ACL snapshot.
- The compensation restores `service_role` EXECUTE on the two trigger-only
  functions, matching the baseline migration behavior; the forward candidate
  intentionally denies it. `anon` and `authenticated` remain denied. PostgreSQL
  does not permit direct invocation of trigger functions even when EXECUTE is
  granted. A direct SQL invocation as `service_role` after compensation returned
  `trigger functions can only be called as triggers`; `anon` and
  `authenticated` were denied by ACL. This is a baseline-restoration choice,
  not a forward-candidate privilege grant.
- Restored policy definitions, trigger inventory, index inventory, RLS flags,
  profile state, and RPC execute grants were checked in the isolated
  PostgreSQL 17.11 run. Function source text is reformatted relative to the
  reference migrations; semantic behavior and sensitive search escaping were
  reviewed/tested, but byte-for-byte identity of every restored function body
  is not established by the PGlite baseline-equality assertion.
- Compensation's profile update itself creates an audit row and advances the
  activity-log sequence. Sequence advancement is non-transactional: a failed
  attempt can leave a gap even when table/catalog changes roll back. The script
  does not reset sequence values, and the plan does not claim that such gaps
  can be reversed.

Concurrency tests confirmed ordinary profile writes, Auth email updates, and
signup wait while the compensation's table locks are held. However, an existing
transaction that locks/updates `profiles` before writing `auth.users` can
deadlock against the compensation's `auth.users` → advisory lock → `profiles`
order. PostgreSQL returned SQLSTATE `40P01` and aborted the compensation
atomically. This is a real operational deadlock mode, not an unlocked
profile-state race; the procedure must pause and drain writes, and must abort
on deadlock/timeout rather than call the lock order deadlock-proof.

Dashboard inspection on 2026-11-10 found public signup enabled. After explicit
user approval it was disabled, reloaded, and verified unchecked. This setting
must be rechecked immediately before any recovery; it does not authorize or
apply SQL.

These tests do not establish a restorable production backup, capture a fresh
pre-deployment snapshot, or account for legitimate production changes made
after a recovery point. The production database and migration ledger remain
untouched.

## Required maintenance procedure for any future compensation

The lock order is **not deadlock-proof**. PostgreSQL 17.11 reproduced a
`40P01` deadlock when an existing transaction updated `profiles` and then
updated `auth.users`, opposite to the compensation's `auth.users` → advisory
lock → `profiles` order. Do not retry through that conflict or weaken the
preflight. Use an approved maintenance window:

1. **Confirm scope and snapshot.** Verify the exact Supabase project reference,
   take the approved fresh pre-deployment catalog/data snapshot outside Git,
   and confirm the candidate migration ledger entry and target profile state.
2. **Restrict signup before touching the database.** Public signup for project
   `rfcgmfmzfkqinkopzabt` was disabled and re-verified in the Dashboard on
   2026-11-10. Recheck that it remains disabled at the start of the actual
   maintenance window and record the project reference, state, operator, and
   time in the change record. Do not infer this setting from SQL or from the
   trigger body. If signup is enabled or cannot be verified, stop. Do not use
   any public test signup against production. Keep Auth user creation/invites
   operator-controlled and prevent removal of all profiles until the restored
   first-user-admin behavior is replaced.
3. **Pause writes.** Put the application in maintenance mode and pause all
   profile mutations, Auth user creation/invites, Auth email changes, and
   other operators or jobs that can write those tables. Keep public signup
   disabled throughout compensation and verification.
4. **Drain existing transactions.** Wait for transactions that hold write or
   conflicting locks on `auth.users` or `public.profiles` to finish. Inspect
   `pg_stat_activity` and `pg_locks`; include idle-in-transaction sessions,
   not only currently running statements. Do not proceed while a relevant
   transaction remains. If the compensation hits `lock_timeout` or SQLSTATE
   `40P01`, treat it as an aborted attempt: verify transaction rollback, drain
   the conflicting transaction, recheck the snapshot/preflight assumptions,
   and obtain operator approval before retrying.

   Read-only lock inspection query (run with sufficient catalog visibility):

   ```sql
   SELECT a.pid, a.usename, a.application_name, a.state, a.xact_start,
          l.relation::regclass AS relation, l.mode, l.granted, l.waitstart
   FROM pg_catalog.pg_locks l
   JOIN pg_catalog.pg_stat_activity a USING (pid)
   WHERE l.locktype = 'relation'
     AND l.relation IN (
       'auth.users'::regclass,
       'public.profiles'::regclass
     )
     AND l.mode IN (
       'RowExclusiveLock', 'ShareUpdateExclusiveLock', 'ShareLock',
       'ShareRowExclusiveLock', 'ExclusiveLock', 'AccessExclusiveLock'
     )
   ORDER BY a.xact_start NULLS LAST, a.pid, l.granted;
   ```

   Resolve every relevant application/operator transaction and rerun the
   inspection before applying compensation. Do not terminate sessions merely
   to clear the preflight; let the owning operator determine a safe resolution.
5. **Execute and reconcile the ledger.** Apply the reviewed compensation
   through the approved migration runner as one transaction. Do not run
   sections manually or bypass preflight. If the runner reports failure, do
   not retry blindly: inspect the full compensated state and migration ledger.
   If state is fully compensated but the ledger row is absent, obtain
   independent verification and operator approval before using the reviewed
   `supabase migration repair --status applied <compensation_version>` recovery
   path. If any object/data state is partial or unexpected, stop; do not repair
   the ledger or rerun the migration.
6. **Verify before resuming.** Independently verify the restored function
   definitions/owners/security settings/ACLs, policies, table and sequence
   grants, RLS flags, trigger inventory, index inventory, both profiles,
   customer/audit data, and migration ledger against the fresh snapshot and
   recovery expectations. Confirm the second account is inactive Staff and
   the first remains an active Admin. Keep signup disabled.
7. **Resume deliberately.** Resume ordinary application writes only after
   verification and operator sign-off. Do not re-enable public signup until
   a separately reviewed signup control has replaced the first-user-admin
   behavior and its effective setting has been verified. If no such control
   exists, leave public signup disabled.

The production Dashboard setting was changed to disable public signup after
explicit user approval and verified unchecked after reload. No database or
migration changes were made in production. The production write pause and
transaction drain have not been performed.

## Go/no-go prerequisites

Remain **NO-GO** until all are satisfied:

1. Obtain and preserve a fresh, exact production snapshot through an approved
   read-only path; verify any backup/PITR evidence in the Dashboard.
2. Obtain an independently reviewed, fresh production snapshot and establish a
   verified recovery point. The current Free-plan evidence shows no
   Supabase-managed backup/PITR point; do not treat the supplied inventory as
   restorable.
3. Reconcile the current production ledger again and approve exact migration
   packaging/runner steps. Do not replay the repository’s incompatible legacy
   `001`–`005` chain. The isolated CLI rehearsal does not substitute for
   production ledger verification.
4. Approve and execute the maintenance procedure above, including write pause,
   transaction drain, and pre/post verification, only after a recovery point
   and operator-approved recovery path exist.
5. Re-verify public signup is disabled in the exact production project at the
   maintenance window and keep it disabled until the restored first-user-admin
   behavior is replaced. It is currently verified disabled; recheck it before
   any recovery execution.
6. Obtain explicit deployment approval. This artifact grants none.
