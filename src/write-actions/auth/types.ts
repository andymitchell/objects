export interface IUser {
    getID():string | undefined;
    getUuid():string | undefined;
    getEmail():string | undefined;
}


export function isIUser(x:unknown): x is IUser {
    if (typeof x === 'object' && x !== null) {
        const hasEmail = "getEmail" in x && typeof x.getEmail==='function';
        const hasUuid = "getUuid" in x && typeof x.getUuid==='function';

        return hasEmail && hasUuid;
    }
    return false;
}