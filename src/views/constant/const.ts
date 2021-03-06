export const markName = {
    'first': '初',
    last: '終',
    live: '生',
    bingeWatching: '一挙',
    recommendation: '注目',
    drm: 'DRM',
    newcomer: '新',
    timeshiftFree: 'TS(F)',
    timeshift: 'TS'
};
export const markLongName = {
    first: '初放送',
    last: '最終回',
    live: '生放送',
    bingeWatching: '一挙放送',
    recommendation: '注目番組',
    drm: 'DRM(CENC)',
    newcomer: '新番組',
    timeshift: 'タイムシフト',
    timeshiftFree: '無料タイムシフト'
};

export type MarkType = 'first' | 'last' | 'live' | 'bingeWatching' | 'recommendation' | 'drm' | 'newcomer' | 'timeshift' | 'timeshiftFree';

export const sortType = {
    'start/asc': '開始時間/昇順',
    'start/desc': '開始時間/降順',
    'title/asc': 'タイトル/昇順',
    'title/desc': 'タイトル/降順'
};
export type SortType = 'start/asc' | 'start/desc' | 'title/asc' | 'title/desc';