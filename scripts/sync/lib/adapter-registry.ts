// Adapter registry factory.
//
// The DeliveryAdapter registry in `./adapters.ts` is a generic Map<name, adapter>;
// only the no-op adapter auto-registers from that module. The concrete external
// adapters (GitHub, Jira) carry their own credentials + config and must not
// instantiate at module-load (the smoke tests inject mocked instances; doing
// it from the lib would make the smokes harder to isolate). This factory is
// the single explicit-registration seam: each script (`publish-delivery`,
// `mirror-delivery`, `reconcile`) calls it once at startup.
//
// The factory is conservative -- it skips an adapter when the required env
// vars are missing rather than throwing. That way an operator who runs
// `publish-delivery --adapter noop` does not need to set GitHub or Jira
// credentials. If the resolved adapter name is unregistered after this call,
// `resolveDeliveryAdapter` will throw with the clear "no delivery adapter
// registered" error from `./adapters.ts`.

import { GitHubDeliveryAdapter } from './github.ts';
import { JiraDeliveryAdapter } from './jira.ts';
import { registerDeliveryAdapter } from './adapters.ts';

export interface RegistryOptions {
  /** Skip GitHub registration even if env vars are set. Tests use this to
   *  avoid clobbering an in-memory mock. */
  skipGithub?: boolean;
  /** Skip Jira registration even if env vars are set. */
  skipJira?: boolean;
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

  return { registered };
}
