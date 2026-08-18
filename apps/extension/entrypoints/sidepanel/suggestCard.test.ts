import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { SuggestCard } from './SuggestCard';
import type { ExtractedQuestion } from '@jobibi/shared';

describe('SuggestCard Component (D24 Pick-lists)', () => {
  const dummyJobContext = {
    roleTitle: 'Frontend Engineer',
    company: 'Acme Corp',
  };

  it('renders fixed instruction line and omits "Suggest an answer" button for select questions', () => {
    const selectQ: ExtractedQuestion = {
      id: 'q-select-1',
      label: 'What is your highest level of education?',
      fieldType: 'select',
      field: { tagName: 'select', id: 'edu', selector: '#edu' },
      labelSource: 'label-for',
      confidence: 1.0,
    };

    const html = renderToString(
      React.createElement(SuggestCard, {
        q: selectQ,
        jobContext: dummyJobContext,
      }),
    );

    expect(html).toContain('Pick from the options on the page.');
    expect(html).not.toContain('Suggest an answer');
    expect(html).not.toContain('suggest-btn');
    expect(html).not.toContain('Thinking…');
    expect(html).not.toContain('Regenerate');
    expect(html).not.toContain('Insert');
  });

  it('renders fixed instruction line and omits "Suggest an answer" button for radio questions', () => {
    const radioQ: ExtractedQuestion = {
      id: 'q-radio-1',
      label: 'Are you willing to relocate to Makati?',
      fieldType: 'radio',
      field: { tagName: 'input', id: 'reloc', selector: '#reloc' },
      labelSource: 'label-for',
      confidence: 0.95,
    };

    const html = renderToString(
      React.createElement(SuggestCard, {
        q: radioQ,
        jobContext: dummyJobContext,
      }),
    );

    expect(html).toContain('Pick from the options on the page.');
    expect(html).not.toContain('Suggest an answer');
    expect(html).not.toContain('suggest-btn');
  });

  it('renders fixed instruction line and omits "Suggest an answer" button for checkbox questions', () => {
    const checkboxQ: ExtractedQuestion = {
      id: 'q-checkbox-1',
      label: 'Select all testing tools you have used:',
      fieldType: 'checkbox',
      field: { tagName: 'input', id: 'tools', selector: '#tools' },
      labelSource: 'label-for',
      confidence: 0.95,
    };

    const html = renderToString(
      React.createElement(SuggestCard, {
        q: checkboxQ,
        jobContext: dummyJobContext,
      }),
    );

    expect(html).toContain('Pick from the options on the page.');
    expect(html).not.toContain('Suggest an answer');
    expect(html).not.toContain('suggest-btn');
  });

  it('renders "Suggest an answer" button for text questions and does not render picklist message', () => {
    const textQ: ExtractedQuestion = {
      id: 'q-text-1',
      label: 'Describe your favorite project and your contribution:',
      fieldType: 'text',
      field: { tagName: 'input', id: 'proj', selector: '#proj' },
      labelSource: 'label-for',
      confidence: 1.0,
    };

    const html = renderToString(
      React.createElement(SuggestCard, {
        q: textQ,
        jobContext: dummyJobContext,
      }),
    );

    expect(html).toContain('Suggest an answer');
    expect(html).toContain('data-testid="suggest-btn"');
    expect(html).not.toContain('Pick from the options on the page.');
  });

  it('renders "Suggest an answer" button for textarea questions', () => {
    const textareaQ: ExtractedQuestion = {
      id: 'q-textarea-1',
      label: 'Why should we hire you for this role?',
      fieldType: 'textarea',
      field: { tagName: 'textarea', id: 'why', selector: '#why' },
      labelSource: 'label-for',
      confidence: 1.0,
    };

    const html = renderToString(
      React.createElement(SuggestCard, {
        q: textareaQ,
        jobContext: dummyJobContext,
      }),
    );

    expect(html).toContain('Suggest an answer');
    expect(html).not.toContain('Pick from the options on the page.');
  });

  it('renders "Suggest an answer" button for number questions (D24: number questions stay normal)', () => {
    const numberQ: ExtractedQuestion = {
      id: 'q-number-1',
      label: 'How many years of experience do you have with Playwright?',
      fieldType: 'number',
      field: { tagName: 'input', id: 'yrs', selector: '#yrs' },
      labelSource: 'label-for',
      confidence: 1.0,
    };

    const html = renderToString(
      React.createElement(SuggestCard, {
        q: numberQ,
        jobContext: dummyJobContext,
      }),
    );

    expect(html).toContain('Suggest an answer');
    expect(html).not.toContain('Pick from the options on the page.');
  });
});
