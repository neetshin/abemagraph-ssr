import * as React from 'react';
import { pure } from 'recompose';
import * as moment from 'moment';

import { Container } from '../components/Container';
import { PageHeader } from '../components/PageHeader';
import { ReduxProps, connect } from '../utils/connect';
import { BroadcastSlot } from '../../types/abemagraph';
import { Link, withRouter, RouteComponentProps } from 'react-router-dom';
import { Title } from '../components/RouterControl';
import { Glyphicon } from '../components/Glyphicon';
import { Channel } from '../../types/abema';
import { Mark } from '../components/Mark';
import { parse } from '../utils/querystring';

type Sort = 'v' | 'c' | 'vpm' | 'cpm';
class Current extends React.Component<ReduxProps<{
    slots: BroadcastSlot[],
    elapsedFromUpdate: number,
    channels: Channel[]
}> & RouteComponentProps<{}>, { mounted: boolean, sortBy: Sort }>{
    constructor(props) {
        super(props);
        this.state = { mounted: false, sortBy: 'vpm' };
    }

    componentDidMount() {
        if (this.props.slots.length > 0 && this.props.channels.length > 0 && this.props.channels.length !== this.props.slots.length)
            this.props.actions.app.fetchChannels();
        if (this.props.elapsedFromUpdate > 60 * 1000)
            this.props.actions.broadcast.fetchBroadcastSlots();
        this.setState({ mounted: true });
        this.setSortBy();
    }

    componentDidUpdate(prevProps: RouteComponentProps<{}>) {
        if (prevProps.location.search !== this.props.location.search) {
            this.setSortBy();
        }
    }

    private setSortBy() {
        if (this.props.location.search) {
            const search: { sort?: Sort } = parse(this.props.location.search);
            if (search.sort && this.state.sortBy !== search.sort && ['v', 'c', 'vpm', 'cpm'].indexOf(search.sort) >= 0) {
                this.setState({ sortBy: search.sort });
            }
        }
    }
    private findChannelName(channelId: string) {
        const channel = this.props.channels.find(ch => ch.id === channelId);
        return channel ? channel.name : channelId;
    }
    render() {
        const now = Date.now() / 1000;
        const { mounted, sortBy } = this.state;
        const slots = this.props.slots.map(slot => ({
            ...slot,
            stats: slot.stats || { view: 0, comment: 0, updated: now },
            vpm: slot.stats ? slot.stats.view / (now - slot.startAt) * 60 : 0,
            cpm: slot.stats ? slot.stats.comment / (now - slot.startAt) * 60 : 0
        })).sort((a, b) => {
            if (sortBy === 'v')
                return b.stats.view - a.stats.view;
            else if (sortBy === 'c')
                return b.stats.comment - a.stats.comment;
            else if (sortBy === 'cpm')
                return b.cpm - a.cpm;
            else
                return b.vpm - a.vpm;
        });
        return (
            <React.Fragment>
                <Title title='AbemaTV情報サイト(非公式) AbemaGraph' />
                <PageHeader text='現在放送中の番組'>
                    <div className='pull-right'>
                        <select className='form-control'>
                            <option value='v'>閲覧数</option>
                            <option value='c'>コメント数</option>
                            <option value='vpm'>閲覧数の勢い</option>
                            <option value='cpm'>コメントの勢い</option>
                        </select>
                    </div>
                </PageHeader>
                {this.props.slots.length > 0 ? <React.Fragment>
                    <dl className='dl-horizontal'>
                        <dt>総閲覧数 <Glyphicon glyph='user' /></dt>
                        <dd>{slots.reduce((total, item) => total += item.stats ? item.stats.view : 0, 0)}</dd>
                        <dt>総コメント数 <Glyphicon glyph='comment' /></dt>
                        <dd>{slots.reduce((total, item) => total += item.stats ? item.stats.comment : 0, 0)}</dd>
                    </dl>
                    <div className='list-group'>
                        {slots.map(slot => (
                            <Link to={`/details/${slot.id}`} className='list-group-item' key={slot.id}>
                                <h4 className='list-group-item-heading'>
                                    <Mark mark={slot.mark} showItem={['first', 'last', 'bingeWatching']} />
                                    {slot.title}
                                    <span className='pull-right label label-success'>{this.findChannelName(slot.channelId)}</span>
                                </h4>
                                <p className='list-group-item-text'>
                                    {`${moment.unix(slot.startAt).format('YYYY/MM/DD(ddd) HH:mm:ss')} ~ ${moment.unix(slot.startAt + slot.duration).format('HH:mm:ss')}`}
                                    <br />
                                    {slot.stats ? (
                                        `閲覧数:${slot.stats.view} (${mounted ? slot.vpm.toFixed(2) : '-'} vpm) ` +
                                        `コメント:${slot.stats.comment} (${mounted ? slot.cpm.toFixed(2) : '-'} cpm)`
                                    ) : '閲覧数: - (- vpm) コメント: - (- cpm)'}
                                </p>
                            </Link>
                        ))}
                    </div>
                </React.Fragment> : null}
            </React.Fragment>
        );
    }
}

export default connect<{ slots: BroadcastSlot[], elapsedFromUpdate: number, channels: Channel[] }>({
    slots: state => state.broadcast.broadcastSlots,
    elapsedFromUpdate: state => Date.now() - state.broadcast.broadcastSlotUpdated,
    channels: state => state.app.channels
})(pure(Current));