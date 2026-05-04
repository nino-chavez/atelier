// Adapter registry factory.
//
// The DeliveryAdapter registry in `./adapters.ts` is a generic Map<name, adapter>;
// only the no-op adapter auto-registers from that module. The concrete external
// adapters (GitHub, Jira, Linear) carry their own credentials + config and
// must not instantiate at module-load (the smoke tests inject mocked
// instances; doing it from the lib would make the smokes harder to isolate).
// This factory is the single explicit-registration seam: each script
// (`publish-delivery`, `mirror-delivery`, `reconcile`) calls it once at
// startup.
//
// The factory is conservative -- it skips an adapter when the required env
// vars are missing rather than throwing. That way an operator who runs
// `publish-delivery --adapter noop` does not need to set GitHub, Jira, or
// Linear credentials. If the resolved adapter name is unregistered after
// this call, `resolveDeliveryAdapter` will throw with the clear "no delivery
// adapter registered" error from `./adapters.ts`.

import { GitHubDeliveryAdapter } from './github.ts';
import { JiraDeliveryAdapter } from './jira.ts';
import { LinearDeliveryAdapter } from './linear.ts';
import { ConfluenceDocAdapter } from './confluence.ts';
import { NotionDocAdapter } from './notion.ts';
import { registerDeliveryAdapter, registerDocAdapter } from './adapters.ts';

export interface RegistryOptions {
  /** Skip GitHub registration even if env vars are set. Tests use this to
   *  avoid clobbering an in-memory mock. */
  skipGithub?: boolean;
  /** Skip Jira registration even if env vars are set. */
  skipJira?: boolean;
  /** Skip Linear registration even if env vars are set. */
  skipLinear?: boolean;
  /** Skip Confluence registration even if env vars are set. */
  skipConfluence?: boolean;
  /** Skip Notion registration even if env vars are set. */
  skipNotion?: boolean;
}

export function registerConfiguredAdapters(opts: RegistryOptions = {}): { registered: string[] } {
  const registered: string[] = [];

  if (!opts.skipGithub) {
    const token = process.env.ATELIER_GITHUB_TOKEN;
    const owner = process.env.ATELIER_GITHUB_OWNER;
    const repo  = process.env.ATELIER_GITHUB_REPO;
    if (token && owner && repo) {
      registerDeliveryAdapter(new GitHubDeliveryAdapter({ token, owner, repo }));
      registered.push('github');
    }
  }

  if (!opts.skipJira) {
    const baseUrl    = process.env.ATELIER_JIRA_BASE_URL;
    const email      = process.env.ATELIER_JIRA_EMAIL;
    const apiToken   = process.env.ATELIER_JIRA_API_TOKEN;
    const projectKey = process.env.ATELIER_JIRA_PROJECT_KEY;
    if (baseUrl && email && apiToken && projectKey) {
      registerDeliveryAdapter(new JiraDeliveryAdapter({ baseUrl, email, apiToken, projectKey }));
      registered.push('jira');
    }
  }

  if (!opts.skipLinear) {
    const apiKey = process.env.ATELIER_LINEAR_API_KEY;
    const teamId = process.env.ATELIER_LINEAR_TEAM_ID;
    if (apiKey && teamId) {
      registerDeliveryAdapter(new LinearDeliveryAdapter({ apiKey, teamId }));
      registered.push('linear');
    }
  }

  if (!opts.skipConfluence) {
    const baseUrl  = process.env.ATELIER_CONFLUENCE_BASE_URL;
    const email    = process.env.ATELIER_CONFLUENCE_EMAIL;
    const apiToken = process.env.ATELIER_CONFLUENCE_API_TOKEN;
    const defaultSpaceKey = process.env.ATELIER_CONFLUENCE_SPACE_KEY;
    if (baseUrl && email && apiToken) {
      registerDocAdapter(new ConfluenceDocAdapter({
        baseUrl,
        email,
        apiToken,
        ...(defaultSpaceKey ? { defaultSpaceKey } : {}),
      }));
      registered.push('confluence');
    }
  }

  if (!opts.skipNotion) {
    const apiToken         = process.env.ATELIER_NOTION_API_TOKEN;
    const defaultDatabaseId = process.env.ATELIER_NOTION_DATABASE_ID;
    if (apiToken && defaultDatabaseId) {
      registerDocAdapter(new NotionDocAdapter({ apiToken, defaultDatabaseId }));
      registered.push('notion');
    }
  }

  return { registered };
}
