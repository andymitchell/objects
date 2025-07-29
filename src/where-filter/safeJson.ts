export function safeJson(object: any, initial = 'na', unparsable = 'unknowable'):string {
    let json = initial;
    try {
        json = JSON.stringify(object);
    } catch(e) {
        json = unparsable
    }
    return json;
}