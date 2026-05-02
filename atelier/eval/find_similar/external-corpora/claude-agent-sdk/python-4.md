# python (part 4 of 7)

## Message Types

### `Message`

Union type of all possible messages.

```python theme={null}
Message = (
    UserMessage
    | AssistantMessage
    | SystemMessage
    | ResultMessage
    | StreamEvent
    | RateLimitEvent
)
```

### `UserMessage`

User input message.

```python theme={null}
@dataclass
class UserMessage:
    content: str | list[ContentBlock]
    uuid: str | None = None
    parent_tool_use_id: str | None = None
    tool_use_result: dict[str, Any] | None = None
```

| Field                | Type                        | Description                                           |
| :------------------- | :-------------------------- | :---------------------------------------------------- |
| `content`            | `str \| list[ContentBlock]` | Message content as text or content blocks             |
| `uuid`               | `str \| None`               | Unique message identifier                             |
| `parent_tool_use_id` | `str \| None`               | Tool use ID if this message is a tool result response |
| `tool_use_result`    | `dict[str, Any] \| None`    | Tool result data if applicable                        |

### `AssistantMessage`

Assistant response message with content blocks.

```python theme={null}
@dataclass
class AssistantMessage:
    content: list[ContentBlock]
    model: str
    parent_tool_use_id: str | None = None
    error: AssistantMessageError | None = None
    usage: dict[str, Any] | None = None
    message_id: str | None = None
```

| Field                | Type                                                           | Description                                                                     |
| :------------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| `content`            | `list[ContentBlock]`                                           | List of content blocks in the response                                          |
| `model`              | `str`                                                          | Model that generated the response                                               |
| `parent_tool_use_id` | `str \| None`                                                  | Tool use ID if this is a nested response                                        |
| `error`              | [`AssistantMessageError`](#assistant-message-error) ` \| None` | Error type if the response encountered an error                                 |
| `usage`              | `dict[str, Any] \| None`                                       | Per-message token usage (same keys as [`ResultMessage.usage`](#result-message)) |
| `message_id`         | `str \| None`                                                  | API message ID. Multiple messages from one turn share the same ID               |

### `AssistantMessageError`

Possible error types for assistant messages.

```python theme={null}
AssistantMessageError = Literal[
    "authentication_failed",
    "billing_error",
    "rate_limit",
    "invalid_request",
    "server_error",
    "max_output_tokens",
    "unknown",
]
```

### `SystemMessage`

System message with metadata.

```python theme={null}
@dataclass
class SystemMessage:
    subtype: str
    data: dict[str, Any]
```

### `ResultMessage`

Final result message with cost and usage information.

```python theme={null}
@dataclass
class ResultMessage:
    subtype: str
    duration_ms: int
    duration_api_ms: int
    is_error: bool
    num_turns: int
    session_id: str
    total_cost_usd: float | None = None
    usage: dict[str, Any] | None = None
    result: str | None = None
    stop_reason: str | None = None
    structured_output: Any = None
    model_usage: dict[str, Any] | None = None
```

The `usage` dict contains the following keys when present:

| Key                           | Type  | Description                              |
| ----------------------------- | ----- | ---------------------------------------- |
| `input_tokens`                | `int` | Total input tokens consumed.             |
| `output_tokens`               | `int` | Total output tokens generated.           |
| `cache_creation_input_tokens` | `int` | Tokens used to create new cache entries. |
| `cache_read_input_tokens`     | `int` | Tokens read from existing cache entries. |

The `model_usage` dict maps model names to per-model usage. The inner dict keys use camelCase because the value is passed through unmodified from the underlying CLI process, matching the TypeScript [`ModelUsage`](/en/agent-sdk/typescript#model-usage) type:

| Key                        | Type    | Description                                                                                                                              |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `inputTokens`              | `int`   | Input tokens for this model.                                                                                                             |
| `outputTokens`             | `int`   | Output tokens for this model.                                                                                                            |
| `cacheReadInputTokens`     | `int`   | Cache read tokens for this model.                                                                                                        |
| `cacheCreationInputTokens` | `int`   | Cache creation tokens for this model.                                                                                                    |
| `webSearchRequests`        | `int`   | Web search requests made by this model.                                                                                                  |
| `costUSD`                  | `float` | Estimated cost in USD for this model, computed client-side. See [Track cost and usage](/en/agent-sdk/cost-tracking) for billing caveats. |
| `contextWindow`            | `int`   | Context window size for this model.                                                                                                      |
| `maxOutputTokens`          | `int`   | Maximum output token limit for this model.                                                                                               |

### `StreamEvent`

Stream event for partial message updates during streaming. Only received when `include_partial_messages=True` in `ClaudeAgentOptions`. Import via `from claude_agent_sdk.types import StreamEvent`.

```python theme={null}
@dataclass
class StreamEvent:
    uuid: str
    session_id: str
    event: dict[str, Any]  # The raw Claude API stream event
    parent_tool_use_id: str | None = None
```

| Field                | Type             | Description                                         |
| :------------------- | :--------------- | :-------------------------------------------------- |
| `uuid`               | `str`            | Unique identifier for this event                    |
| `session_id`         | `str`            | Session identifier                                  |
| `event`              | `dict[str, Any]` | The raw Claude API stream event data                |
| `parent_tool_use_id` | `str \| None`    | Parent tool use ID if this event is from a subagent |

### `RateLimitEvent`

Emitted when rate limit status changes (for example, from `"allowed"` to `"allowed_warning"`). Use this to warn users before they hit a hard limit, or to back off when status is `"rejected"`.

```python theme={null}
@dataclass
class RateLimitEvent:
    rate_limit_info: RateLimitInfo
    uuid: str
    session_id: str
```

| Field             | Type                                | Description              |
| :---------------- | :---------------------------------- | :----------------------- |
| `rate_limit_info` | [`RateLimitInfo`](#rate-limit-info) | Current rate limit state |
| `uuid`            | `str`                               | Unique event identifier  |
| `session_id`      | `str`                               | Session identifier       |

### `RateLimitInfo`

Rate limit state carried by [`RateLimitEvent`](#rate-limit-event).

```python theme={null}
RateLimitStatus = Literal["allowed", "allowed_warning", "rejected"]
RateLimitType = Literal[
    "five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "overage"
]


@dataclass
class RateLimitInfo:
    status: RateLimitStatus
    resets_at: int | None = None
    rate_limit_type: RateLimitType | None = None
    utilization: float | None = None
    overage_status: RateLimitStatus | None = None
    overage_resets_at: int | None = None
    overage_disabled_reason: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)
```

| Field                     | Type                      | Description                                                                                           |
| :------------------------ | :------------------------ | :---------------------------------------------------------------------------------------------------- |
| `status`                  | `RateLimitStatus`         | Current status. `"allowed_warning"` means approaching the limit; `"rejected"` means the limit was hit |
| `resets_at`               | `int \| None`             | Unix timestamp when the rate limit window resets                                                      |
| `rate_limit_type`         | `RateLimitType \| None`   | Which rate limit window applies                                                                       |
| `utilization`             | `float \| None`           | Fraction of the rate limit consumed (0.0 to 1.0)                                                      |
| `overage_status`          | `RateLimitStatus \| None` | Status of pay-as-you-go overage usage, if applicable                                                  |
| `overage_resets_at`       | `int \| None`             | Unix timestamp when the overage window resets                                                         |
| `overage_disabled_reason` | `str \| None`             | Why overage is unavailable, if status is `"rejected"`                                                 |
| `raw`                     | `dict[str, Any]`          | Full raw dict from the CLI, including fields not modeled above                                        |

### `TaskStartedMessage`

Emitted when a background task starts. A background task is anything tracked outside the main turn: a backgrounded Bash command, a [Monitor](#monitor) watch, a subagent spawned via the Agent tool, or a remote agent. The `task_type` field tells you which. This naming is unrelated to the `Task`-to-`Agent` tool rename.

```python theme={null}
@dataclass
class TaskStartedMessage(SystemMessage):
    task_id: str
    description: str
    uuid: str
    session_id: str
    tool_use_id: str | None = None
    task_type: str | None = None
```

| Field         | Type          | Description                                                                                                                 |
| :------------ | :------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| `task_id`     | `str`         | Unique identifier for the task                                                                                              |
| `description` | `str`         | Description of the task                                                                                                     |
| `uuid`        | `str`         | Unique message identifier                                                                                                   |
| `session_id`  | `str`         | Session identifier                                                                                                          |
| `tool_use_id` | `str \| None` | Associated tool use ID                                                                                                      |
| `task_type`   | `str \| None` | Which kind of background task: `"local_bash"` for background Bash and Monitor watches, `"local_agent"`, or `"remote_agent"` |

### `TaskUsage`

Token and timing data for a background task.

```python theme={null}
class TaskUsage(TypedDict):
    total_tokens: int
    tool_uses: int
    duration_ms: int
```

### `TaskProgressMessage`

Emitted periodically with progress updates for a running background task.

```python theme={null}
@dataclass
class TaskProgressMessage(SystemMessage):
    task_id: str
    description: str
    usage: TaskUsage
    uuid: str
    session_id: str
    tool_use_id: str | None = None
    last_tool_name: str | None = None
```

| Field            | Type          | Description                         |
| :--------------- | :------------ | :---------------------------------- |
| `task_id`        | `str`         | Unique identifier for the task      |
| `description`    | `str`         | Current status description          |
| `usage`          | `TaskUsage`   | Token usage for this task so far    |
| `uuid`           | `str`         | Unique message identifier           |
| `session_id`     | `str`         | Session identifier                  |
| `tool_use_id`    | `str \| None` | Associated tool use ID              |
| `last_tool_name` | `str \| None` | Name of the last tool the task used |

### `TaskNotificationMessage`

Emitted when a background task completes, fails, or is stopped. Background tasks include `run_in_background` Bash commands, Monitor watches, and background subagents.

```python theme={null}
@dataclass
class TaskNotificationMessage(SystemMessage):
    task_id: str
    status: TaskNotificationStatus  # "completed" | "failed" | "stopped"
    output_file: str
    summary: str
    uuid: str
    session_id: str
    tool_use_id: str | None = None
    usage: TaskUsage | None = None
```

| Field         | Type                     | Description                                      |
| :------------ | :----------------------- | :----------------------------------------------- |
| `task_id`     | `str`                    | Unique identifier for the task                   |
| `status`      | `TaskNotificationStatus` | One of `"completed"`, `"failed"`, or `"stopped"` |
| `output_file` | `str`                    | Path to the task output file                     |
| `summary`     | `str`                    | Summary of the task result                       |
| `uuid`        | `str`                    | Unique message identifier                        |
| `session_id`  | `str`                    | Session identifier                               |
| `tool_use_id` | `str \| None`            | Associated tool use ID                           |
| `usage`       | `TaskUsage \| None`      | Final token usage for the task                   |

## Content Block Types

### `ContentBlock`

Union type of all content blocks.

```python theme={null}
ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock
```

### `TextBlock`

Text content block.

```python theme={null}
@dataclass
class TextBlock:
    text: str
```

### `ThinkingBlock`

Thinking content block (for models with thinking capability).

```python theme={null}
@dataclass
class ThinkingBlock:
    thinking: str
    signature: str
```

### `ToolUseBlock`

Tool use request block.

```python theme={null}
@dataclass
class ToolUseBlock:
    id: str
    name: str
    input: dict[str, Any]
```

### `ToolResultBlock`

Tool execution result block.

```python theme={null}
@dataclass
class ToolResultBlock:
    tool_use_id: str
    content: str | list[dict[str, Any]] | None = None
    is_error: bool | None = None
```

## Error Types

### `ClaudeSDKError`

Base exception class for all SDK errors.

```python theme={null}
class ClaudeSDKError(Exception):
    """Base error for Claude SDK."""
```

### `CLINotFoundError`

Raised when Claude Code CLI is not installed or not found.

```python theme={null}
class CLINotFoundError(CLIConnectionError):
    def __init__(
        self, message: str = "Claude Code not found", cli_path: str | None = None
    ):
        """
        Args:
            message: Error message (default: "Claude Code not found")
            cli_path: Optional path to the CLI that was not found
        """
```

### `CLIConnectionError`

Raised when connection to Claude Code fails.

```python theme={null}
class CLIConnectionError(ClaudeSDKError):
    """Failed to connect to Claude Code."""
```

### `ProcessError`

Raised when the Claude Code process fails.

```python theme={null}
class ProcessError(ClaudeSDKError):
    def __init__(
        self, message: str, exit_code: int | None = None, stderr: str | None = None
    ):
        self.exit_code = exit_code
        self.stderr = stderr
```

### `CLIJSONDecodeError`

Raised when JSON parsing fails.

```python theme={null}
class CLIJSONDecodeError(ClaudeSDKError):
    def __init__(self, line: str, original_error: Exception):
        """
        Args:
            line: The line that failed to parse
            original_error: The original JSON decode exception
        """
        self.line = line
        self.original_error = original_error
```

