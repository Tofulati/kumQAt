from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class TestCase(BaseModel):
    id: str
    name: str
    goal: str
    preconditions: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    expected_outcomes: list[str] = Field(default_factory=list)
    failure_signals: list[str] = Field(default_factory=list)
    priority: str = "P1"
    tags: list[str] = Field(default_factory=list)


class GenerateTestsRequest(BaseModel):
    url: str
    requirement_text: str
    max_cases: int = Field(default=5, ge=1, le=12)


class GenerateTestsResponse(BaseModel):
    test_cases: list[TestCase]


class RunSuiteRequest(BaseModel):
    url: str
    requirement_text: str
    test_cases: Optional[list[TestCase]] = None
    max_cases: int = Field(default=5, ge=1, le=12)
    viewport: Literal["desktop", "mobile"] = "desktop"


class RunSuiteResponse(BaseModel):
    run_id: str
    message: str


class RunTestRequest(BaseModel):
    url: str
    requirement_text: str = ""
    viewport: Literal["desktop", "mobile"] = "desktop"


class TestResultPayload(BaseModel):
    test_case_id: str
    status: Literal["pass", "fail", "flaky", "blocked"]
    severity: Literal["low", "medium", "high"] = "medium"
    confidence: float = 0.75
    failed_step: Optional[str] = None
    expected: str = ""
    actual: str = ""
    repro_steps: list[str] = Field(default_factory=list)
    evidence: list[str] = Field(default_factory=list)
    suspected_issue: str = ""
    business_impact: str = ""
    agent_trace: str = ""
    summary: str = ""


class RunResultsResponse(BaseModel):
    run_id: str
    url: str
    requirement_text: str
    status: str
    viewport: str
    created_at: str
    results: list[dict[str, Any]]
    test_cases: list[dict[str, Any]]


class RerunFailedRequest(BaseModel):
    run_id: str


class RunOneCaseRequest(BaseModel):
    url: str
    test_case: TestCase
    viewport: Literal["desktop", "mobile"] = "desktop"
    requirement_text: str = ""


class ChatRunRequest(BaseModel):
    url: str
    requirement_text: str
    viewport: Literal["desktop", "mobile"] = "desktop"


class ScheduleRunRequest(BaseModel):
    url: str
    requirement_text: str
    viewport: Literal["desktop", "mobile"] = "desktop"
    interval: Literal["hourly", "daily", "weekly"] = "daily"


class ScheduleRunResponse(BaseModel):
    schedule_id: str
    message: str
    next_run_at: str


class DiscussMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class DiscussRequest(BaseModel):
    run_id: str
    messages: list[DiscussMessage]
