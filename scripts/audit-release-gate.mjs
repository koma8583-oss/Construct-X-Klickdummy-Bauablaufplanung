#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const REQUIRED_CHECK = "Quality and release gate";

function fail(message) {
  console.error(`Release-gate protection audit failed: ${message}`);
  process.exitCode = 1;
}

if (!process.env.GH_TOKEN) {
  fail(
    "GH_TOKEN is missing. Run this audit with an authenticated maintainer token " +
      "that can read repository administration settings; do not commit the token.",
  );
  process.exit();
}

function ghApi(endpoint) {
  try {
    return {
      value: JSON.parse(
        execFileSync(
          "gh",
          [
            "api",
            endpoint,
            "--header",
            "Accept: application/vnd.github+json",
            "--header",
            "X-GitHub-Api-Version: 2022-11-28",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
      ),
    };
  } catch (error) {
    const stderr = error?.stderr?.toString().trim() || "";
    const httpStatus = stderr.match(/\bHTTP (\d{3})\b/)?.[1];
    return {
      error: {
        status: httpStatus ? Number(httpStatus) : error?.status,
        message: stderr || "GitHub API request failed",
      },
    };
  }
}

function repositoryName() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;

  try {
    return execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch {
    return "";
  }
}

const repository = repositoryName();
if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
  fail(
    "could not determine the GitHub repository. Set GITHUB_REPOSITORY to OWNER/REPOSITORY " +
      "or run the command from a GitHub checkout.",
  );
  process.exit();
}

const repositoryResponse = ghApi(`repos/${repository}`);
if (repositoryResponse.error) {
  fail(
    `could not read repository metadata for ${repository}. Check that the maintainer token ` +
      "has repository metadata and administration read access.",
  );
  process.exit();
}

const defaultBranch = repositoryResponse.value.default_branch;
if (!defaultBranch) {
  fail(`GitHub returned no default branch for ${repository}.`);
  process.exit();
}

const branchEndpoint = `repos/${repository}/branches/${encodeURIComponent(defaultBranch)}/protection`;
const protectionResponse = ghApi(branchEndpoint);
if (protectionResponse.error) {
  if (protectionResponse.error.status === 404) {
    fail(
      `default branch "${defaultBranch}" has no readable classic branch protection. ` +
        "Enable protection (or migrate the policy to a ruleset and audit that ruleset) " +
        "before merging.",
    );
  } else if (
    protectionResponse.error.status === 401 ||
    protectionResponse.error.status === 403
  ) {
    fail(
      `the maintainer token cannot read protection for "${defaultBranch}". ` +
        "Grant it repository Administration: read access and run the audit again.",
    );
  } else {
    fail(
      `GitHub could not read protection for "${defaultBranch}". ` +
        "Check the API response and repository access before merging.",
    );
  }
  process.exit();
}

const protection = protectionResponse.value;
const failures = [];

if (!protection.required_pull_request_reviews) {
  failures.push("pull requests are not required before merging");
}

const requiredStatusChecks = protection.required_status_checks;
if (!requiredStatusChecks) {
  failures.push(`the required status check "${REQUIRED_CHECK}" is missing`);
} else {
  if (requiredStatusChecks.strict !== true) {
    failures.push("the required status checks are not configured to require an up-to-date branch");
  }

  const contexts = Array.isArray(requiredStatusChecks.contexts)
    ? requiredStatusChecks.contexts
    : Array.isArray(requiredStatusChecks.checks)
      ? requiredStatusChecks.checks.map((check) => check.context)
      : [];
  const uniqueContexts = [...new Set(contexts)];
  if (
    uniqueContexts.length !== 1 ||
    uniqueContexts[0] !== REQUIRED_CHECK
  ) {
    const actual = uniqueContexts.length ? uniqueContexts.join(", ") : "none";
    failures.push(
      `required status checks must contain exactly "${REQUIRED_CHECK}" (found: ${actual})`,
    );
  }
}

if (protection.required_conversation_resolution?.enabled !== true) {
  failures.push("conversation resolution is not required");
}

if (protection.enforce_admins?.enabled !== true) {
  failures.push("administrators can bypass branch protection");
}

if (failures.length > 0) {
  console.error(
    `Release-gate protection drift detected on ${repository}:${defaultBranch}`,
  );
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    "Restore the documented settings in docs/ci-release-gate.md, then rerun this audit.",
  );
  process.exitCode = 1;
} else {
  console.log(
    `Release-gate protection is valid on ${repository}:${defaultBranch}: ` +
      `PRs require the exact "${REQUIRED_CHECK}" check, an up-to-date branch, ` +
      "conversation resolution, and administrator enforcement.",
  );
}