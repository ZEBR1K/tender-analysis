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
  const decisionFactId = (decision) => {
    if (typeof decision.fact_id === 'string') return decision.fact_id;
    if (
      typeof decision.candidate_ref === 'string' &&
      decision.candidate_ref.startsWith('fact:')
    ) {
      return decision.candidate_ref.slice('fact:'.length);
    }
    return null;
  };
  const decisionsById = new Map(
    checked.candidate_decisions
      .map((decision) => [decisionFactId(decision), decision])
      .filter(([factId]) => factId !== null),
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

  if (route === 'round2_requires_review') {
    const aggregationCandidates = Array.isArray(
      checked.aggregation_input?.candidates,
    )
      ? checked.aggregation_input.candidates
      : [];
    const checkedDecisions = Array.isArray(checked.candidate_decisions)
      ? checked.candidate_decisions
      : [];
    const finalDecisions = Array.isArray(final?.candidate_decisions)
      ? final.candidate_decisions
      : [];
    const candidateRefs = aggregationCandidates.map(
      ({ candidate_ref: candidateRef }) => candidateRef,
    );
    const checkedDecisionRefs = checkedDecisions.map(
      ({ candidate_ref: candidateRef }) => candidateRef,
    );
    const finalDecisionRefs = finalDecisions.map(
      ({ candidate_ref: candidateRef }) => candidateRef,
    );
    const refsAreExact = (actualRefs) =>
      actualRefs.length === candidateRefs.length &&
      new Set(actualRefs).size === actualRefs.length &&
      candidateRefs.every((candidateRef) => actualRefs.includes(candidateRef));
    const checkedDecisionsByRef = new Map(
      checkedDecisions.map((decision) => [decision.candidate_ref, decision]),
    );
    const expectedAcceptedEvidence = aggregationCandidates.flatMap(
      (candidate) => {
        if (!acceptedRoles.has(checkedDecisionsByRef.get(candidate.candidate_ref)?.role)) {
          return [];
        }
        return (Array.isArray(candidate.evidence) ? candidate.evidence : []).map(
          (evidence) => ({ candidate_ref: candidate.candidate_ref, evidence }),
        );
      },
    );
    const finalEvidence = Array.isArray(final?.evidence) ? final.evidence : [];
    const evidenceItemIsPreserved = ({ candidate_ref: candidateRef, evidence }) =>
      finalEvidence.some(
        (finalItem) =>
          finalItem.candidate_ref === candidateRef &&
          finalItem.analysis_unit_id === evidence.analysis_unit_id &&
          finalItem.semantic_block_id === evidence.semantic_block_id &&
          finalItem.quote === evidence.quote,
      );
    const unresolvedEgripFactId =
      '74000000-0016-4000-8000-000000000016';
    const unresolvedEgripCandidate = aggregationCandidates.find(
      ({ candidate_ref: candidateRef }) =>
        candidateRef === `fact:${unresolvedEgripFactId}`,
    );
    const unresolvedEgripDecision = checkedDecisionsByRef.get(
      `fact:${unresolvedEgripFactId}`,
    );

    const checks = {
      round2_checked_status_requires_review:
        checked.aggregation_status === 'requires_review',
      round2_checked_needs_recheck_is_false: checked.needs_recheck === false,
      round2_final_exists: final !== null && final !== undefined,
      round2_final_status_requires_review:
        final?.aggregation_status === 'requires_review',
      round2_final_needs_recheck_is_false: final?.needs_recheck === false,
      round2_final_requires_human_review:
        final?.requires_human_review === true,
      round2_review_reason_is_allowed:
        allowedRecheckReasonCodes.has(checked.review_reason_code) &&
        final?.review_reason_code === checked.review_reason_code,
      round2_review_note_is_nonempty:
        typeof checked.review_note === 'string' &&
        checked.review_note.trim().length > 0 &&
        final?.review_note === checked.review_note,
      automatic_partial_resolved_absent:
        checked.aggregation_status !== 'resolved' &&
        final?.aggregation_status !== 'resolved',
      checked_candidate_decisions_preserved: refsAreExact(checkedDecisionRefs),
      final_candidate_decisions_preserved:
        refsAreExact(finalDecisionRefs) &&
        JSON.stringify(finalDecisions) === JSON.stringify(checkedDecisions),
      accepted_candidate_evidence_preserved:
        expectedAcceptedEvidence.length > 0 &&
        expectedAcceptedEvidence.every(evidenceItemIsPreserved),
      round2_audit_provenance_preserved:
        final?.aggregation_round === 2 &&
        final?.recheck_attempt === checked.recheck_attempt &&
        JSON.stringify(final?.original_aggregation) ===
          JSON.stringify(checked.original_aggregation) &&
        JSON.stringify(final?.recheck_profile) ===
          JSON.stringify(checked.recheck_profile) &&
        final?.targeted_recheck_result?.post_validator_route ===
          checked.post_validator_route,
      unresolved_egrip_requirement_not_reliably_resolved:
        unresolvedEgripCandidate?.validator_verdict === 'requires_review' &&
        /ЕГРИП.*не позднее 6 месяцев/iu.test(
          unresolvedEgripCandidate?.value_text ?? '',
        ) &&
        unresolvedEgripDecision !== undefined &&
        !acceptedRoles.has(unresolvedEgripDecision.role) &&
        final?.aggregation_status === 'requires_review',
    };

    return {
      passed: Object.values(checks).every(Boolean),
      semantic_outcome: 'round2_requires_review_evaluated',
      checks,
      failed_checks: Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name),
      observed: {
        route,
        checked_status: checked.aggregation_status,
        final_status: final?.aggregation_status ?? null,
        needs_recheck: checked.needs_recheck,
        review_reason_code: checked.review_reason_code ?? null,
        review_note: checked.review_note ?? null,
        candidate_count: candidateRefs.length,
        checked_decision_count: checkedDecisionRefs.length,
        final_decision_count: finalDecisionRefs.length,
        expected_accepted_evidence_count: expectedAcceptedEvidence.length,
        final_evidence_count: finalEvidence.length,
        unresolved_egrip_role: unresolvedEgripDecision?.role ?? null,
      },
    };
  }

  if (route !== 'round1_final' && route !== 'round2_final') {
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
    semantic_outcome:
      route === 'round2_final'
        ? 'round2_final_evaluated'
        : 'round1_final_evaluated',
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
