---
name: CI test reporter output
description: How Node's built-in JUnit reporter behaves when its output is sent to a file
---

Node's built-in JUnit test reporter writes the structured report to the configured destination and does not also print the normal test summary to stdout.

**Why:** A report file is useful for machine processing, but without a separate console capture, failed test diagnostics are harder to inspect in the workflow log.

**How to apply:** When a CI test command uses `--test-reporter-destination`, capture stdout and stderr into a separate log (for example with `tee`) and upload both files on failure.