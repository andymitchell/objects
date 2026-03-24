import type { IUser } from "../../write-actions/auth/types.ts";

/**
 * Creates a test IUser with configurable identity claims.
 *
 * Decouples ownership tests from any real auth implementation.
 *
 * @example
 * const alice = mockUser({ uuid: 'alice-uuid', email: 'alice@test.com' });
 * const anonymous = mockUser({});
 */
export function mockUser(config: {
    id?: string,
    uuid?: string,
    email?: string,
}): IUser {
    return {
        getID: () => config.id ?? config.uuid,
        getUuid: () => config.uuid,
        getEmail: () => config.email,
    };
}
