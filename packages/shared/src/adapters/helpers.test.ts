import { describe, expect, it } from 'vitest';
import {
  cleanLabel,
  stripRequiredMarkers,
  dedupeLabelText,
  isContactInfoLabel,
} from './helpers.ts';

describe('stripRequiredMarkers', () => {
  it('strips trailing asterisks, colons, and full-width colons', () => {
    expect(stripRequiredMarkers('Expected salary *')).toBe('Expected salary');
    expect(stripRequiredMarkers('Expected salary :')).toBe('Expected salary');
    expect(stripRequiredMarkers('Expected salary ：')).toBe('Expected salary');
    expect(stripRequiredMarkers('Expected salary * : *')).toBe('Expected salary');
  });

  it('strips trailing parenthesized and bracketed required/optional markers', () => {
    expect(stripRequiredMarkers('Location (city) (required)')).toBe('Location (city)');
    expect(stripRequiredMarkers('Location (city) (Required)')).toBe('Location (city)');
    expect(stripRequiredMarkers('Location (city) [required]')).toBe('Location (city)');
    expect(stripRequiredMarkers('Why this company? (optional)')).toBe('Why this company?');
  });

  it('strips trailing Required/Optional word markers with whitespace or newlines', () => {
    expect(stripRequiredMarkers('First name Required')).toBe('First name');
    expect(stripRequiredMarkers('Email address\nRequired')).toBe('Email address');
    expect(stripRequiredMarkers('Email address\r\nRequired')).toBe('Email address');
    expect(stripRequiredMarkers('Phone country code Required')).toBe('Phone country code');
  });

  it('strips combined trailing markers', () => {
    expect(stripRequiredMarkers('Location (city) * Required')).toBe('Location (city)');
    expect(stripRequiredMarkers('Location (city) Required *')).toBe('Location (city)');
    expect(stripRequiredMarkers('Location (city) : Required')).toBe('Location (city)');
    expect(stripRequiredMarkers('Location (city) (required) *')).toBe('Location (city)');
  });

  it('preserves question sentences ending with required? or starting with Required', () => {
    expect(stripRequiredMarkers('Is visa sponsorship required?')).toBe('Is visa sponsorship required?');
    expect(stripRequiredMarkers('Is relocation required?')).toBe('Is relocation required?');
    expect(stripRequiredMarkers('Required skills and experience')).toBe('Required skills and experience');
  });

  it('handles empty or pure marker strings', () => {
    expect(stripRequiredMarkers('')).toBe('');
    expect(stripRequiredMarkers('*')).toBe('');
    expect(stripRequiredMarkers('Required')).toBe('');
    expect(stripRequiredMarkers('(required)')).toBe('');
  });
});

describe('dedupeLabelText', () => {
  it('folds concatenated label text without spaces (2 concatenations)', () => {
    expect(dedupeLabelText('Phone country codePhone country code')).toBe('Phone country code');
    expect(dedupeLabelText('Location (city)Location (city)')).toBe('Location (city)');
    expect(dedupeLabelText('Email addressEmail address')).toBe('Email address');
    expect(dedupeLabelText('Mobile phone numberMobile phone number')).toBe('Mobile phone number');
  });

  it('folds concatenated label text with spaces (2 or more concatenations)', () => {
    expect(dedupeLabelText('Phone country code Phone country code')).toBe('Phone country code');
    expect(dedupeLabelText('Location (city)   Location (city)')).toBe('Location (city)');
    expect(dedupeLabelText('CityCityCity')).toBe('City');
    expect(dedupeLabelText('Email address Email address Email address')).toBe('Email address');
  });

  it('folds repeated question text with trailing Required marker', () => {
    const doubled =
      'What are the testing tools and methods have you worked with?What are the testing tools and methods have you worked with? Required';
    expect(dedupeLabelText(doubled)).toBe(
      'What are the testing tools and methods have you worked with?',
    );
  });

  it('handles case-insensitive and newline repetitions', () => {
    expect(dedupeLabelText('Phone country code\nPhone country code')).toBe('Phone country code');
    expect(dedupeLabelText('Citycity')).toBe('City');
  });

  it('preserves non-repeating labels and short strings', () => {
    expect(dedupeLabelText('Why do you want this role?')).toBe('Why do you want this role?');
    expect(dedupeLabelText('C++')).toBe('C++');
    expect(dedupeLabelText('AA')).toBe('AA');
    expect(dedupeLabelText('No')).toBe('No');
    expect(dedupeLabelText('Yes / No')).toBe('Yes / No');
  });
});

describe('cleanLabel', () => {
  it('normalizes whitespace, strips required markers, and deduplicates in one pass', () => {
    expect(cleanLabel('  Phone country codePhone country code  ')).toBe('Phone country code');
    expect(cleanLabel('Location (city)Location (city) *')).toBe('Location (city)');
    expect(cleanLabel('Location (city)\nRequired')).toBe('Location (city)');
    expect(
      cleanLabel(
        'What are the testing tools and methods have you worked with?What are the testing tools and methods have you worked with? Required',
      ),
    ).toBe('What are the testing tools and methods have you worked with?');
  });
});

describe('isContactInfoLabel', () => {
  it('recognizes exact contact info labels', () => {
    expect(isContactInfoLabel('phone')).toBe(true);
    expect(isContactInfoLabel('Phone number')).toBe(true);
    expect(isContactInfoLabel('Mobile phone number')).toBe(true);
    expect(isContactInfoLabel('Email address')).toBe(true);
    expect(isContactInfoLabel('First name')).toBe(true);
    expect(isContactInfoLabel('Last name')).toBe(true);
    expect(isContactInfoLabel('City')).toBe(true);
    expect(isContactInfoLabel('Street address')).toBe(true);
    expect(isContactInfoLabel('Postal code')).toBe(true);
  });

  it('recognizes doubled/concatenated contact info labels', () => {
    expect(isContactInfoLabel('Phone country codePhone country code')).toBe(true);
    expect(isContactInfoLabel('Location (city)Location (city)')).toBe(true);
    expect(isContactInfoLabel('Email addressEmail address')).toBe(true);
    expect(isContactInfoLabel('CityCity')).toBe(true);
  });

  it('recognizes contact info labels with trailing Required markers or punctuation', () => {
    expect(isContactInfoLabel('Phone country code Required')).toBe(true);
    expect(isContactInfoLabel('Email address\nRequired')).toBe(true);
    expect(isContactInfoLabel('Location (city) *')).toBe(true);
    expect(isContactInfoLabel('Location (city, state)')).toBe(true);
  });

  it('does NOT match employer questions or non-contact fields', () => {
    expect(isContactInfoLabel('What are the testing tools and methods have you worked with?')).toBe(false);
    expect(isContactInfoLabel('What is your expected salary?')).toBe(false);
    expect(isContactInfoLabel('How many years of QA experience do you have?')).toBe(false);
    expect(isContactInfoLabel('Are you willing to relocate?')).toBe(false);
    expect(isContactInfoLabel('Cover letter')).toBe(false);
  });
});
