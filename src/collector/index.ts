import { Client } from 'elasticsearch';
import { Db, Collection } from 'mongodb';
import { writeFile, readFile, exists } from 'async-file';
import * as moment from 'moment';
import * as _ from 'lodash';
import { parseString } from 'xml2js';

import Config from '../config';
import { downloadTimetable, storeTimetableToES } from './timetable';
import { app as appLogger } from '../logger';
import { Slot, Program, Channel, Timetable, Sitemap } from '../types/abema';
import { getSlotAudience } from './audience';
import { Log, All, ESData } from '../types/abemagraph';
import { sleep } from '../utils/sleep';
import { purgeId } from '../utils/purge-id';
import { request } from '../utils/request';
import { api } from '../utils/abema';

class Collector {
    slotsDb: Collection<Slot & { programs: string[] }>;
    programsDb: Collection<Program>;
    logsDb: Collection<Log>;
    channelsDb: Collection<Channel>;
    allDb: Collection<All>;
    timetable?: Timetable;

    private db: Db;
    private es: Client;
    private cancelPromise: Promise<void> | null = null;
    private cancel: Function | null = null;
    private promises: Array<Promise<void>> = [];

    initialize(db: Db, es: Client) {
        this.db = db;
        this.es = es;
        this.slotsDb = db.collection('slots');
        this.programsDb = db.collection('programs');
        this.logsDb = db.collection('logs');
        this.channelsDb = db.collection('channels');
        this.allDb = db.collection('all');
    }

    async insertMissedSlotsFromSitemap() {
        if (!this.db || !this.es) throw new Error();
        const sitemapXml = (await request({
            url: 'https://abema.tv/sitemap-slots-0.xml',
            method: 'GET',
            gzip: true,
            encoding: 'utf8'
        })).body as string;
        const sitemap: Sitemap = await new Promise<Sitemap>((resolve, reject) => {
            parseString(sitemapXml, (err, res) => {
                if (err || !res) reject(err);
                resolve(res);
            });
        });
        if (sitemap.urlset && sitemap.urlset.url && sitemap.urlset.url.length > 0) {
            const slotIds = sitemap.urlset.url.map(entry => entry.loc[0].replace(/https.+\/slots\//, ''));
            const slots = this.slots;
            // console.log(slotIds);
            const insertSlots: Slot[] = [];
            for (const slotId of slotIds) {
                if (slots.find(slot => slot.id === slotId)) continue;
                const slotDbInfo = await this.findSlot(slotId);
                if (slotDbInfo && slotDbInfo.length > 0) {
                    insertSlots.push(slotDbInfo[0]);
                    continue;
                }
                const slotInfo: Slot = (await api<{ slot: Slot }>(`media/slots/${slotId}`)).slot;
                appLogger.debug(`Slot: ${slotId} (${slotInfo.channelId} -> not found`);
                insertSlots.push(slotInfo);
            }
            if (insertSlots.length > 0 && this.timetable) {
                const loadedChannels = this.timetable.channels;
                const channelIds = _.uniqBy(insertSlots, 'channelId').map(slot => slot.channelId);
                this.timetable.channels.push(...channelIds
                    .filter(channelId => !loadedChannels.some(ch => ch.id === channelId))
                    .map(id => ({ id, name: id, order: 255 })));
                this.timetable.channelSchedules.push(...channelIds.map(channelId => ({
                    channelId,
                    slots: insertSlots.filter(slot => slot.channelId === channelId),
                    date: moment().format('YYYYMMDD')
                })));
                appLogger.info(`${insertSlots.length} slots will be inserted`);
            }
        }
    }

    async updateFullTimetable() {
        if (!this.db || !this.es) throw new Error();
        this.timetable = await downloadTimetable();

        await writeFile(Config.cache.timetable, JSON.stringify(this.timetable), { encoding: 'utf8' });
        appLogger.debug('Saved timetable file');

        const slots = this.slots;
        await this.channelsDb.bulkWrite(this.timetable.channels.map(channel => ({
            replaceOne: {
                filter: { _id: channel.id },
                replacement: {
                    ...channel,
                    _id: channel.id,
                },
                upsert: true
            }
        })));
        await this.programsDb.insertMany(_.uniqBy(_.flatMap(slots, s => s.programs), p => p.id).map(program => ({ ...program, _id: program.id })), { ordered: false }).catch(err => {
            appLogger.debug('inserted:', err.result.nInserted, 'failed:', err.writeErrors ? err.writeErrors.length : 'unknown');
        });
        await this.slotsDb.bulkWrite(slots.map(slot => ({
            replaceOne: {
                filter: { _id: slot.id },
                replacement: {
                    ...slot,
                    _id: slot.id,
                    programs: slot.programs.map(p => p.id)
                },
                upsert: true
            }
        })));
        await this.insertMissedSlotsFromSitemap();
        appLogger.debug('MongoDB updated');
        await storeTimetableToES(this.es, slots);
    }

    async loadTimetableFromFile() {
        if (await exists(Config.cache.timetable))
            this.timetable = JSON.parse(await readFile(Config.cache.timetable, { encoding: 'utf8' }));
    }

    get slots() {
        if (!this.timetable) return [];
        return _.flatMap(this.timetable.channelSchedules, c => c.slots);
    }

    get currentSlots() {
        if (!this.timetable) return [];
        const now = Date.now() / 1000;
        return this.slots.filter(slot => slot.startAt <= now && slot.endAt >= now);
    }

    async collectSlotLog() {
        if (!this.db || !this.es) return;
        const slots = this.currentSlots;
        const audiences = await getSlotAudience(...slots.map(slot => slot.id));
        const now = Math.floor(Date.now() / 1000);
        const all: All = { c: 0, v: 0, ch: {}, t: now, date: moment().format('YYYYMMDD') };
        const pastLogs = await this.findLogs(...audiences.map(a => a.slotId));
        for (const audience of audiences) {
            if (pastLogs[audience.slotId] && Object.keys(pastLogs[audience.slotId].log).length >= 2) {
                const past = pastLogs[audience.slotId];
                const lastKey = Object.keys(past.log).map(v => Number(v)).sort((a, b) => b - a)[0];
                const commentInc = Math.floor(((audience.commentCount || 0) - past.log[`${lastKey}`].c) / (now - lastKey) * 60);
                const viewInc = Math.floor(((audience.viewCount || 0) - past.log[`${lastKey}`].v) / (now - lastKey) * 60);
                if (commentInc > 0 && viewInc > 0) {
                    all.ch[audience.channelId] = [commentInc, viewInc];
                    all.c += commentInc;
                    all.v += viewInc;
                }
            } /*else {
                const slot = slots.find(s => s.id === audience.slotId);
                if (slot && now - slot.startAt > 60) {
                    const commentInc = Math.floor(audience.commentCount / (now - slot.startAt) * 60);
                    const viewInc = Math.floor(audience.viewCount / (now - slot.startAt) * 60);
                    all.ch[audience.channelId] = [commentInc, viewInc];
                    all.c += commentInc;
                    all.v += viewInc;
                }
            }*/
            await this.logsDb.updateOne({ _id: audience.slotId }, {
                '$set': {
                    [`log.${now}`]: {
                        c: audience.commentCount || 0,
                        v: audience.viewCount || 0
                    }
                }
            }, { upsert: true });
        }

        if (Object.keys(all.ch).length > 0)
            await this.allDb.insertOne(all);

        appLogger.debug('Slot status collected');
    }

    get channels() {
        if (this.timetable)
            return this.timetable.channels;
        else
            return null;
    }

    async getChannel(...names: string[]): Promise<Channel[]> {
        if (!this.db || !this.es) throw new Error();
        const cursor = await this.channelsDb.find({ $or: names.map(name => ({ _id: name })) });
        return (await cursor.toArray()).map(purgeId);
    }

    async findLogs(...slotIds: string[]): Promise<{ [slot: string]: Log }> {
        if (!this.db || !this.es) throw new Error();
        const cursor = await this.logsDb.find({ $or: slotIds.map(_id => ({ _id })) });
        const result = await cursor.toArray();
        return result.reduce((list: { [slot: string]: Log }, item) => ({ ...list, [item._id]: item }), {});
    }

    async findSlot(...slotIds: string[]): Promise<Slot[]> {
        if (!this.db || !this.es) throw new Error();
        const slotCursor = await this.slotsDb.find({ $or: slotIds.map(slotId => ({ _id: slotId })) });
        const slots = (await slotCursor.toArray()).map(purgeId);
        if (slots.length === 0) return [];
        const prorgamsCursor = await this.programsDb.find({ $or: _.flatMap(slots, slot => slot.programs).map(pgId => ({ _id: pgId })) });
        const programs = (await prorgamsCursor.toArray()).map(purgeId);
        return slots.map(slot => ({
            ...slot,
            programs: slot.programs.map((pgId: string) => programs.find(pg => pg.id === pgId)).filter((pg: Program): pg is Program => !!pg)
        }));
    }

    async search(query) {
        if (!this.db || !this.es) throw new Error();
        return await this.es.search<ESData>({
            index: Config.elasticsearch.index,
            type: Config.elasticsearch.type,
            body: query
        });
    }
    startSchedule() {
        if (!this.db || !this.es) throw new Error();
        if (this.cancel) return;
        this.cancelPromise = new Promise(resolve => this.cancel = () => resolve());

        const timetableTask = async () => {
            while (this.cancel && this.cancelPromise) {
                await this.updateFullTimetable();
                appLogger.debug('Timetable updater', 'OK');
                await Promise.race([this.cancelPromise, sleep(Config.abema.timetableUpdateInterval * 1000)]);
            }
        };
        const collectStatsTask = async () => {
            while (this.cancel && this.cancelPromise) {
                const nextTime = moment().startOf('minute').add(1, 'minute').subtract(250, 'ms');
                await Promise.race([this.cancelPromise, sleep(nextTime.diff(moment(), 'ms'))]);
                await this.collectSlotLog();
                await Promise.race([this.cancelPromise, sleep(1000 * 30)]);
                await this.collectSlotLog();
                appLogger.debug('Collector', 'OK');
            }
        };
        this.promises = [timetableTask(), collectStatsTask()];
    }

    async stopSchedule() {
        if (!this.cancel) return;
        appLogger.info('Scheduler stopping');
        this.cancel();
        await Promise.all(this.promises);
        appLogger.info('Scheduler stopped');
    }
}

export const collector = new Collector();