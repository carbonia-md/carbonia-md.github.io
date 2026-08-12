---
tier: gotcha
triggers:
  paths:
    - "scripts/**/*.sh"
  objective:
    - "shell script"
    - "bash"
  definition_of_done:
    - "shell script"
    - "bash 3.2"
---
# Shell scripts must run on macOS bash 3.2 and CI bash 5

Repo shell scripts (`scripts/**`) run both locally (macOS default bash is 3.2; a dev shell
may have `CDPATH` set) and in CI (ubuntu bash 5). Write to the older target:

- No `mapfile`/`readarray` (bash 4+). Build lists with a `while read` loop or
  `grep … | paste -sd '|' -`.
- `unset CDPATH` before `dir="$(cd … && pwd)"`: with `CDPATH` set, `cd` echoes the resolved
  path into the command substitution and corrupts the captured value.
- Avoid other bash-4-only features (associative arrays, `${var,,}`) unless you gate on a
  bash ≥4 shebang and document it.

**Why:** LB-2's `check-genericity.sh` failed twice locally before running — `mapfile: command
not found` and a doubled `$ROOT` from `CDPATH` (work-summary obstacles). Both were invisible
on CI's bash 5; only the DoD-4-required local runs exposed them.
