import matchJavascriptObjectReference from "../../matchJavascriptObject.ts";
import { MONGO_TRUTH_CORPUS } from "./corpus.ts";
import { startMongoTruth, type MongoTruthRunner } from "./mongod.ts";

/**
 * Settles every "MongoDB does X" claim in the divergence and decision registers against a real `mongod`.
 *
 * Opt-in — `npm run test:mongo-truth`. It boots a server (downloading its binary the first time), which is too
 * heavy for the default suite; the default suite instead relies on `mingo` as a standing conformance oracle, and
 * this corpus is what tells us whether to believe `mingo` when the two disagree.
 */
describe('MongoDB ground truth', () => {

    let mongo: MongoTruthRunner;

    beforeAll(async () => {
        // Every case queries its own document by id, so a duplicate id would silently make two cases share a row.
        const ids = MONGO_TRUTH_CORPUS.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        mongo = await startMongoTruth(MONGO_TRUTH_CORPUS);
    });

    afterAll(async () => {
        await mongo?.stop();
    });

    describe.each([...new Set(MONGO_TRUTH_CORPUS.map(c => c.source))])('%s', (source) => {

        const cases = MONGO_TRUTH_CORPUS.filter(c => c.source === source);

        test.each(cases)('$claim', async (testCase) => {
            const answers = {
                mongo: await mongo.evaluate(testCase.id, testCase.filter),
                ours: matchJavascriptObjectReference(testCase.row, testCase.filter),
            };

            expect(answers).toEqual({ mongo: testCase.mongo, ours: testCase.ours });
        });
    });
});
