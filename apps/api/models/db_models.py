from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


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
