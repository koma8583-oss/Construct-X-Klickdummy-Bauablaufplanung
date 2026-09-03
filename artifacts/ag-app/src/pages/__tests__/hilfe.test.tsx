import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import Hilfe from '../hilfe';

afterEach(() => {
  cleanup();
});

function renderHilfe() {
  return render(
    <Router base="">
      <Hilfe />
    </Router>,
  );
}

describe('AG-Hilfe', () => {
  it('zeigt AG-spezifische Themen und die Trennung von Einladung und Veröffentlichung', () => {
    renderHilfe();

    expect(screen.getByRole('heading', { name: /Sicher koordinieren/i })).toBeInTheDocument();
    expect(screen.getByTestId('callout-invitation-publication')).toBeInTheDocument();
    expect(screen.getByTestId('button-topic-data')).toBeInTheDocument();
    expect(screen.getByTestId('card-help-article-requests-03')).toHaveTextContent('Neubau Bochum');
    expect(screen.getByTestId('card-help-article-requests-03')).toHaveTextContent('keine erneute Zustimmung erforderlich');
  });

  it('filtert Inhalte über die Hilfesuche', async () => {
    const user = userEvent.setup();
    renderHilfe();

    await user.type(screen.getByTestId('input-help-search'), 'Terminänderung');

    expect(screen.getByTestId('card-help-article-schedule-01')).toBeInTheDocument();
    expect(screen.queryByTestId('card-help-article-start-01')).not.toBeInTheDocument();
  });

  it('öffnet und schließt FAQ-Antworten', async () => {
    const user = userEvent.setup();
    renderHilfe();

    const faqButton = screen.getByTestId('button-faq-faq-policy');
    await user.click(faqButton);
    expect(screen.getByTestId('answer-faq-faq-policy')).toBeInTheDocument();

    await user.click(faqButton);
    expect(screen.queryByTestId('answer-faq-faq-policy')).not.toBeInTheDocument();
  });

  it('erklärt DataOffers als unabhängige Datenpakete', async () => {
    const user = userEvent.setup();
    renderHilfe();

    await user.type(screen.getByTestId('input-help-search'), 'DataOffer');

    expect(screen.getByTestId('faq-item-faq-data-offer')).toBeInTheDocument();
    await user.click(screen.getByTestId('button-faq-faq-data-offer'));
    expect(screen.getByTestId('answer-faq-faq-data-offer')).toHaveTextContent('BIM-Modell');
  });
});