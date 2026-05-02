# typescript (part 1 of 5)

# Agent SDK reference - TypeScript

> Complete API reference for the TypeScript Agent SDK, including all functions, types, and interfaces.

<script src="/components/typescript-sdk-type-links.js" defer />

<Note>
  **Try the new V2 interface (preview):** A simplified interface with `send()` and `stream()` patterns is now available, making multi-turn conversations easier. [Learn more about the TypeScript V2 preview](/en/agent-sdk/typescript-v2-preview)
</Note>

## Installation

```bash theme={null}
npm install @anthropic-ai/claude-agent-sdk
```

<Note>
  The SDK bundles a native Claude Code binary for your platform as an optional dependency such as `@anthropic-ai/claude-agent-sdk-darwin-arm64`. You don't need to install Claude Code separately. If your package manager skips optional dependencies, the SDK throws `Native CLI binary for <platform> not found`; set [`pathToClaudeCodeExecutable`](#options) to a separately installed `claude` binary instead.
</Note>

## Functions

### `query()`

The primary function for interacting with Claude Code. Creates an async generator that streams messages as they arrive.

```typescript theme={null}
function query({
  prompt,
  options
}: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: Options;
}): Query;
```

#### Parameters

| Parameter | Type                                                              | Description                                                       |
| :-------- | :---------------------------------------------------------------- | :---------------------------------------------------------------- |
| `prompt`  | `string \| AsyncIterable<`[`SDKUserMessage`](#sdkuser-message)`>` | The input prompt as a string or async iterable for streaming mode |
| `options` | [`Options`](#options)                                             | Optional configuration object (see Options type below)            |

#### Returns

Returns a [`Query`](#query-object) object that extends `AsyncGenerator<`[`SDKMessage`](#sdk-message)`, void>` with additional methods.

### `startup()`

Pre-warms the CLI subprocess by spawning it and completing the initialize handshake before a prompt is available. The returned [`WarmQuery`](#warm-query) handle accepts a prompt later and writes it to an already-ready process, so the first `query()` call resolves without paying subprocess spawn and initialization cost inline.

```typescript theme={null}
function startup(params?: {
  options?: Options;
  initializeTimeoutMs?: number;
}): Promise<WarmQuery>;
```

#### Parameters

| Parameter             | Type                  | Description                                                                                                                                                                    |
| :-------------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`             | [`Options`](#options) | Optional configuration object. Same as the `options` parameter to `query()`                                                                                                    |
| `initializeTimeoutMs` | `number`              | Maximum time in milliseconds to wait for subprocess initialization. Defaults to `60000`. If initialization does not complete in time, the promise rejects with a timeout error |

#### Returns

Returns a `Promise<`[`WarmQuery`](#warm-query)`>` that resolves once the subprocess has spawned and completed its initialize handshake.

#### Example

Call `startup()` early, for example on application boot, then call `.query()` on the returned handle once a prompt is ready. This moves subprocess spawn and initialization out of the critical path.

```typescript theme={null}
import { startup } from "@anthropic-ai/claude-agent-sdk";

// Pay startup cost upfront
const warm = await startup({ options: { maxTurns: 3 } });

// Later, when a prompt is ready, this is immediate
for await (const message of warm.query("What files are here?")) {
  console.log(message);
}
```

### `tool()`

Creates a type-safe MCP tool definition for use with SDK MCP servers.

```typescript theme={null}
function tool<Schema extends AnyZodRawShape>(
  name: string,
  description: string,
  inputSchema: Schema,
  handler: (args: InferShape<Schema>, extra: unknown) => Promise<CallToolResult>,
  extras?: { annotations?: ToolAnnotations }
): SdkMcpToolDefinition<Schema>;
```

#### Parameters

| Parameter     | Type                                                                | Description                                                                     |
| :------------ | :------------------------------------------------------------------ | :------------------------------------------------------------------------------ |
| `name`        | `string`                                                            | The name of the tool                                                            |
| `description` | `string`                                                            | A description of what the tool does                                             |
| `inputSchema` | `Schema extends AnyZodRawShape`                                     | Zod schema defining the tool's input parameters (supports both Zod 3 and Zod 4) |
| `handler`     | `(args, extra) => Promise<`[`CallToolResult`](#call-tool-result)`>` | Async function that executes the tool logic                                     |
| `extras`      | `{ annotations?: `[`ToolAnnotations`](#tool-annotations)` }`        | Optional MCP tool annotations providing behavioral hints to clients             |

#### `ToolAnnotations`

Re-exported from `@modelcontextprotocol/sdk/types.js`. All fields are optional hints; clients should not rely on them for security decisions.

| Field             | Type      | Default     | Description                                                                                                                                          |
| :---------------- | :-------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | `string`  | `undefined` | Human-readable title for the tool                                                                                                                    |
| `readOnlyHint`    | `boolean` | `false`     | If `true`, the tool does not modify its environment                                                                                                  |
| `destructiveHint` | `boolean` | `true`      | If `true`, the tool may perform destructive updates (only meaningful when `readOnlyHint` is `false`)                                                 |
| `idempotentHint`  | `boolean` | `false`     | If `true`, repeated calls with the same arguments have no additional effect (only meaningful when `readOnlyHint` is `false`)                         |
| `openWorldHint`   | `boolean` | `true`      | If `true`, the tool interacts with external entities (for example, web search). If `false`, the tool's domain is closed (for example, a memory tool) |

```typescript theme={null}
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const searchTool = tool(
  "search",
  "Search the web",
  { query: z.string() },
  async ({ query }) => {
    return { content: [{ type: "text", text: `Results for: ${query}` }] };
  },
  { annotations: { readOnlyHint: true, openWorldHint: true } }
);
```

### `createSdkMcpServer()`

Creates an MCP server instance that runs in the same process as your application.

```typescript theme={null}
function createSdkMcpServer(options: {
  name: string;
  version?: string;
  tools?: Array<SdkMcpToolDefinition<any>>;
}): McpSdkServerConfigWithInstance;
```

#### Parameters

| Parameter         | Type                          | Description                                              |
| :---------------- | :---------------------------- | :------------------------------------------------------- |
| `options.name`    | `string`                      | The name of the MCP server                               |
| `options.version` | `string`                      | Optional version string                                  |
| `options.tools`   | `Array<SdkMcpToolDefinition>` | Array of tool definitions created with [`tool()`](#tool) |

### `listSessions()`

Discovers and lists past sessions with light metadata. Filter by project directory or list sessions across all projects.

```typescript theme={null}
function listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
```

#### Parameters

| Parameter                  | Type      | Default     | Description                                                                        |
| :------------------------- | :-------- | :---------- | :--------------------------------------------------------------------------------- |
| `options.dir`              | `string`  | `undefined` | Directory to list sessions for. When omitted, returns sessions across all projects |
| `options.limit`            | `number`  | `undefined` | Maximum number of sessions to return                                               |
| `options.includeWorktrees` | `boolean` | `true`      | When `dir` is inside a git repository, include sessions from all worktree paths    |

#### Return type: `SDKSessionInfo`

| Property       | Type                  | Description                                                                 |
| :------------- | :-------------------- | :-------------------------------------------------------------------------- |
| `sessionId`    | `string`              | Unique session identifier (UUID)                                            |
| `summary`      | `string`              | Display title: custom title, auto-generated summary, or first prompt        |
| `lastModified` | `number`              | Last modified time in milliseconds since epoch                              |
| `fileSize`     | `number \| undefined` | Session file size in bytes. Only populated for local JSONL storage          |
| `customTitle`  | `string \| undefined` | User-set session title (via `/rename`)                                      |
| `firstPrompt`  | `string \| undefined` | First meaningful user prompt in the session                                 |
| `gitBranch`    | `string \| undefined` | Git branch at the end of the session                                        |
| `cwd`          | `string \| undefined` | Working directory for the session                                           |
| `tag`          | `string \| undefined` | User-set session tag (see [`tagSession()`](#tag-session))                   |
| `createdAt`    | `number \| undefined` | Creation time in milliseconds since epoch, from the first entry's timestamp |

#### Example

Print the 10 most recent sessions for a project. Results are sorted by `lastModified` descending, so the first item is the newest. Omit `dir` to search across all projects.

```typescript theme={null}
import { listSessions } from "@anthropic-ai/claude-agent-sdk";

const sessions = await listSessions({ dir: "/path/to/project", limit: 10 });

for (const session of sessions) {
  console.log(`${session.summary} (${session.sessionId})`);
}
```

### `getSessionMessages()`

Reads user and assistant messages from a past session transcript.

```typescript theme={null}
function getSessionMessages(
  sessionId: string,
  options?: GetSessionMessagesOptions
): Promise<SessionMessage[]>;
```

#### Parameters

| Parameter        | Type     | Default     | Description                                                                   |
| :--------------- | :------- | :---------- | :---------------------------------------------------------------------------- |
| `sessionId`      | `string` | required    | Session UUID to read (see `listSessions()`)                                   |
| `options.dir`    | `string` | `undefined` | Project directory to find the session in. When omitted, searches all projects |
| `options.limit`  | `number` | `undefined` | Maximum number of messages to return                                          |
| `options.offset` | `number` | `undefined` | Number of messages to skip from the start                                     |

#### Return type: `SessionMessage`

| Property             | Type                    | Description                             |
| :------------------- | :---------------------- | :-------------------------------------- |
| `type`               | `"user" \| "assistant"` | Message role                            |
| `uuid`               | `string`                | Unique message identifier               |
| `session_id`         | `string`                | Session this message belongs to         |
| `message`            | `unknown`               | Raw message payload from the transcript |
| `parent_tool_use_id` | `null`                  | Reserved                                |

#### Example

```typescript theme={null}
import { listSessions, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

const [latest] = await listSessions({ dir: "/path/to/project", limit: 1 });

if (latest) {
  const messages = await getSessionMessages(latest.sessionId, {
    dir: "/path/to/project",
    limit: 20
  });

  for (const msg of messages) {
    console.log(`[${msg.type}] ${msg.uuid}`);
  }
}
```

### `getSessionInfo()`

Reads metadata for a single session by ID without scanning the full project directory.

```typescript theme={null}
function getSessionInfo(
  sessionId: string,
  options?: GetSessionInfoOptions
): Promise<SDKSessionInfo | undefined>;
```

#### Parameters

| Parameter     | Type     | Default     | Description                                                            |
| :------------ | :------- | :---------- | :--------------------------------------------------------------------- |
| `sessionId`   | `string` | required    | UUID of the session to look up                                         |
| `options.dir` | `string` | `undefined` | Project directory path. When omitted, searches all project directories |

Returns [`SDKSessionInfo`](#return-type-sdk-session-info), or `undefined` if the session is not found.

### `renameSession()`

Renames a session by appending a custom-title entry. Repeated calls are safe; the most recent title wins.

```typescript theme={null}
function renameSession(
  sessionId: string,
  title: string,
  options?: SessionMutationOptions
): Promise<void>;
```

#### Parameters

| Parameter     | Type     | Default     | Description                                                            |
| :------------ | :------- | :---------- | :--------------------------------------------------------------------- |
| `sessionId`   | `string` | required    | UUID of the session to rename                                          |
| `title`       | `string` | required    | New title. Must be non-empty after trimming whitespace                 |
| `options.dir` | `string` | `undefined` | Project directory path. When omitted, searches all project directories |

### `tagSession()`

Tags a session. Pass `null` to clear the tag. Repeated calls are safe; the most recent tag wins.

```typescript theme={null}
function tagSession(
  sessionId: string,
  tag: string | null,
  options?: SessionMutationOptions
): Promise<void>;
```

#### Parameters

| Parameter     | Type             | Default     | Description                                                            |
| :------------ | :--------------- | :---------- | :--------------------------------------------------------------------- |
| `sessionId`   | `string`         | required    | UUID of the session to tag                                             |
| `tag`         | `string \| null` | required    | Tag string, or `null` to clear                                         |
| `options.dir` | `string`         | `undefined` | Project directory path. When omitted, searches all project directories |

