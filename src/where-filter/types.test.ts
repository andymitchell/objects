
import { isLogicFilter, isPartialObjectFilter } from "./typeguards.ts";
import { type WhereFilterDefinition } from "./types.ts"



it('it correctly identifies the available keys, and their type, and there is no type-error because the object property matches the type', () => {

    type NormalType = { name: '2' };

    const a: WhereFilterDefinition<NormalType> = {
        name: '2'
    }

})

it('it correctly identifies the available keys, and their type, but there is a type-error because the object property has the wrong the type', () => {

    type NormalType = { name: '2' };

    const a: WhereFilterDefinition<NormalType> = {
        // @ts-expect-error
        name: 1 // OK type error because it's not '2'
    }

})


it('it correctly identifies the available dot prop sub keys, and their type, and there is no type-error because the object property matches the type', () => {

    type NormalType = { name: '2', 'child': { age: number } };

    const a: WhereFilterDefinition<NormalType> = {
        "child.age": 1
    }

})


it('it correctly identifies the available dot prop sub keys, and their type, but there is a type-error because the object property matches the type', () => {

    type NormalType = { name: '2', 'child': { age: number } };

    const a: WhereFilterDefinition<NormalType> = {
        // @ts-expect-error
        "child.age": 'abc'  // OK type error because it's not a number
    }

})


it('it throws a type error if using an unknown key', () => {

    type NormalType = { name: '2', 'child': { age: number } };

    const a: WhereFilterDefinition<NormalType> = {
        // @ts-expect-error
        "child2": 1 // OK type error because it's not a known key
    }

})

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
        name?: string;
        message?: string;
        stack?: string;
        cause?: unknown;
        code?: string;
    } & {
        [x: string]: JsonValue; // This is the source of potentially infinite recursion 
    } & {
        [x: string]: JsonValue | undefined; // This is the source of potentially infinite recursion 
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

    logStorage.get<LogEntry<MessagingError>>({AND: [
        {
            'context.message.direction': 'request'
        },
        {
            'context.type': 'context-invalidated'
        }
    ]});


    logStorage.get<LogEntry<MessagingError>>({AND: [
        {
            'context.message.direction': 'request'
        },
        {
            // @ts-expect-error Not a known type value
            'context.type': 'bad-value'
        }
    ]});

    // WIP Investigating why serialized error fails
    logStorage.get<LogEntry<MessagingError>>({'context.serializedError': {}}); // Problem: it cannot go deeper than 'context.serializedError'. It just ignores it. Possibly because ErrorObject has infinite recursion and a lot of the Path tracing guards against it. 
    logStorage.get<LogEntry<MessagingError>>({'context.serializedError.stack': ''}); // Interestingly there's no type error (which is right because it exists, but the permutations of paths doesn't seem to know that - there's no suggestion below 'context.serializedError')
    logStorage.get<LogEntry<MessagingError>>({'context.serializedError.stack2': ''}); // Problem: no error even thought 'stack2' does not exist. It's just given up on context.serializedError. 
    
})

it('with a discriminated union, even though a propery is not always present, it should be allowed as a PartialObjectFilter and have the correct type', () => {


    type DiscrimatedUnion = { name: '1', message: string } | { name: '2' };

    const a: WhereFilterDefinition<DiscrimatedUnion> = {
        message: 'a'
    }

})


describe('Receive filter parameter in a function', () => {
    // WhereFilterDefinition<TheType> will fail if it isn't setting the object, because 
    // WhereFilterDefinition is a union type that can either be a logic filter or partial object filter, but TypeScript cannot infer which. 


    it('showcasing the problem', () => {
        type NormalType = { name: string };

        function receiveFilter(a: WhereFilterDefinition<NormalType>) {
            // @ts-expect-error
            a['name']; // This will fail, because TypeSCript cannot be sure which part of the union it receive (logic of values)
        }
    })

    it('works if first test if logic or partial', () => {
        type NormalType = { name: string };
        function receiveFilter(a: WhereFilterDefinition<NormalType>) {
            if (isPartialObjectFilter(a)) {
                a['name'];
            }
            if (isLogicFilter(a) && a['OR']) {
                a['OR'].some;
            }
        }

    })
})

describe("type guards", () => {
    it('Can use isPartialObjectFilter even if no type defined', () => {
        const a: WhereFilterDefinition = { name: 'Bob' };

        if (isPartialObjectFilter(a)) {

        } else if (isLogicFilter(a)) {

        }
    })

})