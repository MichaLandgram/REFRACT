import * as fs from 'fs';
import * as path from 'path';



// Should be the central point of loading



/** Default location of the LDBC SF0.1 initial snapshot (relative to cwd). */
export const SF01_DIR = path.join(
    'snb-output-sf0.1',
    'graphs', 'csv', 'bi', 'composite-merged-fk', 'initial_snapshot',
);

/** LDBC SF3 initial snapshot. */
export const SF03_DIR = path.join(
    'snb-output-sf3',
    'graphs', 'csv', 'bi', 'composite-merged-fk', 'initial_snapshot',
);

export interface SnbNodes {
    persons:       Record<string, any>[];
    posts:         Record<string, any>[];
    comments:      Record<string, any>[];
    forums:        Record<string, any>[];
    organizations: Record<string, any>[];
    places:        Record<string, any>[];
    tags:          Record<string, any>[];
    tagClasses:    Record<string, any>[];
}

export interface SnbEdges {
    knows:                 Record<string, any>[];

    postHasCreator:        Record<string, any>[];
    commentHasCreator:     Record<string, any>[];

    personLikesPost:       Record<string, any>[];
    personLikesComment:    Record<string, any>[];

    commentReplyOfPost:    Record<string, any>[];
    commentReplyOfComment: Record<string, any>[];

    containerOf:           Record<string, any>[];
    hasMember:             Record<string, any>[];

    postHasTag:            Record<string, any>[]
    commentHasTag:         Record<string, any>[];
    forumHasTag:           Record<string, any>[];

    studyAt:               Record<string, any>[];
    workAt:                Record<string, any>[];

    personIsLocatedIn:     Record<string, any>[];
    isPartOf:              Record<string, any>[];
    hasType:               Record<string, any>[];
    isSubclassOf:          Record<string, any>[];
}

export interface SnbData extends SnbNodes, SnbEdges {}


export function readSnbNodes(sfDir: string): SnbNodes {
    return {
        persons:       read(sfDir, 'dynamic', 'Person'),
        posts:         read(sfDir, 'dynamic', 'Post'),
        comments:      read(sfDir, 'dynamic', 'Comment'),
        forums:        read(sfDir, 'dynamic', 'Forum'),
        organizations: read(sfDir, 'static',  'Organisation'),
        places:        read(sfDir, 'static',  'Place'),
        tags:          read(sfDir, 'static',  'Tag'),
        tagClasses:    read(sfDir, 'static',  'TagClass'),
    };
}


export function readSnbEdges(sfDir: string): SnbEdges {
    return {
        knows:                 read(sfDir, 'dynamic', 'Person_knows_Person'),
        postHasCreator:        read(sfDir, 'dynamic', 'Post_hasCreator_Person'),
        commentHasCreator:     read(sfDir, 'dynamic', 'Comment_hasCreator_Person'),
        personLikesPost:       read(sfDir, 'dynamic', 'Person_likes_Post'),
        personLikesComment:    read(sfDir, 'dynamic', 'Person_likes_Comment'),
        commentReplyOfPost:    read(sfDir, 'dynamic', 'Comment_replyOf_Post'),
        commentReplyOfComment: read(sfDir, 'dynamic', 'Comment_replyOf_Comment'),
        containerOf:           read(sfDir, 'dynamic', 'Forum_containerOf_Post'),
        hasMember:             read(sfDir, 'dynamic', 'Forum_hasMember_Person'),
        postHasTag:            read(sfDir, 'dynamic', 'Post_hasTag_Tag'),
        commentHasTag:         read(sfDir, 'dynamic', 'Comment_hasTag_Tag'),
        forumHasTag:           read(sfDir, 'dynamic', 'Forum_hasTag_Tag'),
        studyAt:               read(sfDir, 'dynamic', 'Person_studyAt_Organisation'),
        workAt:                read(sfDir, 'dynamic', 'Person_workAt_Organisation'),
        personIsLocatedIn:     read(sfDir, 'static',  'Person_isLocatedIn_City'),
        isPartOf:              read(sfDir, 'static',  'Place_isPartOf_Place'),
        hasType:               read(sfDir, 'static',  'Tag_hasType_TagClass'),
        isSubclassOf:          read(sfDir, 'static',  'TagClass_isSubclassOf_TagClass'),
    };
}

function isInt(s: string): boolean {
    if (s.length === 0) return false;
    const start = s.charCodeAt(0) === 45 ? 1 : 0;
    if (start === s.length) return false;
    for (let i = start; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 48 || c > 57) return false;
    }
    return true;
}

// new TODO replace everywhere
function parseCsvFast(filePath: string): Record<string, any>[] {
    if (!fs.existsSync(filePath)) { console.warn(`CSV not found: ${filePath}`); return []; }
    const raw   = fs.readFileSync(filePath, 'utf-8');
    const nl    = raw.indexOf('\n');
    if (nl === -1) return [];
    const headers = raw.slice(0, nl).trimEnd().split('|');
    const nCols   = headers.length;
    const rows: Record<string, any>[] = [];
    let pos = nl + 1;
    while (pos < raw.length) {
        let end = raw.indexOf('\n', pos);
        if (end === -1) end = raw.length;
        const line = raw.slice(pos, end).trimEnd();
        pos = end + 1;
        if (line.length === 0) continue;
        const vals = line.split('|');
        const rec: Record<string, any> = {};
        for (let i = 0; i < nCols; i++) {
            const v = vals[i] ?? '';
            rec[headers[i]] = isInt(v) ? Number(v) : v;
        }
        rows.push(rec);
    }
    return rows;
}
// old
export function parseLdbcCsv(filePath: string): Record<string, any>[] {
    if (!fs.existsSync(filePath)) { console.warn(`CSV not found: ${filePath}`); return []; }
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split('|');
    return lines.slice(1).map((line: string) => {
        const vals = line.split('|');
        const rec: Record<string, any> = {};
        headers.forEach((h, i) => {
            const v = vals[i] ?? '';
            rec[h] = /^\d+$/.test(v) ? Number(v) : v;
        });
        return rec;
    });
}

export function findCsvFile(dir: string): string {
    if (!fs.existsSync(dir)) return '';
    const f = fs.readdirSync(dir).find(f => f.endsWith('.csv') && !f.startsWith('.'));
    return f ? path.join(dir, f) : '';
}

export function parseCsv(filePath: string): Record<string, any>[] {
    return parseCsvFast(filePath);
}

function read(sfDir: string, ...segments: string[]): Record<string, any>[] {
    return parseCsv(findCsvFile(path.join(sfDir, ...segments)));
}

export interface SnbPersonsAndKnows {
    persons: Record<string, any>[];
    knows:   Record<string, any>[];
}

export function readSnbPersonsAndKnows(sfDir: string): SnbPersonsAndKnows {
    const resolved    = path.resolve(process.cwd(), sfDir);
    const personFile  = findCsvFile(path.join(resolved, 'dynamic', 'Person'));
    const knowsFile   = findCsvFile(path.join(resolved, 'dynamic', 'Person_knows_Person'));
    const cacheFile   = path.join(resolved, '..', '..', '..', '..', '.persons_knows_cache.json');

    if (personFile && fs.existsSync(cacheFile)) {
        const csvMtime   = fs.statSync(personFile).mtimeMs;
        const cacheMtime = fs.statSync(cacheFile).mtimeMs;
        if (cacheMtime > csvMtime) {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
            return cached;
        }
    }

    const persons = personFile ? parseCsvFast(personFile) : [];
    const knows   = knowsFile  ? parseCsvFast(knowsFile)  : [];

    fs.writeFileSync(cacheFile, JSON.stringify({ persons, knows }));

    return { persons, knows };
}


export function readSnbData(sfDir: string = SF01_DIR): SnbData {
    const resolved = path.resolve(process.cwd(), sfDir);

    if (!fs.existsSync(resolved)) {
        throw new Error(
            `SnbDataReader: snapshot directory not found:\n  ${resolved}\n` +
            `Run LDBC datagen first (docker-compose up in snb-datagen/).`
        );
    }

    const nodes = readSnbNodes(resolved);
    const edges = readSnbEdges(resolved);

    Object.entries(nodes).forEach(([k, v]) =>
        console.log(`  ${k.padEnd(14)} ${v.length} rows`));
    Object.entries(edges).forEach(([k, v]) =>
        v.length > 0 && console.log(`  ${k.padEnd(14)} ${v.length} rows`));

    return { ...nodes, ...edges };
}
