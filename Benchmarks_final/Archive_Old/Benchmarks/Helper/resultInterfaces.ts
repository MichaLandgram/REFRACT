export interface Edge { src: string; tgt: string; creationDate: string; _edgeId: string; }

export type EagerEdge = { _edgeId: string; [k: string]: any };

export interface NormPerson {
    firstName:   string;
    lastName:    string;
    gender:      string;
    birthday:    string;
    locationIP:  string;
    browserUsed: string;
}

export interface RQ1_2_Result {
    smo:              string;
    rep:              number;
    N:                number;
    E:                number;
    stub:             boolean;
    smoMs:            number;
    lensGenMs:        number;
    lazyReadyMs:      number;
    cambriaSmoMs:     number;
    cambriaReadyMs:   number;
    eagerMigrationMs: number;
}


export interface RQ1Metrics {
    smo: 'renameL' | 'removePk' | 'splitNT';
    N: number;

    smoMs:            number; 
    lensGenMs:        number;
    lazyReadyMs:      number;

    cambriaSmoMs:     number;
    cambriaReadyMs:   number;

    eagerMigrationMs: number;
}

export interface RQ2_2_Result {
    smo:              string;
    rep:              number;
    N:                number;
    PerNodeUs:          number;
    cambriaPerNodeUs: number;
    eagerPerNodeUs:   number;
    RMs:          number;
    cambriaMs:        number;
    eagerMs:          number;
    correct:          boolean;
    note:             string;
}

export interface RQ3_FS_Result {
    smo:              string;
    factor:           1 | 2; // not used anymore
    N:                number;
    E:                number;
    rep:              number;
    smoMs:            number;
    lensGenMs:        number;
    lazyReadyMs:      number;
    eagerMigrationMs: number;
    RQueryMs:            number;
    eagerQueryMs:     number;
    tippingPoint:      number;
}