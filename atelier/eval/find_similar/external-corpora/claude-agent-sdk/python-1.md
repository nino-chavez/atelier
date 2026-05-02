# python (part 1 of 7)

# Agent SDK reference - Python

> Complete API reference for the Python Agent SDK, including all functions, types, and classes.

## Installation

```bash theme={null}
pip install claude-agent-sdk
```

## Choosing between `query()` and `ClaudeSDKClient`

The Python SDK provides two ways to interact with Claude Code:

### Quick comparison

| Feature             | `query()`                     | `ClaudeSDKClient`                  |
| :------------------ | :---------------------------- | :--------------------------------- |
| **Session**         | Creates new session each time | Reuses same session                |
| **Conversation**    | Single exchange               | Multiple exchanges in same context |
| **Connection**      | Managed automatically         | Manual control                     |
| **Streaming Input** | ✅ Supported                   | ✅ Supported                        |
| **Interrupts**      | ❌ Not supported               | ✅ Supported                        |
| **Hooks**           | ✅ Supported                   | ✅ Supported                        |
| **Custom Tools**    | ✅ Supported                   | ✅ Supported                        |
| **Continue Chat**   | ❌ New session each time       | ✅ Maintains conversation           |
| **Use Case**        | One-off tasks                 | Continuous conversations           |

### When to use `query()` (new session each time)

**Best for:**

* One-off questions where you don't need conversation history
* Independent tasks that don't require context from previous exchanges
* Simple automation scripts
* When you want a fresh start each time

### When to use `ClaudeSDKClient` (continuous conversation)

**Best for:**

* **Continuing conversations** - When you need Claude to remember context
* **Follow-up questions** - Building on previous responses
* **Interactive applications** - Chat interfaces, REPLs
* **Response-driven logic** - When next action depends on Claude's response
* **Session control** - Managing conversation lifecycle explicitly

## Functions

### `query()`

Creates a new session for each interaction with Claude Code. Returns an async iterator that yields messages as they arrive. Each call to `query()` starts fresh with no memory of previous interactions.

```python theme={null}
async def query(
    *,
    prompt: str | AsyncIterable[dict[str, Any]],
    options: ClaudeAgentOptions | None = None,
    transport: Transport | None = None
) -> AsyncIterator[Message]
```

#### Parameters

| Parameter   | Type                         | Description                                                                |
| :---------- | :--------------------------- | :------------------------------------------------------------------------- |
| `prompt`    | `str \| AsyncIterable[dict]` | The input prompt as a string or async iterable for streaming mode          |
| `options`   | `ClaudeAgentOptions \| None` | Optional configuration object (defaults to `ClaudeAgentOptions()` if None) |
| `transport` | `Transport \| None`          | Optional custom transport for communicating with the CLI process           |

#### Returns

Returns an `AsyncIterator[Message]` that yields messages from the conversation.

#### Example - With options

```python theme={null}
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions


async def main():
    options = ClaudeAgentOptions(
        system_prompt="You are an expert Python developer",
        permission_mode="acceptEdits",
        cwd="/home/user/project",
    )

    async for message in query(prompt="Create a Python web server", options=options):
        print(message)


asyncio.run(main())
```

### `tool()`

Decorator for defining MCP tools with type safety.

```python theme={null}
def tool(
    name: str,
    description: str,
    input_schema: type | dict[str, Any],
    annotations: ToolAnnotations | None = None
) -> Callable[[Callable[[Any], Awaitable[dict[str, Any]]]], SdkMcpTool[Any]]
```

#### Parameters

| Parameter      | Type                                             | Description                                                         |
| :------------- | :----------------------------------------------- | :------------------------------------------------------------------ |
| `name`         | `str`                                            | Unique identifier for the tool                                      |
| `description`  | `str`                                            | Human-readable description of what the tool does                    |
| `input_schema` | `type \| dict[str, Any]`                         | Schema defining the tool's input parameters (see below)             |
| `annotations`  | [`ToolAnnotations`](#tool-annotations)` \| None` | Optional MCP tool annotations providing behavioral hints to clients |

#### Input schema options

1. **Simple type mapping** (recommended):

   ```python theme={null}
   {"text": str, "count": int, "enabled": bool}
   ```

2. **JSON Schema format** (for complex validation):
   ```python theme={null}
   {
       "type": "object",
       "properties": {
           "text": {"type": "string"},
           "count": {"type": "integer", "minimum": 0},
       },
       "required": ["text"],
   }
   ```

#### Returns

A decorator function that wraps the tool implementation and returns an `SdkMcpTool` instance.

#### Example

```python theme={null}
from claude_agent_sdk import tool
from typing import Any


@tool("greet", "Greet a user", {"name": str})
async def greet(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": f"Hello, {args['name']}!"}]}
```

#### `ToolAnnotations`

Re-exported from `mcp.types` (also available as `from claude_agent_sdk import ToolAnnotations`). All fields are optional hints; clients should not rely on them for security decisions.

| Field             | Type           | Default | Description                                                                                                                                          |
| :---------------- | :------------- | :------ | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | `str \| None`  | `None`  | Human-readable title for the tool                                                                                                                    |
| `readOnlyHint`    | `bool \| None` | `False` | If `True`, the tool does not modify its environment                                                                                                  |
| `destructiveHint` | `bool \| None` | `True`  | If `True`, the tool may perform destructive updates (only meaningful when `readOnlyHint` is `False`)                                                 |
| `idempotentHint`  | `bool \| None` | `False` | If `True`, repeated calls with the same arguments have no additional effect (only meaningful when `readOnlyHint` is `False`)                         |
| `openWorldHint`   | `bool \| None` | `True`  | If `True`, the tool interacts with external entities (for example, web search). If `False`, the tool's domain is closed (for example, a memory tool) |

```python theme={null}
from claude_agent_sdk import tool, ToolAnnotations
from typing import Any


@tool(
    "search",
    "Search the web",
    {"query": str},
    annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=True),
)
async def search(args: dict[str, Any]) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": f"Results for: {args['query']}"}]}
```

### `create_sdk_mcp_server()`

Create an in-process MCP server that runs within your Python application.

```python theme={null}
def create_sdk_mcp_server(
    name: str,
    version: str = "1.0.0",
    tools: list[SdkMcpTool[Any]] | None = None
) -> McpSdkServerConfig
```

#### Parameters

| Parameter | Type                            | Default   | Description                                           |
| :-------- | :------------------------------ | :-------- | :---------------------------------------------------- |
| `name`    | `str`                           | -         | Unique identifier for the server                      |
| `version` | `str`                           | `"1.0.0"` | Server version string                                 |
| `tools`   | `list[SdkMcpTool[Any]] \| None` | `None`    | List of tool functions created with `@tool` decorator |

#### Returns

Returns an `McpSdkServerConfig` object that can be passed to `ClaudeAgentOptions.mcp_servers`.

#### Example

```python theme={null}
from claude_agent_sdk import tool, create_sdk_mcp_server


@tool("add", "Add two numbers", {"a": float, "b": float})
async def add(args):
    return {"content": [{"type": "text", "text": f"Sum: {args['a'] + args['b']}"}]}


@tool("multiply", "Multiply two numbers", {"a": float, "b": float})
async def multiply(args):
    return {"content": [{"type": "text", "text": f"Product: {args['a'] * args['b']}"}]}


calculator = create_sdk_mcp_server(
    name="calculator",
    version="2.0.0",
    tools=[add, multiply],  # Pass decorated functions
)

# Use with Claude
options = ClaudeAgentOptions(
    mcp_servers={"calc": calculator},
    allowed_tools=["mcp__calc__add", "mcp__calc__multiply"],
)
```

### `list_sessions()`

Lists past sessions with metadata. Filter by project directory or list sessions across all projects. Synchronous; returns immediately.

```python theme={null}
def list_sessions(
    directory: str | None = None,
    limit: int | None = None,
    include_worktrees: bool = True
) -> list[SDKSessionInfo]
```

#### Parameters

| Parameter           | Type          | Default | Description                                                                           |
| :------------------ | :------------ | :------ | :------------------------------------------------------------------------------------ |
| `directory`         | `str \| None` | `None`  | Directory to list sessions for. When omitted, returns sessions across all projects    |
| `limit`             | `int \| None` | `None`  | Maximum number of sessions to return                                                  |
| `include_worktrees` | `bool`        | `True`  | When `directory` is inside a git repository, include sessions from all worktree paths |

#### Return type: `SDKSessionInfo`

| Property        | Type          | Description                                                          |
| :-------------- | :------------ | :------------------------------------------------------------------- |
| `session_id`    | `str`         | Unique session identifier                                            |
| `summary`       | `str`         | Display title: custom title, auto-generated summary, or first prompt |
| `last_modified` | `int`         | Last modified time in milliseconds since epoch                       |
| `file_size`     | `int \| None` | Session file size in bytes (`None` for remote storage backends)      |
| `custom_title`  | `str \| None` | User-set session title                                               |
| `first_prompt`  | `str \| None` | First meaningful user prompt in the session                          |
| `git_branch`    | `str \| None` | Git branch at the end of the session                                 |
| `cwd`           | `str \| None` | Working directory for the session                                    |
| `tag`           | `str \| None` | User-set session tag (see [`tag_session()`](#tag-session))           |
| `created_at`    | `int \| None` | Session creation time in milliseconds since epoch                    |

#### Example

Print the 10 most recent sessions for a project. Results are sorted by `last_modified` descending, so the first item is the newest. Omit `directory` to search across all projects.

```python theme={null}
from claude_agent_sdk import list_sessions

for session in list_sessions(directory="/path/to/project", limit=10):
    print(f"{session.summary} ({session.session_id})")
```

### `get_session_messages()`

Retrieves messages from a past session. Synchronous; returns immediately.

```python theme={null}
def get_session_messages(
    session_id: str,
    directory: str | None = None,
    limit: int | None = None,
    offset: int = 0
) -> list[SessionMessage]
```

#### Parameters

| Parameter    | Type          | Default  | Description                                                       |
| :----------- | :------------ | :------- | :---------------------------------------------------------------- |
| `session_id` | `str`         | required | The session ID to retrieve messages for                           |
| `directory`  | `str \| None` | `None`   | Project directory to look in. When omitted, searches all projects |
| `limit`      | `int \| None` | `None`   | Maximum number of messages to return                              |
| `offset`     | `int`         | `0`      | Number of messages to skip from the start                         |

#### Return type: `SessionMessage`

| Property             | Type                           | Description               |
| :------------------- | :----------------------------- | :------------------------ |
| `type`               | `Literal["user", "assistant"]` | Message role              |
| `uuid`               | `str`                          | Unique message identifier |
| `session_id`         | `str`                          | Session identifier        |
| `message`            | `Any`                          | Raw message content       |
| `parent_tool_use_id` | `None`                         | Reserved for future use   |

#### Example

```python theme={null}
from claude_agent_sdk import list_sessions, get_session_messages

sessions = list_sessions(limit=1)
if sessions:
    messages = get_session_messages(sessions[0].session_id)
    for msg in messages:
        print(f"[{msg.type}] {msg.uuid}")
```

### `get_session_info()`

Reads metadata for a single session by ID without scanning the full project directory. Synchronous; returns immediately.

```python theme={null}
def get_session_info(
    session_id: str,
    directory: str | None = None,
) -> SDKSessionInfo | None
```

#### Parameters

| Parameter    | Type          | Default  | Description                                                            |
| :----------- | :------------ | :------- | :--------------------------------------------------------------------- |
| `session_id` | `str`         | required | UUID of the session to look up                                         |
| `directory`  | `str \| None` | `None`   | Project directory path. When omitted, searches all project directories |

Returns [`SDKSessionInfo`](#return-type-sdk-session-info), or `None` if the session is not found.

#### Example

Look up a single session's metadata without scanning the project directory. Useful when you already have a session ID from a previous run.

```python theme={null}
from claude_agent_sdk import get_session_info

info = get_session_info("550e8400-e29b-41d4-a716-446655440000")
if info:
    print(f"{info.summary} (branch: {info.git_branch}, tag: {info.tag})")
```

### `rename_session()`

Renames a session by appending a custom-title entry. Repeated calls are safe; the most recent title wins. Synchronous.

```python theme={null}
def rename_session(
    session_id: str,
    title: str,
    directory: str | None = None,
) -> None
```

#### Parameters

| Parameter    | Type          | Default  | Description                                                            |
| :----------- | :------------ | :------- | :--------------------------------------------------------------------- |
| `session_id` | `str`         | required | UUID of the session to rename                                          |
| `title`      | `str`         | required | New title. Must be non-empty after stripping whitespace                |
| `directory`  | `str \| None` | `None`   | Project directory path. When omitted, searches all project directories |

Raises `ValueError` if `session_id` is not a valid UUID or `title` is empty; `FileNotFoundError` if the session cannot be found.

#### Example

Rename the most recent session so it's easier to find later. The new title appears in [`SDKSessionInfo.custom_title`](#return-type-sdk-session-info) on subsequent reads.

```python theme={null}
from claude_agent_sdk import list_sessions, rename_session

sessions = list_sessions(directory="/path/to/project", limit=1)
if sessions:
    rename_session(sessions[0].session_id, "Refactor auth module")
```

### `tag_session()`

Tags a session. Pass `None` to clear the tag. Repeated calls are safe; the most recent tag wins. Synchronous.

```python theme={null}
def tag_session(
    session_id: str,
    tag: str | None,
    directory: str | None = None,
) -> None
```

#### Parameters

| Parameter    | Type          | Default  | Description                                                            |
| :----------- | :------------ | :------- | :--------------------------------------------------------------------- |
| `session_id` | `str`         | required | UUID of the session to tag                                             |
| `tag`        | `str \| None` | required | Tag string, or `None` to clear. Unicode-sanitized before storing       |
| `directory`  | `str \| None` | `None`   | Project directory path. When omitted, searches all project directories |

Raises `ValueError` if `session_id` is not a valid UUID or `tag` is empty after sanitization; `FileNotFoundError` if the session cannot be found.

#### Example

Tag a session, then filter by that tag on a later read. Pass `None` to clear an existing tag.

```python theme={null}
from claude_agent_sdk import list_sessions, tag_session

# Tag a session
tag_session("550e8400-e29b-41d4-a716-446655440000", "needs-review")

# Later: find all sessions with that tag
for session in list_sessions(directory="/path/to/project"):
    if session.tag == "needs-review":
        print(session.summary)
```

