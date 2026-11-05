export function unpackProp(prop: any): any {
    if (prop === null || prop === undefined) return undefined;
    if (typeof prop !== 'object') return prop;
    const keys = Object.keys(prop);
    if (keys.length === 0) return undefined;

    const winningKey = getHighestClientId(keys);
    const val = prop[winningKey];
    if (typeof val === 'object' && val !== null && 'value' in val) {
        return val.value;
    }
    return val;
}

function getHighestClientId(keys: string[]): string {
    keys.sort((a, b) => {
        const numA = Number(a);
        const numB = Number(b);
        if (!isNaN(numA) && !isNaN(numB)) {
            return numB - numA;
        }
        return b.localeCompare(a);
    });
    return keys[0];
}