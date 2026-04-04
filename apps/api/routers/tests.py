from fastapi import APIRouter

from models.schemas import GenerateTestsRequest, GenerateTestsResponse
from services.planner import generate_test_cases

router = APIRouter(tags=["tests"])


@router.post("/generate-tests", response_model=GenerateTestsResponse)
async def generate_tests(body: GenerateTestsRequest):
    cases = await generate_test_cases(
        body.url,
        body.requirement_text,
        body.max_cases,
    )
    return GenerateTestsResponse(test_cases=cases)
