/**
 * Identity contract for ownership checks — provides user claims (UUID, email).
 *
 * Why: Decouples ownership logic from any specific auth implementation.
 *
 * @example
 * const user: IUser = { getID: () => 'u1', getUuid: () => 'u1', getEmail: () => 'a@b.com' };
 */
export interface IUser {
    getID():string | undefined;
    getUuid():string | undefined;
    getEmail():string | undefined;
}

/**
 * Runtime typeguard for IUser.
 *
 * @example
 * if (isIUser(maybeUser)) console.log(maybeUser.getUuid());
 */
export function isIUser(x:unknown): x is IUser {
    if (typeof x === 'object' && x !== null) {
        const hasEmail = "getEmail" in x && typeof x.getEmail==='function';
        const hasUuid = "getUuid" in x && typeof x.getUuid==='function';

        return hasEmail && hasUuid;
    }
    return false;
}
