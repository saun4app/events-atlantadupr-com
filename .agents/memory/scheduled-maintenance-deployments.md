---
name: Scheduled maintenance deployments
description: How recurring checks are configured without disturbing this pnpm workspace's web deployment
---
# Scheduled maintenance deployment rule

Recurring maintenance checks should run as a separate Replit Scheduled Deployment, configured in Publishing with an explicit schedule and a package script that exits nonzero on findings. Do not replace the workspace's Autoscale/artifact production process with the maintenance command.

**Why:** Scheduled Deployments alert maintainers when a run fails, while a read-only check can surface findings without destructive cleanup. In pnpm workspaces, artifact manifests own production service commands.

**How to apply:** Keep the schedule and exact run command documented in `.replit` and the audit script. Use a separate explicit cleanup command only after review.