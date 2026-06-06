# NorthStar Agent Instructions

## Architecture & Goals
- **NorthStar** is an observability, debugging, and evaluation platform for AI agents.
- **Current Focus**: Observability/Tracing.
- **Data Layer**: Supabase. Traces are stored in a Supabase backend and visualized on a separate web dashboard.
- **Core Entity Hierarchy** (implemented in `src/models.py`):
  - `Session`: Top-level user tracking session, contains multiple `Trace`s.
  - `Trace`: Represents an agent run or step.
  - `ToolCall`: Captures the execution details (`id`, `name`, `params`, `output`) inside a Trace.
- **Distribution**: Packaged as a Python library/SDK (users will install via `uv add northstar-ai` and import `northstar`).
- Users provide a Northstar API KEY to authenticate and send traces to the backend.

## Toolchain & Commands
- **Package Manager**: `uv`. Always run Python commands via `uv run` (e.g., `uv run python -c "..."`).
- **Dependencies**: Uses `pydantic` (`>=2.13.4`) for strict data validation and schema definitions. Python version is `>=3.11`.

## Development Conventions
- **Code Organization**: The library source code is in `src/` (e.g., `src/models.py`, `src/main.py`), not the root `main.py`.
- **Type Hinting**: Ensure type hints are accurate and compatible with Python 3.11+ and Pydantic (e.g., use `Dict[str, Any]` over raw `dict[str]` for Pydantic model fields).
- **IDs**: UUIDs are automatically generated for `Session.id`, `Trace.run_id`, and `ToolCall.id` using `uuid.uuid4()`.

## Todo List

- [ ] Set up Supabase project and configure connection
- [ ] Create database tables for Session, Trace, and ToolCall entities
- [ ] Set up Row Level Security (RLS) policies for multi-tenant data isolation
- [ ] Implement Python SDK client for sending traces to Supabase
- [ ] Add NorthStar API KEY authentication middleware
- [ ] Create migrations for schema versioning
- [ ] Build web dashboard for visualizing traces
- [ ] Write tests for Supabase integration and data models
- [ ] Package and publish SDK to PyPI for `uv add northstar-ai`

