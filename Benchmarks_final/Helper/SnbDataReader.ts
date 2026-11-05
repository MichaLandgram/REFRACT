import * as fs from 'fs';
import * as path from 'path';
import { SnbNodes, SnbEdges, SnbData } from './interfaces';
import { SF01_DIR } from './benchHelper';
import { cutNodes as padPersons} from './benchHelper';
import { Edge } from '../Helper/interfaces';


/* find the first CSV file in the given directory, ignoring hidden files */
export function findCsvFile(dir: string): string {
    if (!fs.existsSync(dir)) return '';
    const f = fs.readdirSync(dir).find(f => f.endsWith('.csv') && !f.startsWith('.'));
    return f ? path.join(dir, f) : '';
}
/* easy CSV read abstraction */
function read(sfDir: string, ...segments: string[]): Record<string, any>[] {
    return parseCsvFast(findCsvFile(path.join(sfDir, ...segments)));
}

// safe is safe helper to check if a string is an integer
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

export function readSnbPersonsAndKnows(sfDir: string): { persons: Record<string, any>[]; knows: Record<string, any>[] } {
    const resolved    = path.resolve(process.cwd(), sfDir);
    const personFile  = findCsvFile(path.join(resolved, 'dynamic', 'Person'));
    const knowsFile   = findCsvFile(path.join(resolved, 'dynamic', 'Person_knows_Person'));
    const cacheFile   = path.join(resolved, '..', '..', '..', '..', '.persons_knows_cache.json');

    // check if cache exists and is newer than the CSV files - if so, use the cache 
    // makes it a bit faster
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

export function getPersonIds(persons: Record<string, any>[]): Set<string> {
    return new Set(persons.map(p => String(p.id)));
}

export function filterKnowsEdges(knows: Record<string, any>[], personIds: Set<string>): Record<string, any>[] {
    return knows.filter(e => personIds.has(String(e.Person1Id)) && personIds.has(String(e.Person2Id)));
}

export function fullReaderPipelineKnowsAndPersons(cutoff: number = 1000): { persons: Record<string, any>[]; edges: Record<string, any>[]; warmP: Record<string, any>[]; warmE: Record<string, any>[] } {

    const sfDir     = path.resolve(process.cwd(), SF01_DIR);
    const data       = readSnbPersonsAndKnows(sfDir);
    const allPersons = data.persons;
    const persons    = padPersons(allPersons, cutoff);
    const personIds  = new Set(persons.map(p => String(p.id)));
    const edges: Edge[] = (() => {
        const edgeDir = path.join(sfDir, 'dynamic', 'Person_knows_Person');
        if (!fs.existsSync(edgeDir)) {
            console.warn('knows directory not found:', edgeDir);
            return [];
        }
        const f = fs.readdirSync(edgeDir).find(f => f.endsWith('.csv'));
        if (!f) { console.warn('knows no CSV in', edgeDir); return []; }

        const filePath = path.join(edgeDir, f);
        const lines = fs.readFileSync(filePath, 'utf-8')
            .split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) { console.warn('knows empty file', filePath); return []; }

        const headers = lines[0].split('|');

        let iSrc = headers.indexOf('Person1Id');
        let iTgt = headers.indexOf('Person2Id');
        let iDt  = headers.indexOf('creationDate');
        if (iSrc < 0 || iTgt < 0) {
            iSrc = headers.indexOf('Person.id');
            iTgt = headers.indexOf('Person.id.1');
        }
        if (iSrc < 0 || iTgt < 0) {
            iSrc = 1; iTgt = 2; iDt = 0;
        }
        // filter edges to only include those where both src and tgt are in the personIds set :)
        const result: Edge[] = [];
        for (let i = 1; i < lines.length; i++) {
            const v = lines[i].split('|');
            const src = v[iSrc] ?? '', tgt = v[iTgt] ?? '';
            if (personIds.has(src) && personIds.has(tgt))
                result.push({ src, tgt, creationDate: v[iDt] ?? '', _edgeId: `knows-${src}-${tgt}` });
        }

        if (result.length === 0 && lines.length > 1) {
            const sample = lines[1].split('|');
            console.warn('knows 0 edges matched. First row:', sample, '| personIds sample:', Array.from(personIds).slice(0, 5));
        }
        return result;
    })();

    const warmP   = padPersons(allPersons, 50);
    const warmIds = new Set(warmP.map(p => String(p.id)));
    const warmE   = edges.filter(e => warmIds.has(e.src) && warmIds.has(e.tgt));

    return { persons, edges, warmP, warmE };

}