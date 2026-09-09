# Graph Report - tender-analysis  (2026-09-06)

## Corpus Check
- Large corpus: 163 files · ~921,169 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 900 nodes · 1337 edges · 53 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 48 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- DOCX Option State Tests
- Evidence Repair Tests
- Extractor Recovery Tests
- DW-23 Integration Design
- Application Documents Runtime
- Targeted Recheck Workflows
- Procurement Subject Evaluation
- E2E Body SDK
- Live E2E Verification
- Validator Selective Retry
- DOCX Option Ownership Tests
- E2E Workflow Builder
- Extractor Envelope Tests
- E2E Export Tooling
- Recheck Evidence Coordinates
- Application Documents 14173
- Application Documents Containment
- E2E Runner Tests
- Procurement Subject 14104
- Extractor Model Evaluation
- Runtime Evaluation Tools
- Validator Runtime Tools
- Validator Field Profiles
- Recheck Existing Candidates
- Sanitized Fixture Manifests
- Semantic Containment 14260
- Recheck Application Gate
- Noncontiguous Quote Regression
- Core Architecture Model
- Live Test Overlay
- Fact Literal Guard
- Recheck Route 14429
- Field Semantics Catalog
- Project State Plans
- Validator Runtime Contract
- E2E Controller SDK
- Validator Semantic Oracle
- Finalization Report Pipeline
- Replay Report SDK
- Evidence Integrity Design
- Application Documents 14254
- National Regime Tests
- Project History Status
- ActiveX Ownership Evolution
- Project Index Synchronization
- Extractor Recovery Canary
- Report Generation Evolution
- Recovery Barrier Test
- Extractor Recovery Failures
- Aggregator Model Selection
- GLM 5.2 Evaluation
- Replay Report Builder
- Fallback Canary 14363

## God Nodes (most connected - your core abstractions)
1. `executeWorkflowCodeNode()` - 34 edges
2. `loadAggregatorWorkflow()` - 26 edges
3. `runAggregatorRound1()` - 13 edges
4. `Targeted Recheck Workflow` - 12 edges
5. `buildControllerWorkflow()` - 11 edges
6. `RuntimePreflightError` - 11 edges
7. `RuntimePreflightError` - 10 edges
8. `prepareLiveBetaRuntimeRequest()` - 10 edges
9. `prepareLiveBetaRuntimeRequest()` - 10 edges
10. `runCodeNode()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Lossless Fact Partition` --semantically_similar_to--> `Reference-Only Evidence Repair V2`  [INFERRED] [semantically similar]
  DOCUMENT_WORKER_LOSSLESS_FACT_PARTITION_IMPLEMENTATION_PLAN.md → docs/superpowers/plans/2026-09-02-dw17-reference-only-evidence-repair.md
- `Report Must Not Change Analysis Results` --semantically_similar_to--> `not_found Is Unknown, Not Negative`  [INFERRED] [semantically similar]
  REPORT_FIELD_MAPPING.md → FIELD_CATALOG.md
- `Verified Live E2E Baseline` --conceptually_related_to--> `End-to-End Tender Analysis Pipeline`  [INFERRED]
  REVIEW_2026-08-23.md → ARCHITECTURE.md
- `Invalid-Confidence Selective Retry Green` --semantically_similar_to--> `Fact-Identity Selective Retry`  [INFERRED] [semantically similar]
  evaluations/DOCUMENT_WORKER_DW23_RUNTIME_14589_2026-09-06.md → docs/superpowers/specs/2026-09-05-dw23-validator-selective-retry-design.md
- `Exact Grounding Pass and Applicability Fail` --semantically_similar_to--> `Fail-Closed Semantic Review Cap`  [INFERRED] [semantically similar]
  evaluations/DOCUMENT_WORKER_SEMANTIC_AUDIT_14374_14376_2026-09-03.md → docs/superpowers/specs/2026-09-03-activex-local-semantic-ownership-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Tender Analysis Persistent Lifecycle** — architecture_end_to_end_pipeline, data_model_tender_analysis_runs, data_model_tender_analysis_documents, data_model_tender_analysis_units, data_model_tender_analysis_facts, data_model_tender_analysis_field_results, architecture_finalization_barrier [EXTRACTED 1.00]
- **Document Worker Semantic Integrity Controls** — architecture_layered_ai_validation, document_worker_lossless_fact_partition_implementation_plan_lossless_fact_partition, docs_superpowers_plans_2026_09_02_dw17_reference_only_evidence_repair_reference_only_repair, docs_superpowers_plans_2026_09_03_dw21_structural_option_owner_structural_option_owner, docs_superpowers_plans_2026_09_05_dw23_validator_selective_retry_selective_validator_retry, docs_superpowers_plans_2026_08_31_dw18_ag11_docx_option_state_ag_11_containment [INFERRED 0.85]
- **Report Generation V2 Layered Flow** — report_generation_v2_architecture_report_snapshot, report_generation_v2_architecture_report_adapter, report_generation_v2_architecture_report_model, report_generation_v2_architecture_html_renderer, report_field_mapping_client_presentation_mapping [EXTRACTED 1.00]
- **DW-23 Three-Way Contract Integration** — docs_superpowers_specs_2026_09_03_activex_local_semantic_ownership_design_group_local_applicability, docs_superpowers_plans_2026_09_06_dw23_active_x_three_way_integration_json_tuple_identity_contract, docs_superpowers_specs_2026_09_05_dw_evidence_catalog_overflow_design_target_ranked_windows, docs_superpowers_specs_2026_09_05_dw23_validator_selective_retry_design_fact_identity_retry [INFERRED 0.95]
- **Reference-Only Evidence Repair Safety Architecture** — docs_superpowers_specs_2026_09_02_dw17_reference_only_evidence_repair_design_canonical_evidence_catalog, docs_superpowers_specs_2026_09_02_dw17_reference_only_evidence_repair_design_reference_only_selection_protocol, docs_superpowers_specs_2026_09_02_dw17_reference_only_evidence_repair_design_strict_catalog_rebuild_parity, docs_superpowers_specs_2026_09_05_dw_evidence_catalog_overflow_design_target_ranked_windows, docs_superpowers_specs_2026_09_05_dw_evidence_catalog_overflow_design_overflow_audit_parity [INFERRED 0.95]
- **Extractor Recovery Canary Progression** — evaluations_document_worker_extractor_recovery_canary_14360_2026_09_01_paired_item_ancestry_defect, evaluations_document_worker_extractor_recovery_canary_14361_2026_09_01_code_node_input_api_mismatch, evaluations_document_worker_extractor_recovery_canary_14362_2026_09_01_canary_barrier_identity_source_defect, evaluations_document_worker_batch_first_canary_14367_2026_09_02_batch_first_gate_green [INFERRED 0.85]
- **Tender Analysis MVP Pipeline** — workflows_orchestrator_orchestrator_workflow, workflows_document_worker_document_worker, workflows_aggregator_aggregator_workflow, workflows_targeted_recheck_targeted_recheck_workflow, workflows_report_generation_report_generation_workflow [EXTRACTED 1.00]
- **Targeted Recheck Model Stack Comparison** — evaluations_targeted_recheck_deepseek_eval_2026_08_30_evaluation, evaluations_targeted_recheck_glm_gemini_glm_eval_2026_08_30_evaluation, evaluations_targeted_recheck_glm_gemini_gemini_eval_2026_08_30_evaluation [EXTRACTED 1.00]
- **E2E PIN Canary and Confirmation Sequence** — evaluations_tender_e2e_pin_canary_14259_2026_08_31_canary, evaluations_tender_e2e_pin_canary_14279_2026_08_31_canary, evaluations_tender_e2e_pin_canary_14294_2026_08_31_canary, evaluations_tender_e2e_pin_confirmations_2026_08_31_confirmation_series [INFERRED 0.95]

## Communities (53 total, 0 thin omitted)

### Community 0 - "DOCX Option State Tests"
Cohesion: 0.05
Nodes (38): binaryDescriptor(), binaryPartItems(), buildCfbWithContents(), buildMorphDataContents(), buildOptionStateSemanticFixture(), cfbGateCases, decodeXmlEntities(), doclingTable() (+30 more)

### Community 1 - "Evidence Repair Tests"
Cohesion: 0.06
Nodes (39): aggregatorWorkflowPath, betaWorkflowPath, buildCatalogParityFixture(), buildConvergenceUnit(), buildDispatchReadyUnit(), buildExecution14061PostOverlapUnits(), buildExecution14487SanitizedDerivative(), buildExtractorResponse() (+31 more)

### Community 2 - "Extractor Recovery Tests"
Cohesion: 0.06
Nodes (44): fixture, testDirectory, assertExactHardStop(), AUDIT_KEYS, batchingFixture, batchingFixturePath, buildAttemptEnvelope(), buildAudit() (+36 more)

### Community 3 - "DW-23 Integration Design"
Cohesion: 0.06
Nodes (40): DW-23 ActiveX Three-Way Integration Plan, Versioned JSON Tuple Identity Contract, Live-Test Operational Overlay, Semantic Merge Strategy, Canonical Evidence Catalog, Lossless Evidence Merge, DW-17 Reference-Only Evidence Repair Design, Reference-Only Evidence Selection Protocol (+32 more)

### Community 4 - "Application Documents Runtime"
Cohesion: 0.10
Nodes (32): evaluateApplicationDocumentsOracle(), ambiguousCandidateRoles(), baseReport(), checkerRejectionResult(), evaluateHttpRequestBody(), evaluateLiveBetaModelResponse(), evaluateOfflineModelResponse(), evaluatePreparedModelResponse() (+24 more)

### Community 5 - "Targeted Recheck Workflows"
Cohesion: 0.12
Nodes (34): GPT-5.4 Nano Low Extractor Evaluation, GPT-5.6 Luna Pro Low Extractor Evaluation, DeepSeek Targeted Recheck Evaluation, Targeted Recheck 14389–14391 Forensic Report, GLM Gemini Gemini Targeted Recheck Evaluation, GLM Gemini GLM Targeted Recheck Evaluation, Tender E2E PIN Canary 14259, Tender E2E PIN Canary 14279 (+26 more)

### Community 6 - "Procurement Subject Evaluation"
Cohesion: 0.16
Nodes (23): evaluateProcurementSubjectOracle(), evaluateRecordedFixture(), loadAggregatorFixture(), runAggregatorRound1(), ALLOWED_RUNTIME_MODEL_ALIAS_SET, ALLOWED_RUNTIME_MODEL_ALIASES, checkerRejectionResult(), evaluateHttpRequestBody() (+15 more)

### Community 7 - "E2E Body SDK"
Cohesion: 0.08
Nodes (24): n0, n1, n10, n11, n12, n13, n14, n15 (+16 more)

### Community 8 - "Live E2E Verification"
Cohesion: 0.09
Nodes (20): baseUrl, behavior(), betaDirectory, byName(), controllerText, ids, liveBodyDownstreamConnections, liveBodyNodes (+12 more)

### Community 9 - "Validator Selective Retry"
Cohesion: 0.12
Nodes (18): assertExplicitSourceEnvelope(), buildExecutionBoundary(), buildFact(), buildUnits(), dispatchEnvelope(), explicitSourceEnvelope(), findNode(), fixture (+10 more)

### Community 10 - "DOCX Option Ownership Tests"
Cohesion: 0.12
Nodes (14): fixture, fixturePath, mappedOption(), node(), normalize(), parserInputItems(), root, runCode() (+6 more)

### Community 11 - "E2E Workflow Builder"
Cohesion: 0.16
Nodes (22): assertBodyParity(), barrierSql(), buildBodyWorkflow(), buildControllerWorkflow(), clone(), collapseCode(), contractGuardCode(), exactRunnerRequest() (+14 more)

### Community 12 - "Extractor Envelope Tests"
Cohesion: 0.11
Nodes (12): buildAttemptEnvelope(), findNode(), fixture, fixturePath, recoveryFixture, recoveryFixturePath, repositoryRoot, runEvidenceValidator() (+4 more)

### Community 13 - "E2E Export Tooling"
Cohesion: 0.11
Nodes (16): baseUrl, body, controller, files, outputDirectory, replayReport, replayReportOnly, repositoryRoot (+8 more)

### Community 14 - "Recheck Evidence Coordinates"
Cohesion: 0.14
Nodes (14): loadAggregatorWorkflow(), assertEvidenceFallback(), buildAiResponse(), buildSource(), testDirectory, validateEvidence(), workflowPath, check() (+6 more)

### Community 15 - "Application Documents 14173"
Cohesion: 0.14
Nodes (11): assertExportContainsNoExecutionSpecificLiterals(), betaWorkflowPath, canonicalWorkflowPath, controlsFixturePath, executionFixturePath, fieldCatalogPath, loadControlsFixture(), loadExecutionFixture() (+3 more)

### Community 16 - "Application Documents Containment"
Cohesion: 0.16
Nodes (14): buildApiResponse(), buildExecution14252Shape(), fixtureFactId(), runChecker(), testDirectory, workflowPath, classify(), fixture (+6 more)

### Community 17 - "E2E Runner Tests"
Cohesion: 0.12
Nodes (13): reportSourcePath, repositoryRoot, sourcePath, testDirectory, ANALYSIS_RUN_ID, CLAIM_PIN_ITEM, CONTROLLER_WORKFLOW_NAME, evaluateReportDispatch() (+5 more)

### Community 18 - "Procurement Subject 14104"
Cohesion: 0.14
Nodes (14): assertUniversalProcurementSubjectBoundary(), betaAggregatorWorkflowPath, expectedExecution14104Response(), fieldCatalogPath, fixturePath, getProcurementSubjectRules(), repositoryRoot, runtimeEvalPath (+6 more)

### Community 19 - "Extractor Model Evaluation"
Cohesion: 0.14
Nodes (16): DeepSeek Contract Compliance Failure, DeepSeek V4 Flash 0731 Extractor Evaluation, Reject DeepSeek as Extractor, DeepSeek Evaluation-Criteria Semantic Overreach, Deterministic Grounding Cannot Validate Field Semantics, Extractor Model Comparison, GLM 5.3 Flash Low Extractor Baseline, Stop Extractor Model Search on Current Fixture (+8 more)

### Community 20 - "Runtime Evaluation Tools"
Cohesion: 0.14
Nodes (13): applicationDocumentsTestPath, fixturePath, repositoryRoot, runtimeEvalPath, testDirectory, aggregatorAntiOverfitFixturePath, aggregatorFixturePath, aggregatorWorkflowPath (+5 more)

### Community 21 - "Validator Runtime Tools"
Cohesion: 0.16
Nodes (11): buildValidatorRequest(), evaluateValidatorOutput(), parseValidatorOutput(), recordedContent(), args, fixturePath, modes, promptPath (+3 more)

### Community 22 - "Validator Field Profiles"
Cohesion: 0.17
Nodes (11): buildFact(), buildUnit(), CANONICAL_FIELD_KEYS, executeCode(), findNode(), previousStaticPromptPath, repositoryRoot, runNode() (+3 more)

### Community 23 - "Recheck Existing Candidates"
Cohesion: 0.27
Nodes (14): assertTechnicalFallback(), buildApplicationDocumentsItem(), buildExecution14256Fixture(), candidate(), checkItem(), existingOnlyEvidenceIndexes, extractorResponse(), mutateApplicationItem() (+6 more)

### Community 24 - "Sanitized Fixture Manifests"
Cohesion: 0.14
Nodes (13): content_review, credentials_or_secrets_found, full_client_docx_included, notes, personal_data_found, unrelated_procurement_content_included, contract_version, derived_parts (+5 more)

### Community 25 - "Semantic Containment 14260"
Cohesion: 0.18
Nodes (12): buildPostValidatorInput(), buildRound2Response(), fixturePath, immutablePreRouteGuardWorkflowPath, loadFixture(), loadJson(), procurementSubjectFixturePath, repositoryRoot (+4 more)

### Community 26 - "Recheck Application Gate"
Cohesion: 0.15
Nodes (11): allowedReviewReasonCodes, applicationDocumentsFixturePath, buildRequiresReviewApiResponse(), buildResolvedApiResponse(), immutablePreRouteGuardWorkflowPath, mutableCanonicalWorkflowPath, procurementSubjectFixturePath, repositoryRoot (+3 more)

### Community 27 - "Noncontiguous Quote Regression"
Cohesion: 0.14
Nodes (8): currentPromptArtifactPath, fixture, fixturePath, immutableLiveWorkflowPath, routeGuardAddedNodeNames, routeGuardChangedNodeNames, testDirectory, workflowPath

### Community 28 - "Core Architecture Model"
Cohesion: 0.21
Nodes (13): Core Architecture Invariants, Tender Analysis Project Operating Rules, Project Source-of-Truth Hierarchy, End-to-End Tender Analysis Pipeline, Exactly 27 Field Items, Tender Analysis System Architecture, Tender Analysis Data Model, tender_analysis_documents (+5 more)

### Community 29 - "Live Test Overlay"
Cohesion: 0.19
Nodes (9): assertApprovedPackageBoundary(), betaWorkflowPath, canonicalWorkflow, canonicalWorkflowPath, comparableCodeNode(), inboundConnections(), renameConnectionTargets(), testDirectory (+1 more)

### Community 30 - "Fact Literal Guard"
Cohesion: 0.22
Nodes (11): assessFacts(), checkerSource(), executeCode(), executionFixturePath, findNode(), loadJson(), loadWorkflow(), repositoryRoot (+3 more)

### Community 31 - "Recheck Route 14429"
Cohesion: 0.19
Nodes (12): allFieldKeys, allowedRound2FieldKeys, buildNoInitialCandidatesNonDirectInput(), buildRouteInput(), evaluateIfOutput(), fixture, fixturePath, forbiddenRound2FieldKeys (+4 more)

### Community 32 - "Field Semantics Catalog"
Cohesion: 0.21
Nodes (12): Targeted Recheck, AG-11 National-Regime Applicability Containment, application_documents Field, Fields Requiring Business Confirmation, Canonical 27-Field Catalog, national_regime Field, not_found Is Unknown, Not Negative, Four-Field Round 2 Allowlist (+4 more)

### Community 33 - "Project State Plans"
Cohesion: 0.17
Nodes (12): Project State Consolidation Plan, Contract-Owned Integration Branch Strategy, DW-23 Validator Selective Retry Plan, Fact-Selective AI Validator Retry, DW-23 ActiveX Reconciliation Plan, Superseded Reconciliation Plan, Three-Way ActiveX Integration Redirect, DW-23 Selective Retry Runtime Canary (+4 more)

### Community 34 - "Validator Runtime Contract"
Cohesion: 0.17
Nodes (7): evaluatorPath, fixturePath, promptArtifactPath, repositoryRoot, runtimeCommandPath, testDirectory, workflowPath

### Community 35 - "E2E Controller SDK"
Cohesion: 0.17
Nodes (11): n0, n1, n10, n2, n3, n4, n5, n6 (+3 more)

### Community 36 - "Validator Semantic Oracle"
Cohesion: 0.22
Nodes (7): findNode(), oraclePath, repositoryRoot, systemPrompt(), testDirectory, validatorBody(), workflowPath

### Community 37 - "Finalization Report Pipeline"
Cohesion: 0.20
Nodes (10): DB-Backed 27/27 Finalization Barrier, PostgreSQL-Backed Synchronization, Field Results Referential Integrity Gap, tender_analysis_field_results, Tender Analysis MVP Goal, Self-Contained HTML Renderer, Report Adapter, Validated Report Model (+2 more)

### Community 38 - "Replay Report SDK"
Cohesion: 0.20
Nodes (9): n0, n1, n2, n3, n4, n5, n6, n7 (+1 more)

### Community 39 - "Evidence Integrity Design"
Cohesion: 0.25
Nodes (9): Layered AI Validation, DW-17 Reference-Only Evidence Repair Plan, Reference-Only Evidence Repair V2, Evidence Catalog Overflow Corrective Plan, Target-Ranked Evidence Windows, Bounded Evidence Retry Routing, Evidence Resource Contract 25/1500/5000, Lossless Fact Partition (+1 more)

### Community 40 - "Application Documents 14254"
Cohesion: 0.28
Nodes (8): aggregatorWorkflowPath, buildApiResponse(), buildExecution14254Fixture(), factId(), repositoryRoot, runChecker(), targetedRecheckWorkflowPath, testDirectory

### Community 41 - "National Regime Tests"
Cohesion: 0.28
Nodes (8): buildFieldItem(), buildResponse(), fixture, malformedProofCases, runCase(), testDirectory, workflowPaths, betaAggregatorWorkflowPath

### Community 42 - "Project History Status"
Cohesion: 0.29
Nodes (7): Tender Analysis Development History, Execution-Derived Regression Evidence, AGENTS File Index Implementation Plan, Durable Project File Index, Aggregator Live Synchronization, Current Tender Analysis Project State, Promotion and Fresh Runtime Gate

### Community 43 - "ActiveX Ownership Evolution"
Cohesion: 0.29
Nodes (7): Deterministic ActiveX Option-State Parsing, DW-18 and AG-11 DOCX Option-State Plan, Group-Local Option Ownership, ActiveX Local Semantic Ownership Plan, DW-21 Structural Option Ownership Plan, Structural DOCX Option Owner, DW-24 ActiveX GroupName NUL Containment

### Community 44 - "Project Index Synchronization"
Cohesion: 0.29
Nodes (7): Export as Factual Implementation Baseline, Regression Oracle Preservation, Current n8n Test v2 Synchronization Plan, AGENTS.md Project File Index Design, Authoritative Project Entry Point, Canonical Beta and Live Boundaries, Durable Milestone Routing

### Community 45 - "Extractor Recovery Canary"
Cohesion: 0.29
Nodes (7): Batch-First Runtime Gate Green, Document Worker DW-19 Batch-First Canary 14367, Exactly-One Unit Extractor Fallback, Isolated Canary Safety Boundary, Canary Barrier Expected-Identity Source Defect, Document Worker Recovery Canary 14362, Recovery Items Completed

### Community 46 - "Report Generation Evolution"
Cohesion: 0.33
Nodes (7): Report Generation V2 Architecture, Report Generation V2 Executor Prompt, Explicit Report Implementation Authorization Gate, Report Generation V2 Implementation Plan, Verified Live E2E Baseline, Historical Report Stub Gap, Technical Review 2026-08-23

### Community 47 - "Recovery Barrier Test"
Cohesion: 0.29
Nodes (5): barrier, fixture, repositoryRoot, testDirectory, workflow

### Community 48 - "Extractor Recovery Failures"
Cohesion: 0.33
Nodes (6): Blocked Before Parser and AI, Paired-Item Ancestry Defect, Document Worker Extractor Recovery Canary 14360, Code Node Input API Mode Mismatch, Corrected Pinned-Claim Canary 14361, Pinned Claim Substitution Ancestry

### Community 49 - "Aggregator Model Selection"
Cohesion: 0.50
Nodes (4): Aggregator Model Comparison, Gemini Aggregator Latency Fallback, GLM 5.3 Flash Aggregator Beta Baseline, Route-Aware Semantic Oracle

### Community 50 - "GLM 5.2 Evaluation"
Cohesion: 0.50
Nodes (4): GLM 5.2 Cost and Semantic Tradeoff, GLM 5.2 Extractor Evaluation, Reject GLM 5.2 as Extractor, GLM 5.2 Low Contract Success

### Community 51 - "Replay Report Builder"
Cohesion: 0.50
Nodes (4): assertReplayReportParity(), buildReplayReportWorkflow(), replayReportGuardCode(), validateReportSource()

### Community 52 - "Fallback Canary 14363"
Cohesion: 0.67
Nodes (3): Document Worker Exactly-One Fallback Canary 14363, Code Sandbox structuredClone Incompatibility, Temporary Harness Failure Not Production Failure

## Knowledge Gaps
- **317 isolated node(s):** `scriptDirectory`, `repositoryRoot`, `outputDirectory`, `replayReportOnly`, `baseUrl` (+312 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 438 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `End-to-End Tender Analysis Pipeline` connect `Core Architecture Model` to `Field Semantics Catalog`, `Finalization Report Pipeline`, `Evidence Integrity Design`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `Project Source-of-Truth Hierarchy` connect `Core Architecture Model` to `Project State Plans`, `Project History Status`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `scriptDirectory`, `repositoryRoot`, `outputDirectory` to the rest of the system?**
  _317 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `DOCX Option State Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05450733752620545 - nodes in this community are weakly interconnected._
- **Should `Evidence Repair Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.06219426974143955 - nodes in this community are weakly interconnected._
- **Should `Extractor Recovery Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05587808417997097 - nodes in this community are weakly interconnected._
- **Should `DW-23 Integration Design` be split into smaller, more focused modules?**
  _Cohesion score 0.057692307692307696 - nodes in this community are weakly interconnected._