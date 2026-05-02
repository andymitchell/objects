
import { isLogicFilter, isPartialObjectFilter } from "./typeguards.ts";
import { type PartialObjectFilter, type PartialObjectFilterStrict, type WhereFilterDefinition } from "./types.ts"

type TestObj = {
    name: string;
    age: number;
    active: boolean;
    contact: { city: string; zip: number };
    tags: string[];
    scores: number[];
    addresses: { street: string; primary: boolean }[];
    status: 'pending' | 'resolved' | 'rejected';
    nickname?: string;
    deletedAt: string | null;
};

describe('WhereFilterDefinition types', () => {

    describe('1. Filter forms', () => {

        describe('1a. Partial Object Filter', () => {
            it('accepts top-level key with correct value type', () => {
                const a: WhereFilterDefinition<TestObj> = { name: 'Andy' };
            })

            it('accepts multiple keys (implicit $and)', () => {
                const a: WhereFilterDefinition<TestObj> = { name: 'Andy', age: 30 };
            })

            it('rejects unknown key', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error unknown key
                    unknown: 'x'
                };
            })

            it('rejects wrong value type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error number is not string
                    name: 1
                };
            })

            it('accepts discriminated union optional property', () => {
                type DiscriminatedUnion = { name: '1', message: string } | { name: '2' };
                const a: WhereFilterDefinition<DiscriminatedUnion> = {
                    message: 'a'
                };
            })
        })

        describe('1b. Logic Filter', () => {
            it('accepts $and with array of sub-filters', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    $and: [{ name: 'Andy' }, { age: 30 }]
                };
            })

            it('accepts $or with array of sub-filters', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    $or: [{ name: 'Andy' }, { age: 30 }]
                };
            })

            it('accepts $nor with array of sub-filters', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    $nor: [{ name: 'Andy' }]
                };
            })

            it('sub-filters can nest logic inside logic', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    $and: [
                        { $or: [{ name: 'Andy' }, { name: 'Bob' }] },
                        { age: 30 }
                    ]
                };
            })

            it('accepts multiple logic operators on one object', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    $and: [{ name: 'Andy' }],
                    $nor: [{ age: 99 }]
                };
            })
        })
    })

    describe('2. Scalar value comparisons — ValueComparisonFlexi<T>', () => {

        describe('string properties', () => {
            it('accepts exact string', () => {
                const a: WhereFilterDefinition<TestObj> = { name: 'Andy' };
            })

            it('rejects wrong type (number for string field)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error number is not string
                    name: 1
                };
            })

            it('accepts range operators ($gt, $lt, $gte, $lte) with string value', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $gt: 'A' } };
                const b: WhereFilterDefinition<TestObj> = { name: { $lt: 'Z' } };
                const c: WhereFilterDefinition<TestObj> = { name: { $gte: 'A' } };
                const d: WhereFilterDefinition<TestObj> = { name: { $lte: 'Z' } };
            })

            it('rejects range with wrong type (number for string range)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    name: {
                        // @ts-expect-error number is not string
                        $gte: 1
                    }
                };
            })

            it('accepts $contains with string', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $contains: 'nd' } };
            })

            it('rejects $contains with wrong type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    name: {
                        // @ts-expect-error number is not string
                        $contains: 1
                    }
                };
            })

            it('accepts $regex with string and $options', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $regex: '^And' } };
                const b: WhereFilterDefinition<TestObj> = { name: { $regex: '^And', $options: 'i' } };
            })

            it('accepts $ne with string', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $ne: 'Bob' } };
            })

            it('rejects $ne with wrong type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    name: {
                        // @ts-expect-error number is not string
                        $ne: 1
                    }
                };
            })

            it('accepts $in with string array', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $in: ['Andy', 'Bob'] } };
            })

            it('rejects $in with wrong element type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    name: {
                        // @ts-expect-error number[] is not string[]
                        $in: [1, 2]
                    }
                };
            })

            it('accepts $nin with string array', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $nin: ['Andy'] } };
            })

            it('accepts $not wrapping range', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $not: { $gte: 'M' } } };
            })

            it('accepts $not wrapping $contains', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $not: { $contains: 'nd' } } };
            })

            it('accepts $not wrapping $ne', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $not: { $ne: 'Bob' } } };
            })

            it('accepts $not wrapping $in', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $not: { $in: ['Andy'] } } };
            })

            it('accepts $not wrapping $regex', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $not: { $regex: '^A' } } };
            })

            it('accepts $exists', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $exists: true } };
                const b: WhereFilterDefinition<TestObj> = { name: { $exists: false } };
            })

            it('accepts $type with valid type string', () => {
                const a: WhereFilterDefinition<TestObj> = { name: { $type: 'string' } };
                const b: WhereFilterDefinition<TestObj> = { name: { $type: 'number' } };
                const c: WhereFilterDefinition<TestObj> = { name: { $type: 'boolean' } };
                const d: WhereFilterDefinition<TestObj> = { name: { $type: 'object' } };
                const e: WhereFilterDefinition<TestObj> = { name: { $type: 'array' } };
                const f: WhereFilterDefinition<TestObj> = { name: { $type: 'null' } };
            })

            it('rejects $type with invalid type string', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    name: {
                        // @ts-expect-error 'function' is not a valid $type value
                        $type: 'function'
                    }
                };
            })
        })

        describe('number properties', () => {
            it('accepts exact number', () => {
                const a: WhereFilterDefinition<TestObj> = { age: 30 };
            })

            it('rejects wrong type (string for number field)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error string is not number
                    age: 'thirty'
                };
            })

            it('accepts range operators with number', () => {
                const a: WhereFilterDefinition<TestObj> = { age: { $gt: 18 } };
                const b: WhereFilterDefinition<TestObj> = { age: { $lt: 65 } };
                const c: WhereFilterDefinition<TestObj> = { age: { $gte: 18, $lte: 65 } };
            })

            it('rejects range with wrong type (string for number range)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    age: {
                        // @ts-expect-error string is not number
                        $gte: 'a'
                    }
                };
            })

            it('rejects $contains', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    age: {
                        // @ts-expect-error $contains is string-only
                        $contains: 'x'
                    }
                };
            })

            it('rejects $regex', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    age: {
                        // @ts-expect-error $regex is string-only
                        $regex: '\\d+'
                    }
                };
            })

            it('accepts $ne with number', () => {
                const a: WhereFilterDefinition<TestObj> = { age: { $ne: 0 } };
            })

            it('accepts $in with number array', () => {
                const a: WhereFilterDefinition<TestObj> = { age: { $in: [25, 30, 35] } };
            })

            it('accepts $nin with number array', () => {
                const a: WhereFilterDefinition<TestObj> = { age: { $nin: [0] } };
            })

            it('accepts $not wrapping range', () => {
                const a: WhereFilterDefinition<TestObj> = { age: { $not: { $gte: 100 } } };
            })

            it('$not correctly rejects $contains/$regex (gated on T extends string)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    age: {
                        $not: {
                            // @ts-expect-error $contains inside $not is string-only
                            $contains: 'x'
                        }
                    }
                };
                const b: WhereFilterDefinition<TestObj> = {
                    age: {
                        $not: {
                            // @ts-expect-error $regex inside $not is string-only
                            $regex: '\\d+'
                        }
                    }
                };
            })
        })

        describe('boolean properties', () => {
            it('accepts exact boolean (true/false)', () => {
                const a: WhereFilterDefinition<TestObj> = { active: true };
                const b: WhereFilterDefinition<TestObj> = { active: false };
            })

            it('rejects wrong type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error string is not boolean
                    active: 'yes'
                };
            })

            it('rejects range ($gt etc)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    active: {
                        // @ts-expect-error range operators not available for boolean
                        $gt: true
                    }
                };
            })

            it('rejects $contains', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    active: {
                        // @ts-expect-error $contains is string-only
                        $contains: 'x'
                    }
                };
            })

            it('rejects $regex', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    active: {
                        // @ts-expect-error $regex is string-only
                        $regex: '.*'
                    }
                };
            })

            it('rejects $ne (resolves to never)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    active: {
                        // @ts-expect-error $ne resolves to never for boolean
                        $ne: true
                    }
                };
            })

            it('rejects $in (resolves to never[])', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    active: {
                        // @ts-expect-error $in resolves to never[] for boolean
                        $in: [true, false]
                    }
                };
            })

            it('rejects $nin (resolves to never[])', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    active: {
                        // @ts-expect-error $nin resolves to never[] for boolean
                        $nin: [true]
                    }
                };
            })
        })

        describe('object properties', () => {
            it('accepts exact object (deep equality) with correct shape', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    contact: { city: 'London', zip: 12345 }
                };
            })

            it('rejects wrong object shape', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error missing 'zip' property
                    contact: { city: 'London' }
                };
            })

            it('rejects range operators', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    contact: {
                        // @ts-expect-error range not available for objects
                        $gt: { city: 'A', zip: 0 }
                    }
                };
            })

            it('rejects $contains', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    contact: {
                        // @ts-expect-error $contains is string-only
                        $contains: 'x'
                    }
                };
            })

            it('rejects $regex', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    contact: {
                        // @ts-expect-error $regex is string-only
                        $regex: '.*'
                    }
                };
            })

            it('rejects $ne (resolves to never)', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    contact: {
                        // @ts-expect-error $ne resolves to never for objects
                        $ne: { city: 'London', zip: 12345 }
                    }
                };
            })

            it('rejects $in (resolves to never[])', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    contact: {
                        // @ts-expect-error $in resolves to never[] for objects
                        $in: [{ city: 'London', zip: 12345 }]
                    }
                };
            })
        })

        describe('literal union properties', () => {
            it('accepts exact literal value', () => {
                const a: WhereFilterDefinition<TestObj> = { status: 'pending' };
            })

            it('rejects non-member literal', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error 'unknown' is not in the union
                    status: 'unknown'
                };
            })

            it('accepts $in with literal union members', () => {
                const a: WhereFilterDefinition<TestObj> = { status: { $in: ['pending', 'resolved'] } };
            })

            it('accepts $ne with literal union member', () => {
                const a: WhereFilterDefinition<TestObj> = { status: { $ne: 'rejected' } };
            })

            it('accepts range operators (string-based union)', () => {
                const a: WhereFilterDefinition<TestObj> = { status: { $gte: 'a' } };
            })
        })

        describe('optional and nullable properties', () => {
            it('optional property: accepts exact string match', () => {
                const a: WhereFilterDefinition<TestObj> = { nickname: 'Bob' };
            })

            it('optional property: accepts $exists check', () => {
                const a: WhereFilterDefinition<TestObj> = { nickname: { $exists: true } };
            })

            it('optional property: rejects wrong type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error number is not string
                    nickname: 1
                };
            })

            it('nullable property: accepts exact string match', () => {
                const a: WhereFilterDefinition<TestObj> = { deletedAt: '2024-01-01' };
            })

            it('nullable property: accepts $exists check', () => {
                const a: WhereFilterDefinition<TestObj> = { deletedAt: { $exists: true } };
            })
        })
    })

    describe('3. Array comparisons', () => {

        describe('exact array match', () => {
            it('accepts array literal of correct element type', () => {
                const a: WhereFilterDefinition<TestObj> = { tags: ['a', 'b'] };
            })

            it('rejects array of wrong element type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error number[] not assignable to string[]
                    tags: [1, 2]
                };
            })
        })

        describe('scalar element match', () => {
            it('accepts scalar matching element type', () => {
                const a: WhereFilterDefinition<TestObj> = { tags: 'London' };
            })

            it('rejects scalar of wrong type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error number is not string (element type)
                    tags: 1
                };
            })
        })

        describe('compound object filter on array', () => {
            it('accepts WhereFilterDefinition<ElementType> for object arrays', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    addresses: { street: 'Main' }
                };
            })

            it('accepts logic filter ($and/$or) on object array elements', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    addresses: { $and: [{ street: 'Main' }, { primary: true }] }
                };
            })
        })

        describe('$elemMatch', () => {
            it('object array: accepts WhereFilterDefinition<T> inside', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    addresses: { $elemMatch: { street: 'Main' } }
                };
            })

            it('object array: accepts multi-key implicit $and', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    addresses: { $elemMatch: { street: 'Main', primary: true } }
                };
            })

            it('scalar array: accepts scalar value', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    scores: { $elemMatch: 5 }
                };
            })

            it('scalar array: accepts ValueComparisonFlexi', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    scores: { $elemMatch: { $gt: 5 } }
                };
            })

            it('scalar array: rejects wrong scalar type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error string is not number element type
                    scores: { $elemMatch: 'five' }
                };
            })
        })

        describe('$all', () => {
            it('accepts array of correct element type', () => {
                const a: WhereFilterDefinition<TestObj> = { tags: { $all: ['a', 'b'] } };
            })

            it('rejects wrong element type', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error number[] not assignable to string[]
                    tags: { $all: [1, 2] }
                };
            })
        })

        describe('$size', () => {
            it('accepts number', () => {
                const a: WhereFilterDefinition<TestObj> = { tags: { $size: 2 } };
            })

            it('rejects non-number', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error string is not number
                    tags: { $size: 'two' }
                };
            })

            it('rejects nested query', () => {
                const a: WhereFilterDefinition<TestObj> = {
                    // @ts-expect-error $size takes a number, not a query object
                    tags: { $size: { $gt: 0 } }
                };
            })
        })
    })

    describe('4. Dot-prop paths and array spreading', () => {
        it('accepts nested dot-prop path with correct type', () => {
            const a: WhereFilterDefinition<TestObj> = { 'contact.city': 'London' };
        })

        it('rejects wrong type for nested dot-prop', () => {
            const a: WhereFilterDefinition<TestObj> = {
                // @ts-expect-error number is not string
                'contact.city': 1
            };
        })

        it('rejects unknown nested path', () => {
            const a: WhereFilterDefinition<TestObj> = {
                // @ts-expect-error 'contact.unknown' is not a valid path
                'contact.unknown': 'x'
            };
        })

        it('array paths get ArrayFilter — use compound filter or $elemMatch, not dot-prop through array', () => {
            // Dot-prop paths stop at arrays; access element properties via array filter syntax
            const a: WhereFilterDefinition<TestObj> = {
                addresses: { street: 'Main' }
            };
            const b: WhereFilterDefinition<TestObj> = {
                addresses: { $elemMatch: { street: 'Main' } }
            };
        })
    })

    describe('5. Type guards', () => {
        it('isPartialObjectFilter narrows — can access property keys', () => {
            type NormalType = { name: string };
            function receiveFilter(a: WhereFilterDefinition<NormalType>) {
                if (isPartialObjectFilter(a)) {
                    a['name'];
                }
            }
        })

        it('isLogicFilter narrows — can access $or/$and/$nor', () => {
            type NormalType = { name: string };
            function receiveFilter(a: WhereFilterDefinition<NormalType>) {
                if (isLogicFilter(a) && a['$or']) {
                    a['$or'].some;
                }
            }
        })

        it('union not narrowed without guard — property access fails', () => {
            type NormalType = { name: string };
            function receiveFilter(a: WhereFilterDefinition<NormalType>) {
                // @ts-expect-error
                a['name']; // Cannot access without narrowing
            }
        })

        it('type guards work on untyped WhereFilterDefinition (no generic)', () => {
            const a: WhereFilterDefinition = { name: 'Bob' };
            if (isPartialObjectFilter(a)) {
                // narrows successfully
            } else if (isLogicFilter(a)) {
                // narrows successfully
            }
        })
    })

    describe('Regression', () => {
        it('handles complex discriminated unions with possibly infinite recursion [regression]', () => {

            interface Message<
                TProtocolMap extends Record<string, any> = any,
                TType extends keyof TProtocolMap = any,
            > {
                owner: 'owner';
                direction: 'request' | 'response';
                namespace?: string,
                id: number;
                data: GetDataType<TProtocolMap[TType]>;
                type: TType;
                timestamp: number;
            }


            type GetDataType<T> = T extends (...args: infer Args) => any
                ? Args['length'] extends 0 | 1
                ? Args[0]
                : any
                : never;


            type MessagingError = NoListenerError | ListenerConflictError | TimeOutError | ContextInvalidatedError | UnknownError | DataValidationError;

            type MessagingErrorLocation = 'sendMessage' | 'onMessage';

            interface BaseMessagingError {
                type: string,
                location: MessagingErrorLocation;
                description: string;
                message: Message;
            }

            interface NoListenerError extends BaseMessagingError {
                type: 'missing-or-stolen-listener';
            }

            interface ListenerConflictError extends BaseMessagingError {
                type: 'own-listener-conflict';
            }

            interface TimeOutError extends Omit<BaseMessagingError, 'message'> {
                type: 'time-out';
                message?: Message
            }


            interface DataValidationError extends Omit<BaseMessagingError, 'message'> {
                type: 'data-validation';
                data: any;
            }


            interface ContextInvalidatedError extends BaseMessagingError {
                type: 'context-invalidated';
            }

            interface UnknownError extends BaseMessagingError {
                type: 'unknown',
                serializedError: ErrorObject
            }


            type JsonObject = { [Key in string]: JsonValue } & { [Key in string]?: JsonValue | undefined };
            type JsonArray = JsonValue[] | readonly JsonValue[];
            type JsonPrimitive = string | number | boolean | null;
            type JsonValue = JsonPrimitive | JsonObject | JsonArray;
            type ErrorObject = {
                [x: string]: JsonValue; // This is the source of potentially infinite recursion
            } & {
                [x: string]: JsonValue | undefined; // This is the source of potentially infinite recursion
            } &{
                name?: string;
                message?: string;
                stack?: string;
                cause?: unknown;
                code?: string;
            }

            type MinimumContext = Record<string, any>;

            type BaseLogEntry<C = any, M extends MinimumContext = any> = {

                ulid: string,

                timestamp: number,

                context?: C,

                meta?: M,

                stack_trace?: string
            }
            type DebugLogEntry<C = any, M extends MinimumContext = any> = BaseLogEntry<C, M> & {
                type: 'debug',
                message: string
            };
            type InfoLogEntry<C = any, M extends MinimumContext = any> = BaseLogEntry<C, M> & {
                type: 'info',
                message: string
            };
            type WarnLogEntry<C = any, M extends MinimumContext = any> = BaseLogEntry<C, M> & {
                type: 'warn',
                message: string
            };
            type ErrorLogEntry<C = any, M extends MinimumContext = any> = BaseLogEntry<C, M> & {
                type: 'error',
                message: string
            };
            type CriticalLogEntry<C = any, M extends MinimumContext = any> = BaseLogEntry<C, M> & {
                type: 'critical',
                message: string
            };

            type BaseEventDetail = {
                name: string
            }
            type StartEventDetail = BaseEventDetail & {
                name: 'span_start'
            }
            type EndEventDetail = BaseEventDetail & {
                name: 'span_end'
            }
            type EventDetail = StartEventDetail | EndEventDetail;

            type EventLogEntry<C = any, M extends MinimumContext = any, E extends EventDetail = EventDetail> = BaseLogEntry<C, M> & {
                type: 'event',
                message?: string
                event: E
            };

            type LogEntry<C = any, M extends MinimumContext = any> =
                DebugLogEntry<C, M> |
                InfoLogEntry<C, M> |
                WarnLogEntry<C, M> |
                ErrorLogEntry<C, M> |
                CriticalLogEntry<C, M> |
                EventLogEntry<C, M>;

            interface ILogStorage {
                get<T extends LogEntry = LogEntry>(filter?:WhereFilterDefinition<T>, fullTextFilter?: string): Promise<T[]>;
            }

            const logStorage:ILogStorage = {
                get: async () => []
            }

            // Run the type checks. All should be ok with no type errors (actual result in line comments below).
            logStorage.get<LogEntry<MessagingError>>(); // No type error
            logStorage.get<LogEntry<ErrorObject>>({'context': {}})
            logStorage.get<LogEntry<ErrorObject>>({'context.message': 1}); // Problem: doesn't fail like it should, as it needs to be a string not a number
            logStorage.get<LogEntry<ErrorObject>>({'context.message2': ''}); // Problem: doesn't fail like it should, as it's not a key on ErrorObject

            logStorage.get<LogEntry>({'type': 'error'}); // No type error
            logStorage.get<LogEntry<MessagingError>>({'type': 'error'}); // No type error
            logStorage.get<LogEntry<MessagingError>>({'context.message.data': {}}); // No type error. Notice it goes 3 deep just fine.
            // @ts-expect-error unknown key
            logStorage.get<LogEntry<MessagingError>>({'context.message.data2': {}}); // Good type error: it correctly catches 'data2' is not a key.
            // @ts-expect-error unknown key
            logStorage.get<LogEntry<MessagingError>>({'context.nokey': ''}); // No type error. Notice it goes 3 deep just fine.
            logStorage.get<LogEntry<MessagingError>>({'context.message.id': 1});
            // @ts-expect-error wrong type
            logStorage.get<LogEntry<MessagingError>>({'context.message.id': '1'});

            logStorage.get<LogEntry<MessagingError>>({$and: [
                {
                    'context.message.direction': 'request'
                },
                {
                    'context.type': 'context-invalidated'
                }
            ]});


            logStorage.get<LogEntry<MessagingError>>({$and: [
                {
                    'context.message.direction': 'request'
                },
                {
                    // @ts-expect-error Not a known type value
                    'context.type': 'bad-value'
                }
            ]});

            // ErrorObject is basically a Record<string, any>, so it cannot restrict keys.
            logStorage.get<LogEntry<MessagingError>>({'context.serializedError': {}}); // Ok
            logStorage.get<LogEntry<MessagingError>>({'context.serializedError.stack': 1}); // Problem: it should recognise this should be a string not a number
            logStorage.get<LogEntry<MessagingError>>({'context.serializedError.stack2': ''}); // Ok. It's a Record<string, any> at heart, so it allows anything.

        })
    })

    describe('Known limitations (documentation)', () => {
        it('handles a variable of the same type', () => {

            type MessagingError = NoListenerError | TimeOutError;

            type MessagingErrorLocation = 'sendMessage' | 'onMessage';
            type Message = {};

            interface BaseMessagingError {
                type: string,
                location: MessagingErrorLocation;
                description: string;
                message: Message;
            }

            interface NoListenerError extends BaseMessagingError {
                type: 'missing-or-stolen-listener';
            }

            interface TimeOutError extends Omit<BaseMessagingError, 'message'> {
                type: 'time-out';
                message?: Message
            }

            function test(type: keyof MessagingError) {
                const b: WhereFilterDefinition<{error: MessagingError}> = {
                    // @ts-ignore The types are the same. It should work
                    'error.type': type
                    //'error.type': 'missing-or-stolen-listener' // DOing it inline does work
                }

            }


        })

        it('handles top level array', () => {

            type Obj = {name: string};
            const b: WhereFilterDefinition<Obj[]> = {
                // It finds no dot prop: but I'd expect a top level $elemMatch on it
            }

        })

        it('handles an object or array union', () => {
            type Obj = {name: string};
            const b: WhereFilterDefinition<{objects: Obj | Obj[]}> = {
                // Finds no dot-prop, but I'd expect it offer both object or $elemMatch for array. And to handle both.
            }
        })

        it('treat nested objects are partial matches, not deepEql', () => {
            type Obj = {name: string, sibling: {name: string, age: number}};

            // Currently this is how to do sibling.name:
            const a: WhereFilterDefinition<Obj> = {
                'sibling.name': 'Bob'
            }

            // But in regular use I found myself attempting this and being confused about why it doesn't let me do partials. (It's because its a deepEql comparison requiring the full object beyond the top level).
            const b: WhereFilterDefinition<Obj> = {
                // @ts-expect-error Oh it does actually throw an error for not using 'age'. It's perhaps more a mental model thing.
                // I.e. that WhereFilterDefinition is only dot-prop keys, not partial nesting.
                // But maybe Mongo allows it to be more explicit?
                'sibling': {
                    'name': 'Bob',
                    //'age': 1
                }
            }

            // I think in Mongo the default is it would work. And if you want to match a full object you provide everything. We should mimic that.


        })

        it('should try to control types even on permissive records', () => {
            type ErrorObject = {[x: string]: any;} & {
                name?: string;
                message?: string;
                stack?: string;
                cause?: unknown;
                code?: string;
            }

            // Sadly this currently doesn't work.
            // In an ideal world, it detect that "message" has to be a string. But typescript flips into full permissive mode.
            const a: WhereFilterDefinition<ErrorObject> = {
                'message': 1 // Expect this to fail because of in ErrorObject 'message' is a string. But it doesn't fail. It doesn't have any opinion on any key.
            }
        })
    })
})


describe('PartialObjectFilterStrict types', () => {
    type Doc = {
        name: string;
        age: number;
        contact: { city: string; zip: number };
        addresses: { street: string; primary: boolean }[];
        tags: string[];
    };

    describe('accepts the same field-level shapes as PartialObjectFilter', () => {
        it('top-level scalar equality', () => {
            const a: PartialObjectFilterStrict<Doc> = { name: 'Andy' };
        });

        it('range operators on a scalar field', () => {
            const a: PartialObjectFilterStrict<Doc> = { age: { $gte: 18, $lte: 65 } };
        });

        it('$in / $nin / $exists / $regex on appropriate fields', () => {
            const a: PartialObjectFilterStrict<Doc> = { name: { $in: ['Andy', 'Bob'] } };
            const b: PartialObjectFilterStrict<Doc> = { age: { $nin: [0] } };
            const c: PartialObjectFilterStrict<Doc> = { name: { $exists: true } };
            const d: PartialObjectFilterStrict<Doc> = { name: { $regex: '^And' } };
        });

        it('$elemMatch on object array with field operators inside', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                addresses: { $elemMatch: { street: 'Main' } }
            };
            const b: PartialObjectFilterStrict<Doc> = {
                addresses: { $elemMatch: { street: 'Main', primary: true } }
            };
        });

        it('$elemMatch on scalar array with value comparison inside', () => {
            const a: PartialObjectFilterStrict<Doc> = { tags: { $elemMatch: 'foo' } };
            const b: PartialObjectFilterStrict<Doc> = { tags: { $elemMatch: { $regex: 'fo' } } };
        });

        it('$all and $size on array fields', () => {
            const a: PartialObjectFilterStrict<Doc> = { tags: { $all: ['a', 'b'] } };
            const b: PartialObjectFilterStrict<Doc> = { tags: { $size: 2 } };
        });

        it('nested dot-prop path', () => {
            const a: PartialObjectFilterStrict<Doc> = { 'contact.city': 'London' };
        });
    });

    describe('rejects logic operators at the top level', () => {
        it('rejects top-level $or', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                // @ts-expect-error — $or rejected by PartialObjectFilterStrict
                $or: [{ name: 'Andy' }, { age: 30 }]
            };
        });

        it('rejects top-level $and', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                // @ts-expect-error — $and rejected by PartialObjectFilterStrict
                $and: [{ name: 'Andy' }, { age: 30 }]
            };
        });

        it('rejects top-level $nor', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                // @ts-expect-error — $nor rejected by PartialObjectFilterStrict
                $nor: [{ name: 'Andy' }]
            };
        });
    });

    describe('rejects logic operators nested inside $elemMatch (recursion contract)', () => {
        it('rejects $or inside $elemMatch on object array', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                addresses: {
                    $elemMatch: {
                        // @ts-expect-error — $or inside $elemMatch rejected by PartialObjectFilterStrict
                        $or: [{ street: 'Main' }, { primary: true }]
                    }
                }
            };
        });

        it('rejects $and inside $elemMatch on object array', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                addresses: {
                    $elemMatch: {
                        // @ts-expect-error — $and inside $elemMatch rejected by PartialObjectFilterStrict
                        $and: [{ street: 'Main' }, { primary: true }]
                    }
                }
            };
        });

        it('rejects $nor inside $elemMatch on object array', () => {
            const a: PartialObjectFilterStrict<Doc> = {
                addresses: {
                    $elemMatch: {
                        // @ts-expect-error — $nor inside $elemMatch rejected by PartialObjectFilterStrict
                        $nor: [{ primary: false }]
                    }
                }
            };
        });
    });

    describe('Regression guard — PartialObjectFilter (loose) still accepts logic inside $elemMatch', () => {
        // If the loose variant ever stops accepting nested logic-in-$elemMatch,
        // 11+ existing tests in standardTests.ts break. This pin catches that
        // accidental tightening — flips to compile error if PartialObjectFilter
        // is changed to recurse into a non-LogicFilter type.
        it('PartialObjectFilter accepts $or inside $elemMatch (loose contract preserved)', () => {
            const a: PartialObjectFilter<Doc> = {
                addresses: {
                    $elemMatch: {
                        $or: [{ street: 'Main' }, { primary: true }]
                    }
                }
            };
        });

        it('PartialObjectFilter accepts $and inside $elemMatch (loose contract preserved)', () => {
            const a: PartialObjectFilter<Doc> = {
                addresses: {
                    $elemMatch: {
                        $and: [{ street: 'Main' }, { primary: true }]
                    }
                }
            };
        });
    });
});
