import { describe, expect, it } from 'vitest';
import {
  isPickListFieldType,
  PICK_LIST_FIELD_TYPES,
  PICK_LIST_MESSAGE,
  type ExtractedQuestion,
} from './types.ts';

describe('Pick-list Question Identification & Contracts (D24)', () => {
  it('PICK_LIST_FIELD_TYPES includes select, radio, and checkbox', () => {
    expect(PICK_LIST_FIELD_TYPES).toEqual(['select', 'radio', 'checkbox']);
  });

  it('PICK_LIST_MESSAGE is locked to the fixed instruction line', () => {
    expect(PICK_LIST_MESSAGE).toBe('Pick from the options on the page.');
  });

  it('isPickListFieldType returns true for pick-list field types', () => {
    expect(isPickListFieldType('select')).toBe(true);
    expect(isPickListFieldType('radio')).toBe(true);
    expect(isPickListFieldType('checkbox')).toBe(true);
  });

  it('isPickListFieldType handles case insensitivity and surrounding whitespace', () => {
    expect(isPickListFieldType('SELECT')).toBe(true);
    expect(isPickListFieldType(' Radio ')).toBe(true);
    expect(isPickListFieldType('CheckBox')).toBe(true);
  });

  it('isPickListFieldType returns false for normal draftable question types (number, text, textarea)', () => {
    expect(isPickListFieldType('number')).toBe(false);
    expect(isPickListFieldType('text')).toBe(false);
    expect(isPickListFieldType('textarea')).toBe(false);
  });

  it('isPickListFieldType returns false for other non-picklist types and invalid values', () => {
    expect(isPickListFieldType('email')).toBe(false);
    expect(isPickListFieldType('file')).toBe(false);
    expect(isPickListFieldType('unknown')).toBe(false);
    expect(isPickListFieldType('')).toBe(false);
    expect(isPickListFieldType(null)).toBe(false);
    expect(isPickListFieldType(undefined)).toBe(false);
  });

  it('correctly classifies ExtractedQuestion objects', () => {
    const selectQuestion: ExtractedQuestion = {
      id: 'q1',
      label: 'Select your highest degree',
      fieldType: 'select',
      field: { tagName: 'select', id: 'deg', selector: '#deg' },
      labelSource: 'label-for',
      confidence: 1.0,
    };
    const radioQuestion: ExtractedQuestion = {
      id: 'q2',
      label: 'Are you legally authorized to work in the Philippines?',
      fieldType: 'radio',
      field: { tagName: 'input', id: 'auth', selector: '#auth' },
      labelSource: 'label-for',
      confidence: 1.0,
    };
    const checkboxQuestion: ExtractedQuestion = {
      id: 'q3',
      label: 'Which testing frameworks have you used?',
      fieldType: 'checkbox',
      field: { tagName: 'input', id: 'fw', selector: '#fw' },
      labelSource: 'label-for',
      confidence: 0.95,
    };
    const textQuestion: ExtractedQuestion = {
      id: 'q4',
      label: 'Describe a challenging project you delivered',
      fieldType: 'text',
      field: { tagName: 'input', id: 'proj', selector: '#proj' },
      labelSource: 'label-for',
      confidence: 1.0,
    };
    const textareaQuestion: ExtractedQuestion = {
      id: 'q5',
      label: 'Why are you interested in this role?',
      fieldType: 'textarea',
      field: { tagName: 'textarea', id: 'interest', selector: '#interest' },
      labelSource: 'label-for',
      confidence: 1.0,
    };
    const numberQuestion: ExtractedQuestion = {
      id: 'q6',
      label: 'How many years of experience do you have with Cypress?',
      fieldType: 'number',
      field: { tagName: 'input', id: 'yrs', selector: '#yrs' },
      labelSource: 'label-for',
      confidence: 1.0,
    };

    expect(isPickListFieldType(selectQuestion.fieldType)).toBe(true);
    expect(isPickListFieldType(radioQuestion.fieldType)).toBe(true);
    expect(isPickListFieldType(checkboxQuestion.fieldType)).toBe(true);

    expect(isPickListFieldType(textQuestion.fieldType)).toBe(false);
    expect(isPickListFieldType(textareaQuestion.fieldType)).toBe(false);
    expect(isPickListFieldType(numberQuestion.fieldType)).toBe(false);
  });
});
