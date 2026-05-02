# typescript (part 5 of 5)

## Sandbox Configuration

### `SandboxSettings`

Configuration for sandbox behavior. Use this to enable command sandboxing and configure network restrictions programmatically.

```typescript theme={null}
type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: SandboxNetworkConfig;
  filesystem?: SandboxFilesystemConfig;
  ignoreViolations?: Record<string, string[]>;
  enableWeakerNestedSandbox?: boolean;
  ripgrep?: { command: string; args?: string[] };
};
```

| Property                    | Type                                                    | Default     | Description                                                                                                                                                                                                                             |
| :-------------------------- | :------------------------------------------------------ | :---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                   | `boolean`                                               | `false`     | Enable sandbox mode for command execution                                                                                                                                                                                               |
| `autoAllowBashIfSandboxed`  | `boolean`                                               | `true`      | Auto-approve bash commands when sandbox is enabled                                                                                                                                                                                      |
| `excludedCommands`          | `string[]`                                              | `[]`        | Commands that always bypass sandbox restrictions (e.g., `['docker']`). These run unsandboxed automatically without model involvement                                                                                                    |
| `allowUnsandboxedCommands`  | `boolean`                                               | `true`      | Allow the model to request running commands outside the sandbox. When `true`, the model can set `dangerouslyDisableSandbox` in tool input, which falls back to the [permissions system](#permissions-fallback-for-unsandboxed-commands) |
| `network`                   | [`SandboxNetworkConfig`](#sandbox-network-config)       | `undefined` | Network-specific sandbox configuration                                                                                                                                                                                                  |
| `filesystem`                | [`SandboxFilesystemConfig`](#sandbox-filesystem-config) | `undefined` | Filesystem-specific sandbox configuration for read/write restrictions                                                                                                                                                                   |
| `ignoreViolations`          | `Record<string, string[]>`                              | `undefined` | Map of violation categories to patterns to ignore (e.g., `{ file: ['/tmp/*'], network: ['localhost'] }`)                                                                                                                                |
| `enableWeakerNestedSandbox` | `boolean`                                               | `false`     | Enable a weaker nested sandbox for compatibility                                                                                                                                                                                        |
| `ripgrep`                   | `{ command: string; args?: string[] }`                  | `undefined` | Custom ripgrep binary configuration for sandbox environments                                                                                                                                                                            |

#### Example usage

```typescript theme={null}
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Build and test my project",
  options: {
    sandbox: {
      enabled: true,
      autoAllowBashIfSandboxed: true,
      network: {
        allowLocalBinding: true
      }
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

<Warning>
  **Unix socket security:** The `allowUnixSockets` option can grant access to powerful system services. For example, allowing `/var/run/docker.sock` effectively grants full host system access through the Docker API, bypassing sandbox isolation. Only allow Unix sockets that are strictly necessary and understand the security implications of each.
</Warning>

### `SandboxNetworkConfig`

Network-specific configuration for sandbox mode.

```typescript theme={null}
type SandboxNetworkConfig = {
  allowedDomains?: string[];
  deniedDomains?: string[];
  allowManagedDomainsOnly?: boolean;
  allowLocalBinding?: boolean;
  allowUnixSockets?: string[];
  allowAllUnixSockets?: boolean;
  httpProxyPort?: number;
  socksProxyPort?: number;
};
```

| Property                  | Type       | Default     | Description                                                                                 |
| :------------------------ | :--------- | :---------- | :------------------------------------------------------------------------------------------ |
| `allowedDomains`          | `string[]` | `[]`        | Domain names that sandboxed processes can access                                            |
| `deniedDomains`           | `string[]` | `[]`        | Domain names that sandboxed processes cannot access. Takes precedence over `allowedDomains` |
| `allowManagedDomainsOnly` | `boolean`  | `false`     | Restrict network access to only the domains in `allowedDomains`                             |
| `allowLocalBinding`       | `boolean`  | `false`     | Allow processes to bind to local ports (e.g., for dev servers)                              |
| `allowUnixSockets`        | `string[]` | `[]`        | Unix socket paths that processes can access (e.g., Docker socket)                           |
| `allowAllUnixSockets`     | `boolean`  | `false`     | Allow access to all Unix sockets                                                            |
| `httpProxyPort`           | `number`   | `undefined` | HTTP proxy port for network requests                                                        |
| `socksProxyPort`          | `number`   | `undefined` | SOCKS proxy port for network requests                                                       |

<Note>
  The built-in sandbox proxy enforces `allowedDomains` based on the requested hostname and does not terminate or inspect TLS traffic, so techniques such as [domain fronting](https://en.wikipedia.org/wiki/Domain_fronting) can potentially bypass it. See [Sandboxing security limitations](/en/sandboxing#security-limitations) for details and [Secure deployment](/en/agent-sdk/secure-deployment#traffic-forwarding) for configuring a TLS-terminating proxy.
</Note>

### `SandboxFilesystemConfig`

Filesystem-specific configuration for sandbox mode.

```typescript theme={null}
type SandboxFilesystemConfig = {
  allowWrite?: string[];
  denyWrite?: string[];
  denyRead?: string[];
};
```

| Property     | Type       | Default | Description                                 |
| :----------- | :--------- | :------ | :------------------------------------------ |
| `allowWrite` | `string[]` | `[]`    | File path patterns to allow write access to |
| `denyWrite`  | `string[]` | `[]`    | File path patterns to deny write access to  |
| `denyRead`   | `string[]` | `[]`    | File path patterns to deny read access to   |

### Permissions Fallback for Unsandboxed Commands

When `allowUnsandboxedCommands` is enabled, the model can request to run commands outside the sandbox by setting `dangerouslyDisableSandbox: true` in the tool input. These requests fall back to the existing permissions system, meaning your `canUseTool` handler is invoked, allowing you to implement custom authorization logic.

<Note>
  **`excludedCommands` vs `allowUnsandboxedCommands`:**

  * `excludedCommands`: A static list of commands that always bypass the sandbox automatically (e.g., `['docker']`). The model has no control over this.
  * `allowUnsandboxedCommands`: Lets the model decide at runtime whether to request unsandboxed execution by setting `dangerouslyDisableSandbox: true` in the tool input.
</Note>

```typescript theme={null}
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Deploy my application",
  options: {
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: true // Model can request unsandboxed execution
    },
    permissionMode: "default",
    canUseTool: async (tool, input) => {
      // Check if the model is requesting to bypass the sandbox
      if (tool === "Bash" && input.dangerouslyDisableSandbox) {
        // The model is requesting to run this command outside the sandbox
        console.log(`Unsandboxed command requested: ${input.command}`);

        if (isCommandAuthorized(input.command)) {
          return { behavior: "allow" as const, updatedInput: input };
        }
        return {
          behavior: "deny" as const,
          message: "Command not authorized for unsandboxed execution"
        };
      }
      return { behavior: "allow" as const, updatedInput: input };
    }
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

This pattern enables you to:

* **Audit model requests:** Log when the model requests unsandboxed execution
* **Implement allowlists:** Only permit specific commands to run unsandboxed
* **Add approval workflows:** Require explicit authorization for privileged operations

<Warning>
  Commands running with `dangerouslyDisableSandbox: true` have full system access. Ensure your `canUseTool` handler validates these requests carefully.

  If `permissionMode` is set to `bypassPermissions` and `allowUnsandboxedCommands` is enabled, the model can autonomously execute commands outside the sandbox without any approval prompts. This combination effectively allows the model to escape sandbox isolation silently.
</Warning>

## See also

* [SDK overview](/en/agent-sdk/overview) - General SDK concepts
* [Python SDK reference](/en/agent-sdk/python) - Python SDK documentation
* [CLI reference](/en/cli-reference) - Command-line interface
* [Common workflows](/en/common-workflows) - Step-by-step guides
