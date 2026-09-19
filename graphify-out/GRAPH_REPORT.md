# Graph Report - tender-analysis  (2026-09-13)

## Corpus Check
- 76 files · ~1,118,574 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1155 nodes · 1539 edges · 101 communities (78 shown, 23 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.88)
- Token cost: 118,000 input · 19,000 output

## Community Hubs (Navigation)
- Application Documents Runtime
- DOCX Option State Tests
- Evidence Repair Tests
- Extractor Recovery Tests
- Report Generation Architecture
- DW 23 Integration Design
- Targeted Recheck Workflows
- Deck Closures Procurement
- Procurement Subject Evaluation
- E2E Body SDK
- Live E2E Verification
- Validator Selective Retry
- Tender Procedure Documents
- DOCX Option Ownership Tests
- E2E Workflow Builder
- Extractor Envelope Tests
- Agent Blind Test Evaluation
- E2E Export Tooling
- Recheck Evidence Coordinates
- Targeted Recheck Workflows
- Application Documents Containment
- E2E Runner Tests
- Procurement Subject 14104
- Extractor Model Evaluation
- Runtime Evaluation Tools
- Validator Runtime Tools
- Field Semantics Catalog
- Validator Field Profiles
- Recheck Existing Candidates
- Project State Plans
- Document Semantics Tests
- Fact Literal Guard
- Sanitized Fixture Manifests
- Semantic Containment 14260
- Recheck Application Gate
- Noncontiguous Quote Regression
- Live Test Overlay
- Recheck Route 14429
- Validator Runtime Contract
- E2E Controller SDK
- Semantic Finalization Architecture
- DW 23 Integration Design
- Validator Semantic Oracle
- Finalization Data Contract
- Replay Report SDK
- Production Report Export
- Application Documents 14254
- National Regime Tests
- Report PDF Tests
- Evidence Integrity Design
- Runtime Support Services
- Gotenberg PDF Pipeline
- Project Index Synchronization
- Extractor Recovery Canary
- Supplier Qualification Requirements
- Recovery Barrier Test
- Document Processing Pipeline
- Tender Analysis MVP
- Archive Ingestion Design
- Semantic Technical Debt
- Extractor Recovery Failures
- PDF Test Export
- Archive Document Ingestion
- Blind Analysis Protocol
- Tender Procurement Documentation
- Supplier Audit Procedure
- Verified Project State
- Project Operating Rules
- Aggregator Model Selection
- Agent Analysis Evaluation
- GLM 5.2 Evaluation
- PDF Acceptance Gates
- Targeted Recheck Workflows
- Gotenberg Deployment Tests
- Replay Report Builder
- Whole Corpus Analysis
- Fallback Canary 14363
- Application Document Fields
- Project History Status
- Blind Test Package
- Participation Cost Semantics
- Procurement Intake Queries
- Advance Guarantee Field
- Analog Allowed Field
- Analog Definition Field
- Application Deadline Field
- Review Date Field
- Bank Support Field
- Customer Field
- Customer Contacts Field
- Evaluation Criteria Field
- Government Contract Field
- Payment Terms Field
- Platform Field
- Procedure Type Field
- Rebidding Field
- Results Date Field
- Supply Experience Field
- Special Account Field
- Syncthing Probe Marker
- Procurement Scope Safety

## God Nodes (most connected - your core abstractions)
1. `executeWorkflowCodeNode()` - 34 edges
2. `loadAggregatorWorkflow()` - 26 edges
3. `runAggregatorRound1()` - 13 edges
4. `RuntimePreflightError` - 11 edges
5. `buildControllerWorkflow()` - 11 edges
6. `Targeted Recheck Workflow` - 11 edges
7. `RuntimePreflightError` - 10 edges
8. `prepareLiveBetaRuntimeRequest()` - 10 edges
9. `prepareLiveBetaRuntimeRequest()` - 10 edges
10. `runCodeNode()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Agent Output Offline Evaluator` --semantically_similar_to--> `Layered AI Validation`  [INFERRED] [semantically similar]
  evaluations/codex-agentic-blind-test-2026-09-08/HERMES_HANDOFF.md → ARCHITECTURE.md
- `Parallel Agent Reliability Query` --semantically_similar_to--> `Four Run Reproducibility Evaluation`  [INFERRED] [semantically similar]
  graphify-out/memory/query_20260907_214552_действительно_ли_три_параллельных_агентских_анализ.md → evaluations/codex-agentic-blind-test-2026-09-08/comparison.md
- `Exact Grounded Evidence Rules` --semantically_similar_to--> `Deterministic Evidence Validation`  [INFERRED] [semantically similar]
  prompts/document-worker-extractor-request-builder-v2.1-2026-09-07.txt → workflows/document-worker.md
- `Invalid-Confidence Selective Retry Green` --semantically_similar_to--> `Fact-Identity Selective Retry`  [INFERRED] [semantically similar]
  evaluations/DOCUMENT_WORKER_DW23_RUNTIME_14589_2026-09-06.md → docs/superpowers/specs/2026-09-05-dw23-validator-selective-retry-design.md
- `Exact Grounding Pass and Applicability Fail` --semantically_similar_to--> `Fail-Closed Semantic Review Cap`  [INFERRED] [semantically similar]
  evaluations/DOCUMENT_WORKER_SEMANTIC_AUDIT_14374_14376_2026-09-03.md → docs/superpowers/specs/2026-09-03-activex-local-semantic-ownership-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Blind Test Evidence Chain** — evaluations_codex_agentic_blind_test_2026_09_08_common_prompt_blind_analysis_protocol, evaluations_codex_agentic_blind_test_2026_09_08_inputs_field_catalog_tender_fields_v1, evaluations_codex_agentic_blind_test_2026_09_08_comparison_four_run_reproducibility, evaluations_codex_agentic_blind_test_2026_09_08_sha256sums_integrity_manifest [EXTRACTED 1.00]
- **Client Semantics Runtime Alignment** — field_catalog_tender_fields_v1, docs_superpowers_plans_2026_09_07_client_confirmed_field_semantics_cross_workflow_alignment, architecture_document_worker, architecture_aggregator, architecture_targeted_recheck, architecture_report_generation_v2 [EXTRACTED 1.00]
- **Document to FINAL Data Flow** — architecture_document_worker, architecture_analysis_units, architecture_candidate_facts, architecture_aggregator, architecture_targeted_recheck, architecture_tender_field_final_v1 [EXTRACTED 1.00]
- **Deterministic Report Artifact Pipeline** — workflows_report_generation_report_snapshot_v2, workflows_report_generation_report_adapter_v2, workflows_report_generation_client_safe_sources, workflows_report_generation_report_model_v2, workflows_report_generation_html_renderer, workflows_report_generation_gotenberg_pdf_conversion [EXTRACTED 1.00]
- **Document Worker Grounded Fact Pipeline** — workflows_document_worker_semantic_sections_and_chunking, workflows_document_worker_ai_extractor_stage, prompts_document_worker_extractor_request_builder_v2_1_2026_09_07_ai_extractor_v1_contract, workflows_document_worker_deterministic_evidence_validation, workflows_document_worker_independent_ai_validator, prompts_document_worker_validator_field_profiles_v1_1_2026_09_07_validator_field_profiles, workflows_document_worker_fact_persistence [EXTRACTED 1.00]
- **Nine-Block Procurement Documentation** — graphify_out_converted_0_62807816_procurement_documentation, graphify_out_converted_1_de4ba0ec_competitive_procurement_notice, graphify_out_converted_2_c109a445_procurement_information_card, graphify_out_converted_3_f155745c_general_procurement_conditions, graphify_out_converted_4_9f7d6f78_application_form_catalog, graphify_out_converted_5_936c2995_procedural_document_templates, graphify_out_converted_6_41d13feb_supply_contract, graphify_out_converted_7_7d3ed0cf_technical_specification, graphify_out_converted_8_02fb26dc_pbo_hse_audit_procedure, graphify_out_converted_9_961dbfab_supplier_qualification_catalog [EXTRACTED 1.00]
- **Persistent Analysis State** — data_model_tender_analysis_runs, data_model_tender_analysis_documents, data_model_tender_analysis_units, data_model_tender_analysis_facts, data_model_tender_analysis_field_results [EXTRACTED 1.00]
- **Report Generation V2 Layered Flow** — report_generation_v2_architecture_report_snapshot, report_generation_v2_architecture_report_adapter, report_generation_v2_architecture_report_model, workflows_report_generation_html_renderer [EXTRACTED 1.00]
- **Targeted Recheck Model Stack Comparison** — evaluations_targeted_recheck_deepseek_eval_2026_08_30_evaluation, evaluations_targeted_recheck_glm_gemini_glm_eval_2026_08_30_evaluation, evaluations_targeted_recheck_glm_gemini_gemini_eval_2026_08_30_evaluation [EXTRACTED 1.00]
- **Extractor Recovery Canary Progression** — evaluations_document_worker_extractor_recovery_canary_14360_2026_09_01_paired_item_ancestry_defect, evaluations_document_worker_extractor_recovery_canary_14361_2026_09_01_code_node_input_api_mismatch, evaluations_document_worker_extractor_recovery_canary_14362_2026_09_01_canary_barrier_identity_source_defect, evaluations_document_worker_batch_first_canary_14367_2026_09_02_batch_first_gate_green [INFERRED 0.85]
- **Report PDF Artifact Integrity** — evaluations_report_generation_pdf_execution_14649_html_to_pdf_runtime_path, evaluations_report_generation_pdf_execution_14649_pdf_signature_gate, evaluations_report_generation_pdf_filename_execution_17294_readable_pdf_filename_persistence [INFERRED 0.85]
- **DW-23 Three-Way Contract Integration** — docs_superpowers_specs_2026_09_03_activex_local_semantic_ownership_design_group_local_applicability, docs_superpowers_plans_2026_09_06_dw23_active_x_three_way_integration_json_tuple_identity_contract, docs_superpowers_plans_2026_09_05_dw_evidence_catalog_overflow_target_ranked_windows, docs_superpowers_specs_2026_09_05_dw23_validator_selective_retry_design_fact_identity_retry [INFERRED 0.95]
- **E2E PIN Canary and Confirmation Sequence** — evaluations_tender_e2e_pin_canary_14259_2026_08_31_canary, evaluations_tender_e2e_pin_canary_14279_2026_08_31_canary, evaluations_tender_e2e_pin_canary_14294_2026_08_31_canary, evaluations_tender_e2e_pin_confirmations_2026_08_31_confirmation_series [INFERRED 0.95]
- **Hybrid Agent Validation Architecture** — evaluations_codex_agentic_blind_test_2026_09_08_context_prior_discussion_codex_runner_service, evaluations_codex_agentic_blind_test_2026_09_08_context_prior_discussion_shadow_mode, evaluations_codex_agentic_blind_test_2026_09_08_comparison_deterministic_external_guards, evaluations_codex_agentic_blind_test_2026_09_08_inputs_field_catalog_tender_fields_v1 [INFERRED 0.95]
- **Reference-Only Evidence Repair Safety Architecture** — docs_superpowers_specs_2026_09_02_dw17_reference_only_evidence_repair_design_canonical_evidence_catalog, docs_superpowers_specs_2026_09_02_dw17_reference_only_evidence_repair_design_reference_only_selection_protocol, docs_superpowers_specs_2026_09_02_dw17_reference_only_evidence_repair_design_strict_catalog_rebuild_parity, docs_superpowers_plans_2026_09_05_dw_evidence_catalog_overflow_target_ranked_windows, docs_superpowers_specs_2026_09_05_dw_evidence_catalog_overflow_design_overflow_audit_parity [INFERRED 0.95]

## Communities (101 total, 23 thin omitted)

### Community 0 - "Application Documents Runtime"
Cohesion: 0.06
Nodes (43): assertExportContainsNoExecutionSpecificLiterals(), betaWorkflowPath, canonicalWorkflowPath, controlsFixturePath, executionFixturePath, fieldCatalogPath, loadControlsFixture(), loadExecutionFixture() (+35 more)

### Community 1 - "DOCX Option State Tests"
Cohesion: 0.05
Nodes (38): binaryDescriptor(), binaryPartItems(), buildCfbWithContents(), buildMorphDataContents(), buildOptionStateSemanticFixture(), cfbGateCases, decodeXmlEntities(), doclingTable() (+30 more)

### Community 2 - "Evidence Repair Tests"
Cohesion: 0.06
Nodes (39): aggregatorWorkflowPath, betaWorkflowPath, buildCatalogParityFixture(), buildConvergenceUnit(), buildDispatchReadyUnit(), buildExecution14061PostOverlapUnits(), buildExecution14487SanitizedDerivative(), buildExtractorResponse() (+31 more)

### Community 3 - "Extractor Recovery Tests"
Cohesion: 0.06
Nodes (44): fixture, testDirectory, assertExactHardStop(), AUDIT_KEYS, batchingFixture, batchingFixturePath, buildAttemptEnvelope(), buildAudit() (+36 more)

### Community 4 - "Report Generation Architecture"
Cohesion: 0.07
Nodes (30): Composite Run Document Unit Integrity, DM-0 Missing FINAL Foreign Key, Tender Analysis Physical Data Model, tender_analysis_documents, tender_analysis_facts, tender_analysis_field_results, tender_analysis_runs, tender_analysis_units (+22 more)

### Community 5 - "DW 23 Integration Design"
Cohesion: 0.07
Nodes (30): DW-23 ActiveX Three-Way Integration Plan, Versioned JSON Tuple Identity Contract, Live-Test Operational Overlay, Semantic Merge Strategy, DOCX ActiveX Local Semantic Ownership Design, Deterministic ActiveX Ownership Algorithm, Fail-Closed Semantic Review Cap, Group-Local Applicability (+22 more)

### Community 6 - "Targeted Recheck Workflows"
Cohesion: 0.09
Nodes (29): GPT-5.4 Nano Low Extractor Evaluation, GPT-5.6 Luna Pro Low Extractor Evaluation, AI Extractor v1 JSON Contract, Document Worker Extractor Request Builder v2.1, Exact Grounded Evidence Rules, No Global Not Found in Extractor, Tender Fields v1 Catalog, Canonical 27 Field Keys (+21 more)

### Community 7 - "Deck Closures Procurement"
Cohesion: 0.08
Nodes (27): Deck Closure Delivery Completeness, GOST 25309-94, Project 10510 Nuclear Icebreaker, Initial Technical Requirements 10510/20-068/1ITT, Supplier Technical Documentation Package, Three-Party Technical Documentation Acceptance, Initial Maximum Price Calculation, Selected NMC 3,181,278.10 RUB with VAT (+19 more)

### Community 8 - "Procurement Subject Evaluation"
Cohesion: 0.16
Nodes (23): evaluateProcurementSubjectOracle(), evaluateRecordedFixture(), loadAggregatorFixture(), runAggregatorRound1(), ALLOWED_RUNTIME_MODEL_ALIAS_SET, ALLOWED_RUNTIME_MODEL_ALIASES, checkerRejectionResult(), evaluateHttpRequestBody() (+15 more)

### Community 9 - "E2E Body SDK"
Cohesion: 0.08
Nodes (24): n0, n1, n10, n11, n12, n13, n14, n15 (+16 more)

### Community 10 - "Live E2E Verification"
Cohesion: 0.09
Nodes (20): baseUrl, behavior(), betaDirectory, byName(), controllerText, ids, liveBodyDownstreamConnections, liveBodyNodes (+12 more)

### Community 11 - "Validator Selective Retry"
Cohesion: 0.12
Nodes (18): assertExplicitSourceEnvelope(), buildExecutionBoundary(), buildFact(), buildUnits(), dispatchEnvelope(), explicitSourceEnvelope(), findNode(), fixture (+10 more)

### Community 12 - "Tender Procedure Documents"
Cohesion: 0.09
Nodes (23): Qualification Technical and Commercial Application Parts, Contract Security Requirements, Bid Evaluation and Award Procedure, Procurement Information Card, Application Preparation and Submission, Bid Clarification Procedure, Bid Evaluation and Winner Selection, General Competitive Procurement Conditions (+15 more)

### Community 13 - "DOCX Option Ownership Tests"
Cohesion: 0.12
Nodes (14): fixture, fixturePath, mappedOption(), node(), normalize(), parserInputItems(), root, runCode() (+6 more)

### Community 14 - "E2E Workflow Builder"
Cohesion: 0.16
Nodes (22): assertBodyParity(), barrierSql(), buildBodyWorkflow(), buildControllerWorkflow(), clone(), collapseCode(), contractGuardCode(), exactRunnerRequest() (+14 more)

### Community 15 - "Extractor Envelope Tests"
Cohesion: 0.11
Nodes (12): buildAttemptEnvelope(), findNode(), fixture, fixturePath, recoveryFixture, recoveryFixturePath, repositoryRoot, runEvidenceValidator() (+4 more)

### Community 16 - "Agent Blind Test Evaluation"
Cohesion: 0.11
Nodes (19): Deterministic External Guards, Four Run Reproducibility Evaluation, Shared Licenses and Certificates Drift, Unresolved Conflict Guard, Isolated Codex Runner Service, Codex Shadow Mode Evaluation, Application Documents Completeness Contract, Literal License Certificate Boundary (+11 more)

### Community 17 - "E2E Export Tooling"
Cohesion: 0.11
Nodes (16): baseUrl, body, controller, files, outputDirectory, replayReport, replayReportOnly, repositoryRoot (+8 more)

### Community 18 - "Recheck Evidence Coordinates"
Cohesion: 0.14
Nodes (14): loadAggregatorWorkflow(), assertEvidenceFallback(), buildAiResponse(), buildSource(), testDirectory, validateEvidence(), workflowPath, check() (+6 more)

### Community 19 - "Targeted Recheck Workflows"
Cohesion: 0.25
Nodes (17): DeepSeek Targeted Recheck Evaluation, Targeted Recheck 14389–14391 Forensic Report, GLM Gemini Gemini Targeted Recheck Evaluation, GLM Gemini GLM Targeted Recheck Evaluation, Tender E2E PIN Canary 14259, Tender E2E PIN Canary 14279, Tender E2E PIN Canary 14294, Tender E2E PIN Three-Run Confirmation Series (+9 more)

### Community 20 - "Application Documents Containment"
Cohesion: 0.16
Nodes (14): buildApiResponse(), buildExecution14252Shape(), fixtureFactId(), runChecker(), testDirectory, workflowPath, classify(), fixture (+6 more)

### Community 21 - "E2E Runner Tests"
Cohesion: 0.12
Nodes (13): reportSourcePath, repositoryRoot, sourcePath, testDirectory, ANALYSIS_RUN_ID, CLAIM_PIN_ITEM, CONTROLLER_WORKFLOW_NAME, evaluateReportDispatch() (+5 more)

### Community 22 - "Procurement Subject 14104"
Cohesion: 0.14
Nodes (14): assertUniversalProcurementSubjectBoundary(), betaAggregatorWorkflowPath, expectedExecution14104Response(), fieldCatalogPath, fixturePath, getProcurementSubjectRules(), repositoryRoot, runtimeEvalPath (+6 more)

### Community 23 - "Extractor Model Evaluation"
Cohesion: 0.14
Nodes (16): DeepSeek Contract Compliance Failure, DeepSeek V4 Flash 0731 Extractor Evaluation, Reject DeepSeek as Extractor, DeepSeek Evaluation-Criteria Semantic Overreach, Deterministic Grounding Cannot Validate Field Semantics, Extractor Model Comparison, GLM 5.3 Flash Low Extractor Baseline, Stop Extractor Model Search on Current Fixture (+8 more)

### Community 24 - "Runtime Evaluation Tools"
Cohesion: 0.14
Nodes (13): applicationDocumentsTestPath, fixturePath, repositoryRoot, runtimeEvalPath, testDirectory, aggregatorAntiOverfitFixturePath, aggregatorFixturePath, aggregatorWorkflowPath (+5 more)

### Community 25 - "Validator Runtime Tools"
Cohesion: 0.16
Nodes (11): buildValidatorRequest(), evaluateValidatorOutput(), parseValidatorOutput(), recordedContent(), args, fixturePath, modes, promptPath (+3 more)

### Community 26 - "Field Semantics Catalog"
Cohesion: 0.16
Nodes (15): Dmitry Field Semantics Checkpoint, DW-18 DOCX Option-State Loss, Client Semantics Safety Invariants, delivery_term, Four-Key Round 2 Allow-List, national_regime, nm_price_with_vat, not_found Semantic Rule (+7 more)

### Community 27 - "Validator Field Profiles"
Cohesion: 0.17
Nodes (11): buildFact(), buildUnit(), CANONICAL_FIELD_KEYS, executeCode(), findNode(), previousStaticPromptPath, repositoryRoot, runNode() (+3 more)

### Community 28 - "Recheck Existing Candidates"
Cohesion: 0.27
Nodes (14): assertTechnicalFallback(), buildApplicationDocumentsItem(), buildExecution14256Fixture(), candidate(), checkItem(), existingOnlyEvidenceIndexes, extractorResponse(), mutateApplicationItem() (+6 more)

### Community 29 - "Project State Plans"
Cohesion: 0.14
Nodes (14): AG-11 National-Regime Applicability Containment, Deterministic ActiveX Option-State Parsing, DW-18 and AG-11 DOCX Option-State Plan, Group-Local Option Ownership, ActiveX Local Semantic Ownership Plan, DW-21 Structural Option Ownership Plan, Structural DOCX Option Owner, Project State Consolidation Plan (+6 more)

### Community 30 - "Document Semantics Tests"
Cohesion: 0.16
Nodes (10): assertBoth(), extractorField(), extractorSource, repositoryRoot, testDirectory, validatorCheckerSource, validatorField(), validatorSource (+2 more)

### Community 31 - "Fact Literal Guard"
Cohesion: 0.20
Nodes (11): assessFacts(), checkerSource(), executeCode(), executionFixturePath, findNode(), loadJson(), loadWorkflow(), repositoryRoot (+3 more)

### Community 32 - "Sanitized Fixture Manifests"
Cohesion: 0.14
Nodes (13): content_review, credentials_or_secrets_found, full_client_docx_included, notes, personal_data_found, unrelated_procurement_content_included, contract_version, derived_parts (+5 more)

### Community 33 - "Semantic Containment 14260"
Cohesion: 0.18
Nodes (12): buildPostValidatorInput(), buildRound2Response(), fixturePath, immutablePreRouteGuardWorkflowPath, loadFixture(), loadJson(), procurementSubjectFixturePath, repositoryRoot (+4 more)

### Community 34 - "Recheck Application Gate"
Cohesion: 0.15
Nodes (11): allowedReviewReasonCodes, applicationDocumentsFixturePath, buildRequiresReviewApiResponse(), buildResolvedApiResponse(), immutablePreRouteGuardWorkflowPath, mutableCanonicalWorkflowPath, procurementSubjectFixturePath, repositoryRoot (+3 more)

### Community 35 - "Noncontiguous Quote Regression"
Cohesion: 0.14
Nodes (8): currentPromptArtifactPath, fixture, fixturePath, immutableLiveWorkflowPath, routeGuardAddedNodeNames, routeGuardChangedNodeNames, testDirectory, workflowPath

### Community 36 - "Live Test Overlay"
Cohesion: 0.19
Nodes (9): assertApprovedPackageBoundary(), betaWorkflowPath, canonicalWorkflow, canonicalWorkflowPath, comparableCodeNode(), inboundConnections(), renameConnectionTargets(), testDirectory (+1 more)

### Community 37 - "Recheck Route 14429"
Cohesion: 0.19
Nodes (12): allFieldKeys, allowedRound2FieldKeys, buildNoInitialCandidatesNonDirectInput(), buildRouteInput(), evaluateIfOutput(), fixture, fixturePath, forbiddenRound2FieldKeys (+4 more)

### Community 38 - "Validator Runtime Contract"
Cohesion: 0.17
Nodes (7): evaluatorPath, fixturePath, promptArtifactPath, repositoryRoot, runtimeCommandPath, testDirectory, workflowPath

### Community 39 - "E2E Controller SDK"
Cohesion: 0.17
Nodes (11): n0, n1, n10, n2, n3, n4, n5, n6 (+3 more)

### Community 40 - "Semantic Finalization Architecture"
Cohesion: 0.20
Nodes (11): Tender Aggregator, Candidate Facts, Report Generation V2, Targeted Recheck, TenderMeta Resolver, Round 2 Is Terminal, Four-Workflow Semantic Alignment, Three-Node PDF Workflow Extension (+3 more)

### Community 41 - "DW 23 Integration Design"
Cohesion: 0.24
Nodes (11): Evidence Catalog Overflow Corrective Plan, Target-Ranked Evidence Windows, Canonical Evidence Catalog, Lossless Evidence Merge, DW-17 Reference-Only Evidence Repair Design, Reference-Only Evidence Selection Protocol, Strict Catalog Rebuild Parity, Document Worker Evidence Catalog Overflow Design (+3 more)

### Community 42 - "Validator Semantic Oracle"
Cohesion: 0.22
Nodes (7): findNode(), oraclePath, repositoryRoot, systemPrompt(), testDirectory, validatorBody(), workflowPath

### Community 43 - "Finalization Data Contract"
Cohesion: 0.20
Nodes (10): Evidence Audit Trail, DB-Backed 27 of 27 Barrier, PostgreSQL Synchronization Layer, Semantic Blocks, tender_field_final_v1, Conditional Branch Merge Discovery, Tender Analysis Engineering History, Unified FINAL Contract Decision (+2 more)

### Community 44 - "Replay Report SDK"
Cohesion: 0.20
Nodes (9): n0, n1, n2, n3, n4, n5, n6, n7 (+1 more)

### Community 45 - "Production Report Export"
Cohesion: 0.22
Nodes (7): baseUrl, expectedPdfChain, exportKeys, exportWorkflow, nodeNames, outputPath, scriptDirectory

### Community 46 - "Application Documents 14254"
Cohesion: 0.28
Nodes (8): aggregatorWorkflowPath, buildApiResponse(), buildExecution14254Fixture(), factId(), repositoryRoot, runChecker(), targetedRecheckWorkflowPath, testDirectory

### Community 47 - "National Regime Tests"
Cohesion: 0.28
Nodes (8): buildFieldItem(), buildResponse(), fixture, malformedProofCases, runCase(), testDirectory, workflowPaths, betaAggregatorWorkflowPath

### Community 48 - "Report PDF Tests"
Cohesion: 0.22
Nodes (4): candidatePath, canonicalPath, repositoryRoot, testsDirectory

### Community 49 - "Evidence Integrity Design"
Cohesion: 0.29
Nodes (8): Analysis Units, Layered AI Validation, DW-17 Reference-Only Evidence Repair Plan, Reference-Only Evidence Repair V2, Bounded Evidence Retry Routing, Evidence Resource Contract 25/1500/5000, Lossless Fact Partition, Lossless Fact Partition Implementation Plan

### Community 50 - "Runtime Support Services"
Cohesion: 0.29
Nodes (7): tender-pdf-gotenberg Container, Gotenberg Resource and Network Limits, Internal Gotenberg Service Runbook, Gotenberg Operational Isolation, Archive Extractor Internal API, tender-archive-extractor, Safe Recursive Archive Extraction

### Community 51 - "Gotenberg PDF Pipeline"
Cohesion: 0.29
Nodes (7): Gotenberg PDF Path Promotion, Gotenberg HTML-to-PDF Implementation Plan, Isolated PDF Runtime Canary, PDF Derived from Exact HTML, Gotenberg HTML-to-PDF Design, Internal Chromium Conversion Service, RG-1 PDF Production Runtime Gate

### Community 52 - "Project Index Synchronization"
Cohesion: 0.29
Nodes (7): Export as Factual Implementation Baseline, Regression Oracle Preservation, Current n8n Test v2 Synchronization Plan, AGENTS.md Project File Index Design, Authoritative Project Entry Point, Canonical Beta and Live Boundaries, Durable Milestone Routing

### Community 53 - "Extractor Recovery Canary"
Cohesion: 0.29
Nodes (7): Batch-First Runtime Gate Green, Document Worker DW-19 Batch-First Canary 14367, Exactly-One Unit Extractor Fallback, Isolated Canary Safety Boundary, Canary Barrier Expected-Identity Source Defect, Document Worker Recovery Canary 14362, Recovery Items Completed

### Community 54 - "Supplier Qualification Requirements"
Cohesion: 0.29
Nodes (7): Participant Qualification Requirements, Bankruptcy Tax and Enforcement Debt Checks, Supplier Due Diligence, Financial Stability Assessment, Official Qualification Supporting Documents, Ownership and Beneficiary Disclosure, Supplier Qualification Requirements Catalog

### Community 55 - "Recovery Barrier Test"
Cohesion: 0.29
Nodes (5): barrier, fixture, repositoryRoot, testDirectory, workflow

### Community 56 - "Document Processing Pipeline"
Cohesion: 0.33
Nodes (6): Analysis Run, Atomic Document Claim, Docling Universal Normalization, Document Worker, Tender Orchestrator, Live Orchestrator Reconciliation

### Community 57 - "Tender Analysis MVP"
Cohesion: 0.33
Nodes (6): MVP Analysis Pipeline, Tender Analysis System, Company Matching Out of Scope, MVP Output Contract, AI Tender Analysis MVP, Seven Workflow Architecture

### Community 58 - "Archive Ingestion Design"
Cohesion: 0.33
Nodes (6): Archive Ingestion Implementation Plan, Archive Ingestion Node-Level Plan, Archive Production Acceptance Sequence, Archive Ingestion Rollback Boundary, Archive Ingestion Design, OR-0 Unsupported Document Deadlock

### Community 59 - "Semantic Technical Debt"
Cohesion: 0.33
Nodes (6): Client Semantics Implementation Plan, Client Confirmed Field Semantics Design, DW-3 Docling Terminal Failure, DW-8 Stale Analysis Units, Prioritized Technical Debt, SEM-1 Runtime Semantic Drift

### Community 60 - "Extractor Recovery Failures"
Cohesion: 0.33
Nodes (6): Blocked Before Parser and AI, Paired-Item Ancestry Defect, Document Worker Extractor Recovery Canary 14360, Code Node Input API Mode Mismatch, Corrected Pinned-Claim Canary 14361, Pinned Claim Substitution Ancestry

### Community 61 - "PDF Test Export"
Cohesion: 0.33
Nodes (5): baseUrl, exportKeys, exportWorkflow, outputPath, scriptDirectory

### Community 62 - "Archive Document Ingestion"
Cohesion: 0.40
Nodes (5): Absence Is Not a Negative Fact, Atomic Manifest Registration, TENDER — Подготовить документацию, Fail-Closed Archive Preparation, tender_document_ingestion_v1

### Community 63 - "Blind Analysis Protocol"
Cohesion: 0.40
Nodes (5): Blind Tender Analysis Protocol, Safe not_found Semantics, tender_fields_v1 Semantic Catalog, Graphify Instructions Absence Query, Agent Instruction Provenance Query

### Community 64 - "Tender Procurement Documentation"
Cohesion: 0.40
Nodes (5): Federal Law 223-FZ, Nine-Block Tender Structure, Tender Procurement Documentation, Request for Offers 167/26-ZO, SSK Zvezda

### Community 65 - "Supplier Audit Procedure"
Cohesion: 0.40
Nodes (5): Participant Admission Decision, Audit Conclusion Act, Mandatory Desktop Review, HSE Qualification Audit Procedure, Optional On-Site Technical Audit

### Community 66 - "Verified Project State"
Cohesion: 0.40
Nodes (5): Current Verified Project State, DW-18 and AG-11 Checkpoint, Promotion-Grade Worker Canary, Open Runtime Gates, Verified Runtime Boundary

### Community 67 - "Project Operating Rules"
Cohesion: 0.50
Nodes (4): Minimal Change Discipline, Tender Analysis Operating Rules, Read-Only Production Boundary, Source of Truth Priority

### Community 68 - "Aggregator Model Selection"
Cohesion: 0.50
Nodes (4): Aggregator Model Comparison, Gemini Aggregator Latency Fallback, GLM 5.3 Flash Aggregator Beta Baseline, Route-Aware Semantic Oracle

### Community 69 - "Agent Analysis Evaluation"
Cohesion: 0.50
Nodes (4): Agent Output Offline Evaluator, Hermes Agent Handoff, Hybrid Agent Analysis Direction, Majority Vote Shared-Error Limit

### Community 70 - "GLM 5.2 Evaluation"
Cohesion: 0.50
Nodes (4): GLM 5.2 Cost and Semantic Tradeoff, GLM 5.2 Extractor Evaluation, Reject GLM 5.2 as Extractor, GLM 5.2 Low Contract Success

### Community 71 - "PDF Acceptance Gates"
Cohesion: 0.50
Nodes (4): Verified HTML to PDF Runtime Path, Owner PDF Visual Acceptance, PDF Signature Validation Gate, Readable PDF Filename Persistence

### Community 72 - "Targeted Recheck Workflows"
Cohesion: 0.50
Nodes (4): AI Validator Prompt v1.1, Universal Semantic Validation Axes, AI Validator Prompt v1.2, AI Validator Prompt v1

### Community 73 - "Gotenberg Deployment Tests"
Cohesion: 0.50
Nodes (3): composePath, repositoryRoot, testsDirectory

### Community 74 - "Replay Report Builder"
Cohesion: 0.50
Nodes (4): assertReplayReportParity(), buildReplayReportWorkflow(), replayReportGuardCode(), validateReportSource()

### Community 75 - "Whole Corpus Analysis"
Cohesion: 0.67
Nodes (3): Whole Corpus Agent Reviewer Advantage, Early Context Loss Failure, Two Part Advance Contract Guarantee

### Community 76 - "Fallback Canary 14363"
Cohesion: 0.67
Nodes (3): Document Worker Exactly-One Fallback Canary 14363, Code Sandbox structuredClone Incompatibility, Temporary Harness Failure Not Production Failure

### Community 77 - "Application Document Fields"
Cohesion: 0.67
Nodes (3): application_documents, licenses_certificates, required_official_certificates

## Knowledge Gaps
- **454 isolated node(s):** `cfbGateCases`, `fixtureRoot`, `invalidGroupNameFixture`, `manifest`, `nodeNames` (+449 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 596 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Layered AI Validation` connect `Evidence Integrity Design` to `Semantic Finalization Architecture`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **Why does `Target-Ranked Evidence Windows` connect `DW 23 Integration Design` to `Evidence Integrity Design`?**
  _High betweenness centrality (0.000) - this node is a cross-community bridge._
- **What connects `cfbGateCases`, `fixtureRoot`, `invalidGroupNameFixture` to the rest of the system?**
  _454 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Application Documents Runtime` be split into smaller, more focused modules?**
  _Cohesion score 0.06168831168831169 - nodes in this community are weakly interconnected._
- **Should `DOCX Option State Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05450733752620545 - nodes in this community are weakly interconnected._
- **Should `Evidence Repair Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.06219426974143955 - nodes in this community are weakly interconnected._
- **Should `Extractor Recovery Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05587808417997097 - nodes in this community are weakly interconnected._