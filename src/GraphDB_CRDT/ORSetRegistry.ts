import * as Y from 'yjs';

export class ORSetRegistry {
    private doc: Y.Doc;
    private registryName: string;
    private tombstonesName: string;
    private _index: Map<string, Set<string>> | null = null;
    private static KEY_SEPARATOR = ':';

    constructor(doc: Y.Doc, registryName: string) {
        this.doc = doc;
        this.registryName = registryName;
        this.tombstonesName = `${registryName}_tombstones`;
        doc.getMap(registryName).observe(() => { this._index = null; });
        doc.getMap(`${registryName}_tombstones`).observe(() => { this._index = null; });
    }

    private getIndex(): Map<string, Set<string>> {
    if (this._index !== null) return this._index;
    const registry   = this.getRegistry();
    const tombstones = this.getTombstones();
    const index      = new Map<string, Set<string>>();
    registry.forEach((v, key) => {
        const parsed = this.parseKey(key);
        if (!parsed) return;
        if (tombstones.has(parsed.tag)) return;
        let tags = index.get(parsed.id);
        if (!tags) { tags = new Set(); index.set(parsed.id, tags); }
        tags.add(parsed.tag);
    });
    this._index = index;
    return index;
    }

    private getRegistry(): Y.Map<number> {
        return this.doc.getMap(this.registryName) as Y.Map<number>;
    }

    private getTombstones(): Y.Map<boolean> {
        return this.doc.getMap(this.tombstonesName) as Y.Map<boolean>;
    }
    private composeKey(id: string, tag: string): string {
        return `${id}${ORSetRegistry.KEY_SEPARATOR}${tag}`;
    }

    private parseKey(key: string): { id: string; tag: string } | null {
        const sepIndex = key.indexOf(ORSetRegistry.KEY_SEPARATOR);
        if (sepIndex === -1) return null;
        return {
            id: key.substring(0, sepIndex),
            tag: key.substring(sepIndex + 1)
        };
    }

    private generateTag(): string {
        const uuid = crypto.randomUUID();
        return `t_${this.doc.clientID}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${uuid}`;
    }

    public add(id: string, tag?: string): string {
        const registry = this.getRegistry();
        const newTag = tag || this.generateTag();
        const key = this.composeKey(id, newTag);

        this.doc.transact(() => {
            registry.set(key, Date.now());
        });

        return newTag;
    }

    public remove(id: string): void {
        const tombstones = this.getTombstones();
        const tagsForId = this.getAllTagsForId(id);

        if (tagsForId.length === 0) return;

        this.doc.transact(() => {
            tagsForId.forEach(tag => {
                tombstones.set(tag, true);
            });
        });
    }

    private getAllTagsForId(id: string): string[] {
        const tags = this.getIndex().get(id);
        return tags ? Array.from(tags) : [];
    }

    public isAlive(id: string): boolean {
        const tags = this.getIndex().get(id);
        return tags !== undefined && tags.size > 0;
    }

    public getAliveTags(id: string): string[] {
        const tombstones = this.getTombstones();
        const tags = this.getAllTagsForId(id);

        return tags.filter(tag => !tombstones.has(tag));
    }

    public isTagAlive(tag: string): boolean {
        const tombstones = this.getTombstones();
        return !tombstones.has(tag);
    }

    public getAllAlive(): string[] {
        return Array.from(this.getIndex().keys());
    }

    public has(id: string): boolean {
        return this.getAllTagsForId(id).length > 0;
    }

    public getAllTags(id: string): Map<string, { timestamp: number; alive: boolean }> {
        const registry = this.getRegistry();
        const tombstones = this.getTombstones();
        const prefix = id + ORSetRegistry.KEY_SEPARATOR;
        const result = new Map<string, { timestamp: number; alive: boolean }>();

        registry.forEach((timestamp, key) => {
            if (key.startsWith(prefix)) {
                const parsed = this.parseKey(key);
                if (parsed) {
                    result.set(parsed.tag, {
                        timestamp,
                        alive: !tombstones.has(parsed.tag)
                    });
                }
            }
        });

        return result;
    }
}

