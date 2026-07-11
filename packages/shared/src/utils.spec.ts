import { describe, expect, it } from 'vitest';
import { classifyProjectFromJobTypes, validateServiceAddition } from './utils';

describe('classifyProjectFromJobTypes', () => {
  it('classifies packing only projects', () => {
    expect(classifyProjectFromJobTypes(['PACKING'])).toBe('אריזה');
  });

  it('classifies unpacking only projects', () => {
    expect(classifyProjectFromJobTypes(['UNPACKING'])).toBe('פריקה');
  });

  it('classifies organizing only projects', () => {
    expect(classifyProjectFromJobTypes(['HOME_ORGANIZATION'])).toBe('סידור');
  });

  it('classifies moving projects when packing and unpacking exist', () => {
    expect(classifyProjectFromJobTypes(['PACKING', 'UNPACKING'])).toBe('מעבר דירה');
  });
});

describe('validateServiceAddition', () => {
  it('blocks adding organizing to project with unpacking', () => {
    const message = validateServiceAddition(['UNPACKING'], 'HOME_ORGANIZATION');
    expect(message).toContain('שירות פריקה כבר כולל סידור');
  });

  it('blocks adding unpacking to organizing project', () => {
    const message = validateServiceAddition(['HOME_ORGANIZATION'], 'UNPACKING');
    expect(message).toContain('פריקה וסידור עצמאי מנוהלים כפרויקטים נפרדים');
  });

  it('allows valid packing to unpacking progression', () => {
    expect(validateServiceAddition(['PACKING'], 'UNPACKING')).toBeNull();
  });
});
