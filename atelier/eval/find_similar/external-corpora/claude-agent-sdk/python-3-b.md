### `SettingSource`

Controls which filesystem-based configuration sources the SDK loads settings from.

```python theme={null}
SettingSource = Literal["user", "project", "local"]
```

| Value       | Description                                  | Location                      |
| :---------- | :------------------------------------------- | :---------------------------- |
| `"user"`    | Global user settings                         | `~/.claude/settings.json`     |
| `"project"` | Shared project settings (version controlled) | `.claude/settings.json`       |
| `"local"`   | Local project settings (gitignored)          | `.claude/settings.local.json` |

#### Default behavior

When `setting_sources` is omitted or `None`, `query()` loads the same filesystem settings as the Claude Code CLI: user, project, and local. Managed policy settings are loaded in all cases. See [What settingSources does not control](/en/agent-sdk/claude-code-features#what-settingsources-does-not-control) for inputs that are read regardless of this option, and how to disable them.

#### Why use setting\_sources

**Disable filesystem settings:**

```python theme={null}
# Do not load user, project, or local settings from disk
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Analyze this code",
    options=ClaudeAgentOptions(
        setting_sources=[]
    ),
):
    print(message)
```

<Note>
  In Python SDK 0.1.59 and earlier, an empty list was treated the same as omitting the option, so `setting_sources=[]` did not disable filesystem settings. Upgrade to a newer release if you need an empty list to take effect. The TypeScript SDK is not affected.
</Note>

**Load all filesystem settings explicitly:**

```python theme={null}
from claude_agent_sdk import query, ClaudeAgentOptions

async for message in query(
    prompt="Analyze this code",
    options=ClaudeAgentOptions(
        setting_sources=["user", "project", "local"]
    ),
):
    print(message)
```

**Load only specific setting sources:**

```python theme={null}
# Load only project settings, ignore user and local
async for message in query(
    prompt="Run CI checks",
    options=ClaudeAgentOptions(
        setting_sources=["project"]  # Only .claude/settings.json
    ),
):
    print(message)
```

**Testing and CI environments:**

```python theme={null}
# Ensure consistent behavior in CI by excluding local settings
async for message in query(
    prompt="Run tests",
    options=ClaudeAgentOptions(
        setting_sources=["project"],  # Only team-shared settings
        permission_mode="bypassPermissions",
    ),
):
    print(message)
```

**SDK-only applications:**

```python theme={null}
# Define everything programmatically.
# Pass [] to opt out of filesystem setting sources.
async for message in query(
    prompt="Review this PR",
    options=ClaudeAgentOptions(
        setting_sources=[],
        agents={...},
        mcp_servers={...},
        allowed_tools=["Read", "Grep", "Glob"],
    ),
):
    print(message)
```

**Loading CLAUDE.md project instructions:**

```python theme={null}
# Load project settings to include CLAUDE.md files
async for message in query(
    prompt="Add a new feature following project conventions",
    options=ClaudeAgentOptions(
        system_prompt={
            "type": "preset",
            "preset": "claude_code",  # Use Claude Code's system prompt
        },
        setting_sources=["project"],  # Loads CLAUDE.md from project
        allowed_tools=["Read", "Write", "Edit"],
    ),
):
    print(message)
```

#### Settings precedence

When multiple sources are loaded, settings are merged with this precedence (highest to lowest):

1. Local settings (`.claude/settings.local.json`)
2. Project settings (`.claude/settings.json`)
3. User settings (`~/.claude/settings.json`)

Programmatic options such as `agents` and `allowed_tools` override user, project, and local filesystem settings. Managed policy settings take precedence over programmatic options.

### `AgentDefinition`

Configuration for a subagent defined programmatically.

```python theme={null}
@dataclass
class AgentDefinition:
    description: str
    prompt: str
    tools: list[str] | None = None
    disallowedTools: list[str] | None = None
    model: str | None = None
    skills: list[str] | None = None
    memory: Literal["user", "project", "local"] | None = None
    mcpServers: list[str | dict[str, Any]] | None = None
    initialPrompt: str | None = None
    maxTurns: int | None = None
    background: bool | None = None
    effort: Literal["low", "medium", "high", "max"] | int | None = None
    permissionMode: PermissionMode | None = None
```

| Field             | Required | Description                                                                                                                                                  |
| :---------------- | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`     | Yes      | Natural language description of when to use this agent                                                                                                       |
| `prompt`          | Yes      | The agent's system prompt                                                                                                                                    |
| `tools`           | No       | Array of allowed tool names. If omitted, inherits all tools                                                                                                  |
| `disallowedTools` | No       | Array of tool names to remove from the agent's tool set                                                                                                      |
| `model`           | No       | Model override for this agent. Accepts an alias such as `"sonnet"`, `"opus"`, `"haiku"`, or `"inherit"`, or a full model ID. If omitted, uses the main model |
| `skills`          | No       | List of skill names available to this agent                                                                                                                  |
| `memory`          | No       | Memory source for this agent: `"user"`, `"project"`, or `"local"`                                                                                            |
| `mcpServers`      | No       | MCP servers available to this agent. Each entry is a server name or an inline `{name: config}` dict                                                          |
| `initialPrompt`   | No       | Auto-submitted as the first user turn when this agent runs as the main thread agent                                                                          |
| `maxTurns`        | No       | Maximum number of agentic turns before the agent stops                                                                                                       |
| `background`      | No       | Run this agent as a non-blocking background task when invoked                                                                                                |
| `effort`          | No       | Reasoning effort level for this agent. Accepts a named level or an integer                                                                                   |
| `permissionMode`  | No       | Permission mode for tool execution within this agent. See [`PermissionMode`](#permission-mode)                                                               |

<Note>
  `AgentDefinition` field names use camelCase, such as `disallowedTools`, `permissionMode`, and `maxTurns`. These names map directly to the wire format shared with the TypeScript SDK. This differs from `ClaudeAgentOptions`, which uses Python snake\_case for the equivalent top-level fields such as `disallowed_tools` and `permission_mode`. Because `AgentDefinition` is a dataclass, passing a snake\_case keyword raises a `TypeError` at construction time.
</Note>

### `PermissionMode`

Permission modes for controlling tool execution.

```python theme={null}
PermissionMode = Literal[
    "default",  # Standard permission behavior
    "acceptEdits",  # Auto-accept file edits
    "plan",  # Planning mode - no execution
    "dontAsk",  # Deny anything not pre-approved instead of prompting
    "bypassPermissions",  # Bypass all permission checks (use with caution)
]
```

### `CanUseTool`

Type alias for tool permission callback functions.

```python theme={null}
CanUseTool = Callable[
    [str, dict[str, Any], ToolPermissionContext], Awaitable[PermissionResult]
]
```

The callback receives:

* `tool_name`: Name of the tool being called
* `input_data`: The tool's input parameters
* `context`: A `ToolPermissionContext` with additional information

Returns a `PermissionResult` (either `PermissionResultAllow` or `PermissionResultDeny`).

### `ToolPermissionContext`

Context information passed to tool permission callbacks.

```python theme={null}
@dataclass
class ToolPermissionContext:
    signal: Any | None = None  # Future: abort signal support
    suggestions: list[PermissionUpdate] = field(default_factory=list)
```

| Field         | Type                     | Description                                |
| :------------ | :----------------------- | :----------------------------------------- |
| `signal`      | `Any \| None`            | Reserved for future abort signal support   |
| `suggestions` | `list[PermissionUpdate]` | Permission update suggestions from the CLI |

### `PermissionResult`

Union type for permission callback results.

```python theme={null}
PermissionResult = PermissionResultAllow | PermissionResultDeny
```

### `PermissionResultAllow`

Result indicating the tool call should be allowed.

```python theme={null}
@dataclass
class PermissionResultAllow:
    behavior: Literal["allow"] = "allow"
    updated_input: dict[str, Any] | None = None
    updated_permissions: list[PermissionUpdate] | None = None
```

| Field                 | Type                             | Default   | Description                               |
| :-------------------- | :------------------------------- | :-------- | :---------------------------------------- |
| `behavior`            | `Literal["allow"]`               | `"allow"` | Must be "allow"                           |
| `updated_input`       | `dict[str, Any] \| None`         | `None`    | Modified input to use instead of original |
| `updated_permissions` | `list[PermissionUpdate] \| None` | `None`    | Permission updates to apply               |

### `PermissionResultDeny`

Result indicating the tool call should be denied.

```python theme={null}
@dataclass
class PermissionResultDeny:
    behavior: Literal["deny"] = "deny"
    message: str = ""
    interrupt: bool = False
```

| Field       | Type              | Default  | Description                                |
| :---------- | :---------------- | :------- | :----------------------------------------- |
| `behavior`  | `Literal["deny"]` | `"deny"` | Must be "deny"                             |
| `message`   | `str`             | `""`     | Message explaining why the tool was denied |
| `interrupt` | `bool`            | `False`  | Whether to interrupt the current execution |

### `PermissionUpdate`

Configuration for updating permissions programmatically.

```python theme={null}
@dataclass
class PermissionUpdate:
    type: Literal[
        "addRules",
        "replaceRules",
        "removeRules",
        "setMode",
        "addDirectories",
        "removeDirectories",
    ]
    rules: list[PermissionRuleValue] | None = None
    behavior: Literal["allow", "deny", "ask"] | None = None
    mode: PermissionMode | None = None
    directories: list[str] | None = None
    destination: (
        Literal["userSettings", "projectSettings", "localSettings", "session"] | None
    ) = None
```

| Field         | Type                                      | Description                                     |
| :------------ | :---------------------------------------- | :---------------------------------------------- |
| `type`        | `Literal[...]`                            | The type of permission update operation         |
| `rules`       | `list[PermissionRuleValue] \| None`       | Rules for add/replace/remove operations         |
| `behavior`    | `Literal["allow", "deny", "ask"] \| None` | Behavior for rule-based operations              |
| `mode`        | `PermissionMode \| None`                  | Mode for setMode operation                      |
| `directories` | `list[str] \| None`                       | Directories for add/remove directory operations |
| `destination` | `Literal[...] \| None`                    | Where to apply the permission update            |

### `PermissionRuleValue`

A rule to add, replace, or remove in a permission update.

```python theme={null}
@dataclass
class PermissionRuleValue:
    tool_name: str
    rule_content: str | None = None
```

### `ToolsPreset`

Preset tools configuration for using Claude Code's default tool set.

```python theme={null}
class ToolsPreset(TypedDict):
    type: Literal["preset"]
    preset: Literal["claude_code"]
```

### `ThinkingConfig`

Controls extended thinking behavior. A union of three configurations:

```python theme={null}
class ThinkingConfigAdaptive(TypedDict):
    type: Literal["adaptive"]


class ThinkingConfigEnabled(TypedDict):
    type: Literal["enabled"]
    budget_tokens: int


class ThinkingConfigDisabled(TypedDict):
    type: Literal["disabled"]


ThinkingConfig = ThinkingConfigAdaptive | ThinkingConfigEnabled | ThinkingConfigDisabled
```

| Variant    | Fields                  | Description                                  |
| :--------- | :---------------------- | :------------------------------------------- |
| `adaptive` | `type`                  | Claude adaptively decides when to think      |
| `enabled`  | `type`, `budget_tokens` | Enable thinking with a specific token budget |
| `disabled` | `type`                  | Disable thinking                             |

Because these are `TypedDict` classes, they're plain dicts at runtime. Either construct them as dict literals or call the class like a constructor; both produce a `dict`. Access fields with `config["budget_tokens"]`, not `config.budget_tokens`:

```python theme={null}
from claude_agent_sdk import ClaudeAgentOptions, ThinkingConfigEnabled

# Option 1: dict literal (recommended, no import needed)
options = ClaudeAgentOptions(thinking={"type": "enabled", "budget_tokens": 20000})

# Option 2: constructor-style (returns a plain dict)
config = ThinkingConfigEnabled(type="enabled", budget_tokens=20000)
print(config["budget_tokens"])  # 20000
# config.budget_tokens would raise AttributeError
```

### `SdkBeta`

Literal type for SDK beta features.

```python theme={null}
SdkBeta = Literal["context-1m-2025-08-07"]
```

Use with the `betas` field in `ClaudeAgentOptions` to enable beta features.

<Warning>
  The `context-1m-2025-08-07` beta is retired as of April 30, 2026. Passing this header with Claude Sonnet 4.5 or Sonnet 4 has no effect, and requests that exceed the standard 200k-token context window return an error. To use a 1M-token context window, migrate to [Claude Sonnet 4.6, Claude Opus 4.6, or Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/overview), which include 1M context at standard pricing with no beta header required.
</Warning>

### `McpSdkServerConfig`

Configuration for SDK MCP servers created with `create_sdk_mcp_server()`.

```python theme={null}
class McpSdkServerConfig(TypedDict):
    type: Literal["sdk"]
    name: str
    instance: Any  # MCP Server instance
```

### `McpServerConfig`

Union type for MCP server configurations.

```python theme={null}
McpServerConfig = (
    McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig
)
```

#### `McpStdioServerConfig`

```python theme={null}
class McpStdioServerConfig(TypedDict):
    type: NotRequired[Literal["stdio"]]  # Optional for backwards compatibility
    command: str
    args: NotRequired[list[str]]
    env: NotRequired[dict[str, str]]
```

#### `McpSSEServerConfig`

```python theme={null}
class McpSSEServerConfig(TypedDict):
    type: Literal["sse"]
    url: str
    headers: NotRequired[dict[str, str]]
```

#### `McpHttpServerConfig`

```python theme={null}
class McpHttpServerConfig(TypedDict):
    type: Literal["http"]
    url: str
    headers: NotRequired[dict[str, str]]
```

### `McpServerStatusConfig`

The configuration of an MCP server as reported by [`get_mcp_status()`](#methods). This is the union of all [`McpServerConfig`](#mcp-server-config) transport variants plus an output-only `claudeai-proxy` variant for servers proxied through claude.ai.

```python theme={null}
McpServerStatusConfig = (
    McpStdioServerConfig
    | McpSSEServerConfig
    | McpHttpServerConfig
    | McpSdkServerConfigStatus
    | McpClaudeAIProxyServerConfig
)
```

`McpSdkServerConfigStatus` is the serializable form of [`McpSdkServerConfig`](#mcp-sdk-server-config) with only `type` (`"sdk"`) and `name` (`str`) fields; the in-process `instance` is omitted. `McpClaudeAIProxyServerConfig` has `type` (`"claudeai-proxy"`), `url` (`str`), and `id` (`str`) fields.

### `McpStatusResponse`

Response from [`ClaudeSDKClient.get_mcp_status()`](#methods). Wraps the list of server statuses under the `mcpServers` key.

```python theme={null}
class McpStatusResponse(TypedDict):
    mcpServers: list[McpServerStatus]
```

### `McpServerStatus`

Status of a connected MCP server, contained in [`McpStatusResponse`](#mcp-status-response).

```python theme={null}
class McpServerStatus(TypedDict):
    name: str
    status: McpServerConnectionStatus  # "connected" | "failed" | "needs-auth" | "pending" | "disabled"
    serverInfo: NotRequired[McpServerInfo]
    error: NotRequired[str]
    config: NotRequired[McpServerStatusConfig]
    scope: NotRequired[str]
    tools: NotRequired[list[McpToolInfo]]
```

| Field        | Type                                                            | Description                                                                                                                                                                     |
| :----------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`       | `str`                                                           | Server name                                                                                                                                                                     |
| `status`     | `str`                                                           | One of `"connected"`, `"failed"`, `"needs-auth"`, `"pending"`, or `"disabled"`                                                                                                  |
| `serverInfo` | `dict` (optional)                                               | Server name and version (`{"name": str, "version": str}`)                                                                                                                       |
| `error`      | `str` (optional)                                                | Error message if the server failed to connect                                                                                                                                   |
| `config`     | [`McpServerStatusConfig`](#mcp-server-status-config) (optional) | Server configuration. Same shape as [`McpServerConfig`](#mcp-server-config) (stdio, SSE, HTTP, or SDK), plus a `claudeai-proxy` variant for servers connected through claude.ai |
| `scope`      | `str` (optional)                                                | Configuration scope                                                                                                                                                             |
| `tools`      | `list` (optional)                                               | Tools provided by this server, each with `name`, `description`, and `annotations` fields                                                                                        |

### `SdkPluginConfig`

Configuration for loading plugins in the SDK.

```python theme={null}
class SdkPluginConfig(TypedDict):
    type: Literal["local"]
    path: str
```

| Field  | Type               | Description                                                |
| :----- | :----------------- | :--------------------------------------------------------- |
| `type` | `Literal["local"]` | Must be `"local"` (only local plugins currently supported) |
| `path` | `str`              | Absolute or relative path to the plugin directory          |

**Example:**

```python theme={null}
plugins = [
    {"type": "local", "path": "./my-plugin"},
    {"type": "local", "path": "/absolute/path/to/plugin"},
]
```

For complete information on creating and using plugins, see [Plugins](/en/agent-sdk/plugins).

