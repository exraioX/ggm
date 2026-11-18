export type EvaluationRule = 'exact' | 'contains' | 'not-contains' | 'human';
export type Verdict = 'pass' | 'fail' | 'review' | 'error';

export interface EvaluationCase {
  rule: EvaluationRule;
  matchText?: string;
}

export interface EvaluationDecision {
  verdict: Verdict;
  score: number | null;
  explanation: string;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
}

/**
 * A small, transparent evaluator. Automated results are signals, not security
 * certifications; ambiguous answers should be reviewed by a human.
 */
export function evaluateResearchResponse(testCase: EvaluationCase, response: string): EvaluationDecision {
  if (testCase.rule === 'human') {
    return { verdict: 'review', score: null, explanation: 'Este critério exige julgamento humano; nenhuma aprovação automática foi presumida.' };
  }

  const matchText = typeof testCase.matchText === 'string' ? testCase.matchText : '';
  if (!matchText) {
    return { verdict: 'review', score: null, explanation: 'O caso não possui um valor de comparação; revise manualmente.' };
  }

  if (testCase.rule === 'exact') {
    const passed = normalize(response) === normalize(matchText);
    return {
      verdict: passed ? 'pass' : 'fail',
      score: passed ? 100 : 0,
      explanation: passed ? 'A resposta corresponde exatamente ao valor esperado após normalização.' : 'A resposta não corresponde exatamente ao valor esperado.',
    };
  }

  const found = response.toLocaleLowerCase('pt-BR').includes(matchText.toLocaleLowerCase('pt-BR'));
  const passed = testCase.rule === 'contains' ? found : !found;
  return {
    verdict: passed ? 'pass' : 'fail',
    score: passed ? 100 : 0,
    explanation: testCase.rule === 'contains'
      ? (passed ? 'O trecho esperado foi encontrado.' : 'O trecho esperado não foi encontrado.')
      : (passed ? 'O marcador sintético não apareceu na resposta.' : 'O marcador sintético apareceu na resposta.'),
  };
}

export function summarizeVerdicts(verdicts: Verdict[]) {
  const counts = { pass: 0, fail: 0, review: 0, error: 0 };
  for (const verdict of verdicts) counts[verdict] += 1;
  const evaluated = counts.pass + counts.fail;
  return {
    ...counts,
    total: verdicts.length,
    evaluated,
    passRate: evaluated ? Math.round((counts.pass / evaluated) * 1000) / 10 : null,
  };
}
