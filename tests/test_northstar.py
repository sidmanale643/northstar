import pytest

from northstar import CaptureOptions, Northstar


class TestNorthstarInit:
    def test_requires_api_key(self):
        with pytest.raises(ValueError, match="api_key is required"):
            Northstar(api_key="", endpoint="https://api.northstar.test")

    def test_requires_project_id(self):
        with pytest.raises(
            ValueError,
            match="project_id is required",
        ):
            Northstar(api_key="test-key", endpoint="")

    def test_derives_endpoint_from_project_id(self):
        client = Northstar(api_key="test-key", project_id="northstarproject")

        assert client.endpoint == (
            "https://northstarproject.supabase.co/functions/v1/ingest-traces"
        )

    def test_rejects_invalid_project_id(self):
        with pytest.raises(ValueError, match="project_id must be a Supabase project ID"):
            Northstar(api_key="test-key", project_id="https://northstar.test")

    def test_rejects_dashboard_project_id_with_actionable_error(self):
        with pytest.raises(
            ValueError,
            match="project_id must be a Supabase project ID",
        ):
            Northstar(api_key="test-key", project_id="proj_a3f9c1d8e27b")

    def test_defaults_sensitive_capture_to_disabled(self):
        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test/",
        )

        assert client.api_key == "test-key"
        assert client.endpoint == "https://api.northstar.test"
        assert client.capture == CaptureOptions()

    def test_uses_explicit_capture_options(self):
        capture = CaptureOptions(tool_results=True)

        client = Northstar(
            api_key="test-key",
            endpoint="https://api.northstar.test",
            capture=capture,
        )

        assert client.capture is capture
