# python (part 5 of 7)

## Hook Types

For a comprehensive guide on using hooks with examples and common patterns, see the [Hooks guide](/en/agent-sdk/hooks).

### `HookEvent`

Supported hook event types.

```python theme={null}
HookEvent = Literal[
    "PreToolUse",  # Called before tool execution
    "PostToolUse",  # Called after tool execution
    "PostToolUseFailure",  # Called when a tool execution fails
    "UserPromptSubmit",  # Called when user submits a prompt
    "Stop",  # Called when stopping execution
    "SubagentStop",  # Called when a subagent stops
    "PreCompact",  # Called before message compaction
    "Notification",  # Called for notification events
    "SubagentStart",  # Called when a subagent starts
    "PermissionRequest",  # Called when a permission decision is needed
]
```

<Note>
  The TypeScript SDK supports additional hook events not yet available in Python: `SessionStart`, `SessionEnd`, `Setup`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`, `WorktreeCreate`, `WorktreeRemove`, and `PostToolBatch`.
</Note>

### `HookCallback`

Type definition for hook callback functions.

```python theme={null}
HookCallback = Callable[[HookInput, str | None, HookContext], Awaitable[HookJSONOutput]]
```

Parameters:

* `input`: Strongly-typed hook input with discriminated unions based on `hook_event_name` (see [`HookInput`](#hook-input))
* `tool_use_id`: Optional tool use identifier (for tool-related hooks)
* `context`: Hook context with additional information

Returns a [`HookJSONOutput`](#hook-json-output) that may contain:

* `decision`: `"block"` to block the action
* `systemMessage`: System message to add to the transcript
* `hookSpecificOutput`: Hook-specific output data

### `HookContext`

Context information passed to hook callbacks.

```python theme={null}
class HookContext(TypedDict):
    signal: Any | None  # Future: abort signal support
```

### `HookMatcher`

Configuration for matching hooks to specific events or tools.

```python theme={null}
@dataclass
class HookMatcher:
    matcher: str | None = (
        None  # Tool name or pattern to match (e.g., "Bash", "Write|Edit")
    )
    hooks: list[HookCallback] = field(
        default_factory=list
    )  # List of callbacks to execute
    timeout: float | None = (
        None  # Timeout in seconds for all hooks in this matcher (default: 60)
    )
```

### `HookInput`

Union type of all hook input types. The actual type depends on the `hook_event_name` field.

```python theme={null}
HookInput = (
    PreToolUseHookInput
    | PostToolUseHookInput
    | PostToolUseFailureHookInput
    | UserPromptSubmitHookInput
    | StopHookInput
    | SubagentStopHookInput
    | PreCompactHookInput
    | NotificationHookInput
    | SubagentStartHookInput
    | PermissionRequestHookInput
)
```

### `BaseHookInput`

Base fields present in all hook input types.

```python theme={null}
class BaseHookInput(TypedDict):
    session_id: str
    transcript_path: str
    cwd: str
    permission_mode: NotRequired[str]
```

| Field             | Type             | Description                         |
| :---------------- | :--------------- | :---------------------------------- |
| `session_id`      | `str`            | Current session identifier          |
| `transcript_path` | `str`            | Path to the session transcript file |
| `cwd`             | `str`            | Current working directory           |
| `permission_mode` | `str` (optional) | Current permission mode             |

### `PreToolUseHookInput`

Input data for `PreToolUse` hook events.

```python theme={null}
class PreToolUseHookInput(BaseHookInput):
    hook_event_name: Literal["PreToolUse"]
    tool_name: str
    tool_input: dict[str, Any]
    tool_use_id: str
    agent_id: NotRequired[str]
    agent_type: NotRequired[str]
```

| Field             | Type                    | Description                                                        |
| :---------------- | :---------------------- | :----------------------------------------------------------------- |
| `hook_event_name` | `Literal["PreToolUse"]` | Always "PreToolUse"                                                |
| `tool_name`       | `str`                   | Name of the tool about to be executed                              |
| `tool_input`      | `dict[str, Any]`        | Input parameters for the tool                                      |
| `tool_use_id`     | `str`                   | Unique identifier for this tool use                                |
| `agent_id`        | `str` (optional)        | Subagent identifier, present when the hook fires inside a subagent |
| `agent_type`      | `str` (optional)        | Subagent type, present when the hook fires inside a subagent       |

### `PostToolUseHookInput`

Input data for `PostToolUse` hook events.

```python theme={null}
class PostToolUseHookInput(BaseHookInput):
    hook_event_name: Literal["PostToolUse"]
    tool_name: str
    tool_input: dict[str, Any]
    tool_response: Any
    tool_use_id: str
    agent_id: NotRequired[str]
    agent_type: NotRequired[str]
```

| Field             | Type                     | Description                                                        |
| :---------------- | :----------------------- | :----------------------------------------------------------------- |
| `hook_event_name` | `Literal["PostToolUse"]` | Always "PostToolUse"                                               |
| `tool_name`       | `str`                    | Name of the tool that was executed                                 |
| `tool_input`      | `dict[str, Any]`         | Input parameters that were used                                    |
| `tool_response`   | `Any`                    | Response from the tool execution                                   |
| `tool_use_id`     | `str`                    | Unique identifier for this tool use                                |
| `agent_id`        | `str` (optional)         | Subagent identifier, present when the hook fires inside a subagent |
| `agent_type`      | `str` (optional)         | Subagent type, present when the hook fires inside a subagent       |

### `PostToolUseFailureHookInput`

Input data for `PostToolUseFailure` hook events. Called when a tool execution fails.

```python theme={null}
class PostToolUseFailureHookInput(BaseHookInput):
    hook_event_name: Literal["PostToolUseFailure"]
    tool_name: str
    tool_input: dict[str, Any]
    tool_use_id: str
    error: str
    is_interrupt: NotRequired[bool]
    agent_id: NotRequired[str]
    agent_type: NotRequired[str]
```

| Field             | Type                            | Description                                                        |
| :---------------- | :------------------------------ | :----------------------------------------------------------------- |
| `hook_event_name` | `Literal["PostToolUseFailure"]` | Always "PostToolUseFailure"                                        |
| `tool_name`       | `str`                           | Name of the tool that failed                                       |
| `tool_input`      | `dict[str, Any]`                | Input parameters that were used                                    |
| `tool_use_id`     | `str`                           | Unique identifier for this tool use                                |
| `error`           | `str`                           | Error message from the failed execution                            |
| `is_interrupt`    | `bool` (optional)               | Whether the failure was caused by an interrupt                     |
| `agent_id`        | `str` (optional)                | Subagent identifier, present when the hook fires inside a subagent |
| `agent_type`      | `str` (optional)                | Subagent type, present when the hook fires inside a subagent       |

### `UserPromptSubmitHookInput`

Input data for `UserPromptSubmit` hook events.

```python theme={null}
class UserPromptSubmitHookInput(BaseHookInput):
    hook_event_name: Literal["UserPromptSubmit"]
    prompt: str
```

| Field             | Type                          | Description                 |
| :---------------- | :---------------------------- | :-------------------------- |
| `hook_event_name` | `Literal["UserPromptSubmit"]` | Always "UserPromptSubmit"   |
| `prompt`          | `str`                         | The user's submitted prompt |

### `StopHookInput`

Input data for `Stop` hook events.

```python theme={null}
class StopHookInput(BaseHookInput):
    hook_event_name: Literal["Stop"]
    stop_hook_active: bool
```

| Field              | Type              | Description                     |
| :----------------- | :---------------- | :------------------------------ |
| `hook_event_name`  | `Literal["Stop"]` | Always "Stop"                   |
| `stop_hook_active` | `bool`            | Whether the stop hook is active |

### `SubagentStopHookInput`

Input data for `SubagentStop` hook events.

```python theme={null}
class SubagentStopHookInput(BaseHookInput):
    hook_event_name: Literal["SubagentStop"]
    stop_hook_active: bool
    agent_id: str
    agent_transcript_path: str
    agent_type: str
```

| Field                   | Type                      | Description                            |
| :---------------------- | :------------------------ | :------------------------------------- |
| `hook_event_name`       | `Literal["SubagentStop"]` | Always "SubagentStop"                  |
| `stop_hook_active`      | `bool`                    | Whether the stop hook is active        |
| `agent_id`              | `str`                     | Unique identifier for the subagent     |
| `agent_transcript_path` | `str`                     | Path to the subagent's transcript file |
| `agent_type`            | `str`                     | Type of the subagent                   |

### `PreCompactHookInput`

Input data for `PreCompact` hook events.

```python theme={null}
class PreCompactHookInput(BaseHookInput):
    hook_event_name: Literal["PreCompact"]
    trigger: Literal["manual", "auto"]
    custom_instructions: str | None
```

| Field                 | Type                        | Description                        |
| :-------------------- | :-------------------------- | :--------------------------------- |
| `hook_event_name`     | `Literal["PreCompact"]`     | Always "PreCompact"                |
| `trigger`             | `Literal["manual", "auto"]` | What triggered the compaction      |
| `custom_instructions` | `str \| None`               | Custom instructions for compaction |

### `NotificationHookInput`

Input data for `Notification` hook events.

```python theme={null}
class NotificationHookInput(BaseHookInput):
    hook_event_name: Literal["Notification"]
    message: str
    title: NotRequired[str]
    notification_type: str
```

| Field               | Type                      | Description                  |
| :------------------ | :------------------------ | :--------------------------- |
| `hook_event_name`   | `Literal["Notification"]` | Always "Notification"        |
| `message`           | `str`                     | Notification message content |
| `title`             | `str` (optional)          | Notification title           |
| `notification_type` | `str`                     | Type of notification         |

### `SubagentStartHookInput`

Input data for `SubagentStart` hook events.

```python theme={null}
class SubagentStartHookInput(BaseHookInput):
    hook_event_name: Literal["SubagentStart"]
    agent_id: str
    agent_type: str
```

| Field             | Type                       | Description                        |
| :---------------- | :------------------------- | :--------------------------------- |
| `hook_event_name` | `Literal["SubagentStart"]` | Always "SubagentStart"             |
| `agent_id`        | `str`                      | Unique identifier for the subagent |
| `agent_type`      | `str`                      | Type of the subagent               |

### `PermissionRequestHookInput`

Input data for `PermissionRequest` hook events. Allows hooks to handle permission decisions programmatically.

```python theme={null}
class PermissionRequestHookInput(BaseHookInput):
    hook_event_name: Literal["PermissionRequest"]
    tool_name: str
    tool_input: dict[str, Any]
    permission_suggestions: NotRequired[list[Any]]
```

| Field                    | Type                           | Description                               |
| :----------------------- | :----------------------------- | :---------------------------------------- |
| `hook_event_name`        | `Literal["PermissionRequest"]` | Always "PermissionRequest"                |
| `tool_name`              | `str`                          | Name of the tool requesting permission    |
| `tool_input`             | `dict[str, Any]`               | Input parameters for the tool             |
| `permission_suggestions` | `list[Any]` (optional)         | Suggested permission updates from the CLI |

### `HookJSONOutput`

Union type for hook callback return values.

```python theme={null}
HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput
```

#### `SyncHookJSONOutput`

Synchronous hook output with control and decision fields.

```python theme={null}
class SyncHookJSONOutput(TypedDict):
    # Control fields
    continue_: NotRequired[bool]  # Whether to proceed (default: True)
    suppressOutput: NotRequired[bool]  # Hide stdout from transcript
    stopReason: NotRequired[str]  # Message when continue is False

    # Decision fields
    decision: NotRequired[Literal["block"]]
    systemMessage: NotRequired[str]  # Warning message for user
    reason: NotRequired[str]  # Feedback for Claude

    # Hook-specific output
    hookSpecificOutput: NotRequired[HookSpecificOutput]
```

<Note>
  Use `continue_` (with underscore) in Python code. It is automatically converted to `continue` when sent to the CLI.
</Note>

#### `HookSpecificOutput`

A `TypedDict` containing the hook event name and event-specific fields. The shape depends on the `hookEventName` value. For full details on available fields per hook event, see [Control execution with hooks](/en/agent-sdk/hooks#outputs).

A discriminated union of event-specific output types. The `hookEventName` field determines which fields are valid.

```python theme={null}
class PreToolUseHookSpecificOutput(TypedDict):
    hookEventName: Literal["PreToolUse"]
    permissionDecision: NotRequired[Literal["allow", "deny", "ask"]]
    permissionDecisionReason: NotRequired[str]
    updatedInput: NotRequired[dict[str, Any]]
    additionalContext: NotRequired[str]


class PostToolUseHookSpecificOutput(TypedDict):
    hookEventName: Literal["PostToolUse"]
    additionalContext: NotRequired[str]
    updatedMCPToolOutput: NotRequired[Any]


class PostToolUseFailureHookSpecificOutput(TypedDict):
    hookEventName: Literal["PostToolUseFailure"]
    additionalContext: NotRequired[str]


class UserPromptSubmitHookSpecificOutput(TypedDict):
    hookEventName: Literal["UserPromptSubmit"]
    additionalContext: NotRequired[str]


class NotificationHookSpecificOutput(TypedDict):
    hookEventName: Literal["Notification"]
    additionalContext: NotRequired[str]


class SubagentStartHookSpecificOutput(TypedDict):
    hookEventName: Literal["SubagentStart"]
    additionalContext: NotRequired[str]


class PermissionRequestHookSpecificOutput(TypedDict):
    hookEventName: Literal["PermissionRequest"]
    decision: dict[str, Any]


HookSpecificOutput = (
    PreToolUseHookSpecificOutput
    | PostToolUseHookSpecificOutput
    | PostToolUseFailureHookSpecificOutput
    | UserPromptSubmitHookSpecificOutput
    | NotificationHookSpecificOutput
    | SubagentStartHookSpecificOutput
    | PermissionRequestHookSpecificOutput
)
```

#### `AsyncHookJSONOutput`

Async hook output that defers hook execution.

```python theme={null}
class AsyncHookJSONOutput(TypedDict):
    async_: Literal[True]  # Set to True to defer execution
    asyncTimeout: NotRequired[int]  # Timeout in milliseconds
```

<Note>
  Use `async_` (with underscore) in Python code. It is automatically converted to `async` when sent to the CLI.
</Note>

### Hook Usage Example

This example registers two hooks: one that blocks dangerous bash commands like `rm -rf /`, and another that logs all tool usage for auditing. The security hook only runs on Bash commands (via the `matcher`), while the logging hook runs on all tools.

```python theme={null}
from claude_agent_sdk import query, ClaudeAgentOptions, HookMatcher, HookContext
from typing import Any


async def validate_bash_command(
    input_data: dict[str, Any], tool_use_id: str | None, context: HookContext
) -> dict[str, Any]:
    """Validate and potentially block dangerous bash commands."""
    if input_data["tool_name"] == "Bash":
        command = input_data["tool_input"].get("command", "")
        if "rm -rf /" in command:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": "Dangerous command blocked",
                }
            }
    return {}


async def log_tool_use(
    input_data: dict[str, Any], tool_use_id: str | None, context: HookContext
) -> dict[str, Any]:
    """Log all tool usage for auditing."""
    print(f"Tool used: {input_data.get('tool_name')}")
    return {}


options = ClaudeAgentOptions(
    hooks={
        "PreToolUse": [
            HookMatcher(
                matcher="Bash", hooks=[validate_bash_command], timeout=120
            ),  # 2 min for validation
            HookMatcher(
                hooks=[log_tool_use]
            ),  # Applies to all tools (default 60s timeout)
        ],
        "PostToolUse": [HookMatcher(hooks=[log_tool_use])],
    }
)

async for message in query(prompt="Analyze this codebase", options=options):
    print(message)
```

