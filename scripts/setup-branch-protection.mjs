#!/usr/bin/env node
/**
 * Sets up GitHub branch protection for `main` with the translation-key-checks
 * workflow as a required status check.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... node scripts/setup-branch-protection.mjs
 *
 * The token must have `repo` scope and admin access to WahNun/glev-app.
 * Create one at: https://github.com/settings/tokens/new?scopes=repo
 *
 * What this script does:
 *   1. Reads the current branch protection settings for `main` (if any).
 *   2. Merges the `Translation key checks` job into the required status checks list.
 *   3. Writes back the full protection payload via PUT.
 *
 * The check name MUST match the `name:` field of the job in
 * .github/workflows/translation-key-checks.yml exactly:
 *   jobs:
 *     translation-key-checks:
 *       name: Translation key checks   <-- this string
 */

const OWNER = "WahNun";
const REPO = "glev-app";
const BRANCH = "main";
const REQUIRED_CHECK = "Translation key checks";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("Error: GITHUB_TOKEN environment variable is not set.");
  console.error("Create a token with `repo` scope at https://github.com/settings/tokens/new?scopes=repo");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "glev-setup-branch-protection/1.0",
};

const base = `https://api.github.com/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection`;

async function getCurrentProtection() {
  const res = await fetch(base, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GET protection failed (${res.status}): ${body}`);
  }
  return res.json();
}

function buildPayload(existing) {
  const existingChecks =
    existing?.required_status_checks?.checks ?? [];

  const alreadyPresent = existingChecks.some(
    (c) => c.context === REQUIRED_CHECK
  );
  const checks = alreadyPresent
    ? existingChecks
    : [...existingChecks, { context: REQUIRED_CHECK }];

  return {
    required_status_checks: {
      strict: existing?.required_status_checks?.strict ?? false,
      checks,
    },
    enforce_admins: existing?.enforce_admins?.enabled ?? false,
    required_pull_request_reviews:
      existing?.required_pull_request_reviews
        ? {
            dismiss_stale_reviews:
              existing.required_pull_request_reviews.dismiss_stale_reviews ??
              false,
            require_code_owner_reviews:
              existing.required_pull_request_reviews
                .require_code_owner_reviews ?? false,
            required_approving_review_count:
              existing.required_pull_request_reviews
                .required_approving_review_count ?? 0,
          }
        : null,
    restrictions: existing?.restrictions
      ? {
          users: existing.restrictions.users?.map((u) => u.login) ?? [],
          teams: existing.restrictions.teams?.map((t) => t.slug) ?? [],
          apps: existing.restrictions.apps?.map((a) => a.slug) ?? [],
        }
      : null,
  };
}

async function apply() {
  console.log(`Fetching current protection for ${OWNER}/${REPO}@${BRANCH}…`);
  const existing = await getCurrentProtection();

  if (existing) {
    const current =
      existing.required_status_checks?.checks?.map((c) => c.context) ?? [];
    console.log("  Existing required checks:", current.length ? current.join(", ") : "(none)");
  } else {
    console.log("  No branch protection exists yet — creating fresh.");
  }

  const payload = buildPayload(existing);
  const newChecks = payload.required_status_checks.checks.map((c) => c.context);
  console.log(`  Required checks after update: ${newChecks.join(", ")}`);

  const res = await fetch(base, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PUT protection failed (${res.status}): ${body}`);
  }

  const result = await res.json();
  const applied =
    result.required_status_checks?.checks?.map((c) => c.context) ?? [];

  if (applied.includes(REQUIRED_CHECK)) {
    console.log(`\nDone. "${REQUIRED_CHECK}" is now a required status check on ${BRANCH}.`);
    console.log("A PR with a failing translation check cannot be merged until it passes.");
  } else {
    console.warn("\nWarning: GitHub response did not confirm the check was applied.");
    console.warn("Applied checks:", JSON.stringify(applied));
    process.exit(1);
  }
}

apply().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
