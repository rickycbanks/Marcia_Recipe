import { SCHEMA_VERSIONS, type SchemaKind } from "@/lib/validation/constants";

/**
 * Version-aware, repeatable migration framework. Each migration upgrades one
 * document kind from version N-1 to N. Migrations are pure functions over the
 * parsed document, applied in order, persisted with atomic writes.
 */
export interface Migration {
  kind: SchemaKind;
  fromVersion: number;
  description: string;
  up: (doc: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Registry of all known migrations. v1 is the initial schema, so the first
 * entry demonstrates the chain from the legacy "v0" fixture shape
 * (recipes that used `name`/`instructions` and lacked schemaVersion).
 */
export const MIGRATIONS: Migration[] = [
  {
    kind: "recipe",
    fromVersion: 0,
    description: "recipe v0 → v1: rename name→title, instructions→steps, add canonical fields",
    up: (doc) => {
      const now = new Date().toISOString();
      const rawSteps = Array.isArray(doc.instructions) ? (doc.instructions as unknown[]) : [];
      return {
        schemaVersion: 1,
        id: doc.id,
        slug: doc.slug,
        previousSlugs: [],
        visibility: doc.visibility ?? "inherit",
        title: typeof doc.name === "string" ? doc.name : (doc.title ?? "Untitled"),
        description: typeof doc.description === "string" ? doc.description : "",
        prepMinutes: null,
        cookMinutes: null,
        servings: typeof doc.servings === "number" ? doc.servings : null,
        difficulty: null,
        category: null,
        tags: Array.isArray(doc.tags) ? doc.tags : [],
        sourceUrl: null,
        ingredients: Array.isArray(doc.ingredients) ? doc.ingredients : [],
        steps: rawSteps.map((text, i) => ({
          id: crypto.randomUUID(),
          order: i,
          text: String(text),
        })),
        notesMarkdown: "",
        media: [],
        archivedAt: null,
        createdAt: typeof doc.createdAt === "string" ? doc.createdAt : now,
        updatedAt: now,
      };
    },
  },
];

/** Ordered migrations needed to bring `kind` from `version` to current. */
export function migrationsFor(kind: SchemaKind, version: number): Migration[] {
  const target = SCHEMA_VERSIONS[kind];
  const chain: Migration[] = [];
  let v = version;
  while (v < target) {
    const next = MIGRATIONS.find((m) => m.kind === kind && m.fromVersion === v);
    if (!next) {
      throw new Error(`No migration path for ${kind} from version ${version} to ${target}`);
    }
    chain.push(next);
    v += 1;
  }
  return chain;
}

/** Apply the migration chain. Unsupported future versions are rejected untouched. */
export function migrateDocument(
  kind: SchemaKind,
  doc: Record<string, unknown>,
): { doc: Record<string, unknown>; applied: Migration[] } {
  const current = SCHEMA_VERSIONS[kind];
  let version = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (version > current) {
    throw new Error(
      `Unsupported ${kind} schema version ${version} (this build understands up to ${current}); file left unmodified`,
    );
  }
  const chain = migrationsFor(kind, version);
  let working = doc;
  for (const migration of chain) {
    working = migration.up(working);
    version += 1;
  }
  return { doc: working, applied: chain };
}
