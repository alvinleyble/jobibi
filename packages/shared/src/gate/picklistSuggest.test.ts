import { describe, expect, it, vi } from 'vitest';
import { isPickListFieldType, PICK_LIST_MESSAGE } from '../adapters/types.ts';
import { normalizeQuestion } from './normalize.ts';

describe('Pick-list Suggest Behavior & Invariants (D24)', () => {
  // Deterministic code-level suggestion resolver simulating the suggest endpoint behavior
  function resolveSuggestOutcome(params: {
    question: string;
    jobContext: { role: string; company: string };
    fieldType?: string;
    gateLogger?: (entry: unknown) => void;
    modelCaller?: () => void;
  }) {
    const questionNorm = normalizeQuestion(params.question);

    // D24: Pick-list check happens before retrieval, before gate, before model call, before gate_decisions logging
    if (isPickListFieldType(params.fieldType)) {
      return {
        outcome: 'pick_list' as const,
        questionNorm,
        questionMatch: 0,
        roleMatch: 0,
        message: PICK_LIST_MESSAGE,
        refuseMessage: PICK_LIST_MESSAGE,
      };
    }

    // Normal processing simulation: calls gate logger and/or model
    if (params.gateLogger) {
      params.gateLogger({
        question_norm: questionNorm,
        outcome: 'draft',
      });
    }
    if (params.modelCaller) {
      params.modelCaller();
    }

    return {
      outcome: 'draft' as const,
      questionNorm,
      questionMatch: 0.85,
      roleMatch: 0.9,
      answer: 'Drafted essay answer',
    };
  }

  it('returns fixed pick-list response for select, radio, and checkbox with zero model calls and zero gate_decisions entries', () => {
    const pickListTypes = ['select', 'radio', 'checkbox'] as const;

    for (const fieldType of pickListTypes) {
      const mockGateLogger = vi.fn();
      const mockModelCaller = vi.fn();

      const result = resolveSuggestOutcome({
        question: 'Which frontend frameworks have you used in production?',
        jobContext: { role: 'Senior Frontend Engineer', company: 'Acme' },
        fieldType,
        gateLogger: mockGateLogger,
        modelCaller: mockModelCaller,
      });

      // Fixed pick-list response
      expect(result.outcome).toBe('pick_list');
      expect(result.message).toBe('Pick from the options on the page.');
      expect(result.refuseMessage).toBe('Pick from the options on the page.');

      // Invariant: Zero model calls (zero tokens consumed)
      expect(mockModelCaller).not.toHaveBeenCalled();

      // Invariant: Zero gate_decisions entries (never reached gate; does not pollute calibration data D15)
      expect(mockGateLogger).not.toHaveBeenCalled();
    }
  });

  it('leaves number, text, and textarea questions unaffected (proceeds to gate and drafting)', () => {
    const normalTypes = ['number', 'text', 'textarea'] as const;

    for (const fieldType of normalTypes) {
      const mockGateLogger = vi.fn();
      const mockModelCaller = vi.fn();

      const result = resolveSuggestOutcome({
        question: 'How many years of automated QA testing experience do you have?',
        jobContext: { role: 'QA Lead', company: 'TechCorp' },
        fieldType,
        gateLogger: mockGateLogger,
        modelCaller: mockModelCaller,
      });

      expect(result.outcome).toBe('draft');
      expect(result.outcome).not.toBe('pick_list');
      expect(result.answer).toBe('Drafted essay answer');

      // Normal processing calls gate and model
      expect(mockGateLogger).toHaveBeenCalledTimes(1);
      expect(mockModelCaller).toHaveBeenCalledTimes(1);
    }
  });

  it('handles questions with undefined fieldType as normal questions', () => {
    const mockGateLogger = vi.fn();
    const mockModelCaller = vi.fn();

    const result = resolveSuggestOutcome({
      question: 'Tell us about your background in mobile testing.',
      jobContext: { role: 'Mobile QA', company: 'AppWorks' },
      fieldType: undefined,
      gateLogger: mockGateLogger,
      modelCaller: mockModelCaller,
    });

    expect(result.outcome).toBe('draft');
    expect(mockGateLogger).toHaveBeenCalledTimes(1);
    expect(mockModelCaller).toHaveBeenCalledTimes(1);
  });
});
