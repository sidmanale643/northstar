import httpx
import pytest
import respx


@pytest.fixture
def mock_ingest_endpoint():
    with respx.mock(assert_all_called=False) as router:
        route = router.post("https://api.northstar.test").mock(
            return_value=httpx.Response(200, json={"accepted": True}),
        )
        yield route


@pytest.fixture
def mock_project_ingest_endpoint():
    with respx.mock(assert_all_called=False) as router:
        route = router.post(
            "https://northstarproject.supabase.co/functions/v1/ingest-traces"
        ).mock(
            return_value=httpx.Response(200, json={"accepted": True}),
        )
        yield route
