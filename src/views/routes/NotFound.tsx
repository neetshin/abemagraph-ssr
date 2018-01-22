import * as React from 'react';
import { StatusCode } from '../components/StatusCode';
import { PageHeader } from '../components/PageHeader';

export const NotFound = () => (
    <StatusCode code={404}>
        <PageHeader text='404 Not Found' />
        <p>お探しのページは存在していません</p>
    </StatusCode>
);