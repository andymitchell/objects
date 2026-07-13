import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Document, type Filter } from "mongodb";
import type { WhereFilterDefinition } from "../../types.ts";
import type { MongoTruthCase } from "./types.ts";

/**
 * A live `mongod` that can answer a filter for any document in the corpus.
 *
 * Held open for the whole run — booting a server per case would dominate the runtime for no extra fidelity,
 * since each case queries its own document by `_id` and so cannot see any other.
 */
export type MongoTruthRunner = {
    /**
     * Ask MongoDB whether the case's own document matches a filter.
     *
     * @param caseId - Identifies the document, which was inserted from the case's `row`.
     * @param filter - The filter to apply, on top of the `_id` match, so only that one document is in scope.
     * @returns Whether MongoDB considers the document a match.
     */
    evaluate(caseId: string, filter: WhereFilterDefinition): Promise<boolean>;
    stop(): Promise<void>;
};

/**
 * Boot a real `mongod` and load the corpus into it, one document per case.
 *
 * This is the conformance suite's final authority. The JS reference matcher and `mingo` are both *implementations*
 * of an understanding of MongoDB, and either can be wrong — so a claim about MongoDB is worth only as much as the
 * server that answered it. Every case's document is inserted under its own `_id`, so the cases stay independent
 * and the whole corpus costs one server boot.
 *
 * @param cases - The corpus. Ids must be unique; each becomes a document `_id`.
 * @returns A runner over the loaded collection, plus the `stop` that tears the server down.
 *
 * @remarks
 * The first run downloads a MongoDB binary (~100MB) and caches it, which is why this corpus is opt-in
 * (`npm run test:mongo-truth`) rather than part of the default suite.
 */
export async function startMongoTruth(cases: readonly MongoTruthCase[]): Promise<MongoTruthRunner> {
    const server = await MongoMemoryServer.create();
    const client = new MongoClient(server.getUri());
    await client.connect();

    const collection = client.db('where_filter').collection('truth');
    const documents: Document[] = cases.map(c => ({ _id: c.id, ...c.row }));
    await collection.insertMany(documents);

    return {
        async evaluate(caseId, filter) {
            // This package's filter language is a subset of MongoDB's, so a valid filter is already a valid query.
            // The driver's `Filter` type is derived from a document type, and the corpus deliberately has none —
            // its whole point is to exercise what the server accepts, not what a schema can express.
            const query = { $and: [{ _id: caseId }, filter] } as Filter<Document>;
            const matches = await collection.countDocuments(query);
            return matches === 1;
        },
        async stop() {
            await client.close();
            await server.stop();
        },
    };
}
