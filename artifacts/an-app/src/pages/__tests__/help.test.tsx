import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import Help from '../help';

afterEach(() => {
  cleanup();
});

function renderHelp() {
  return render(
    <Router base="">
      <Help />
    </Router>,
  );
}

describe('AN-Hilfe', () => {
  it('zeigt AN-spezifische Themen und die getrennten Entscheidungen', () => {
    renderHelp();

    expect(screen.getByRole('heading', { name: /Sicher durch den nächsten Takt/i })).toBeInTheDocument();
    expect(screen.getByTestId('callout-help-separate-decisions')).toBeInTheDocument();
    expect(screen.getByTestId('button-help-topic-projects')).toBeInTheDocument();
  });

  it('filtert den Leitfaden über die Hilfesuche', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.type(screen.getByTestId('input-help-search'), 'Datenangebot');

    expect(screen.getByTestId('card-help-article-data-policies')).toBeInTheDocument();
    expect(screen.queryByTestId('card-help-article-requests')).not.toBeInTheDocument();
  });

  it('öffnet eine FAQ-Antwort interaktiv', async () => {
    const user = userEvent.setup();
    renderHelp();

    await user.click(screen.getByTestId('button-help-faq-invitation-vs-data'));

    expect(screen.getByTestId('text-help-faq-answer-invitation-vs-data')).toBeInTheDocument();
  });
});