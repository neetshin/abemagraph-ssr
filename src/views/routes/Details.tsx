import * as React from 'react';
import { pure } from 'recompose';
import { RouteComponentProps } from 'react-router';
import * as moment from 'moment';
import { Link } from 'react-router-dom';

import { connect, ReduxProps } from '../utils/connect';
import { Slot, Channel } from '../../types/abema';
import { PageHeader } from '../components/PageHeader';
import { Mark } from '../components/Mark';
import { Glyphicon } from '../components/Glyphicon';
import * as _ from 'lodash';
import { Loader } from '../components/Loader';
import { EpisodeItem } from '../components/Episode';
import { ErrorPage } from '../components/Error';
import { Title, StatusCode, OgpMeta, TwitterMeta, SearchMeta } from '../components/RouterControl';
import { Highcharts } from '../components/Highcharts';

type Logs = { [time: number]: { view: number, comment: number } };
type ConnectedProps = {
    slot?: Slot,
    channel?: Channel,
    slotStatus: false | number,
    logsStatus: false | number,
    logs?: Logs,
    logsUpdated: number
};
class Details extends React.Component<ReduxProps<ConnectedProps> & RouteComponentProps<{ slotId: string }>, { now: number }> {
    constructor(props) {
        super(props);
        this.state = { now: 0 };
    }
    componentDidMount() {
        const { slot, channel, match: { params: { slotId } } } = this.props;
        const now = Date.now() / 1000;
        if ((!slot && slotId) || (slot && slotId !== slot.id)) {
            this.props.actions.slot.fetchSlot(slotId);
        }
        if (slot && slot.startAt < now) {
            this.props.actions.slot.fetchSlotLogs(slot.id); // SSRで来た時はこっち
        }
        this.setState({ now });
    }
    componentDidUpdate({ match: { params: { slotId } }, slot }: RouteComponentProps<{ slotId: string }> & { slot?: Slot }) {
        const now = Date.now() / 1000;
        if (this.props.match.params.slotId !== slotId) {
            this.props.actions.slot.fetchSlot(this.props.match.params.slotId);
        }
        if (this.props.slot !== slot && this.props.slot) {
            if (this.props.slot.startAt < now) {
                this.props.actions.slot.fetchSlotLogs(this.props.slot.id);
            }
        }
    }
    componentWillUnmount() {
        this.props.actions.slot.invalidateSlot();
    }
    private createGraphConfig(type: 'comment' | 'view', logs: Logs, { startAt, endAt }: { startAt: number, endAt: number }) {
        const logsData = _.map(logs, (log, v) => [Number(v) * 1000, log[type]]) as Array<[number, number]>;
        const perMinLogs = logsData.map((v, i, a) => i === 0 ? (v[0] - startAt * 1000 > 30 * 1000 ? [v[0], Math.floor((v[1] || 0) / (v[0] - startAt * 1000) * 60 * 1000)] : [v[0], 0]) : [v[0], Math.floor((v[1] - a[i - 1][1]) / (a[i][0] - a[i - 1][0]) * 60 * 1000)]) as Array<[number, number]>;
        const title = type === 'comment' ? 'コメント数' : '閲覧数';
        return {
            chart: { zoomType: 'x' },
            title: { text: title },
            xAxis: {
                title: {
                    text: '時間',
                },
                type: 'datetime',
                min: startAt * 1000,
                max: endAt * 1000
            },
            yAxis: [{
                title: {
                    text: title,
                },
                min: 0,
            }, {
                title: {
                    text: title + '/min',
                },
                min: 0,
                opposite: true
            }],
            series: type === 'comment' ? [{
                name: title + '/min',
                data: perMinLogs,
                yAxis: 1
            }] : [{
                name: title,
                data: logsData,
                yAxis: 0
            }, {
                name: title + '/min',
                data: perMinLogs,
                yAxis: 1
            }]
        };
    }
    render() {
        const { slot, channel, logs, logsUpdated: updated } = this.props;
        const { now } = this.state;
        const now2 = Date.now() / 1000;
        if (this.props.slotStatus) {
            return <><ErrorPage code={this.props.slotStatus} /><StatusCode code={404} /></>;
        }
        if (slot) {
            const elapsedSec = this.state.now - slot.startAt;
            const isEnd = slot.endAt < this.state.now;
            const isOnAir = this.state.now > slot.startAt && this.state.now < slot.endAt;
            const officialLink = `https://abema.tv/channels/${slot.channelId}/slots/${slot.id}`;
            const mark = [...Object.keys(slot.mark), ...Object.keys(slot.flags)];
            const firstPg = slot.programs[0];
            if (!firstPg) return null;
            const series = firstPg && firstPg.series && firstPg.series.id;
            const casts = _.uniq(_.flatMap(slot.programs, p => p.credit.casts || []));
            const crews = _.uniq(_.flatMap(slot.programs, p => p.credit.crews || []));
            const copyrights = _.uniq(_.flatMap(slot.programs, p => p.credit.copyrights || []));
            const largeImage = `https://images.abemagraph.info/pg/${firstPg.id}/${firstPg.providedInfo.thumbImg}.w800.v${firstPg.providedInfo.updatedAt}.jpg`;
            return (
                <>
                    <PageHeader text={(
                        <>
                            <Mark mark={mark} showItem={['first', 'last', 'live', 'newcomer', 'bingeWatching']} />
                            {`${slot.title} - 詳細情報`}
                        </>
                    )}>
                        <Title title={`${slot.title} - AbemaGraph`} />
                        <OgpMeta title={slot.title} type='video' image={largeImage} />
                        <TwitterMeta title={slot.title} card='summary_large_image'
                            label1='チャンネル' data1={channel ? channel.name : slot.channelId} image={largeImage} />
                        <SearchMeta title={slot.title} description={slot.highlight || slot.content} />
                        <div className='pull-right'>
                            {now > 0 && now > slot.startAt ? (
                                isOnAir ?
                                    (
                                        <a href={`https://abema.tv/now-on-air/${slot.channelId}?utm_source=abemagraph`} className='btn btn-primary'>
                                            <b>現在放送中！</b>
                                        </a>
                                    ) : slot.flags.timeshift ? (
                                        slot.timeshiftEndAt < now ?
                                            (<button className='btn btn-info' disabled>放送終了(TS期限切れ)</button>)
                                            : (slot.flags.timeshiftFree && slot.timeshiftFreeEndAt && slot.timeshiftFreeEndAt > now ?
                                                <a href={officialLink} className='btn btn-primary'>無料タイムシフト</a> :
                                                <a href={officialLink} className='btn btn-info'>タイムシフト</a>
                                            )
                                    ) : <button className='btn btn-info' disabled>放送終了(TSなし)</button>) : null}
                        </div>
                    </PageHeader>
                    <PageHeader mini text={<><Glyphicon glyph='info-sign' /> 番組情報</>} />
                    <dl className='dl-horizontal'>
                        <dt>番組名</dt>
                        <dd>
                            <Mark mark={mark} showItem={['first', 'last', 'live', 'newcomer', 'bingeWatching', 'recommendation', 'drm']} />
                            {slot.title}
                        </dd>
                        <dt>チャンネル</dt>
                        <dd>
                            <Link to={`/search?q=channel:${slot.channelId}+since:now`}>{channel ? `${channel.name} (${channel.id})` : slot.channelId}</Link>
                        </dd>
                        <dt><Glyphicon glyph='calendar' /> 放送日時</dt>
                        <dd>
                            {`${moment.unix(slot.startAt).format('YYYY/MM/DD(ddd) HH:mm:ss')} ~ ${moment.unix(slot.endAt).format('HH:mm:ss')} ` +
                                `(${Math.floor((slot.endAt - slot.startAt) / 60)}分` +
                                (isEnd ? ' / 終了' : isOnAir ? ` / 開始から約${(elapsedSec / 60).toFixed(1)}分` : '') + ')'}
                        </dd>
                        <dt><Glyphicon glyph='link' /> 公式ページ</dt>
                        <dd><a href={officialLink}>{officialLink}</a></dd>
                        {series ? (
                            <><dt>シリーズ</dt>
                                <dd>
                                    <Link to={`/search?q=series:${series}`}>{series}</Link>
                                    {(slot.slotGroup ? <> (グループ: <Link to={`/search?q=group:${slot.slotGroup.id}`}>{slot.slotGroup.id}</Link>)</> : null)}
                                </dd></>) : null}
                        {slot.hashtag ? (<>
                            <dt>ハッシュタグ <Glyphicon glyph='tag' /></dt>
                            <dd><a href={`https://twitter.com/hashtag/${slot.hashtag}`}>{slot.hashtag}</a></dd>
                        </>) : null}
                        <dt><Glyphicon glyph='time' /> タイムシフト</dt>
                        <dd>{slot.flags.timeshift ?
                            slot.flags.timeshiftFree && slot.timeshiftFreeEndAt && slot.timeshiftFreeEndAt > now ?
                                (now > 0 ? `無料 - ${moment.unix(slot.timeshiftFreeEndAt || slot.timeshiftEndAt).format('MM/DD(ddd) HH:mm')}まで` : '無料') :
                                (now > 0 ? `プレミアム - ${moment.unix(slot.timeshiftEndAt).format('MM/DD(ddd) HH:mm')}まで` : 'プレミアム') : 'なし'}</dd>
                        {slot.startAt < now2 ? <>
                            <dt>総コメント数 <Glyphicon glyph='comment' /></dt>
                            <dd>{logs ? (now > 0 ? `${logs[updated].comment} (${(logs[updated].comment / elapsedSec * 60).toFixed(2)} comments/min)` : logs[updated].comment) : '-'}</dd>
                            <dt>総閲覧数 <Glyphicon glyph='user' /></dt>
                            <dd>{logs ? (now > 0 ? `${logs[updated].view} (${(logs[updated].view / elapsedSec * 60).toFixed(2)} views/min)` : logs[updated].view) : '-'}</dd>
                            <dt>ログ数 <Glyphicon glyph='stats' /></dt>
                            <dd>{logs ? Object.keys(logs).length : '-'}</dd>
                            <dt>ログ最終更新</dt>
                            <dd>{updated > 0 ? moment.unix(updated).format('YYYY/MM/DD(ddd) HH:mm:ss') : '-'}</dd>
                        </> : null}
                    </dl>
                    <pre>{slot.content}</pre>
                    {slot.programs.map(pg => <EpisodeItem key={pg.id} program={pg} />)}
                    < div className='row'>
                        {casts.length > 0 ? <div className='col-sm-4'>
                            <dl>
                                <dt>キャスト</dt>
                                {casts.map(n => <dd key={n}>{n}</dd>)}
                            </dl>
                        </div> : null}
                        {crews.length > 0 ? <div className='col-sm-4'>
                            <dl>
                                <dt>スタッフ</dt>
                                {crews.map(n => <dd key={n}>{n}</dd>)}
                            </dl>
                        </div> : null}
                    </div>
                    <hr />
                    {logs ? <>
                        <PageHeader mini text={<><Glyphicon glyph='comment' /> コメントグラフ</>} />
                        <Highcharts options={this.createGraphConfig('comment', logs, slot)} />
                        <PageHeader mini text={<><Glyphicon glyph='user' /> 閲覧数グラフ</>} />
                        <Highcharts options={this.createGraphConfig('view', logs, slot)} />
                    </>
                        : null}
                    <hr />
                    {copyrights.length > 0 ? copyrights.map(n => <span className='center' key={n}>{n}</span>) : null}
                </>
            );
        }
        return <Loader />;
    }
}

export default connect<ConnectedProps>({
    slot: state => state.slot.slot,
    channel: ({ app: { channels }, slot: { slot } }) => slot ? channels.find(ch => ch.id === slot.channelId) : undefined,
    slotStatus: state => state.slot.slotStatus,
    logsStatus: state => state.slot.logsStatus,
    logs: ({ slot: { slot, logs } }) => logs && slot && logs.length > 0 ? logs.reduce((obj, log) => ({ ...obj, [log[0] + slot.startAt]: { view: log[1], comment: log[2] } }), {}) : undefined,
    logsUpdated: ({ slot: { slot, logs } }) => logs && slot && logs.length > 0 ? logs[logs.length - 1][0] + slot.startAt : 0
})(pure(Details));