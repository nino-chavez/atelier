# python (part 3 of 7)

## Types

<Note>
  **`@dataclass` vs `TypedDict`:** This SDK uses two kinds of types. Classes decorated with `@dataclass` (such as `ResultMessage`, `AgentDefinition`, `TextBlock`) are object instances at runtime and support attribute access: `msg.result`. Classes defined with `TypedDict` (such as `ThinkingConfigEnabled`, `McpStdioServerConfig`, `SyncHookJSONOutput`) are **plain dicts at runtime** and require key access: `config["budget_tokens"]`, not `config.budget_tokens`. The `ClassName(field=value)` call syntax works for both, but only dataclasses produce objects with attributes.
</Note>

### `SdkMcpTool`

Definition for an SDK MCP tool created with the `@tool` decorator.

```python theme={null}
@dataclass
class SdkMcpTool(Generic[T]):
    name: str
    description: str
    input_schema: type[T] | dict[str, Any]
    handler: Callable[[T], Awaitable[dict[str, Any]]]
    annotations: ToolAnnotations | None = None
```

| Property       | Type                                       | Description                                                                                                |
| :------------- | :----------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `name`         | `str`                                      | Unique identifier for the tool                                                                             |
| `description`  | `str`                                      | Human-readable description                                                                                 |
| `input_schema` | `type[T] \| dict[str, Any]`                | Schema for input validation                                                                                |
| `handler`      | `Callable[[T], Awaitable[dict[str, Any]]]` | Async function that handles tool execution                                                                 |
| `annotations`  | `ToolAnnotations \| None`                  | Optional MCP tool annotations (e.g., `readOnlyHint`, `destructiveHint`, `openWorldHint`). From `mcp.types` |

### `Transport`

Abstract base class for custom transport implementations. Use this to communicate with the Claude process over a custom channel (for example, a remote connection instead of a local subprocess).

<Warning>
  This is a low-level internal API. The interface may change in future releases. Custom implementations must be updated to match any interface changes.
</Warning>

```python theme={null}
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any


class Transport(ABC):
    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def write(self, data: str) -> None: ...

    @abstractmethod
    def read_messages(self) -> AsyncIterator[dict[str, Any]]: ...

    @abstractmethod
    async def close(self) -> None: ...

    @abstractmethod
    def is_ready(self) -> bool: ...

    @abstractmethod
    async def end_input(self) -> None: ...
```

| Method            | Description                                                                 |
| :---------------- | :-------------------------------------------------------------------------- |
| `connect()`       | Connect the transport and prepare for communication                         |
| `write(data)`     | Write raw data (JSON + newline) to the transport                            |
| `read_messages()` | Async iterator that yields parsed JSON messages                             |
| `close()`         | Close the connection and clean up resources                                 |
| `is_ready()`      | Returns `True` if the transport can send and receive                        |
| `end_input()`     | Close the input stream (for example, close stdin for subprocess transports) |

Import: `from claude_agent_sdk import Transport`

### `ClaudeAgentOptions`

Configuration dataclass for Claude Code queries.

```python theme={null}
@dataclass
class ClaudeAgentOptions:
    tools: list[str] | ToolsPreset | None = None
    allowed_tools: list[str] = field(default_factory=list)
    system_prompt: str | SystemPromptPreset | None = None
    mcp_servers: dict[str, McpServerConfig] | str | Path = field(default_factory=dict)
    permission_mode: PermissionMode | None = None
    continue_conversation: bool = False
    resume: str | None = None
    max_turns: int | None = None
    max_budget_usd: float | None = None
    disallowed_tools: list[str] = field(default_factory=list)
    model: str | None = None
    fallback_model: str | None = None
    betas: list[SdkBeta] = field(default_factory=list)
    output_format: dict[str, Any] | None = None
    permission_prompt_tool_name: str | None = None
    cwd: str | Path | None = None
    cli_path: str | Path | None = None
    settings: str | None = None
    add_dirs: list[str | Path] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    extra_args: dict[str, str | None] = field(default_factory=dict)
    max_buffer_size: int | None = None
    debug_stderr: Any = sys.stderr  # Deprecated
    stderr: Callable[[str], None] | None = None
    can_use_tool: CanUseTool | None = None
    hooks: dict[HookEvent, list[HookMatcher]] | None = None
    user: str | None = None
    include_partial_messages: bool = False
    fork_session: bool = False
    agents: dict[str, AgentDefinition] | None = None
    setting_sources: list[SettingSource] | None = None
    sandbox: SandboxSettings | None = None
    plugins: list[SdkPluginConfig] = field(default_factory=list)
    max_thinking_tokens: int | None = None  # Deprecated: use thinking instead
    thinking: ThinkingConfig | None = None
    effort: Literal["low", "medium", "high", "max"] | None = None
    enable_file_checkpointing: bool = False
    session_store: SessionStore | None = None
```

| Property                      | Type                                                                                   | Default                            | Description                                                                                                                                                                                                                                                               |
| :---------------------------- | :------------------------------------------------------------------------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tools`                       | `list[str] \| ToolsPreset \| None`                                                     | `None`                             | Tools configuration. Use `{"type": "preset", "preset": "claude_code"}` for Claude Code's default tools                                                                                                                                                                    |
| `allowed_tools`               | `list[str]`                                                                            | `[]`                               | Tools to auto-approve without prompting. This does not restrict Claude to only these tools; unlisted tools fall through to `permission_mode` and `can_use_tool`. Use `disallowed_tools` to block tools. See [Permissions](/en/agent-sdk/permissions#allow-and-deny-rules) |
| `system_prompt`               | `str \| SystemPromptPreset \| None`                                                    | `None`                             | System prompt configuration. Pass a string for custom prompt, or use `{"type": "preset", "preset": "claude_code"}` for Claude Code's system prompt. Add `"append"` to extend the preset                                                                                   |
| `mcp_servers`                 | `dict[str, McpServerConfig] \| str \| Path`                                            | `{}`                               | MCP server configurations or path to config file                                                                                                                                                                                                                          |
| `permission_mode`             | `PermissionMode \| None`                                                               | `None`                             | Permission mode for tool usage                                                                                                                                                                                                                                            |
| `continue_conversation`       | `bool`                                                                                 | `False`                            | Continue the most recent conversation                                                                                                                                                                                                                                     |
| `resume`                      | `str \| None`                                                                          | `None`                             | Session ID to resume                                                                                                                                                                                                                                                      |
| `max_turns`                   | `int \| None`                                                                          | `None`                             | Maximum agentic turns (tool-use round trips)                                                                                                                                                                                                                              |
| `max_budget_usd`              | `float \| None`                                                                        | `None`                             | Stop the query when the client-side cost estimate reaches this USD value. Compared against the same estimate as `total_cost_usd`; see [Track cost and usage](/en/agent-sdk/cost-tracking) for accuracy caveats                                                            |
| `disallowed_tools`            | `list[str]`                                                                            | `[]`                               | Tools to always deny. Deny rules are checked first and override `allowed_tools` and `permission_mode` (including `bypassPermissions`)                                                                                                                                     |
| `enable_file_checkpointing`   | `bool`                                                                                 | `False`                            | Enable file change tracking for rewinding. See [File checkpointing](/en/agent-sdk/file-checkpointing)                                                                                                                                                                     |
| `model`                       | `str \| None`                                                                          | `None`                             | Claude model to use                                                                                                                                                                                                                                                       |
| `fallback_model`              | `str \| None`                                                                          | `None`                             | Fallback model to use if the primary model fails                                                                                                                                                                                                                          |
| `betas`                       | `list[SdkBeta]`                                                                        | `[]`                               | Beta features to enable. See [`SdkBeta`](#sdk-beta) for available options                                                                                                                                                                                                 |
| `output_format`               | `dict[str, Any] \| None`                                                               | `None`                             | Output format for structured responses (e.g., `{"type": "json_schema", "schema": {...}}`). See [Structured outputs](/en/agent-sdk/structured-outputs) for details                                                                                                         |
| `permission_prompt_tool_name` | `str \| None`                                                                          | `None`                             | MCP tool name for permission prompts                                                                                                                                                                                                                                      |
| `cwd`                         | `str \| Path \| None`                                                                  | `None`                             | Current working directory                                                                                                                                                                                                                                                 |
| `cli_path`                    | `str \| Path \| None`                                                                  | `None`                             | Custom path to the Claude Code CLI executable                                                                                                                                                                                                                             |
| `settings`                    | `str \| None`                                                                          | `None`                             | Path to settings file                                                                                                                                                                                                                                                     |
| `add_dirs`                    | `list[str \| Path]`                                                                    | `[]`                               | Additional directories Claude can access                                                                                                                                                                                                                                  |
| `env`                         | `dict[str, str]`                                                                       | `{}`                               | Environment variables merged on top of the inherited process environment. See [Environment variables](/en/env-vars) for variables the underlying CLI reads                                                                                                                |
| `extra_args`                  | `dict[str, str \| None]`                                                               | `{}`                               | Additional CLI arguments to pass directly to the CLI                                                                                                                                                                                                                      |
| `max_buffer_size`             | `int \| None`                                                                          | `None`                             | Maximum bytes when buffering CLI stdout                                                                                                                                                                                                                                   |
| `debug_stderr`                | `Any`                                                                                  | `sys.stderr`                       | *Deprecated* - File-like object for debug output. Use `stderr` callback instead                                                                                                                                                                                           |
| `stderr`                      | `Callable[[str], None] \| None`                                                        | `None`                             | Callback function for stderr output from CLI                                                                                                                                                                                                                              |
| `can_use_tool`                | [`CanUseTool`](#can-use-tool) ` \| None`                                               | `None`                             | Tool permission callback function. See [Permission types](#can-use-tool) for details                                                                                                                                                                                      |
| `hooks`                       | `dict[HookEvent, list[HookMatcher]] \| None`                                           | `None`                             | Hook configurations for intercepting events                                                                                                                                                                                                                               |
| `user`                        | `str \| None`                                                                          | `None`                             | User identifier                                                                                                                                                                                                                                                           |
| `include_partial_messages`    | `bool`                                                                                 | `False`                            | Include partial message streaming events. When enabled, [`StreamEvent`](#stream-event) messages are yielded                                                                                                                                                               |
| `fork_session`                | `bool`                                                                                 | `False`                            | When resuming with `resume`, fork to a new session ID instead of continuing the original session                                                                                                                                                                          |
| `agents`                      | `dict[str, AgentDefinition] \| None`                                                   | `None`                             | Programmatically defined subagents                                                                                                                                                                                                                                        |
| `plugins`                     | `list[SdkPluginConfig]`                                                                | `[]`                               | Load custom plugins from local paths. See [Plugins](/en/agent-sdk/plugins) for details                                                                                                                                                                                    |
| `sandbox`                     | [`SandboxSettings`](#sandbox-settings) ` \| None`                                      | `None`                             | Configure sandbox behavior programmatically. See [Sandbox settings](#sandbox-settings) for details                                                                                                                                                                        |
| `setting_sources`             | `list[SettingSource] \| None`                                                          | `None` (CLI defaults: all sources) | Control which filesystem settings to load. Pass `[]` to disable user, project, and local settings. Managed policy settings load regardless. See [Use Claude Code features](/en/agent-sdk/claude-code-features#what-settingsources-does-not-control)                       |
| `max_thinking_tokens`         | `int \| None`                                                                          | `None`                             | *Deprecated* - Maximum tokens for thinking blocks. Use `thinking` instead                                                                                                                                                                                                 |
| `thinking`                    | [`ThinkingConfig`](#thinking-config) ` \| None`                                        | `None`                             | Controls extended thinking behavior. Takes precedence over `max_thinking_tokens`                                                                                                                                                                                          |
| `effort`                      | `Literal["low", "medium", "high", "max"] \| None`                                      | `None`                             | Effort level for thinking depth                                                                                                                                                                                                                                           |
| `session_store`               | [`SessionStore`](/en/agent-sdk/session-storage#the-session-store-interface) ` \| None` | `None`                             | Mirror session transcripts to an external backend so any host can resume them. See [Persist sessions to external storage](/en/agent-sdk/session-storage)                                                                                                                  |

### `OutputFormat`

Configuration for structured output validation. Pass this as a `dict` to the `output_format` field on `ClaudeAgentOptions`:

```python theme={null}
# Expected dict shape for output_format
{
    "type": "json_schema",
    "schema": {...},  # Your JSON Schema definition
}
```

| Field    | Required | Description                                        |
| :------- | :------- | :------------------------------------------------- |
| `type`   | Yes      | Must be `"json_schema"` for JSON Schema validation |
| `schema` | Yes      | JSON Schema definition for output validation       |

### `SystemPromptPreset`

Configuration for using Claude Code's preset system prompt with optional additions.

```python theme={null}
class SystemPromptPreset(TypedDict):
    type: Literal["preset"]
    preset: Literal["claude_code"]
    append: NotRequired[str]
    exclude_dynamic_sections: NotRequired[bool]
```

| Field                      | Required | Description                                                                                                                                                                                                                                                                                                      |
| :------------------------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                     | Yes      | Must be `"preset"` to use a preset system prompt                                                                                                                                                                                                                                                                 |
| `preset`                   | Yes      | Must be `"claude_code"` to use Claude Code's system prompt                                                                                                                                                                                                                                                       |
| `append`                   | No       | Additional instructions to append to the preset system prompt                                                                                                                                                                                                                                                    |
| `exclude_dynamic_sections` | No       | Move per-session context such as working directory, git status, and memory paths from the system prompt into the first user message. Improves prompt-cache reuse across users and machines. See [Modify system prompts](/en/agent-sdk/modifying-system-prompts#improve-prompt-caching-across-users-and-machines) |

