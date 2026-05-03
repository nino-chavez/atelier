// Section identifiers for the /atelier/observability dashboard.
// Lives outside page.tsx because Next.js page files only accept the
// recognized export set (default, generateMetadata, dynamic, etc.).

export const SECTIONS = [
  'sessions',
  'contributions',
  'locks',
  'decisions',
  'triage',
  'sync',
  'vector',
  'cost',
] as const;

export type SectionId = (typeof SECTIONS)[number];

export function isSectionId(value: string): value is SectionId {
  return (SECTIONS as readonly string[]).includes(value);
}
