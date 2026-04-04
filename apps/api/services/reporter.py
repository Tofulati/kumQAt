from models.schemas import TestResultPayload


def build_summary(result: TestResultPayload) -> str:
    sev = result.severity.upper()
    head = f"{result.status.upper()} ({sev}) — {result.test_case_id}"
    lines = [head]
    if result.failed_step:
        lines.append(f"Failed step: {result.failed_step}")
    lines.append(f"Expected: {result.expected or '—'}")
    lines.append(f"Actual: {result.actual or '—'}")
    if result.suspected_issue:
        lines.append(f"Suspected issue: {result.suspected_issue}")
    if result.repro_steps:
        lines.append("Repro: " + "; ".join(result.repro_steps[:5]))
    if result.evidence:
        lines.append(f"Evidence: {', '.join(result.evidence)}")
    return "\n".join(lines)


def attach_evidence(result: TestResultPayload, paths: list[str]) -> TestResultPayload:
    merged = list(dict.fromkeys([*result.evidence, *paths]))
    result.evidence = merged
    result.summary = build_summary(result)
    return result
