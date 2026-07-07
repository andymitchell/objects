import { CachedGmailThreadSchema, type CachedGmailThread } from "./fixtures.ts";
import type { SectionCtx } from "./harness.ts";

/** §8. Real-world composite patterns. */
export function registerCompositePatterns(ctx: SectionCtx): void {
    const { test, matchJavascriptObject, expectOrAcknowledgeUnsupported } = ctx;

    describe('8. Real-world composite patterns', () => {

        const thread1: CachedGmailThread = {
            threadId: 't1',
            labelIds: ['INBOX', 'SENT', 'Label_15'],
            rfc822msgids: ['abc@example.com', 'def@example.com'],
            messages: [
                { messageId: 'm1', labelIds: ['INBOX', 'Label_15'], rfc822msgid: 'abc@example.com' },
                { messageId: 'm2', labelIds: ['SENT'], rfc822msgid: 'def@example.com' },
            ]
        };

        const thread2: CachedGmailThread = {
            threadId: 't2',
            labelIds: ['DRAFTS'],
            rfc822msgids: ['xyz@example.com'],
            messages: [
                { messageId: 'm3', labelIds: ['DRAFTS'], rfc822msgid: 'xyz@example.com' },
            ]
        };

        const emptyThread: CachedGmailThread = {
            threadId: 't3',
            labelIds: [],
            rfc822msgids: [],
            messages: []
        };

        describe('8a. Scalar element match on top-level string[]', () => {

            test('labelIds contains INBOX: thread1 passes, thread2 fails', async () => {
                const filter = { labelIds: 'INBOX' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

            test('labelIds contains DRAFTS: thread1 fails, thread2 passes', async () => {
                const filter = { labelIds: 'DRAFTS' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, false);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, true);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

            test('rfc822msgids contains abc@example.com: thread1 passes', async () => {
                const filter = { rfc822msgids: 'abc@example.com' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

            test('rfc822msgids contains nonexistent: all fail', async () => {
                const filter = { rfc822msgids: 'nonexistent@example.com' };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, false);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

        });

        describe('8b. $elemMatch single condition on object array', () => {

            test('message with rfc822msgid abc: thread1 passes, thread2 fails', async () => {
                const filter = { messages: { $elemMatch: { rfc822msgid: 'abc@example.com' } } };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
            });

            test('message with rfc822msgid xyz: thread1 fails, thread2 passes', async () => {
                const filter = { messages: { $elemMatch: { rfc822msgid: 'xyz@example.com' } } };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, false);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, true);
            });

        });

        describe('8c. $elemMatch compound with nested string[]', () => {

            test('same message has both rfc822msgid and labelId: passes', async () => {
                // m1 has rfc822msgid 'abc@example.com' AND labelIds ['INBOX', 'Label_15']
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { rfc822msgid: 'abc@example.com', labelIds: 'INBOX' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('rfc822msgid and labelId split across different messages: fails', async () => {
                // m1 has rfc822msgid 'abc@example.com' but NOT 'SENT'
                // m2 has 'SENT' but NOT rfc822msgid 'abc@example.com'
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { rfc822msgid: 'abc@example.com', labelIds: 'SENT' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('8d. $elemMatch negative — no element satisfies compound', () => {

            test('labelId and rfc822msgid exist on different messages: fails', async () => {
                // m1 has Label_15 but rfc822msgid 'abc@example.com' (not 'def')
                // m2 has rfc822msgid 'def@example.com' but labelIds ['SENT'] (not Label_15)
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { labelIds: 'Label_15', rfc822msgid: 'def@example.com' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

        describe('8e. $or union filter', () => {

            test('threads with INBOX or DRAFTS or rfc822msgid xyz', async () => {
                const filter = { $or: [
                    { labelIds: 'INBOX' },
                    { labelIds: 'DRAFTS' },
                    { rfc822msgids: 'xyz@example.com' }
                ] };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, true);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

        });

        describe('8f. $or union with $elemMatch', () => {

            test('STARRED label or message with rfc822msgid abc', async () => {
                const filter = { $or: [
                    { labelIds: 'STARRED' },
                    { messages: { $elemMatch: { rfc822msgid: 'abc@example.com' } } }
                ] };
                const r1 = await matchJavascriptObject(thread1, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r1, true);
                const r2 = await matchJavascriptObject(thread2, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r2, false);
                const r3 = await matchJavascriptObject(emptyThread, filter, CachedGmailThreadSchema);
                expectOrAcknowledgeUnsupported(r3, false);
            });

        });

        describe('8g. Edge cases — empty arrays', () => {

            test('scalar element match on empty labelIds: fails', async () => {
                const result = await matchJavascriptObject(
                    emptyThread,
                    { labelIds: 'INBOX' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$elemMatch on empty messages: fails', async () => {
                const result = await matchJavascriptObject(
                    emptyThread,
                    { messages: { $elemMatch: { rfc822msgid: 'any' } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('$elemMatch with $or inside: either labelId suffices per element', async () => {
                // m1 has INBOX, m2 has SENT — either individually satisfies the $or
                const result = await matchJavascriptObject(
                    thread1,
                    { messages: { $elemMatch: { $or: [{ labelIds: 'INBOX' }, { labelIds: 'SENT' }] } } },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

        });

        describe('8h. Dot-prop spreading into nested arrays', () => {

            test('messages.rfc822msgid scalar match: thread1 passes', async () => {
                const result = await matchJavascriptObject(
                    thread1,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.rfc822msgid': 'abc@example.com' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('messages.rfc822msgid scalar match: thread2 fails', async () => {
                const result = await matchJavascriptObject(
                    thread2,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.rfc822msgid': 'abc@example.com' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

            test('messages.labelIds double-nested spread: thread1 passes', async () => {
                const result = await matchJavascriptObject(
                    thread1,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.labelIds': 'INBOX' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, true);
            });

            test('messages.labelIds double-nested spread: thread2 fails', async () => {
                const result = await matchJavascriptObject(
                    thread2,
                    // @ts-expect-error — TODO: DotPropPathsIncArrayUnion doesn't generate paths through arrays
                    { 'messages.labelIds': 'INBOX' },
                    CachedGmailThreadSchema
                );
                expectOrAcknowledgeUnsupported(result, false);
            });

        });

    });
}
