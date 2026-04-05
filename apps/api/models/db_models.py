from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class ScheduledRun(SQLModel, table=True):
    id: str = Field(primary_key=True)
    url: str
    requirement_text: str
    viewport: str = Field(default="desktop")
    interval: str  # "hourly" | "daily" | "weekly"
    next_run_at: datetime
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_run_id: Optional[str] = Field(default=None)
    active: bool = Field(default=True)


class Run(SQLModel, table=True):
    id: str = Field(primary_key=True)
    url: str
    requirement_text: str
    status: str = Field(default="pending")
    viewport: str = Field(default="desktop")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class StoredTestCase(SQLModel, table=True):
    id: str = Field(primary_key=True)
    run_id: str = Field(foreign_key="run.id")
    case_json: str


class TestResultRow(SQLModel, table=True):
    id: str = Field(primary_key=True)
    run_id: str = Field(foreign_key="run.id")
    result_json: str
    summary: Optional[str] = None
