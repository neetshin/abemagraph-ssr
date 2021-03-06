import * as moment from 'moment';
import { Request } from 'express';
import { BadRequest } from 'http-errors';

import { validateAndParseSearch } from '../../utils/search';
import { collector } from '../../collector';
import { api } from './index';

const stripHighlight = str => str.replace(/<\/mark><mark>/g, '');
export const search = api.get('/search', async ({ query, page }: { query: string, page: number }) => {
    if (typeof query !== 'string' || query.length > 1024 || query.trim().length <= 0)
        throw new BadRequest('Query missed or too long');
    const [errors, queryParsed] = validateAndParseSearch(query);
    if (errors.length > 0) throw new BadRequest('Invalid query');
    const must: Array<{}> = [];
    const sort: Array<{}> = ['_score'];
    if (queryParsed.keyword.length > 0) {
        must.push({
            simple_query_string: {
                fields: ['title', 'content', 'hashtag', 'crews', 'casts'],
                query: queryParsed.keyword,
                default_operator: 'and'
            }
        });
    }
    if (queryParsed.channel.length > 0) {
        must.push({ terms: { channel: queryParsed.channel } });
    }
    if (queryParsed.series.length > 0) {
        must.push({ terms: { series: queryParsed.series } });
    }
    if (queryParsed.group.length > 0) {
        must.push({ terms: { group: queryParsed.group } });
    }
    const range: { from?: string, to?: string } = {};
    if (queryParsed.since) {
        range.from = queryParsed.since[1].format();
    }
    if (queryParsed.until) {
        range.to = queryParsed.until[1].format();
    }
    if (range.from || range.to) {
        must.push({ range: { start: range } });
    }
    if (queryParsed.sort) {
        const [key, order] = queryParsed.sort.split('/');
        sort.unshift({ [key]: { order } });
    }
    if (queryParsed.flag.length > 0) {
        must.push({ terms: { flags: queryParsed.flag } });
    }
    const esQuery = {
        query: { bool: { must } },
        size: 50,
        from: page * 50,
        highlight: {
            pre_tags: ['<mark>'],
            post_tags: ['</mark>'],
            fields: {
                'title': {
                    fragment_size: 100,
                    number_of_fragments: 1,
                    no_match_size: 100,
                    encoder: 'html'
                },
                'content': {
                    fragment_size: 100,
                    number_of_fragments: 1,
                    no_match_size: 100,
                    encoder: 'html',
                },
                'hashtag': {
                    fragment_size: 100,
                    number_of_fragments: 1,
                    no_match_size: 0,
                    encoder: 'html',
                }
            },
        },
        sort,
        timeout: 10000
    };
    const esResult = await collector.search(esQuery);
    if (esResult.timed_out) return null;
    return {
        total: esResult.hits.total,
        took: esResult.took,
        hits: esResult.hits.hits.map(item => ({
            title: item.highlight.title ? stripHighlight(item.highlight.title[0]) : item._source.title,
            channelId: item._source.channel,
            id: item._id,
            content: item.highlight.content ? stripHighlight(item.highlight.content[0]) : item._source.content,
            hashtag: item.highlight.hashtag ? stripHighlight(item.highlight.hashtag[0]) : item._source.hashtag,
            flags: item._source.flags,
            start: moment(item._source.start),
            end: moment(item._source.end),
            score: item._score
        }))
    };
}, (param, { q: query, page: p }) => {
    const page = p ? Number(p) : 0;
    if (isNaN(page)) throw new BadRequest('Page must be number');
    return { query, page };
}, 0);