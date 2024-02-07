type KeyValuePair = {
    keyPath: string;
    value: string | number | boolean;
};

export default function convertObjectToDotProp(obj: Record<string, any>): KeyValuePair[] {
    return _convertObjectToDotProp(obj);
}
function _convertObjectToDotProp(obj: Record<string, any>, prefix = ''): KeyValuePair[] {
    let result: KeyValuePair[] = [];

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            const fullPath = prefix ? `${prefix}.${key}` : key;

            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                result = result.concat(_convertObjectToDotProp(value, fullPath));
            } else {
                result.push({ keyPath: fullPath, value });
            }
        }
    }

    return result;
}