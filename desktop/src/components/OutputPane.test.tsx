import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OutputPane } from './OutputPane';

function renderPretty(output: string, prettyEvidence?: string) {
  render(
    <OutputPane
      output={output}
      prettyEvidence={prettyEvidence}
      aiStatus="Connected"
      aiInsights=""
      aiError=""
      aiAnalysis={null}
      onAnalyze={vi.fn()}
      onCheckStatus={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Pretty View' }));
}

describe('Pretty View API activity cards', () => {
  it('uses retained evidence to show one correlated card with internal logs', async () => {
    const user = userEvent.setup();
    const evidence = [
      '2026-10-28 10:00:00.000 [http-nio-1] INFO [trace-42,user] c.p.RequestLogger : REQ START GET /api/customers/42',
      '2026-10-28 10:00:00.040 [http-nio-1] DEBUG [trace-42,user] c.p.CustomerService : Loaded [REDACTED_EMAIL]',
      '2026-10-28 10:00:00.125 [http-nio-1] INFO [trace-42,user] c.p.RequestLogger : REQ END status=200 duration=125ms',
    ].join('\n');
    const output = [
      'REQ START GET /api/customers/42',
      'Loaded [REDACTED_EMAIL]',
      'REQ END status=200 duration=125ms',
    ].join('\n');

    renderPretty(output, evidence);

    expect(document.querySelectorAll('.api-record')).toHaveLength(1);
    expect(screen.queryByText('Pending', { selector: '.api-status' })).not.toBeInTheDocument();
    expect(screen.getByText('1 internal log')).toBeInTheDocument();
    const card = screen.getByText('/api/customers/42', { selector: '.api-uri' }).closest('details')!;
    await user.click(card.querySelector('summary')!);
    expect(within(card).getByText('DEBUG')).toBeInTheDocument();
    expect(within(card).getByText('Loaded [REDACTED_EMAIL]')).toBeInTheDocument();
    expect(within(card).getByText('+40 ms')).toBeInTheDocument();
  });

  it('shows ambiguous concurrent activity in Unassigned Logs', () => {
    renderPretty([
      'INFO [http-nio-1] [shared,user] c.p.RequestLogger : REQ START GET /api/a',
      'INFO [http-nio-2] [shared,user] c.p.RequestLogger : REQ START GET /api/b',
      'WARN [shared,user] c.p.Service : cannot safely assign this line',
      'INFO [http-nio-1] [shared,user] c.p.RequestLogger : REQ END status=200 duration=10ms',
      'INFO [http-nio-2] [shared,user] c.p.RequestLogger : REQ END status=200 duration=20ms',
    ].join('\n'));

    expect(screen.getByText('Unassigned Logs')).toBeInTheDocument();
    expect(screen.getByText('Unassigned Logs').closest('summary')).toHaveTextContent('1');
  });

  it('renders wrapped paths, method/status variants, and expandable available metadata', async () => {
    const user = userEvent.setup();
    const longUri = '/api/v1/organizations/very-long-organization-name/projects/project-with-a-long-name/resources/another-deep-segment?include=owners%2Cpermissions%2Caudit-history';
    renderPretty([
      `2026-10-28 09:00:00.000 INFO traceId=get-1 REQ START GET ${longUri}`,
      '2026-10-28 09:00:00.125 INFO traceId=get-1 REQ END status=200 duration=125ms',
      'INFO requestId=post-1 REQ START POST /api/orders',
      'INFO requestId=post-1 REQ END status=404',
      'INFO correlationId=put-1 REQ START PUT /api/orders/42',
      'INFO correlationId=put-1 REQ END status=500 duration=1.2s',
      'REQ END DELETE /api/orders/43 status=204 duration=8ms',
    ].join('\n'));

    const path = screen.getByText(longUri, { selector: '.api-uri' });
    expect(path).toHaveClass('api-uri');
    expect(path).not.toHaveAttribute('title');
    expect(screen.getByText('GET', { selector: '.api-method' })).toHaveClass('api-method-get');
    expect(screen.getByText('POST', { selector: '.api-method' })).toHaveClass('api-method-post');
    expect(screen.getByText('PUT', { selector: '.api-method' })).toHaveClass('api-method-put');
    expect(screen.getByText('DELETE', { selector: '.api-method' })).toHaveClass('api-method-delete');
    expect(screen.getByText('200', { selector: '.api-status' })).toHaveClass('api-status-success');
    expect(screen.getByText('404', { selector: '.api-status' })).toHaveClass('api-status-client-error');
    expect(screen.getByText('500', { selector: '.api-status' })).toHaveClass('api-status-server-error');

    const postCard = screen.getByText('/api/orders', { selector: '.api-uri' }).closest('details');
    expect(postCard).not.toBeNull();
    expect(within(postCard!).getAllByText('—')).toHaveLength(2);
    await user.click(postCard!.querySelector('summary')!);
    expect(within(postCard!).getByText('Correlation ID')).toBeInTheDocument();
    expect(within(postCard!).queryByText('Duration', { selector: 'dt' })).not.toBeInTheDocument();
    expect(within(postCard!).queryByText('Timestamp', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('keeps 100 activity cards available in a compact scrollable list', () => {
    const output = Array.from({ length: 100 }, (_, index) => [
      `INFO traceId=request-${index} REQ START GET /api/items/${index}`,
      `INFO traceId=request-${index} REQ END status=200 duration=${index + 1}ms`,
    ]).flat().join('\n');

    renderPretty(output);

    expect(document.querySelectorAll('.api-record')).toHaveLength(100);
    expect(screen.getByLabelText('API activity summary')).toHaveTextContent('Completed requests100');
    expect(screen.getByText('/api/items/99', { selector: '.api-uri' })).toBeInTheDocument();
  });
});
