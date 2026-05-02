# python (part 7 of 7)

## Sandbox Configuration

### `SandboxSettings`

Configuration for sandbox behavior. Use this to enable command sandboxing and configure network restrictions programmatically.

```python theme={null}
class SandboxSettings(TypedDict, total=False):
    enabled: bool
    autoAllowBashIfSandboxed: bool
    excludedCommands: list[str]
    allowUnsandboxedCommands: bool
    network: SandboxNetworkConfig
    ignoreViolations: SandboxIgnoreViolations
    enableWeakerNestedSandbox: bool
```

| Property                    | Type                                                    | Default | Description                                                                                                                                                                                                                             |
| :-------------------------- | :------------------------------------------------------ | :------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`                   | `bool`                                                  | `False` | Enable sandbox mode for command execution                                                                                                                                                                                               |
| `autoAllowBashIfSandboxed`  | `bool`                                                  | `True`  | Auto-approve bash commands when sandbox is enabled                                                                                                                                                                                      |
| `excludedCommands`          | `list[str]`                                             | `[]`    | Commands that always bypass sandbox restrictions (e.g., `["docker"]`). These run unsandboxed automatically without model involvement                                                                                                    |
| `allowUnsandboxedCommands`  | `bool`                                                  | `True`  | Allow the model to request running commands outside the sandbox. When `True`, the model can set `dangerouslyDisableSandbox` in tool input, which falls back to the [permissions system](#permissions-fallback-for-unsandboxed-commands) |
| `network`                   | [`SandboxNetworkConfig`](#sandbox-network-config)       | `None`  | Network-specific sandbox configuration                                                                                                                                                                                                  |
| `ignoreViolations`          | [`SandboxIgnoreViolations`](#sandbox-ignore-violations) | `None`  | Configure which sandbox violations to ignore                                                                                                                                                                                            |
| `enableWeakerNestedSandbox` | `bool`                                                  | `False` | Enable a weaker nested sandbox for compatibility                                                                                                                                                                                        |

#### Example usage

```python theme={null}
from claude_agent_sdk import query, ClaudeAgentOptions, SandboxSettings

sandbox_settings: SandboxSettings = {
    "enabled": True,
    "autoAllowBashIfSandboxed": True,
    "network": {"allowLocalBinding": True},
}

async for message in query(
    prompt="Build and test my project",
    options=ClaudeAgentOptions(sandbox=sandbox_settings),
):
    print(message)
```

<Warning>
  **Unix socket security**: The `allowUnixSockets` option can grant access to powerful system services. For example, allowing `/var/run/docker.sock` effectively grants full host system access through the Docker API, bypassing sandbox isolation. Only allow Unix sockets that are strictly necessary and understand the security implications of each.
</Warning>

### `SandboxNetworkConfig`

Network-specific configuration for sandbox mode.

```python theme={null}
class SandboxNetworkConfig(TypedDict, total=False):
    allowedDomains: list[str]
    deniedDomains: list[str]
    allowManagedDomainsOnly: bool
    allowUnixSockets: list[str]
    allowAllUnixSockets: bool
    allowLocalBinding: bool
    allowMachLookup: list[str]
    httpProxyPort: int
    socksProxyPort: int
```

| Property                  | Type        | Default | Description                                                                                                                                            |
| :------------------------ | :---------- | :------ | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedDomains`          | `list[str]` | `[]`    | Domain names that sandboxed processes can access                                                                                                       |
| `deniedDomains`           | `list[str]` | `[]`    | Domain names that sandboxed processes cannot access. Takes precedence over `allowedDomains`                                                            |
| `allowManagedDomainsOnly` | `bool`      | `False` | Managed-settings only: when set in managed settings, ignore `allowedDomains` from non-managed settings sources. Has no effect when set via SDK options |
| `allowUnixSockets`        | `list[str]` | `[]`    | Unix socket paths that processes can access (e.g., Docker socket)                                                                                      |
| `allowAllUnixSockets`     | `bool`      | `False` | Allow access to all Unix sockets                                                                                                                       |
| `allowLocalBinding`       | `bool`      | `False` | Allow processes to bind to local ports (e.g., for dev servers)                                                                                         |
| `allowMachLookup`         | `list[str]` | `[]`    | macOS only: XPC/Mach service names to allow. Supports a trailing wildcard                                                                              |
| `httpProxyPort`           | `int`       | `None`  | HTTP proxy port for network requests                                                                                                                   |
| `socksProxyPort`          | `int`       | `None`  | SOCKS proxy port for network requests                                                                                                                  |

<Note>
  The built-in sandbox proxy enforces the network allowlist based on the requested hostname and does not terminate or inspect TLS traffic, so techniques such as [domain fronting](https://en.wikipedia.org/wiki/Domain_fronting) can potentially bypass it. See [Sandboxing security limitations](/en/sandboxing#security-limitations) for details and [Secure deployment](/en/agent-sdk/secure-deployment#traffic-forwarding) for configuring a TLS-terminating proxy.
</Note>

### `SandboxIgnoreViolations`

Configuration for ignoring specific sandbox violations.

```python theme={null}
class SandboxIgnoreViolations(TypedDict, total=False):
    file: list[str]
    network: list[str]
```

| Property  | Type        | Default | Description                                 |
| :-------- | :---------- | :------ | :------------------------------------------ |
| `file`    | `list[str]` | `[]`    | File path patterns to ignore violations for |
| `network` | `list[str]` | `[]`    | Network patterns to ignore violations for   |

### Permissions Fallback for Unsandboxed Commands

When `allowUnsandboxedCommands` is enabled, the model can request to run commands outside the sandbox by setting `dangerouslyDisableSandbox: True` in the tool input. These requests fall back to the existing permissions system, meaning your `can_use_tool` handler will be invoked, allowing you to implement custom authorization logic.

<Note>
  **`excludedCommands` vs `allowUnsandboxedCommands`:**

  * `excludedCommands`: A static list of commands that always bypass the sandbox automatically (e.g., `["docker"]`). The model has no control over this.
  * `allowUnsandboxedCommands`: Lets the model decide at runtime whether to request unsandboxed execution by setting `dangerouslyDisableSandbox: True` in the tool input.
</Note>

```python theme={null}
from claude_agent_sdk import (
    query,
    ClaudeAgentOptions,
    HookMatcher,
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
)


async def can_use_tool(
    tool: str, input: dict, context: ToolPermissionContext
) -> PermissionResultAllow | PermissionResultDeny:
    # Check if the model is requesting to bypass the sandbox
    if tool == "Bash" and input.get("dangerouslyDisableSandbox"):
        # The model is requesting to run this command outside the sandbox
        print(f"Unsandboxed command requested: {input.get('command')}")

        if is_command_authorized(input.get("command")):
            return PermissionResultAllow()
        return PermissionResultDeny(
            message="Command not authorized for unsandboxed execution"
        )
    return PermissionResultAllow()


# Required: dummy hook keeps the stream open for can_use_tool
async def dummy_hook(input_data, tool_use_id, context):
    return {"continue_": True}


async def prompt_stream():
    yield {
        "type": "user",
        "message": {"role": "user", "content": "Deploy my application"},
    }


async def main():
    async for message in query(
        prompt=prompt_stream(),
        options=ClaudeAgentOptions(
            sandbox={
                "enabled": True,
                "allowUnsandboxedCommands": True,  # Model can request unsandboxed execution
            },
            permission_mode="default",
            can_use_tool=can_use_tool,
            hooks={"PreToolUse": [HookMatcher(matcher=None, hooks=[dummy_hook])]},
        ),
    ):
        print(message)
```

This pattern enables you to:

* **Audit model requests**: Log when the model requests unsandboxed execution
* **Implement allowlists**: Only permit specific commands to run unsandboxed
* **Add approval workflows**: Require explicit authorization for privileged operations

<Warning>
  Commands running with `dangerouslyDisableSandbox: True` have full system access. Ensure your `can_use_tool` handler validates these requests carefully.

  If `permission_mode` is set to `bypassPermissions` and `allow_unsandboxed_commands` is enabled, the model can autonomously execute commands outside the sandbox without any approval prompts. This combination effectively allows the model to escape sandbox isolation silently.
</Warning>

## See also

* [SDK overview](/en/agent-sdk/overview) - General SDK concepts
* [TypeScript SDK reference](/en/agent-sdk/typescript) - TypeScript SDK documentation
* [CLI reference](/en/cli-reference) - Command-line interface
* [Common workflows](/en/common-workflows) - Step-by-step guides
