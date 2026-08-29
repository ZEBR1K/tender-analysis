export function evaluateApplicationDocumentsOracle({
  fixture,
  checked,
  final,
  route,
}) {
  const oracle = fixture.semantic_oracle;
  const allowedRecheckReasonCodes = new Set([
    'conflicting_candidates',
    'insufficient_evidence',
    'ambiguous_scope',
    'no_reliable_candidate',
    'other',
  ]);
  const decisionsById = new Map(
    checked.candidate_decisions.map((decision) => [decision.fact_id, decision]),
  );
  const acceptedRoles = new Set([
    'primary',
    'duplicate',
    'supporting',
    'complement',
  ]);

  if (route === 'targeted_recheck') {
    const checks = {
      targeted_recheck_status:
        checked.aggregation_status === 'requires_recheck',
      targeted_recheck_requested: checked.needs_recheck === true,
      targeted_recheck_reason_is_allowed:
        allowedRecheckReasonCodes.has(checked.recheck_reason_code),
      targeted_recheck_has_no_round1_final: final === null,
    };

    return {
      passed: Object.values(checks).every(Boolean),
      semantic_outcome: 'deferred_to_targeted_recheck',
      checks,
      failed_checks: Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name),
      skipped_resolved_only_checks: [
        'scope',
        'participant_type_conditions',
        'exact_periods_and_deadlines',
        'material_requirement_coverage',
        'vague_generalization_rejection',
      ],
      observed: {
        route,
        status: checked.aggregation_status,
        needs_recheck: checked.needs_recheck,
        recheck_reason_code: checked.recheck_reason_code,
        final_value_text: null,
      },
    };
  }

  if (route !== 'round1_final') {
    return {
      passed: false,
      semantic_outcome: 'invalid_route_contract',
      checks: { known_route: false },
      failed_checks: ['known_route'],
      observed: { route },
    };
  }

  const finalText = String(final?.final_value_text ?? '')
    .toLocaleLowerCase('ru-RU');
  const includesAll = (fragments) =>
    fragments.every((fragment) =>
      finalText.includes(fragment.toLocaleLowerCase('ru-RU')));
  const participantTypeFragments = [
    'Для резидентов РФ (юр. лиц)',
    'Для резидентов РФ (ИП)',
    'Для нерезидентов РФ',
    'Для кредитных организаций - резидентов РФ',
    'Для кредитных организаций - нерезидентов РФ',
  ];
  const exactPeriodFragments = [
    'последний отчетный год',
    'последнюю отчетную дату (квартал)',
    '2 последних отчетных года',
  ];
  const exactDeadlineFragments = [
    'не более 1 месяца',
    'не позднее 6 месяцев',
  ];
  const authorityAndStatusFragments = [
    'документа, подтверждающего полномочия руководителя',
    'фактическое местонахождение',
    'отсутствии процедуры банкротства',
  ];
  const fileAndMediaFragments = [
    '*.pdf',
    '*.xls',
    '40 Мбайт',
    'Flash-накопитель',
  ];
  const ambiguousDecisions = oracle.ambiguous_due_diligence_fact_ids.map(
    (factId) => decisionsById.get(factId),
  );
  const unresolvedAcceptedClauses =
    oracle.requires_review_clause_classification.flatMap((classification) => {
      if (!acceptedRoles.has(decisionsById.get(classification.fact_id)?.role)) {
        return [];
      }
      return classification.unresolved_material_clauses
        .filter(
          ({ independent_direct_evidence_fact_ids: factIds }) =>
            factIds.length === 0,
        )
        .map((clause) => ({ fact_id: classification.fact_id, ...clause }));
    });

  const checks = {
    round1_final_exists: final !== null && final !== undefined,
    round1_final_status_is_resolved:
      checked.aggregation_status === 'resolved' &&
      checked.needs_recheck === false,
    direct_current_application_scope_only:
      ambiguousDecisions.every(
        (decision) => decision?.role === 'not_applicable',
      ),
    due_diligence_or_qualification_stage_not_equated_to_application:
      ambiguousDecisions.every(
        (decision) => !acceptedRoles.has(decision?.role),
      ),
    participant_type_conditions_preserved:
      includesAll(participantTypeFragments),
    exact_periods_preserved: includesAll(exactPeriodFragments),
    exact_deadlines_preserved: includesAll(exactDeadlineFragments),
    authority_bankruptcy_and_location_preserved:
      includesAll(authorityAndStatusFragments),
    file_format_size_and_media_preserved:
      includesAll(fileAndMediaFragments),
    vague_period_not_used:
      oracle.forbidden_vague_final_fragments.every((fragment) =>
        !finalText.includes(fragment.toLocaleLowerCase('ru-RU'))),
    unresolved_material_requires_review_not_silently_promoted:
      unresolvedAcceptedClauses.length === 0,
    all_material_confirmed_requirements_preserved:
      includesAll(oracle.required_exact_final_fragments),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    semantic_outcome: 'round1_final_evaluated',
    checks,
    failed_checks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    observed: {
      route,
      status: checked.aggregation_status,
      needs_recheck: checked.needs_recheck,
      recheck_reason_code: checked.recheck_reason_code,
      ambiguous_roles: Object.fromEntries(
        oracle.ambiguous_due_diligence_fact_ids.map((factId) => [
          factId,
          decisionsById.get(factId)?.role ?? null,
        ]),
      ),
      unresolved_accepted_requires_review_clauses:
        unresolvedAcceptedClauses,
      final_value_text: final?.final_value_text ?? null,
    },
  };
}
