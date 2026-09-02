---
name: GitHub PR check verification
description: Constraints for exercising repository and fork pull-request workflows from this workspace
---

End-to-end GitHub pull-request workflow verification requires a non-empty remote repository and an authenticated GitHub account with permission to create branches and pull requests.

**Why:** An anonymously reachable repository can still have no refs or pull requests, and local Replit credentials do not automatically authorize GitHub CLI or API writes.

**How to apply:** Check anonymous repository metadata, remote refs, and `gh auth status` separately before attempting hosted verification. If the repository is empty or GitHub auth is absent, run local workflow-logic and artifact-sanitization checks, but do not claim hosted run URLs or outcomes.

The Replit GitHub connector may reject writes to `.github/workflows/*` even after OAuth reauthorization; ordinary repository paths can still be written.

**Why:** GitHub workflow files have a protected permission boundary, and the connector/proxy can return a Cloudflare 403 or GitHub 404 for that path while allowing normal Git Data and Contents API calls.

**How to apply:** Seed ordinary files through the connector, then place the workflow through GitHub’s web editor or a local Git client. Treat the public Actions run summary page as the source for human-readable job-summary and artifact presentation; the connector APIs reliably expose run/job conclusions, annotations, and artifact retention metadata but not the rendered `GITHUB_STEP_SUMMARY` text.

Repository deletion can require fork-owner or organization authority beyond the connector-reported repository permissions; PR and ref cleanup may succeed while deleting the fork returns `403 Must have admin rights`.

**Why:** The hosted verification fork reported admin-level repository permissions, but GitHub still rejected repository deletion for the connected identity.

**How to apply:** Before creating a disposable fork for hosted verification, confirm that the connected identity can delete repositories owned by the fork owner; otherwise plan to remove refs and queue fork deletion for an owner-authorized follow-up.

The GitHub connector can report `admin` repository permission while repository deletion still fails with `403 Must have admin rights to Repository` when its OAuth grant lacks the separate deletion scope.

**Why:** Repository metadata and collaborator-permission endpoints confirm administrative access, but GitHub applies an additional deletion authorization boundary to `DELETE /repos/{owner}/{repo}`.

**How to apply:** Treat a successful admin read as insufficient proof of deletability. Check the deletion endpoint once, inspect the connector's effective OAuth scopes, and use an owner-authorized GitHub account or UI when the connector cannot grant the deletion scope.