#!/usr/bin/env python3
"""article-health.py — SSOT article health check tool.

Design proposal: reports/article-health-ssot-design-2026-05-04.md
Rules canonical: docs/editorial/EDITORIAL.md

Status (2026-06-10 audit A-6 update — original docstring stalled at Phase 1 "0 plugins" was misleading):
  - 25 plugins live (lib/article_health/checks/ auto-discovered)
  - Integrated into pre-commit (--profile=pre-commit) + CI deploy (--profile=ci-deploy) hard gate
  - prose-health / quote-fidelity / paragraph-rhythm / footnote series / image-health etc.
  - View active list: article-health --list-checks

Usage:
  article-health <files> [--profile=NAME] [--check=NAME] [--output=FORMAT]
  article-health --staged [--profile=pre-commit]
  article-health --all [--profile=dashboard --output=json]
  article-health --list-checks
  article-health --inventory   # auto-gen TOOL-INVENTORY-style markdown
"""

from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

# Make `lib.article_health` importable when running this file directly.
_THIS = Path(__file__).resolve()
_TOOLS_DIR = _THIS.parent
sys.path.insert(0, str(_TOOLS_DIR))

from lib.article_health import (  # noqa: E402
    FileTarget,
    HealthReport,
    Severity,
    is_article_path,
    load_config,
    load_target,
    list_checks,
    run_checks,
)


def _eligible_files(paths: list[Path]) -> list[Path]:
    """Filter an explicit file list to article targets (loader.is_article_path).

    `--staged` / `--all` already only emit eligible paths; this guards the
    explicit `<files>` / `--fix <files>` code paths so checks never receive a
    non-article (a path outside knowledge/{Category}/, a leading-underscore
    hub, or a non-.md file). Each skipped path prints a one-line stderr notice.
    """
    out: list[Path] = []
    for p in paths:
        if is_article_path(p):
            out.append(p)
        else:
            print(f"⏭️  {p}: not a knowledge/{{Category}}/*.md article — skipped", file=sys.stderr)
    return out


def _get_staged_md() -> list[Path]:
    """staged knowledge/{Category}/*.md files.

    Eligibility is `loader.is_article_path`, never a second copy of the rule:
    a staged root-level workflow queue (`knowledge/INBOX.md`,
    `knowledge/SNIPPET-INBOX.md`) is not an article, and a divergence here would
    fail the pre-commit hook on files `--all` never checks.
    """
    try:
        out = subprocess.check_output(
            ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
            text=True,
        )
    except subprocess.CalledProcessError:
        return []
    return [Path(line) for line in out.splitlines() if is_article_path(line)]


def _get_all_source() -> list[Path]:
    root = Path("knowledge")
    if not root.exists():
        return []
    files = []
    for cat in root.iterdir():
        if not cat.is_dir():
            continue
        for md in cat.glob("*.md"):
            if not md.name.startswith("_"):
                files.append(md)
    return files


def _cmd_fix(args) -> int:
    """Apply auto-fixes for fix-capable plugins."""
    from lib.article_health import registry as registry_mod
    registry_mod.discover_checks()

    if args.staged:
        files = _get_staged_md()
        if not files:
            print("🔍 staged: no knowledge/*.md files staged, skipping.")
            return 0
    elif args.all:
        files = _get_all_source()
    elif args.files:
        files = _eligible_files([Path(f) for f in args.files])
    else:
        print("⚠️  --fix needs files / --staged / --all", file=sys.stderr)
        return 2

    config = load_config(args.config)
    profile = config.get_profile(args.profile)

    # Resolve which checks to run --fix on. Restrict to those that export fix().
    candidates = list(registry_mod._REGISTRY.values())  # type: ignore[attr-defined]
    if args.check:
        candidates = [m for m in candidates if m.CHECK_NAME == args.check]
    elif profile and profile.checks is not None:
        names = set(profile.checks)
        candidates = [m for m in candidates if m.CHECK_NAME in names]

    fix_capable = [m for m in candidates if hasattr(m, "fix") and callable(getattr(m, "fix"))]
    if not fix_capable:
        print(f"⚠️  No fix-capable plugins among selection. Available with fix: "
              f"{[m.CHECK_NAME for m in registry_mod._REGISTRY.values() if hasattr(m,'fix')]}",
              file=sys.stderr)
        return 0
    if not args.quiet:
        print(f"🔧 Applying --fix via plugins: {[m.CHECK_NAME for m in fix_capable]}")
        if args.dry_run:
            print("   (dry-run mode — no files will be modified)")

    files_modified = 0
    total_changes = 0
    per_plugin_changes: dict[str, int] = {m.CHECK_NAME: 0 for m in fix_capable}
    for f in files:
        if not f.exists():
            continue
        target = load_target(f)
        any_change = False
        for mod in fix_capable:
            options = config.get_check_config(mod.CHECK_NAME).options
            opts = dict(options)
            opts["dry_run"] = bool(args.dry_run)
            try:
                changed = mod.fix(target, opts)
            except Exception as e:
                print(f"⚠️  {f}: {mod.CHECK_NAME}.fix() error: {e}", file=sys.stderr)
                continue
            if changed:
                any_change = True
                if isinstance(changed, int):
                    per_plugin_changes[mod.CHECK_NAME] += changed
                    total_changes += changed
                else:
                    per_plugin_changes[mod.CHECK_NAME] += 1
                    total_changes += 1
                # Reload target after this plugin's write so the next plugin sees fresh state
                if not args.dry_run:
                    target = load_target(f)
        if any_change:
            files_modified += 1
            if not args.quiet:
                marker = "[dry-run] would fix" if args.dry_run else "✏️  fixed"
                print(f"   {marker} {f}")

    print()
    if args.dry_run:
        print(f"📋 DRY-RUN: {files_modified} file(s) would be modified.")
    else:
        print(f"✏️  Modified {files_modified} file(s).")
    if any(v for v in per_plugin_changes.values()):
        print("   per-plugin changes:")
        for n, c in per_plugin_changes.items():
            if c:
                print(f"     {n}: {c}")
    return 0


def _cmd_write_baseline(out_path: Path, config_path: str | None) -> int:
    """Write prose-health scores to legacy `.quality-baseline.json` schema
    consumed by `scripts/core/generate-dashboard-data.js`.

    Schema:
        {version, timestamp, total, flagged, files: [{file, score, reasons}]}
    where `file` is `<lowercase_category>/<filename>.md`.

    Only entries with score >= 4 are stored (matches legacy quality-scan.sh
    behavior: score 0-3 is the in-budget pass band per EDITORIAL §quality-scan
    and dashboard.template.astro qLabel logic). The dashboard reads this map
    and defaults to 0 (pass) for any article not present.
    """
    import datetime
    config = load_config(config_path)
    files = _get_all_source()
    flagged_files: list[dict] = []
    total = 0
    for f in files:
        if not f.exists():
            continue
        total += 1
        target = load_target(f)
        report = run_checks(target, config, check_name="prose-health")
        score = 0
        reasons = ""
        for r in report.results:
            if r.check != "prose-health":
                continue
            for v in r.violations:
                msg = v.message
                if msg.startswith("prose-health score:"):
                    try:
                        score = int(msg.split(":")[1].strip().split()[0])
                    except (IndexError, ValueError):
                        score = 0
                    if "—" in msg:
                        reasons = msg.split("—", 1)[1].strip()
        if score >= 4:
            rel = f"{target.category.lower()}/{f.name}"
            flagged_files.append({"file": rel, "score": score, "reasons": reasons})
    out = {
        "version": "ssot-1.0",
        "timestamp": datetime.datetime.now(datetime.timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total": total,
        "flagged": len(flagged_files),
        "files": flagged_files,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ Wrote {total} scanned, {len(flagged_files)} flagged (score≥4) to {out_path}")
    return 0


def _effective_passed(report: HealthReport, fail_on: str) -> bool:
    """Whether this report passes under the active profile's fail_on rule.
    `report.passed` only checks HARD; this also respects warn/never.
    """
    if fail_on == "never":
        return True
    if fail_on == "warn":
        return report.hard_count == 0 and report.warn_count == 0
    return report.hard_count == 0


def _format_human(report: HealthReport, fail_on: str = "hard") -> str:
    lines = []
    lines.append(f"🧬 {report.target.path}")
    lines.append(
        f"   category={report.target.category}  slug={report.target.slug}"
    )
    if not report.results:
        lines.append("   (no checks ran — Phase 1 has empty registry)")
        return "\n".join(lines)
    for r in report.results:
        if r.skipped:
            lines.append(f"   ⊘ {r.check}  skipped: {r.skip_reason}")
            continue
        icon = "✅" if r.passed else ("🔴" if r.hard_count else "⚠️ ")
        counts = f"hard={r.hard_count} warn={r.warn_count}"
        if r.info_count:
            counts += f" info={r.info_count}"
        lines.append(f"   {icon} {r.check}  {counts}")
        # Show up to 20 violations per check (was 5, bumped 2026-05-10
        # sad-shockley feedback: tool should show the exact sentence/context,
        # not truncate to 5 and require manual grep). 20 covers most articles
        # without spamming console; rare cases > 20 still surface tail.
        max_show = 20
        for v in r.violations[:max_show]:
            loc = f"L{v.line}" if v.line else ""
            lines.append(f"      {v.severity.value} {loc}: {v.message}")
        if len(r.violations) > max_show:
            lines.append(f"      ... and {len(r.violations) - max_show} more")
    eff = _effective_passed(report, fail_on)
    lines.append(
        f"\nSummary: hard={report.hard_count}  warn={report.warn_count}  "
        f"info={report.info_count}  passed={eff} (fail_on={fail_on})"
    )
    return "\n".join(lines)


def cmd_list_checks() -> int:
    items = list_checks()
    if not items:
        print("(no plugins registered yet — Phase 1 ships empty registry)")
        return 0
    print(f"{'NAME':<30} {'DIM':<20} {'SEV':<6} {'EDITORIAL':<40} FIX?")
    print("-" * 110)
    for it in items:
        fix = "✓" if it["fix_supported"] else " "
        print(
            f"{it['name']:<30} {it['dimension']:<20} "
            f"{it['default_severity']:<6} {it['editorial_ref'][:38]:<40} {fix}"
        )
    return 0


def cmd_inventory() -> int:
    """Auto-gen markdown inventory (replaces hand-maintained TOOL-INVENTORY)."""
    items = list_checks()
    print("# Article Health — Auto-generated check inventory\n")
    print("> Auto-gen by `scripts/tools/article-health.py --inventory`. Do not edit by hand.\n")
    print(f"Total checks: {len(items)}\n")
    print("| Check | Dimension | Default Severity | Editorial Ref | Auto-fix? |")
    print("|---|---|---|---|---|")
    for it in items:
        fix = "✓" if it["fix_supported"] else "—"
        print(
            f"| `{it['name']}` | {it['dimension']} | "
            f"{it['default_severity']} | {it['editorial_ref']} | {fix} |"
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="SSOT article health check tool",
    )
    parser.add_argument("files", nargs="*", type=Path, help="Files to check")
    parser.add_argument("--profile", default="release-pr", help="Profile name from config")
    parser.add_argument("--check", default=None, help="Run only this single check")
    parser.add_argument(
        "--output", choices=["human", "json"], default="human", help="Output format"
    )
    parser.add_argument("--staged", action="store_true", help="Use git staged files")
    parser.add_argument("--all", action="store_true", help="Sweep all knowledge/{Category}/*.md articles")
    parser.add_argument("--list-checks", action="store_true", help="List registered plugins")
    parser.add_argument("--inventory", action="store_true", help="Auto-gen markdown inventory")
    parser.add_argument("--config", default=None, help="Path to config.toml")
    parser.add_argument(
        "--quiet", action="store_true", help="Only summary, no per-violation lines"
    )
    parser.add_argument(
        "--baseline-out",
        default=None,
        help="Write prose-health scores to this path in legacy quality-baseline.json schema "
             "(consumed by scripts/core/generate-dashboard-data.js). Implies --all + --check=prose-health.",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Apply auto-fixes for plugins that export a fix() (frontmatter-format, "
             "link-target, wikilink-target). Files are modified in place. "
             "Combine with --check=NAME to scope. Use --dry-run to preview without writing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --fix, show what would change without writing.",
    )
    args = parser.parse_args()

    if args.baseline_out:
        return _cmd_write_baseline(Path(args.baseline_out), args.config)

    if args.fix:
        return _cmd_fix(args)

    if args.list_checks:
        return cmd_list_checks()
    if args.inventory:
        return cmd_inventory()

    # Resolve file list
    if args.staged:
        files = _get_staged_md()
        if not files:
            print("🔍 staged: no knowledge/*.md files staged, skipping.")
            return 0
    elif args.all:
        files = _get_all_source()
    elif args.files:
        files = _eligible_files([Path(f) for f in args.files])
    else:
        parser.print_help()
        return 0

    config = load_config(args.config)
    reports: list[HealthReport] = []
    for f in files:
        if not f.exists():
            print(f"⚠️  {f}: not found", file=sys.stderr)
            continue
        target = load_target(f)
        report = run_checks(
            target, config, profile_name=args.profile, check_name=args.check
        )
        reports.append(report)

    # Resolve fail_on once for both display + exit code
    profile = config.get_profile(args.profile)
    fail_on = profile.fail_on if profile else "hard"

    # Output
    if args.output == "json":
        payload = {
            "fail_on": fail_on,
            "reports": [
                {**r.as_dict(), "effective_passed": _effective_passed(r, fail_on)}
                for r in reports
            ],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for r in reports:
            print(_format_human(r, fail_on))
            if r is not reports[-1]:
                print()

    # Exit code
    if fail_on == "never":
        return 0
    total_hard = sum(r.hard_count for r in reports)
    total_warn = sum(r.warn_count for r in reports)
    if fail_on == "hard":
        return 1 if total_hard else 0
    if fail_on == "warn":
        return 1 if (total_hard or total_warn) else 0
    if fail_on == "score-budget":
        # Reserved for prose-health ≤ 3 budget — Phase 4+ wires this up
        return 1 if total_hard else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
