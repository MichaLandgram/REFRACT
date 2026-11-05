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

export interface Edge { src: string; tgt: string; creationDate: string; _edgeId: string; }
