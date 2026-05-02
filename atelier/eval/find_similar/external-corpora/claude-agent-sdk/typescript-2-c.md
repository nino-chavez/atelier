### `Query` object

Interface returned by the `query()` function.

```typescript theme={null}
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>;
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean }
  ): Promise<RewindFilesResult>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  initializationResult(): Promise<SDKControlInitializeResponse>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  supportedAgents(): Promise<AgentInfo[]>;
  mcpServerStatus(): Promise<McpServerStatus[]>;
  accountInfo(): Promise<AccountInfo>;
  reconnectMcpServer(serverName: string): Promise<void>;
  toggleMcpServer(serverName: string, enabled: boolean): Promise<void>;
  setMcpServers(servers: Record<string, McpServerConfig>): Promise<McpSetServersResult>;
  streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  close(): void;
}
```

#### Methods

| Method                                 | Description                                                                                                                                                                                                   |
| :------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `interrupt()`                          | Interrupts the query (only available in streaming input mode)                                                                                                                                                 |
| `rewindFiles(userMessageId, options?)` | Restores files to their state at the specified user message. Pass `{ dryRun: true }` to preview changes. Requires `enableFileCheckpointing: true`. See [File checkpointing](/en/agent-sdk/file-checkpointing) |
| `setPermissionMode()`                  | Changes the permission mode (only available in streaming input mode)                                                                                                                                          |
| `setModel()`                           | Changes the model (only available in streaming input mode)                                                                                                                                                    |
| `setMaxThinkingTokens()`               | *Deprecated:* Use the `thinking` option instead. Changes the maximum thinking tokens                                                                                                                          |
| `initializationResult()`               | Returns the full initialization result including supported commands, models, account info, and output style configuration                                                                                     |
| `supportedCommands()`                  | Returns available slash commands                                                                                                                                                                              |
| `supportedModels()`                    | Returns available models with display info                                                                                                                                                                    |
| `supportedAgents()`                    | Returns available subagents as [`AgentInfo`](#agent-info)`[]`                                                                                                                                                 |
| `mcpServerStatus()`                    | Returns status of connected MCP servers                                                                                                                                                                       |
| `accountInfo()`                        | Returns account information                                                                                                                                                                                   |
| `reconnectMcpServer(serverName)`       | Reconnect an MCP server by name                                                                                                                                                                               |
| `toggleMcpServer(serverName, enabled)` | Enable or disable an MCP server by name                                                                                                                                                                       |
| `setMcpServers(servers)`               | Dynamically replace the set of MCP servers for this session. Returns info about which servers were added, removed, and any errors                                                                             |
| `streamInput(stream)`                  | Stream input messages to the query for multi-turn conversations                                                                                                                                               |
| `stopTask(taskId)`                     | Stop a running background task by ID                                                                                                                                                                          |
| `close()`                              | Close the query and terminate the underlying process. Forcefully ends the query and cleans up all resources                                                                                                   |

### `WarmQuery`

Handle returned by [`startup()`](#startup). The subprocess is already spawned and initialized, so calling `query()` on this handle writes the prompt directly to a ready process with no startup latency.

```typescript theme={null}
interface WarmQuery extends AsyncDisposable {
  query(prompt: string | AsyncIterable<SDKUserMessage>): Query;
  close(): void;
}
```

#### Methods

| Method          | Description                                                                                                               |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `query(prompt)` | Send a prompt to the pre-warmed subprocess and return a [`Query`](#query-object). Can only be called once per `WarmQuery` |
| `close()`       | Close the subprocess without sending a prompt. Use this to discard a warm query that is no longer needed                  |

`WarmQuery` implements `AsyncDisposable`, so it can be used with `await using` for automatic cleanup.

### `SDKControlInitializeResponse`

Return type of `initializationResult()`. Contains session initialization data.

```typescript theme={null}
type SDKControlInitializeResponse = {
  commands: SlashCommand[];
  agents: AgentInfo[];
  output_style: string;
  available_output_styles: string[];
  models: ModelInfo[];
  account: AccountInfo;
  fast_mode_state?: "off" | "cooldown" | "on";
};
```

### `AgentDefinition`

Configuration for a subagent defined programmatically.

```typescript theme={null}
type AgentDefinition = {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  prompt: string;
  model?: string;
  mcpServers?: AgentMcpServerSpec[];
  skills?: string[];
  initialPrompt?: string;
  maxTurns?: number;
  background?: boolean;
  memory?: "user" | "project" | "local";
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | number;
  permissionMode?: PermissionMode;
  criticalSystemReminder_EXPERIMENTAL?: string;
};
```

| Field                                 | Required | Description                                                                                                                                                              |
| :------------------------------------ | :------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`                         | Yes      | Natural language description of when to use this agent                                                                                                                   |
| `tools`                               | No       | Array of allowed tool names. If omitted, inherits all tools from parent                                                                                                  |
| `disallowedTools`                     | No       | Array of tool names to explicitly disallow for this agent                                                                                                                |
| `prompt`                              | Yes      | The agent's system prompt                                                                                                                                                |
| `model`                               | No       | Model override for this agent. Accepts an alias such as `'sonnet'`, `'opus'`, `'haiku'`, `'inherit'`, or a full model ID. If omitted or `'inherit'`, uses the main model |
| `mcpServers`                          | No       | MCP server specifications for this agent                                                                                                                                 |
| `skills`                              | No       | Array of skill names to preload into the agent context                                                                                                                   |
| `initialPrompt`                       | No       | Auto-submitted as the first user turn when this agent runs as the main thread agent                                                                                      |
| `maxTurns`                            | No       | Maximum number of agentic turns (API round-trips) before stopping                                                                                                        |
| `background`                          | No       | Run this agent as a non-blocking background task when invoked                                                                                                            |
| `memory`                              | No       | Memory source for this agent: `'user'`, `'project'`, or `'local'`                                                                                                        |
| `effort`                              | No       | Reasoning effort level for this agent. Accepts a named level or an integer                                                                                               |
| `permissionMode`                      | No       | Permission mode for tool execution within this agent. See [`PermissionMode`](#permission-mode)                                                                           |
| `criticalSystemReminder_EXPERIMENTAL` | No       | Experimental: Critical reminder added to the system prompt                                                                                                               |

### `AgentMcpServerSpec`

Specifies MCP servers available to a subagent. Can be a server name (string referencing a server from the parent's `mcpServers` config) or an inline server configuration record mapping server names to configs.

```typescript theme={null}
type AgentMcpServerSpec = string | Record<string, McpServerConfigForProcessTransport>;
```

Where `McpServerConfigForProcessTransport` is `McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig`.

### `SettingSource`

Controls which filesystem-based configuration sources the SDK loads settings from.

```typescript theme={null}
type SettingSource = "user" | "project" | "local";
```

| Value       | Description                                  | Location                      |
| :---------- | :------------------------------------------- | :---------------------------- |
| `'user'`    | Global user settings                         | `~/.claude/settings.json`     |
| `'project'` | Shared project settings (version controlled) | `.claude/settings.json`       |
| `'local'`   | Local project settings (gitignored)          | `.claude/settings.local.json` |

#### Default behavior

When `settingSources` is omitted or `undefined`, `query()` loads the same filesystem settings as the Claude Code CLI: user, project, and local. Managed policy settings are loaded in all cases. See [What settingSources does not control](/en/agent-sdk/claude-code-features#what-settingsources-does-not-control) for inputs that are read regardless of this option, and how to disable them.

#### Why use settingSources

**Disable filesystem settings:**

```typescript theme={null}
// Do not load user, project, or local settings from disk
const result = query({
  prompt: "Analyze this code",
  options: { settingSources: [] }
});
```

**Load all filesystem settings explicitly:**

```typescript theme={null}
const result = query({
  prompt: "Analyze this code",
  options: {
    settingSources: ["user", "project", "local"] // Load all settings
  }
});
```

**Load only specific setting sources:**

```typescript theme={null}
// Load only project settings, ignore user and local
const result = query({
  prompt: "Run CI checks",
  options: {
    settingSources: ["project"] // Only .claude/settings.json
  }
});
```

**Testing and CI environments:**

```typescript theme={null}
// Ensure consistent behavior in CI by excluding local settings
const result = query({
  prompt: "Run tests",
  options: {
    settingSources: ["project"], // Only team-shared settings
    permissionMode: "bypassPermissions"
  }
});
```

**SDK-only applications:**

```typescript theme={null}
// Define everything programmatically.
// Pass [] to opt out of filesystem setting sources.
const result = query({
  prompt: "Review this PR",
  options: {
    settingSources: [],
    agents: {
      /* ... */
    },
    mcpServers: {
      /* ... */
    },
    allowedTools: ["Read", "Grep", "Glob"]
  }
});
```

**Loading CLAUDE.md project instructions:**

```typescript theme={null}
// Load project settings to include CLAUDE.md files
const result = query({
  prompt: "Add a new feature following project conventions",
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code" // Use Claude Code's system prompt
    },
    settingSources: ["project"], // Loads CLAUDE.md from project directory
    allowedTools: ["Read", "Write", "Edit"]
  }
});
```

#### Settings precedence

When multiple sources are loaded, settings are merged with this precedence (highest to lowest):

1. Local settings (`.claude/settings.local.json`)
2. Project settings (`.claude/settings.json`)
3. User settings (`~/.claude/settings.json`)

Programmatic options such as `agents` and `allowedTools` override user, project, and local filesystem settings. Managed policy settings take precedence over programmatic options.

### `PermissionMode`

```typescript theme={null}
type PermissionMode =
  | "default" // Standard permission behavior
  | "acceptEdits" // Auto-accept file edits
  | "bypassPermissions" // Bypass all permission checks
  | "plan" // Planning mode - no execution
  | "dontAsk" // Don't prompt for permissions, deny if not pre-approved
  | "auto"; // Use a model classifier to approve or deny each tool call
```

### `CanUseTool`

Custom permission function type for controlling tool usage.

```typescript theme={null}
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: PermissionUpdate[];
    blockedPath?: string;
    decisionReason?: string;
    toolUseID: string;
    agentID?: string;
  }
) => Promise<PermissionResult>;
```

| Option           | Type                                         | Description                                                                  |
| :--------------- | :------------------------------------------- | :--------------------------------------------------------------------------- |
| `signal`         | `AbortSignal`                                | Signaled if the operation should be aborted                                  |
| `suggestions`    | [`PermissionUpdate`](#permission-update)`[]` | Suggested permission updates so the user is not prompted again for this tool |
| `blockedPath`    | `string`                                     | The file path that triggered the permission request, if applicable           |
| `decisionReason` | `string`                                     | Explains why this permission request was triggered                           |
| `toolUseID`      | `string`                                     | Unique identifier for this specific tool call within the assistant message   |
| `agentID`        | `string`                                     | If running within a sub-agent, the sub-agent's ID                            |

### `PermissionResult`

Result of a permission check.

```typescript theme={null}
type PermissionResult =
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
    }
  | {
      behavior: "deny";
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };
```

### `ToolConfig`

Configuration for built-in tool behavior.

```typescript theme={null}
type ToolConfig = {
  askUserQuestion?: {
    previewFormat?: "markdown" | "html";
  };
};
```

| Field                           | Type                   | Description                                                                                                                                                                   |
| :------------------------------ | :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `askUserQuestion.previewFormat` | `'markdown' \| 'html'` | Opts into the `preview` field on [`AskUserQuestion`](/en/agent-sdk/user-input#question-format) options and sets its content format. When unset, Claude does not emit previews |

### `McpServerConfig`

Configuration for MCP servers.

```typescript theme={null}
type McpServerConfig =
  | McpStdioServerConfig
  | McpSSEServerConfig
  | McpHttpServerConfig
  | McpSdkServerConfigWithInstance;
```

#### `McpStdioServerConfig`

```typescript theme={null}
type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};
```

#### `McpSSEServerConfig`

```typescript theme={null}
type McpSSEServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};
```

#### `McpHttpServerConfig`

```typescript theme={null}
type McpHttpServerConfig = {
  type: "http";
  url: string;
  headers?: Record<string, string>;
};
```

#### `McpSdkServerConfigWithInstance`

```typescript theme={null}
type McpSdkServerConfigWithInstance = {
  type: "sdk";
  name: string;
  instance: McpServer;
};
```

#### `McpClaudeAIProxyServerConfig`

```typescript theme={null}
type McpClaudeAIProxyServerConfig = {
  type: "claudeai-proxy";
  url: string;
  id: string;
};
```

### `SdkPluginConfig`

Configuration for loading plugins in the SDK.

```typescript theme={null}
type SdkPluginConfig = {
  type: "local";
  path: string;
};
```

| Field  | Type      | Description                                                |
| :----- | :-------- | :--------------------------------------------------------- |
| `type` | `'local'` | Must be `'local'` (only local plugins currently supported) |
| `path` | `string`  | Absolute or relative path to the plugin directory          |

**Example:**

```typescript theme={null}
plugins: [
  { type: "local", path: "./my-plugin" },
  { type: "local", path: "/absolute/path/to/plugin" }
];
```

For complete information on creating and using plugins, see [Plugins](/en/agent-sdk/plugins).

