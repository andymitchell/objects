/**
 * Parses the divergence register (`MONGO-DIVERGENCES.md`) into typed entries.
 *
 * The register is the contract consumers plan around, so its structure is machine-checked: every
 * numbered entry must carry a stable kebab-case slug, and `registry.test.ts` holds each slug to a
 * pinning test file in this directory. This parser is the single reading of that structure.
 */

/** One `## N.` entry of the divergence register. */
export type DivergenceEntry = {
    /** The entry's stable number (never reused or renumbered; a retired entry keeps its number as a gap). */
    readonly id: number;
    /** The stable kebab-case identifier test files reference the entry by. */
    readonly slug: string;
    /** `retired` when the behaviour has been fixed toward MongoDB and the entry documents that history. */
    readonly status: 'active' | 'retired';
    /** The heading text after the number. */
    readonly title: string;
};

const HEADING = /^## (\d+)\.\s*(.*)$/;
const SLUG_LINE = /^\*\*Slug\*\*:/;
const WELL_FORMED_SLUG_LINE = /^\*\*Slug\*\*: `([a-z0-9]+(?:-[a-z0-9]+)+)`\s*$/;

/**
 * Extracts every numbered entry, with its slug and retired status, from the register's markdown.
 *
 * @param markdown The full text of `MONGO-DIVERGENCES.md`.
 * @returns The entries in document order.
 * @throws If an entry has no slug line, a malformed slug, or a duplicate id/slug — a structural
 *   defect in the register itself, reported loudly rather than skipped so every consumer of this
 *   parser gets the same guarantee.
 */
export function parseDivergenceRegister(markdown: string): DivergenceEntry[] {
    const lines = markdown.split('\n');
    const entries: DivergenceEntry[] = [];
    const seenIds = new Set<number>();
    const seenSlugs = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
        const heading = HEADING.exec(lines[i]!);
        if (!heading) continue;

        const id = Number(heading[1]);
        const title = heading[2]!.trim();
        if (seenIds.has(id)) {
            throw new Error(`MONGO-DIVERGENCES.md: duplicate entry number #${id}`);
        }
        seenIds.add(id);

        const slug = readSlug(lines, i + 1, id);
        if (seenSlugs.has(slug)) {
            throw new Error(`MONGO-DIVERGENCES.md: duplicate slug \`${slug}\` (entry #${id})`);
        }
        seenSlugs.add(slug);

        entries.push({
            id,
            slug,
            status: /\(retired\)/.test(title) ? 'retired' : 'active',
            title,
        });
    }

    return entries;
}

/** The entry's slug, from the first slug line between its heading and the next `## ` heading. */
function readSlug(lines: readonly string[], startLine: number, id: number): string {
    for (let i = startLine; i < lines.length && !lines[i]!.startsWith('## '); i++) {
        if (!SLUG_LINE.test(lines[i]!)) continue;
        const wellFormed = WELL_FORMED_SLUG_LINE.exec(lines[i]!);
        if (!wellFormed) {
            throw new Error(`MONGO-DIVERGENCES.md: entry #${id} has a malformed slug line: ${lines[i]}`);
        }
        return wellFormed[1]!;
    }
    throw new Error(`MONGO-DIVERGENCES.md: entry #${id} has no \`**Slug**:\` line`);
}
