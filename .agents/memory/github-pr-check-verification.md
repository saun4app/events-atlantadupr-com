---
name: GitHub PR check verification
description: Constraints for exercising repository and fork pull-request workflows from this workspace
---

End-to-end GitHub pull-request workflow verification requires a non-empty remote repository and an authenticated GitHub account with permission to create branches and pull requests.

**Why:** An anonymously reachable repository can still have no refs or pull requests, and local Replit credentials do not automatically authorize GitHub CLI or API writes.

**How to apply:** Check anonymous repository metadata, remote refs, and `gh auth status` separately before attempting hosted verification. If the repository is empty or GitHub auth is absent, run local workflow-logic and artifact-sanitization checks, but do not claim hosted run URLs or outcomes.