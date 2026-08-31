/* Core constants, shared state, source contracts, and Team Totals foundations.
 * Behavior-preserving extraction from the definitive All-Star application.
 */
'use strict';

const MODEL_KEY = 'allStarStandaloneModels.v1';
const RESEARCH_KEY = 'allStarResearchItems.v1';
const RESEARCH_RENDER_DB = 'allStarResearchRenderedResults.v1';
const RESEARCH_RENDER_META_STORE = 'renderMeta';
const RESEARCH_RENDER_CHUNK_STORE = 'renderChunks';
const RESEARCH_RENDER_CHUNK_SIZE = 1000;
const COACHTOOLS_STORAGE_CONTRACT = window.CoachToolsData?.storageContract || null;
const IMPORT_CACHE_DB = COACHTOOLS_STORAGE_CONTRACT?.dbName || 'allStarImportedDataCache.v1';
const IMPORT_CACHE_META_STORE = 'meta';
const IMPORT_CACHE_SOURCE_STORE = 'sourceData';
const IMPORT_CACHE_BOOK_STORE = 'books';
const IMPORT_CACHE_MISC_STORE = 'misc';
const IMPORT_CACHE_SCHEMA_VERSION = Number(COACHTOOLS_STORAGE_CONTRACT?.dbVersion) || 8;
const CONTROL_ROSTER_SCHEMA_VERSION = 2;
const METRICS_KEY = 'allStarResearchMetrics.v1';
const METRICS_DB = 'allStarResearchMetricsDb.v1';
const METRICS_STORE = 'researchMetrics';
const METRICS_RECORD_ID = 'current';
const RESEARCH_CACHE_KEY = 'allStarResearchResultCache.v3';
const DYNAMIC_RESEARCH_SOURCE = 'dynamic';
const NONDATED_SOURCE = 'nondate';
const DATED_SOURCE = 'date';
const QA_DIRECT_SOURCE = 'qa_direct';
const CATEGORIZED_SOURCE_KEYS = [NONDATED_SOURCE, DATED_SOURCE];
const RESEARCH_CACHE_LIMIT = 50;
const RESEARCH_TABLE_VISIBLE_LIMIT = 500;
const VIRTUAL_TABLE_THRESHOLD = 500;
const VIRTUAL_TABLE_BUFFER_ROWS = 20;
const VIRTUAL_TABLE_ESTIMATED_ROW_HEIGHT = 34;
const RESEARCH_CHART_POINT_LIMIT = 5000;
const RESEARCH_SVG_MARK_LIMIT = 300;
const RESEARCH_CANVAS_MARK_LIMIT = 5000;
const RESEARCH_SOURCE_INDEX_SCHEMA_VERSION = 4;
const RESEARCH_PERSIST_MAX_GROUPS = 3000;
const ORG_BUILDER_KEY = 'allStarOrgBuilder.v1';
const REP_ALIAS_KEY = 'allStarRepAliases.v1';
const RUN_SETTINGS_KEY = 'allStarRunSettings.v2';
const state = {
  models: [],
  editModel: null,
  editOriginalId: null,
  data: {
    retail: { fileName:'', rosterFileName:'', rosterUpdatedAt:'', sv2:[], wiper:[], sv2Aoa:[], wiperAoa:[], controlRoster:[], teamTotals:emptyTeamTotalsDataset('retail'), headers:{sv2:[],wiper:[]} },
    referral: { fileName:'', rosterFileName:'', rosterUpdatedAt:'', sv2:[], wiper:[], itac:[], sv2Aoa:[], wiperAoa:[], itacAoa:[], controlRoster:[], teamTotals:emptyTeamTotalsDataset('referral'), headers:{sv2:[],wiper:[],itac:[]}, itacSheetName:'' },
    qa: { fileName:'', rows:[], headers:[], aoa:[] },
    qa_direct: { fileName:'', rows:[], headers:[], aoa:[], sheetName:'' },
    checklist: { fileName:'', rows:[], headers:[], aoa:[] },
    documented_coaching: { fileName:'', rows:[], headers:[], aoa:[] },
    comp_calls: { fileName:'', rows:[], headers:[], aoa:[] }
  },
  categorized: {
    nondated: { headers:['Representative','Coach'], rows:[], builtAt:'', sourceStats:[] },
    dated: { headers:['Representative','Coach','Date'], rows:[], builtAt:'', sourceStats:[] },
    warnings: [],
    stale: false,
    staleReason: '',
    changedSources: [],
    sourceSignatures: {},
    fragments: {}
  },
  categorizationPending: false,
  categorizationPendingReason: '',
  customSources: [],
  books: {
    nondate:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    date:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    retail:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    referral:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    qa:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    checklist:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    documented_coaching:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    comp_calls:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}},
    packaged:{fileName:'',sheetNames:[],aoaBySheet:{},selectedSheets:{}}
  },
  troubleshoot:{source:'qa',sheetName:'',headerRow:1,startCol:1,selectedCell:null,manualHeaders:[]},
  repTeams: new Map(),
  teams: [],
  selectedTeams: new Set(),
  orgs: [],
  activeOrgId: '',
  orgCoachSearch: '',
  orgSearch: '',
  runIncludeOrgs: new Set(),
  runExcludeOrgs: new Set(),
	  runMode: 'single',
	  multiRunOrgIds: new Set(),
	  multiRunOrgSearch: '',
	  multiRunActive: false,
	  runSettingsLoaded: false,
	  qualtricsReady: false,
	  qualtricsLoaded: false,
	  qualtricsCoreConnectedSignature: '',
	  qualtricsCorePendingSignature: '',
	  runOrgSearch: '',
	  teamSearch: '',
  teamSelectionInitialized: false,
  activeTeam: '',
  repAliases: new Map(),
  quarantinedRepAliases: [],
  // One authoritative version registry. Every cache signature and selective invalidation reads these dimensions.
  versions: {data:0,retail:0,referral:0,roster:0,aliases:0,teams:0,mappings:0,models:0,metrics:0,researchDefinitions:0,research:0},
  // Versioned Control-roster index: rebuilt only when roster/alias/team/mapping versions change.
  rosterIndex: { version:0, signature:'', rows:[], byRosterId:new Map(), bySourceRepKey:new Map(), byRepKey:new Map(), byTeamKey:new Map(), repsByTeamKey:new Map(), teamSummaries:new Map(), conflicts:[] },
  repSuggestionCache: new Map(),
  dataUpdateBatch: null,
  identityConflicts: [],
  rosterDiagnostics: {},
  teamDetailsCache: new Map(),
  teamSummaryRevision: '',
  massHeaderRefs: [],
  teamIndexCache: null,
  dataIndex: { dirty:true, reason:'initial', version:0, sources:{}, reps:[], teamCounts:[], repsByTeam:new Map(), dateRanges:{qa:{interaction:null,assigned:null},date:new Map(),checklist:new Map(),documented_coaching:new Map(),comp_calls:new Map()}, lastBuiltAt:0 },
  // Lightweight Run-only caches are intentionally separate from the richer Research/global index.
  runIndexes: new Map(),
  runPreparationJobs: new Map(),
  runIndexDiagnostics: [],
  indexes: null,
  researchItems: [],
  metrics: [],
  editingMetricRules: [],
  editingMetricGear: {},
  metricCache: new Map(),
  researchMetricCache: new Map(),
  researchResultCache: new Map(),
  researchPersistentCache: {},
  researchCohortCache: new Map(),
  researchFilterResultCache: new Map(),
  researchCohortRowSignatures: new WeakMap(),
  researchCohortSequence: 0,
  researchSourceIndexes: new Map(),
  researchSourceIndexJobs: new Map(),
  researchBuildingRowMeta: new WeakMap(),
  researchEntityTable: {signature:'',byRepKey:new Map(),byEntityId:new Map(),teamsById:new Map(),teamIdByKey:new Map(),nextRepId:1,nextTeamId:1},
  researchPerformanceRuns: [],
  researchCanvasCharts: new Map(),
  editingResearchPopulationScope: {includeTeams:[],includeReps:[],excludeTeams:[],excludeReps:[]},
  researchWarmToken: null,
  researchCacheStats: {hits:0,writes:0,warmed:0},
  researchTraceStore: new Map(),
  researchVirtualTables: new Map(),
  researchFeedbackState: {},
  editingResearchFilters: [],
  editingGuidedResearchConditions: [],
  editingGuidedResearchActive: true,
  editingResearchColumns: [],
  researchPreviewCancel: null,
  researchRenderToken: null,
  renderedLargeResearchCards: new Set(),
  researchRenderAllToken: null,
  researchConversationViewers: new Map(),
  researchDuplicateRepCache: new Map(),

  perfCounters: {baseIndexBuilds:0,lazyIndexBuilds:0,filterCompiles:0,filterCacheHits:0,criterionInputCacheHits:0,researchResultCacheHits:0,selectiveInvalidations:0,teamTotalsIndexBuilds:0,teamTotalsIndexBuildsBySource:{},trueTeamValueLookups:0,runIndexCacheHits:0,runIndexCacheMisses:0,sourceRowCacheHits:0,sourceRowCacheMisses:0,entryRowCacheHits:0,entryRowCacheMisses:0},
  compiledFilterCache: new Map(),
  criterionInputCache: new Map(),
  expressionCache: new Map(),
  expressionStats: null,
  importCache: { meta:null, status:'idle', lastError:'', generationId:'', revision:0 },
  importCacheStartupPromise: null,
  importCacheSaving: false,
  importCacheLoading: false,
  importCachePostLoadSave: false,
  sourceMeta: {},
  importCacheDirty: null,
  importCacheSaveTimer: null,
  importCacheSaveQueued: false,
  importCacheSaveReasons: [],
  lifecycle: {closing:false,hidden:false,generation:0},
  startup: {job:null,generation:0,running:false,completed:false,diagnostics:null,promise:null,phase:null,watchdogTimer:0,requestCount:0,pipelineCount:0},
  centralSyncGeneration: 0,
  progressJob: null,
  lifecycleSaveQueued: false,
  runPrep: {generation:0,jobs:new Map(),ready:new Map(),dateRangeCache:new Map(),lastRequired:[],lastModelId:''},
  pdfOptions: null,
  pendingRosterReassignment: null
};
const el = id => document.getElementById(id);
const els = {
  topStatus: el('topStatus'), workArea: el('workArea'), researchBtn: el('researchBtn'), loadingOverlay: el('loadingOverlay'), loadingTitle: el('loadingTitle'), loadingText: el('loadingText'), loadingBarFill: el('loadingBarFill'), loadingPct: el('loadingPct'), loadingDiagnostics:el('loadingDiagnostics'), loadingActions:el('loadingActions'), loadingRetryBtn:el('loadingRetryBtn'), loadingTroubleshootBtn:el('loadingTroubleshootBtn'), loadingContinueBtn:el('loadingContinueBtn'), categoriesDrop: el('categoriesDrop'), importDrop: el('importDrop'), runBtn: el('runBtn'), pdfDrop: el('pdfDrop'), qualtricsEmailBtn: el('qualtricsEmailBtn'), clearOutputBtn: el('clearOutputBtn'),
  pdfOptionsModal: el('pdfOptionsModal'), pdfTitleInput: el('pdfTitleInput'), pdfSubtitleInput: el('pdfSubtitleInput'), pdfColorScheme: el('pdfColorScheme'), pdfCustomColors: el('pdfCustomColors'), pdfCustomPrimary: el('pdfCustomPrimary'), pdfCustomSecondary: el('pdfCustomSecondary'), pdfCustomHeaderText: el('pdfCustomHeaderText'), pdfCustomLightFill: el('pdfCustomLightFill'), pdfOrientation: el('pdfOrientation'), pdfPageSize: el('pdfPageSize'), pdfWinCoach: el('pdfWinCoach'), pdfWinRepTeam: el('pdfWinRepTeam'), pdfWinRepOverall: el('pdfWinRepOverall'), pdfTop50: el('pdfTop50'), pdfEachTeam: el('pdfEachTeam'), pdfCoaches: el('pdfCoaches'), pdfAllReps: el('pdfAllReps'), pdfOptionsSummary: el('pdfOptionsSummary'), pdfWinnerSummaryBtn: el('pdfWinnerSummaryBtn'), pdfFullReportBtn: el('pdfFullReportBtn'), pdfClearBreakdownsBtn: el('pdfClearBreakdownsBtn'), pdfRestoreDefaultsBtn: el('pdfRestoreDefaultsBtn'), pdfSaveOptionsBtn: el('pdfSaveOptionsBtn'), pdfSaveExportBtn: el('pdfSaveExportBtn'), importModal: el('importModal'), troubleshootModal: el('troubleshootModal'), teamsModal: el('teamsModal'), modelsModal: el('modelsModal'), massHeaderModal: el('massHeaderModal'), editModelModal: el('editModelModal'), runModal: el('runModal'), researchModal: el('researchModal'), researchEditorModal: el('researchEditorModal'),
  retailFile: el('retailFile'), referralFile: el('referralFile'), qaFile: el('qaFile'), qaDirectFile: el('qaDirectFile'), clearQADirectFileBtn: el('clearQADirectFileBtn'), checklistFile: el('checklistFile'), documentedCoachingFile: el('documentedCoachingFile'), compCallsFile: el('compCallsFile'), packagedFile: el('packagedFile'), coachtoolsFiles: el('coachtoolsFiles'), coachtoolsImportAllBtn: el('coachtoolsImportAllBtn'), coachtoolsImportReview: el('coachtoolsImportReview'), coachtoolsImportSummary: el('coachtoolsImportSummary'), retailFileName: el('retailFileName'), referralFileName: el('referralFileName'), qaFileName: el('qaFileName'), qaDirectFileName: el('qaDirectFileName'), checklistFileName: el('checklistFileName'), documentedCoachingFileName: el('documentedCoachingFileName'), compCallsFileName: el('compCallsFileName'), packagedFileName: el('packagedFileName'), openTroubleshootBtn: el('openTroubleshootBtn'), fixTeamsBtn: el('fixTeamsBtn'), fixTeamsPanel: el('fixTeamsPanel'), fixTeamsSummary: el('fixTeamsSummary'), fixTeamsReview: el('fixTeamsReview'), fixRepSummary: el('fixRepSummary'), fixRepReview: el('fixRepReview'), applyFixTeamsBtn: el('applyFixTeamsBtn'), applyFixRepMatchesBtn: el('applyFixRepMatchesBtn'), cancelFixTeamsBtn: el('cancelFixTeamsBtn'), categorizeDataBtn: el('categorizeDataBtn'), viewSpreadsheetDataBtn: el('viewSpreadsheetDataBtn'), packageDataBtn: el('packageDataBtn'), saveImportCacheBtn: el('saveImportCacheBtn'), loadImportCacheBtn: el('loadImportCacheBtn'), persistImportCacheBtn: el('persistImportCacheBtn'), clearImportCacheBtn: el('clearImportCacheBtn'), importCacheStatus: el('importCacheStatus'), categorizedDataSummary: el('categorizedDataSummary'), spreadsheetDataPreview: el('spreadsheetDataPreview'), addCustomSourceBtn: el('addCustomSourceBtn'), customSourceFile: el('customSourceFile'), customSourcesList: el('customSourcesList'),
  troubleSourceSelect: el('troubleSourceSelect'), troubleSheetSelect: el('troubleSheetSelect'), troubleHeaderRowInput: el('troubleHeaderRowInput'), troubleStartColInput: el('troubleStartColInput'), troublePreviewBtn: el('troublePreviewBtn'), troubleApplyBtn: el('troubleApplyBtn'), troubleApplyFootBtn: el('troubleApplyFootBtn'), troubleStatus: el('troubleStatus'), troubleSheetPreview: el('troubleSheetPreview'), troubleHeaderSummary: el('troubleHeaderSummary'), troubleHeaderPreview: el('troubleHeaderPreview'), troubleSelectedCell: el('troubleSelectedCell'), troubleManualHeaderName: el('troubleManualHeaderName'), troubleDeclareHeaderBtn: el('troubleDeclareHeaderBtn'), troubleManualHeaders: el('troubleManualHeaders'), troubleCustomFrameworkPanel: el('troubleCustomFrameworkPanel'), troubleNameMode: el('troubleNameMode'), troubleFullNameColumn: el('troubleFullNameColumn'), troubleFirstNameColumn: el('troubleFirstNameColumn'), troubleLastNameColumn: el('troubleLastNameColumn'), troubleConvertLastFirst: el('troubleConvertLastFirst'), troubleTeamColumn: el('troubleTeamColumn'), troubleSkipTeamBuild: el('troubleSkipTeamBuild'), troubleUseDateColumn: el('troubleUseDateColumn'), troubleDateColumn: el('troubleDateColumn'),
  teamManagerSearch: el('teamManagerSearch'), teamManagerList: el('teamManagerList'), teamManagerTitle: el('teamManagerTitle'), teamRepSearch: el('teamRepSearch'), teamMoveSelect: el('teamMoveSelect'), selectAllTeamRepsBtn: el('selectAllTeamRepsBtn'), unselectAllTeamRepsBtn: el('unselectAllTeamRepsBtn'), moveTeamBtn: el('moveTeamBtn'), teamMoveStatus: el('teamMoveStatus'), teamRepList: el('teamRepList'), teamConnectThreshold: el('teamConnectThreshold'), teamConnectThresholdValue: el('teamConnectThresholdValue'), teamQuarantineSummary: el('teamQuarantineSummary'), teamQuarantineList: el('teamQuarantineList'), connectVisibleRepMatchesBtn: el('connectVisibleRepMatchesBtn'), connectAllRepMatchesBtn: el('connectAllRepMatchesBtn'), teamConnectSummary: el('teamConnectSummary'), teamConnectList: el('teamConnectList'), rebuildControlRosterBtn: el('rebuildControlRosterBtn'), clearAllRepAliasesBtn: el('clearAllRepAliasesBtn'), clearRetailRepAliasesBtn: el('clearRetailRepAliasesBtn'), clearReferralRepAliasesBtn: el('clearReferralRepAliasesBtn'),
  modelList: el('modelList'), createModelBtn: el('createModelBtn'), exportModelsBtn: el('exportModelsBtn'), importModelsFile: el('importModelsFile'), massHeaderList: el('massHeaderList'), massHeaderSummary: el('massHeaderSummary'), refreshMassHeaderBtn: el('refreshMassHeaderBtn'), applyMassHeaderBtn: el('applyMassHeaderBtn'), massShowAllHeaders: el('massShowAllHeaders'), editModelTitle: el('editModelTitle'), modelNameInput: el('modelNameInput'), modelTypeInput: el('modelTypeInput'), modelTiebreakerInput: el('modelTiebreakerInput'), sourceSettingsPanel: el('sourceSettingsPanel'), columnCheckResults: el('columnCheckResults'), criteriaList: el('criteriaList'), addCriterionBtn: el('addCriterionBtn'), cancelModelTopBtn: el('cancelModelTopBtn'), cancelModelBtn: el('cancelModelBtn'), saveModelBtn: el('saveModelBtn'), saveExitModelBtn: el('saveExitModelBtn'),
  runModelSelect: el('runModelSelect'), runReadiness: el('runReadiness'), runReadinessTitle: el('runReadinessTitle'), runReadinessDetail: el('runReadinessDetail'), runReadinessMeta: el('runReadinessMeta'), runStartDate: el('runStartDate'), runEndDate: el('runEndDate'), runViewSelect: el('runViewSelect'), qaDateField: el('qaDateField'), runQADateSelect: el('runQADateSelect'), qaTeamScoreModeField: el('qaTeamScoreModeField'), runQATeamScoreMode: el('runQATeamScoreMode'), hideNoScoreReps: el('hideNoScoreReps'), hideNoScoreThreshold: el('hideNoScoreThreshold'), rankRepresentativesWithinTeam: el('rankRepresentativesWithinTeam'), teamSelectGrid: el('teamSelectGrid'), teamSearchInput: el('teamSearchInput'), teamCountBadge: el('teamCountBadge'), addVisibleTeamsBtn: el('addVisibleTeamsBtn'), removeVisibleTeamsBtn: el('removeVisibleTeamsBtn'), selectAllTeamsBtn: el('selectAllTeamsBtn'), clearTeamsBtn: el('clearTeamsBtn'), executeRunBtn: el('executeRunBtn'), allstarRunPanel: el('allstarRunPanel'), orgBuilderModal: el('orgBuilderModal'), createOrgBtn: el('createOrgBtn'), duplicateOrgBtn: el('duplicateOrgBtn'), deleteOrgBtn: el('deleteOrgBtn'), saveOrgBtn: el('saveOrgBtn'), exportOrgsBtn: el('exportOrgsBtn'), importOrgsFile: el('importOrgsFile'), orgSearchInput: el('orgSearchInput'), orgCoachSearchInput: el('orgCoachSearchInput'), orgList: el('orgList'), orgCoachList: el('orgCoachList'), orgSelectedList: el('orgSelectedList'), orgNameInput: el('orgNameInput'), orgCountBadge: el('orgCountBadge'), orgHealthPanel: el('orgHealthPanel'), selectVisibleOrgCoachesBtn: el('selectVisibleOrgCoachesBtn'), clearOrgCoachesBtn: el('clearOrgCoachesBtn'), runOrgSearchInput: el('runOrgSearchInput'), runIncludeOrgGrid: el('runIncludeOrgGrid'), runExcludeOrgGrid: el('runExcludeOrgGrid'), runOrgBadge: el('runOrgBadge'), clearRunOrgsBtn: el('clearRunOrgsBtn'), researchCanvas: el('researchCanvas'), metricsList: el('metricsList'), metricSearchInput: el('metricSearchInput'), metricEditorModal: el('metricEditorModal'), newMetricBtn: el('newMetricBtn'), exportMetricsBtn: el('exportMetricsBtn'), importMetricsFile: el('importMetricsFile'), metricEditId: el('metricEditId'), metricNameInput: el('metricNameInput'), metricSourceSelect: el('metricSourceSelect'), metricModeSelect: el('metricModeSelect'), metricFieldInput: el('metricFieldInput'), metricFieldGearBtn: el('metricFieldGearBtn'), metricPercentOfField: el('metricPercentOfField'), metricWithinCompareField: el('metricWithinCompareField'), metricWithinUseRange: el('metricWithinUseRange'), metricWithinDays: el('metricWithinDays'), metricWithinRangeMin: el('metricWithinRangeMin'), metricWithinRangeMax: el('metricWithinRangeMax'), metricNumericWarn: el('metricNumericWarn'), metricNotesInput: el('metricNotesInput'), addMetricAndBtn: el('addMetricAndBtn'), addMetricOrBtn: el('addMetricOrBtn'), metricRulesList: el('metricRulesList'), deleteMetricBtn: el('deleteMetricBtn'), saveMetricBtn: el('saveMetricBtn'), saveExitMetricBtn: el('saveExitMetricBtn'), researchCanvas: el('researchCanvas'), addResearchItemBtn: el('addResearchItemBtn'), exportResearchBtn: el('exportResearchBtn'), importResearchFile: el('importResearchFile'), renderAllResearchBtn: el('renderAllResearchBtn'), buildResearchIndexBtn: el('buildResearchIndexBtn'), clearResearchCacheBtn: el('clearResearchCacheBtn'), clearResearchRenderedBtn: el('clearResearchRenderedBtn'), researchCacheBadge: el('researchCacheBadge'), stopResearchRenderBtn: el('stopResearchRenderBtn'), clearResearchBtn: el('clearResearchBtn'), researchEditId: el('researchEditId'), researchTitleInput: el('researchTitleInput'), researchTemplateSelect: el('researchTemplateSelect'), researchApplyTemplateBtn: el('researchApplyTemplateBtn'), researchOutputType: el('researchOutputType'), researchMode: el('researchMode'), researchFilterDuplicateReps: el('researchFilterDuplicateReps'), researchSource: el('researchSource'), researchAnalysisGrain: el('researchAnalysisGrain'), researchCrossSourceJoin: el('researchCrossSourceJoin'), researchDateColumn: el('researchDateColumn'), researchStartDate: el('researchStartDate'), researchEndDate: el('researchEndDate'), researchGroupField: el('researchGroupField'), researchGroupMultiAdd: el('researchGroupMultiAdd'), researchGroupMultiAddBuilder: el('researchGroupMultiAddBuilder'), researchGroupMultiAddInput: el('researchGroupMultiAddInput'), researchGroupMultiAddBtn: el('researchGroupMultiAddBtn'), researchGroupMultiAddList: el('researchGroupMultiAddList'), researchGroupExpression: el('researchGroupExpression'), researchValueMode: el('researchValueMode'), researchValueField: el('researchValueField'), researchPercentOfField: el('researchPercentOfField'), researchWithinCompareField: el('researchWithinCompareField'), researchWithinUseRange: el('researchWithinUseRange'), researchWithinDays: el('researchWithinDays'), researchWithinRangeMin: el('researchWithinRangeMin'), researchWithinRangeMax: el('researchWithinRangeMax'), researchValueFieldError: el('researchValueFieldError'), researchUseSecondaryGroup: el('researchUseSecondaryGroup'), researchSecondaryGroupField: el('researchSecondaryGroupField'), researchDateGrouping: el('researchDateGrouping'), researchBucketSize: el('researchBucketSize'), researchModelSelect: el('researchModelSelect'), researchCriteriaSelect: el('researchCriteriaSelect'), researchModelResult: el('researchModelResult'), researchPopulation: el('researchPopulation'), researchPercentBuilder: el('researchPercentBuilder'), researchNumeratorExpression: el('researchNumeratorExpression'), researchNumeratorCount: el('researchNumeratorCount'), researchDenominator: el('researchDenominator'), researchDenominatorExpression: el('researchDenominatorExpression'), researchZeroDenominator: el('researchZeroDenominator'), researchSort: el('researchSort'), researchTableDecimals: el('researchTableDecimals'), researchTableShowPercent: el('researchTableShowPercent'), researchAxisMin: el('researchAxisMin'), researchAxisMax: el('researchAxisMax'), researchDecimals: el('researchDecimals'), researchShowValues: el('researchShowValues'), researchShowDateLabels: el('researchShowDateLabels'), researchShowPercent: el('researchShowPercent'), researchGraphSort: el('researchGraphSort'), researchTopN: el('researchTopN'), researchShowSummaryLine: el('researchShowSummaryLine'), researchGoalValue: el('researchGoalValue'), researchRotateLabels: el('researchRotateLabels'), researchWrapLabels: el('researchWrapLabels'), researchShowLegend: el('researchShowLegend'), researchShowGridlines: el('researchShowGridlines'), researchSmoothLine: el('researchSmoothLine'), researchUseDots: el('researchUseDots'), researchBarOrientation: el('researchBarOrientation'), researchStackedBars: el('researchStackedBars'), researchGroupedBars: el('researchGroupedBars'), researchHideZeroGroups: el('researchHideZeroGroups'), researchHighlightBest: el('researchHighlightBest'), researchHighlightWorst: el('researchHighlightWorst'), researchRowLimit: el('researchRowLimit'), researchTotals: el('researchTotals'), researchTextWrap: el('researchTextWrap'), researchRowDensity: el('researchRowDensity'), addResearchFilterBtn: el('addResearchFilterBtn'), researchFilters: el('researchFilters'), addResearchColumnBtn: el('addResearchColumnBtn'), researchColumns: el('researchColumns'), saveResearchItemBtn: el('saveResearchItemBtn'), previewResearchFoundBtn: el('previewResearchFoundBtn'), researchFoundPreview: el('researchFoundPreview')
};
Object.assign(els,{
  coachingDiagnosticsModal:el('coachingDiagnosticsModal'), coachingDiagnosticsBtn:el('coachingDiagnosticsBtn'), testAllCoachingRulesBtn:el('testAllCoachingRulesBtn'), copyCoachingDiagnosticsBtn:el('copyCoachingDiagnosticsBtn'), exportCoachingDiagnosticsBtn:el('exportCoachingDiagnosticsBtn'), coachingDiagnosticRule:el('coachingDiagnosticRule'), coachingDiagnosticRep:el('coachingDiagnosticRep'), coachingDiagnosticTeam:el('coachingDiagnosticTeam'), coachingDiagnosticsBody:el('coachingDiagnosticsBody'),
  singleRunSelectionPanel:el('singleRunSelectionPanel'), runSingleTab:el('runSingleTab'), runMultiTab:el('runMultiTab'), multiRunPanel:el('multiRunPanel'), multiRunOrgGrid:el('multiRunOrgGrid'), multiRunOrgBadge:el('multiRunOrgBadge'), multiRunOrgSearch:el('multiRunOrgSearch'), multiRunSelectVisibleBtn:el('multiRunSelectVisibleBtn'), multiRunClearBtn:el('multiRunClearBtn'), multiRunSummary:el('multiRunSummary'),
  qualtricsEmailModal:el('qualtricsEmailModal'), qualtricsEmailFrame:el('qualtricsEmailFrame'), qualtricsStatsSource:el('qualtricsStatsSource'), loadQualtricsWeeklyBtn:el('loadQualtricsWeeklyBtn'), refreshQualtricsDataBtn:el('refreshQualtricsDataBtn'), clearQualtricsDataBtn:el('clearQualtricsDataBtn'), qualtricsBridgeStatus:el('qualtricsBridgeStatus'),
  guidedResearchSubject:el('guidedResearchSubject'), guidedRecordType:el('guidedRecordType'), guidedRecordTypeField:el('guidedRecordTypeField'), guidedResearchQuestion:el('guidedResearchQuestion'), guidedPercentageUnit:el('guidedPercentageUnit'), guidedPercentageUnitField:el('guidedPercentageUnitField'), guidedAggregate:el('guidedAggregate'), guidedAggregateField:el('guidedAggregateField'), guidedRankUnit:el('guidedRankUnit'), guidedRankUnitField:el('guidedRankUnitField'), guidedMeasureField:el('guidedMeasureField'), guidedMeasureFieldWrap:el('guidedMeasureFieldWrap'), guidedResearchTitle:el('guidedResearchTitle'), guidedEvidenceSources:el('guidedEvidenceSources'), guidedPrimarySource:el('guidedPrimarySource'), guidedEvidenceRelationship:el('guidedEvidenceRelationship'), guidedResearchConditions:el('guidedResearchConditions'), addGuidedConditionBtn:el('addGuidedConditionBtn'), guidedBreakdown:el('guidedBreakdown'), guidedBreakdownColumn:el('guidedBreakdownColumn'), guidedBreakdownColumnWrap:el('guidedBreakdownColumnWrap'), guidedDisplay:el('guidedDisplay'), guidedSort:el('guidedSort'), guidedQuestionText:el('guidedQuestionText'), guidedCalculationStatus:el('guidedCalculationStatus'), guidedCalculationGrid:el('guidedCalculationGrid')

});
Object.assign(els,{
  researchDiagnosticsDrawer:el('researchDiagnosticsDrawer'), researchDiagnosticsBody:el('researchDiagnosticsBody'),
  researchIncludeOrgInput:el('researchIncludeOrgInput'), researchAddIncludeOrgBtn:el('researchAddIncludeOrgBtn'), researchIncludeOrgChips:el('researchIncludeOrgChips'),
  researchIncludeTeamInput:el('researchIncludeTeamInput'), researchAddIncludeTeamBtn:el('researchAddIncludeTeamBtn'), researchIncludeTeamChips:el('researchIncludeTeamChips'),
  researchIncludeRepInput:el('researchIncludeRepInput'), researchAddIncludeRepBtn:el('researchAddIncludeRepBtn'), researchIncludeRepChips:el('researchIncludeRepChips'),
  researchExcludeOrgInput:el('researchExcludeOrgInput'), researchAddExcludeOrgBtn:el('researchAddExcludeOrgBtn'), researchExcludeOrgChips:el('researchExcludeOrgChips'),
  researchExcludeTeamInput:el('researchExcludeTeamInput'), researchAddExcludeTeamBtn:el('researchAddExcludeTeamBtn'), researchExcludeTeamChips:el('researchExcludeTeamChips'),
  researchExcludeRepInput:el('researchExcludeRepInput'), researchAddExcludeRepBtn:el('researchAddExcludeRepBtn'), researchExcludeRepChips:el('researchExcludeRepChips'),
  researchPopulationOrgSuggestions:el('researchPopulationOrgSuggestions'), researchPopulationTeamSuggestions:el('researchPopulationTeamSuggestions'), researchPopulationRepSuggestions:el('researchPopulationRepSuggestions'),
  researchUnmatchedBehavior:el('researchUnmatchedBehavior'), researchCalculationGroupLimit:el('researchCalculationGroupLimit'), researchReconcile:el('researchReconcile'), researchJoinPreview:el('researchJoinPreview'),
  researchTypedMeasure:el('researchTypedMeasure'), researchMissingBehavior:el('researchMissingBehavior'), researchUseTypedMeasureBtn:el('researchUseTypedMeasureBtn'), researchAddTypedMeasureColumnBtn:el('researchAddTypedMeasureColumnBtn'), researchTypedMeasureMeta:el('researchTypedMeasureMeta'), researchPreviewMeasureSamplesBtn:el('researchPreviewMeasureSamplesBtn'), researchMeasureSamplePreview:el('researchMeasureSamplePreview'),
  researchPanelField:el('researchPanelField')
});
Object.assign(els,{
  listTesterModal:el('listTesterModal'), listTesterBtn:el('listTesterBtn'), listTesterInput:el('listTesterInput'), listTesterCommaSeparated:el('listTesterCommaSeparated'), listTesterCheckEnabled:el('listTesterCheckEnabled'), listTesterCheckPanel:el('listTesterCheckPanel'), listTesterCheckPreset:el('listTesterCheckPreset'), listTesterCheckSource:el('listTesterCheckSource'), listTesterCheckHeader:el('listTesterCheckHeader'), listTesterCheckContains:el('listTesterCheckContains'), listTesterCheckDateHeader:el('listTesterCheckDateHeader'), listTesterCheckStartDate:el('listTesterCheckStartDate'), listTesterCheckEndDate:el('listTesterCheckEndDate'), listTesterCheckMeta:el('listTesterCheckMeta'), runListTesterBtn:el('runListTesterBtn'), clearListTesterBtn:el('clearListTesterBtn'), copyListTesterCoachesBtn:el('copyListTesterCoachesBtn'), exportListTesterBtn:el('exportListTesterBtn'), exportListTesterPdfBtn:el('exportListTesterPdfBtn'), listTesterSummary:el('listTesterSummary'), listTesterUniqueCoaches:el('listTesterUniqueCoaches'), listTesterResults:el('listTesterResults'), listTesterDetailModal:el('listTesterDetailModal'), listTesterDetailTitle:el('listTesterDetailTitle'), listTesterDetailSummary:el('listTesterDetailSummary'), listTesterDetailBody:el('listTesterDetailBody')
});
Object.assign(els,{
  rosterReassignmentModal:el('rosterReassignmentModal'), rosterReassignmentArea:el('rosterReassignmentArea'), rosterReassignmentFile:el('rosterReassignmentFile'), rosterReassignmentFileName:el('rosterReassignmentFileName'), rosterReassignmentStatus:el('rosterReassignmentStatus'), rosterReassignmentSummary:el('rosterReassignmentSummary'), rosterReassignmentWarnings:el('rosterReassignmentWarnings'), rosterReassignmentChanges:el('rosterReassignmentChanges'), applyRosterReassignmentBtn:el('applyRosterReassignmentBtn'), applyRosterReassignmentFootBtn:el('applyRosterReassignmentFootBtn'), clearRosterReassignmentBtn:el('clearRosterReassignmentBtn')
});
function esc(v){return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function id(){return 'm'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
const HEADER_FIELDS = ['column','leftColumn','rightColumn','withinCompareColumn','checkDateColumn','checkColumn','trueValueColumn','lookupMatchColumn','lookupReturnColumn','lookupDateColumn'];
const SOURCE_LABELS = {nondate:'Non-Date Database',date:'Dated Database',retail_sv2:'Retail SV2',retail_wiper:'Retail Wipers',retail_team_totals:'Retail Team Totals',referral_sv2:'Referral SV2',referral_wiper:'Referral Wipers',referral_team_totals:'Referral Team Totals',qa:'QA Genesys Evaluation Score',qa_direct:'Direct QA Team Score Override',checklist:'Checklist',documented_coaching:'Documented Coaching',comp_calls:'Comp Calls'};
const PACKAGE_SHEETS = {nondate:'Non-Date Database',date:'Dated Database',retail_sv2:'Retail SV2',retail_wiper:'Retail Wipers',retail_team_totals:'Retail Team Totals',referral_sv2:'Referral SV2',referral_wiper:'Referral Wipers',referral_team_totals:'Referral Team Totals',qa:'QA Genesys Evaluation Score',checklist:'Checklist',documented_coaching:'Documented Coaching',comp_calls:'Comp Calls'};
const SOURCE_TO_BOOK = {retail_sv2:'retail',retail_wiper:'retail',retail_team_totals:'retail',referral_sv2:'referral',referral_wiper:'referral',referral_itac:'referral',referral_team_totals:'referral',qa:'qa',checklist:'checklist',documented_coaching:'documented_coaching',comp_calls:'comp_calls'};
const SOURCE_SHEET_HINTS = {retail_sv2:['Retail SV2','sv2'],retail_wiper:['Retail Wipers','Retail SV2 Wipers','sv2 wipers','sv2wipers','sv2 wiper','sv2wiper'],referral_sv2:['Referral SV2','sv2'],referral_wiper:['Referral Wipers','Referral SV2 Wipers','sv2 wipers','sv2wipers','sv2 wiper','sv2wiper'],qa:['QA Genesys Evaluation Score','Genesys Evaluation Score','genesys evaluation score','qa','evaluation','evaluations','quality','sheet1'],checklist:['All Items','Checklist','checklist','items','sheet1'],documented_coaching:['Documented Coaching','documented coaching','documented_coaching','coaching','sheet1'],comp_calls:['Compliments','Compliment','Comp Calls','Comp Call','Compliment Calls','sheet1']};
const FORCE_NONDATED_IMPORT_SOURCES = new Set(['retail_sv2','retail_wiper','retail_team_totals','referral_sv2','referral_wiper','referral_team_totals']);
const TEAM_TOTAL_SOURCE_KEYS = ['retail_team_totals','referral_team_totals'];
const TEAM_TOTAL_IDENTITY_SCHEMA_VERSION = 3;
const TEAM_TOTAL_METADATA_HEADERS = ['Full Team Name','Control Tab','AA2 Lookup Key','Source Summary Name','Source Summary Sheet','Source Summary Row'];
const LEGACY_AGGREGATE_SOURCE_RECORD_IDS = new Set(['retail_sv2','retail_wiper','retail_team_totals','referral_sv2','referral_wiper','referral_team_totals']);
const NA_TEAM = 'N/A';
const RESEARCH_TYPED_MEASURES = [
  {id:'record_count',label:'Record Count',category:'Activity',sources:['*'],aggregation:'count',valueType:'number',grains:['rows','representatives','teams'],formula:'COUNT(eligible source rows)',missingBehavior:'zero',chartTypes:['bar','line','pie','heatmap']},
  {id:'unique_representatives',label:'Unique Representative Count',category:'Activity',sources:['*'],aggregation:'unique_rep',valueType:'number',grains:['teams','rows'],formula:'COUNT DISTINCT(canonical representative)',missingBehavior:'exclude',chartTypes:['bar','line','pie','heatmap']},
  {id:'cash_appointment_rate',label:'Cash Appointment Rate',category:'Performance',sources:['retail_sv2','referral_sv2',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Consumer Appointments','Cash Appointments','Cash Appointments Scheduled','Appointments'],denominatorCandidates:['Consumer Opportunities','Cash Opportunities','Opportunities'],grains:['representatives','teams'],formula:'SUM(Consumer Appointments) ÷ SUM(Consumer Opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'consumer_scheduling_rate',label:'Consumer Scheduling Rate',category:'Performance',sources:['retail_sv2','referral_sv2',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Consumer Appointments','Appointments Scheduled','Appointments'],denominatorCandidates:['Consumer Opportunities','Opportunities'],grains:['representatives','teams'],formula:'SUM(Consumer Appointments) ÷ SUM(Consumer Opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'insurance_cash_rate',label:'Insurance Cash Rate',category:'Performance',sources:['retail_sv2','referral_sv2',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Insurance Cash','Insurance Cash Count','Insurance Cash Appointments','IC Appointments'],denominatorCandidates:['Consumer Opportunities','Cash Opportunities','Opportunities','Eligible Calls'],grains:['representatives','teams'],formula:'SUM(Insurance Cash) ÷ SUM(eligible opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'afterpay_usage',label:'Afterpay Usage',category:'Performance',sources:['retail_sv2','referral_sv2',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Afterpay','Afterpay Count','Afterpay Used','Afterpay Appointments'],denominatorCandidates:['Consumer Opportunities','Cash Opportunities','Opportunities','Eligible Calls'],grains:['representatives','teams'],formula:'SUM(Afterpay uses) ÷ SUM(eligible opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'discount_usage',label:'Discount Usage',category:'Performance',sources:['retail_sv2','referral_sv2',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Discount','Discounts','Discount Count','Discount Used','Discount Appointments'],denominatorCandidates:['Consumer Opportunities','Cash Opportunities','Opportunities','Eligible Calls'],grains:['representatives','teams'],formula:'SUM(discount uses) ÷ SUM(eligible opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'success_rate',label:'Success Rate',category:'Performance',sources:['retail_sv2','referral_sv2',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Success','Successful','Scheduled','Appointments','Consumer Appointments'],denominatorCandidates:['Opportunities','Consumer Opportunities','Eligible Calls','Contacts'],grains:['representatives','teams'],formula:'SUM(successes) ÷ SUM(eligible opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'wiper_rate',label:'Wiper Rate',category:'Performance',sources:['retail_wiper','referral_wiper',DATED_SOURCE,NONDATED_SOURCE],aggregation:'weighted_rate',valueType:'percentage',numeratorCandidates:['Wipers','Wiper Sales','Wiper Accepted','Wiper Appointments'],denominatorCandidates:['Wiper Opportunities','Opportunities','Eligible'],grains:['representatives','teams'],formula:'SUM(wiper successes) ÷ SUM(wiper opportunities)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'documented_coaching_count',label:'Documented Coaching Count',category:'Activity',sources:['documented_coaching'],aggregation:'count',valueType:'number',grains:['representatives','teams'],formula:'COUNT(Documented Coaching records)',missingBehavior:'zero',chartTypes:['bar','line','pie','heatmap']},
  {id:'checklist_count',label:'Checklist Count',category:'Activity',sources:['checklist'],aggregation:'count',valueType:'number',grains:['representatives','teams'],formula:'COUNT(Checklist records)',missingBehavior:'zero',chartTypes:['bar','line','pie','heatmap']},
  {id:'qa_monitor_count',label:'QA Monitor Count',category:'Activity',sources:['qa',QA_DIRECT_SOURCE],aggregation:'count',valueType:'number',grains:['representatives','teams'],formula:'COUNT(QA evaluation records)',missingBehavior:'zero',chartTypes:['bar','line','pie','heatmap']},
  {id:'qa_score',label:'QA Score',category:'Performance',sources:['qa',QA_DIRECT_SOURCE],aggregation:'avg',valueType:'percentage',valueCandidates:['Score %','Score','Evaluation Score','Overall Score'],grains:['representatives','teams'],formula:'AVERAGE(QA score)',missingBehavior:'exclude',chartTypes:['bar','line','scatter','heatmap']},
  {id:'compliment_count',label:'Compliment Count',category:'Activity',sources:['comp_calls'],aggregation:'count',valueType:'number',grains:['representatives','teams'],formula:'COUNT(Compliment records)',missingBehavior:'zero',chartTypes:['bar','line','pie','heatmap']}
];

function emptyTeamTotalsDataset(area='retail'){
  const retail=area==='retail';
  return {fileName:retail?'Retail Team Totals.xlsx':'Referral Team Totals.xlsx',sheetName:retail?'Retail Team Totals':'Referral Team Totals',headers:[],rows:[],mappings:[],diagnostics:{},rowsVersion:0,indexVersion:-1,rowsByTeamKey:Object.create(null),rowsByCoachAliasKey:Object.create(null)};
}
function normalizeTeamTotalLookupKey(v){ return norm(v).replace(/[^a-z0-9]+/g,''); }
function coachInitialSurnameKey(value){
  const raw=String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  if(!raw) return '';
  let parts=raw.split(/[^a-z0-9]+/).filter(Boolean);
  if(raw.includes(',') && parts.length>=2) parts=[parts[1],parts[0],...parts.slice(2)];
  const suffixes=new Set(['jr','sr','ii','iii','iv','v']);
  while(parts.length>2 && suffixes.has(parts[parts.length-1])) parts.pop();
  if(parts.length<2) return '';
  const first=parts[0], last=parts[parts.length-1];
  return first && last ? `${first[0]}${last}` : '';
}
function teamTotalsHeaderDefinitions(aoa, headerRowIndex=2){
  const headerRow=aoa?.[headerRowIndex]||[], defs=[], counts=new Map();
  for(let c=0;c<headerRow.length;c++){
    const base=String(headerRow[c]??'').trim();
    if(!base) continue;
    const token=norm(base), count=(counts.get(token)||0)+1; counts.set(token,count);
    defs.push({name:count===1?base:`${base} (${count})`,sourceName:base,index:c});
  }
  return defs;
}
function teamTotalsRowCompleteness(row, headers=[]){
  let filled=0;
  (headers||[]).slice(1).forEach(h=>{ const v=row?.[h]; if(v!==null && v!==undefined && String(v).trim()!=='') filled++; });
  return filled;
}
function teamTotalsPreferredRow(current, candidate, headers=[]){
  if(!current) return candidate;
  const currentScore=teamTotalsRowCompleteness(current,headers), candidateScore=teamTotalsRowCompleteness(candidate,headers);
  if(candidateScore!==currentScore) return candidateScore>currentScore?candidate:current;
  return Number(candidate?._summaryRowNumber||0)>=Number(current?._summaryRowNumber||0)?candidate:current;
}
function chooseBestTeamTotalsSummaryHit(hits, headers=[]){
  return (hits||[]).reduce((best,hit)=>{
    if(!best) return hit;
    const a=teamTotalsRowCompleteness(best.row,headers), b=teamTotalsRowCompleteness(hit.row,headers);
    if(b!==a) return b>a?hit:best;
    return Number(hit.rowNumber||0)>=Number(best.rowNumber||0)?hit:best;
  },null);
}
function teamTotalsIdentityHeader(headers=[]){
  const clean=(headers||[]).filter(h=>String(h??'').trim());
  return clean.find(h=>norm(h)==='name') || clean.find(h=>['coachname','teamname','user'].includes(norm(h))) || clean[0] || '';
}
function teamTotalsDataHeaders(headers=[]){ return (headers||[]).filter(h=>!TEAM_TOTAL_METADATA_HEADERS.includes(h)); }
function usableTeamTotalCoachName(value){
  const name=canonicalCoachName(value||'');
  return name && coachNameKey(name)!==coachNameKey(NA_TEAM) ? name : '';
}
function teamTotalsPersistedIdentitySignature(ds){
  const headers=teamTotalsDataHeaders(ds?.headers||[]), identityHeader=teamTotalsIdentityHeader(headers);
  return JSON.stringify({identitySchemaVersion:Number(ds?.identitySchemaVersion||0),identityHeader:ds?.identityHeader||'',rows:(ds?.rows||[]).map(r=>({identity:identityHeader?r?.[identityHeader]??'':'',team:r?._team??'',teamKey:r?._teamKey??'',fullTeam:r?.['Full Team Name']??'',summaryLookup:r?._summaryLookupKey??'',summaryDisplay:r?._summaryDisplayName??''}))});
}
function normalizeTeamTotalsDataset(ds, sourceKey='', options={}){
  ds=ds||emptyTeamTotalsDataset(sourceKey==='referral_team_totals'?'referral':'retail');
  const inferredSource=sourceKey || ds._sourceKey || (/referral/i.test(ds.sheetName||ds.fileName||'')?'referral_team_totals':'retail_team_totals');
  ds.headers=teamTotalsDataHeaders(ds.headers||[]);
  const identityHeader=teamTotalsIdentityHeader(ds.headers), mappings=Array.isArray(ds.mappings)?ds.mappings:[], mappingByLookup=new Map();
  mappings.forEach(m=>{ const key=normalizeTeamTotalLookupKey(m.lookupKey||m.summaryLookupKey||''); if(key && !mappingByLookup.has(key)) mappingByLookup.set(key,m); });
  ds.rows=(ds.rows||[]).map(original=>{
    const row={...(original||{})}, currentIdentity=identityHeader?String(row[identityHeader]??'').trim():'', lookupRaw=row._summaryLookupKey||row['AA2 Lookup Key']||currentIdentity;
    const mapped=mappingByLookup.get(normalizeTeamTotalLookupKey(lookupRaw));
    // Team Totals rows are coach-level records, never representative rows. Prefer
    // durable Control/mapping identity fields and explicitly reject a generic N/A
    // value that may have been written by older representative-team rebuilds.
    const team=usableTeamTotalCoachName(mapped?.team) || usableTeamTotalCoachName(row['Full Team Name']) || usableTeamTotalCoachName(row._team) || usableTeamTotalCoachName(currentIdentity);
    const summaryDisplay=String(row._summaryDisplayName||row['Source Summary Name']||((team&&coachNameKey(currentIdentity)===coachNameKey(team))?(row._summaryLookupKey||''):currentIdentity)||row._summaryLookupKey||'').trim();
    row._sourceKey=inferredSource;
    row._team=team;
    row._teamKey=coachNameKey(team);
    row['Full Team Name']=team;
    row._summaryLookupKey=row._summaryLookupKey||row['AA2 Lookup Key']||mapped?.summaryLookupKey||summaryDisplay;
    row._summaryDisplayName=summaryDisplay||row._summaryLookupKey||'';
    row._controlTab=row._controlTab||row['Control Tab']||mapped?.controlTab||'';
    row._summarySheet=row._summarySheet||row['Source Summary Sheet']||(inferredSource==='referral_team_totals'?'KPI Summary':'Appt Summary');
    row._summaryRowNumber=row._summaryRowNumber||row['Source Summary Row']||'';
    if(identityHeader && team) row[identityHeader]=team;
    return row;
  });
  ds._sourceKey=inferredSource; ds.identityHeader=identityHeader; ds.identitySchemaVersion=TEAM_TOTAL_IDENTITY_SCHEMA_VERSION;
  return ds;
}
function teamTotalsDataset(source){ const ds=source==='retail_team_totals' ? (state.data.retail.teamTotals||emptyTeamTotalsDataset('retail')) : source==='referral_team_totals' ? (state.data.referral.teamTotals||emptyTeamTotalsDataset('referral')) : emptyTeamTotalsDataset('retail'); return ensureTeamTotalsIndex(ds); }
function markTeamTotalsRowsChanged(ds){ if(!ds) return ds; ds.rowsVersion=(Number(ds.rowsVersion)||0)+1; ds.indexVersion=-1; ds.rowsByTeamKey=Object.create(null); ds.rowsByCoachAliasKey=Object.create(null); ds.indexSignature=''; return ds; }
function teamTotalsIndexSignature(ds){
  const rows=ds?.rows||[], headers=ds?.headers||[], mappings=ds?.mappings||[], v=state.versions||{};
  const rowIdentity=rows.map(r=>[r?._team,r?.['Full Team Name'],r?._teamKey,r?._summaryLookupKey,r?._summaryDisplayName,r?._summaryRowNumber].map(x=>String(x??'')).join('\u001e')).join('\u001d');
  const mappingIdentity=mappings.map(m=>[m?.team,m?.teamKey,m?.controlTab,m?.summaryLookupKey,m?.lookupKey].map(x=>String(x??'')).join('\u001e')).join('\u001d');
  return stableSerialize({rowsVersion:Number(ds?.rowsVersion)||0,rowCount:rows.length,headers:headers.join('\u001f'),rowIdentity,mappingIdentity,identitySchemaVersion:Number(ds?.identitySchemaVersion)||0,identityHeader:ds?.identityHeader||'',teams:v.teams||0,mappings:v.mappings||0,fileName:ds?.fileName||'',sheetName:ds?.sheetName||''});
}
function ensureTeamTotalsIndex(ds){
  ds=ds||emptyTeamTotalsDataset('retail');
  const source=ds._sourceKey || (/referral/i.test(ds.sheetName||ds.fileName||'')?'referral_team_totals':'retail_team_totals');
  ds=normalizeTeamTotalsDataset(ds,source);
  const signature=teamTotalsIndexSignature(ds);
  if(ds.rowsByTeamKey && ds.rowsByCoachAliasKey && ds.indexSignature===signature && ds.indexVersion===Number(ds.rowsVersion||0)) return ds;
  const t0=performance.now(), exact=Object.create(null), aliases=Object.create(null), aliasOwners=Object.create(null), aliasConflicts=new Set(), identityHeader=teamTotalsIdentityHeader(ds.headers||[]), headers=ds.headers||[];
  const addExact=(name,row)=>{ const key=coachNameKey(name||''); if(key) exact[key]=teamTotalsPreferredRow(exact[key],row,headers); };
  const addAlias=(name,row,owner)=>{ const key=coachInitialSurnameKey(name); if(!key || aliasConflicts.has(key)) return; const priorOwner=aliasOwners[key]; if(priorOwner && priorOwner!==owner){ aliasConflicts.add(key); delete aliases[key]; delete aliasOwners[key]; return; } aliasOwners[key]=owner; aliases[key]=teamTotalsPreferredRow(aliases[key],row,headers); };
  (ds.rows||[]).forEach(r=>{
    const owner=coachNameKey(r?._team||r?.['Full Team Name']||(identityHeader?r?.[identityHeader]:'')||r?._summaryLookupKey||'');
    [r?._team,r?.['Full Team Name'],identityHeader?r?.[identityHeader]:'',r?._teamKey,r?._summaryLookupKey,r?._summaryDisplayName].forEach(name=>{ addExact(name,r); addAlias(name,r,owner); });
  });
  ds.rowsByTeamKey=exact; ds.rowsByCoachAliasKey=aliases; ds.indexVersion=Number(ds.rowsVersion)||0; ds.indexSignature=signature;
  state.perfCounters.teamTotalsIndexBuilds++; state.perfCounters.teamTotalsIndexBuildsBySource=state.perfCounters.teamTotalsIndexBuildsBySource||{}; state.perfCounters.teamTotalsIndexBuildsBySource[source]=(state.perfCounters.teamTotalsIndexBuildsBySource[source]||0)+1;
  console.info('[All Star Perf] Team Totals index build',{source,rows:(ds.rows||[]).length,aliases:Object.keys(aliases).length,aliasConflicts:[...aliasConflicts],rowsVersion:ds.rowsVersion,ms:Math.round(performance.now()-t0)}); return ds;
}
function teamTotalsRowMatch(ds, team){
  ds=ensureTeamTotalsIndex(ds);
  const exactKey=coachNameKey(team||''), exact=(ds.rowsByTeamKey||{})[exactKey];
  if(exact) return {row:exact,matchMode:'exact coach name'};
  const aliasKey=coachInitialSurnameKey(team), alias=aliasKey?(ds.rowsByCoachAliasKey||{})[aliasKey]:null;
  return alias ? {row:alias,matchMode:'unique first-initial + surname alias'} : {row:null,matchMode:'none'};
}
function teamTotalsRowForTeam(ds, team){ return teamTotalsRowMatch(ds,team).row; }
function rebuildTeamTotalsIndex(ds){ ds=normalizeTeamTotalsDataset(ds||emptyTeamTotalsDataset('retail'),'',{force:true}); ds=markTeamTotalsRowsChanged(ds); return ensureTeamTotalsIndex(ds); }
function teamTotalsSummaryText(area){ const ds=area==='retail'?(state.data.retail.teamTotals||emptyTeamTotalsDataset('retail')):(state.data.referral.teamTotals||emptyTeamTotalsDataset('referral')); const d=ds.diagnostics||{}; return `${area==='retail'?'Retail':'Referral'} Team Totals: ${(ds.rows||[]).length}/${d.controlTeamsInspected||0} teams matched · ${(d.teamsWithNoExtractedRow||[]).length} missing`; }
function teamTotalsDiagnosticsHtml(ds){
  const d=ds?.diagnostics||{}, list=(a)=>Array.isArray(a)&&a.length?`<div class="checkResultMeta">${a.slice(0,12).map(x=>esc(typeof x==='string'?x:JSON.stringify(x))).join(' · ')}${a.length>12?' …':''}</div>`:'';
  const gapBadge=(d.headerGapColumns||[]).length?`<span class="badge warn">${d.headerGapColumns.length} blank header spacer${d.headerGapColumns.length===1?'':'s'} skipped safely</span>`:'';
  return `<div class="checkResultRow ${(ds?.rows||[]).length?'okRow':'warnRow'}"><strong>${esc(ds?.sheetName||'Team Totals')}</strong><div class="checkResultMeta">${d.controlTeamsInspected||0} teams inspected · ${d.coachTabsFound||0} tabs found · ${d.distinctAA2Keys||0} AA2 keys · ${d.summaryRowsMatched||0} team rows matched ${gapBadge}</div>${list(d.coachTabsMissing)}${list(d.blankAA2Values)}${list(d.aa2KeysNotFound)}${list(d.duplicateSummaryRows)}${list(d.duplicateAA2Keys)}${list(d.teamsWithNoExtractedRow)}${d.missingSummarySheet?`<div class="checkResultMeta"><span class="badge warn">Missing ${esc(d.expectedSummarySheet||'summary sheet')}</span></div>`:''}${d.invalidHeaders?`<div class="checkResultMeta"><span class="badge warn">Blank or invalid Row 3 headers</span></div>`:''}</div>`;
}
async function buildTeamTotalsFromWorkbook(area, wb, fileName='', start=32, end=38){
  const retail=area==='retail', sourceKey=retail?'retail_team_totals':'referral_team_totals', summaryName=retail?'Appt Summary':'KPI Summary', sheetName=retail?'Retail Team Totals':'Referral Team Totals';
  const ds=emptyTeamTotalsDataset(area), rows=[], mappings=[], diag={expectedSummarySheet:summaryName,controlTeamsInspected:0,coachTabsFound:0,coachTabsMissing:[],blankAA2Values:[],distinctAA2Keys:0,summaryRowsMatched:0,aa2KeysNotFound:[],duplicateSummaryRows:[],duplicateAA2Keys:[],teamsWithMultipleExtractedRows:[],teamsWithNoExtractedRow:[],headerGapColumns:[],missingSummarySheet:false,invalidHeaders:false};
  ds.fileName=fileName||ds.fileName; const controlRows=controlRowsFromWorkbook(wb); diag.controlTeamsInspected=controlRows.length; const keyTeams=new Map();
  for(let i=0;i<controlRows.length;i++){
    const item=controlRows[i], team=canonicalCoachName(item.team), tab=String(item.tabName||'').trim(), sn=findWorkbookSheetByName(wb,tab); let aa2='';
    if(sn){ diag.coachTabsFound++; const aoa=sheetAoa(wb,sn); aa2=String(aoa?.[1]?.[26]??'').trim(); }
    else diag.coachTabsMissing.push(`${team} -> ${tab}`);
    if(!aa2) diag.blankAA2Values.push(`${team} -> ${tab}`);
    const k=normalizeTeamTotalLookupKey(aa2);
    if(k){ if(!keyTeams.has(k)) keyTeams.set(k,[]); keyTeams.get(k).push(team); }
    mappings.push({team,teamKey:coachNameKey(team),controlTab:tab,workbookSheet:sn,summaryLookupKey:aa2,lookupKey:k});
    if(i%20===0){ updateProgress(`Extracting ${sheetName} AA2 keys... ${i+1}/${controlRows.length||1}`, start+(end-start)*.45*((i+1)/Math.max(1,controlRows.length))); await yieldToBrowser(); }
  }
  diag.duplicateAA2Keys=[...keyTeams.entries()].filter(([,v])=>v.length>1).map(([k,v])=>`${k}: ${v.join(', ')}`); diag.distinctAA2Keys=keyTeams.size;
  const sumSn=findWorkbookSheetByName(wb,summaryName); if(!sumSn){ diag.missingSummarySheet=true; ds.mappings=mappings; ds.diagnostics=diag; return rebuildTeamTotalsIndex(ds); }
  const aoa=sheetAoa(wb,sumSn), headerRow=aoa[2]||[], headerDefs=teamTotalsHeaderDefinitions(aoa,2), headers=headerDefs.map(d=>d.name), lastNamed=headerDefs.length?Math.max(...headerDefs.map(d=>d.index)):-1;
  for(let c=0;c<lastNamed;c++) if(!String(headerRow[c]??'').trim()) diag.headerGapColumns.push(c+1);
  if(!headers.length || headerDefs[0]?.index!==0) diag.invalidHeaders=true;
  ds.headers=headers;
  const summaryMap=new Map();
  for(let r=3;r<aoa.length;r++){
    const arr=aoa[r]||[], raw=String(arr[0]??'').trim(), k=normalizeTeamTotalLookupKey(raw); if(!k) continue;
    const obj={}; headerDefs.forEach(def=>obj[def.name]=arr[def.index]??'');
    const rec={row:obj,rowNumber:r+1,rawKey:raw}; if(!summaryMap.has(k)) summaryMap.set(k,[]); summaryMap.get(k).push(rec);
  }
  diag.duplicateSummaryRows=[...summaryMap.entries()].filter(([,v])=>v.length>1).map(([k,v])=>{ const chosen=chooseBestTeamTotalsSummaryHit(v,headers); return `${k}: rows ${v.map(x=>x.rowNumber).join(', ')}; using row ${chosen?.rowNumber||''}`; });
  const rowsPerTeam=new Map();
  for(const m of mappings){
    if(!m.lookupKey) continue;
    const hits=summaryMap.get(m.lookupKey)||[];
    if(!hits.length){ diag.aa2KeysNotFound.push(`${m.team} -> ${m.controlTab}: AA2 "${m.summaryLookupKey||'(blank)'}" was not found in ${summaryName} column A`); continue; }
    const hit=chooseBestTeamTotalsSummaryHit(hits,headers); if(!hit) continue;
    const row={...hit.row,_sourceKey:sourceKey,_team:m.team,_teamKey:m.teamKey,_summaryLookupKey:m.summaryLookupKey,_summaryDisplayName:hit.rawKey,_controlTab:m.controlTab,_summarySheet:summaryName,_summaryRowNumber:hit.rowNumber};
    rows.push(row); rowsPerTeam.set(m.teamKey,1);
    if(hits.length>1) diag.teamsWithMultipleExtractedRows.push(`${m.team}: ${hits.length} KPI rows found; row ${hit.rowNumber} selected`);
  }
  diag.summaryRowsMatched=rows.length;
  mappings.forEach(m=>{ if(!rowsPerTeam.has(m.teamKey)) diag.teamsWithNoExtractedRow.push(`${m.team} (${m.controlTab})`); });
  ds.rows=rows; ds.mappings=mappings; ds.diagnostics=diag; return rebuildTeamTotalsIndex(ds);
}
function teamTotalsExportAoa(ds){ ds=normalizeTeamTotalsDataset(ds||emptyTeamTotalsDataset('retail')); const headers=[...(ds.headers||[]),...TEAM_TOTAL_METADATA_HEADERS]; return [headers,...(ds.rows||[]).map(r=>[...(ds.headers||[]).map(h=>r[h]??''),r._team||'',r._controlTab||'',r._summaryLookupKey||'',r._summaryDisplayName||'',r._summarySheet||'',r._summaryRowNumber||''])]; }
function downloadTeamTotals(area){ if(!window.XLSX) return alert('Excel export library is not available.'); const ds=area==='retail'?state.data.retail.teamTotals:state.data.referral.teamTotals; if(!(ds?.rows||[]).length) return alert('No Team Totals dataset is available yet.'); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(teamTotalsExportAoa(ds)),ds.sheetName.slice(0,31)); XLSX.writeFile(wb,ds.fileName||`${ds.sheetName}.xlsx`); }
function renderTeamTotalsImportControls(){ const host=document.getElementById('teamTotalsImportControls'); if(!host) return; host.innerHTML=`<div class="panelTitle">Extracted Team Totals</div><div class="row"><button id="downloadRetailTeamTotalsBtn" class="dark" type="button" ${((state.data.retail.teamTotals?.rows||[]).length?'':'disabled')}>Download Retail Team Totals</button><button id="downloadReferralTeamTotalsBtn" class="dark" type="button" ${((state.data.referral.teamTotals?.rows||[]).length?'':'disabled')}>Download Referral Team Totals</button><span class="checkResultMeta">${esc(teamTotalsSummaryText('retail'))} · ${esc(teamTotalsSummaryText('referral'))}</span></div><div class="checkResultList">${teamTotalsDiagnosticsHtml(state.data.retail.teamTotals)}${teamTotalsDiagnosticsHtml(state.data.referral.teamTotals)}</div>`; document.getElementById('downloadRetailTeamTotalsBtn')?.addEventListener('click',()=>downloadTeamTotals('retail')); document.getElementById('downloadReferralTeamTotalsBtn')?.addEventListener('click',()=>downloadTeamTotals('referral')); }

function sourceAlwaysNonDated(source){ return FORCE_NONDATED_IMPORT_SOURCES.has(source); }
const SOURCE_FRAMEWORKS = {
  generic_table:{label:'Generic Table',mappings:['rep','team','coach','date','week','month','score','numerator','denominator','text','category','uniqueId'],help:'Usable in Research and Metrics. User chooses all fields manually; only header/date parsing is assumed.'},
  stat_file:{label:'Stat File',mappings:['rep','team','coach','date','score','numerator','denominator','category','uniqueId'],help:'One row may contain stats for one rep/team. Supports sum, average, min, max, percent, numerator/denominator, count, and unique count.'},
  weekly_stat_file:{label:'Weekly Stat File',mappings:['rep','team','coach','week','date','score','numerator','denominator','category','uniqueId'],help:'Aggregates repeated representative/team rows across selected date or week ranges, supports weekly trend grouping, and defaults mapped numerator/denominator percentages to weighted totals.'},
  qa_style_file:{label:'QA-Style File',mappings:['rep','team','coach','score','date','assignedDate','category','uniqueId'],help:'Another QA export. Defaults to average score by representative and supports minimum monitor/count rules.'},
  event_coaching_checklist_file:{label:'Event / Coaching / Checklist File',mappings:['rep','team','coach','date','week','month','text','category','uniqueId'],help:'Rows represent events, coaching, checklist records, or notes. Supports phrase counts, contains/not contains, date-aware matching, and text preview.'},
  text_search_conversation_file:{label:'Text Search / Conversation File',mappings:['rep','team','coach','date','text','category','uniqueId'],help:'Large text fields with phrase search, Conversation Viewer, highlighting, preview/export, and row pagination.'}
};
const SOURCE_MAPPING_LABELS = {rep:'Representative column',team:'Team column',coach:'Coach column',date:'Date column',assignedDate:'Assigned date column',week:'Week column',month:'Month column',score:'Score column',numerator:'Numerator column',denominator:'Denominator column',text:'Text / Notes column',category:'Category column',uniqueId:'Unique ID column'};
function frameworkDef(v){ return SOURCE_FRAMEWORKS[v] || SOURCE_FRAMEWORKS.generic_table; }
function sourceFramework(source){ return isCustomSource(source) ? (customSource(source)?.framework || 'generic_table') : ''; }
function sourceIsFramework(source, keys){ return isCustomSource(source) && keys.includes(sourceFramework(source)); }
function isCustomQAStyleSource(source){ return sourceIsFramework(source,['qa_style_file']); }
function isCustomEventLikeSource(source){ return sourceIsFramework(source,['event_coaching_checklist_file','text_search_conversation_file']); }
function isCustomWeeklyStatSource(source){ return sourceIsFramework(source,['weekly_stat_file']); }
function customDateColumn(source){ const c=customSource(source); const cols=c?.columns||{}; if(cols.useDateColumn===false) return ''; return cols.date||cols.week||cols.month||''; }
function sourceFrameworkOptions(selected){ return Object.entries(SOURCE_FRAMEWORKS).map(([k,f])=>`<option value="${k}" ${k===selected?'selected':''}>${esc(f.label)}</option>`).join(''); }
function relevantMappingKeys(source, framework){ return isCustomSource(source) ? frameworkDef(framework||sourceFramework(source)).mappings : []; }
const SOURCE_SETTING_DEFAULTS = {
  retail_sv2:{headerRow:4,startCol:3,columns:{team:'',date:'',useDateColumn:null,skipTeamBuild:false,nameMode:'auto',fullName:'',firstName:'',lastName:'',convertLastFirst:false}},
  retail_wiper:{headerRow:1,startCol:1,columns:{team:'',date:'',useDateColumn:null,skipTeamBuild:false,nameMode:'auto',fullName:'',firstName:'',lastName:'',convertLastFirst:false}},
  referral_sv2:{headerRow:1,startCol:3,columns:{team:'',date:'',useDateColumn:null,skipTeamBuild:true,nameMode:'auto',fullName:'',firstName:'',lastName:'',convertLastFirst:false}},
  referral_wiper:{headerRow:1,startCol:1,columns:{team:'',date:'',useDateColumn:null,skipTeamBuild:false,nameMode:'auto',fullName:'',firstName:'',lastName:'',convertLastFirst:false}},
  qa:{headerRow:1,startCol:1,sheetName:'',manualHeaders:[],columns:{agent:'Agent Name',team:'Team',score:'Score %',interactionDate:'Interaction Start Time',assignedDate:'Assigned Date',date:'Interaction Start Time',useDateColumn:true,skipTeamBuild:false,nameMode:'full',fullName:'Agent Name',firstName:'',lastName:'',convertLastFirst:false}},
  checklist:{headerRow:1,startCol:1,sheetName:'All Items',manualHeaders:[],columns:{rep:'Associate Name',team:'Coach Assigned',date:'',useDateColumn:null,skipTeamBuild:false,nameMode:'full',fullName:'Associate Name',firstName:'',lastName:'',convertLastFirst:false}},
  documented_coaching:{headerRow:1,startCol:1,sheetName:'',manualHeaders:[],columns:{rep:'Associate name',team:'Job Coach',date:'',useDateColumn:null,skipTeamBuild:false,nameMode:'full',fullName:'Associate name',firstName:'',lastName:'',convertLastFirst:false}},
  comp_calls:{headerRow:1,startCol:1,sheetName:'',manualHeaders:[],columns:{rep:'CSR/SSR Name (This is the person being complimented)',team:'CSR Team/Coach',date:'Date of Call',useDateColumn:true,skipTeamBuild:false,text:'Compliment',nameMode:'full',fullName:'CSR/SSR Name (This is the person being complimented)',firstName:'',lastName:'',convertLastFirst:false}}
};
function isCustomSource(source){ return String(source||'').startsWith('custom_'); }
function isCategorizedSource(source){ return CATEGORIZED_SOURCE_KEYS.includes(String(source||'')); }
function categorizedStore(source){ return source===DATED_SOURCE ? state.categorized.dated : state.categorized.nondated; }
function customSource(source){ return (state.customSources||[]).find(c=>c.sourceKey===source); }
function customSourceKeys(){ return (state.customSources||[]).map(c=>c.sourceKey).filter(Boolean); }
function customSourceDefaultSettings(src){ const c=customSource(src)||{}; return {headerRow:c.headerRow||1,startCol:c.startCol||1,sheetName:c.sheetName||'',manualHeaders:c.manualHeaders||[],framework:c.framework||'generic_table',columns:{nameMode:'auto',fullName:'',firstName:'',lastName:'',convertLastFirst:false,useDateColumn:null,skipTeamBuild:false,statPeriod:'week',weekStart:'sunday',dateBasis:'date',...(c.columns||{})}}; }
function isChecklistLikeSource(source){ return source==='checklist' || source==='documented_coaching' || source==='comp_calls'; }
function isDatedRowPullSource(source){ return source===DATED_SOURCE || isChecklistLikeSource(source) || isCustomEventLikeSource(source); }
function rowPullSourceForCriterion(c){ return isDatedRowPullSource(c?.source) ? c.source : 'checklist'; }
function isRowPullCriterion(c){ return !!c && c.calcType!=='displayColumn' && (c.calcType==='checklistCount' || (isDatedRowPullSource(c.source) && c.source!==DATED_SOURCE && c.calcType!=='single')); }
function checklistLikeDefaultDateHeaders(source){
  if(source===DATED_SOURCE) return ['Date','Activity Date','Interaction Date','Created Date','Completed Date','Incident Date'];
  if(source==='comp_calls') return ['Date of Call','Date','Call Date','Completed Date','Created Date'];
  return source==='documented_coaching' ? ['Date','Coaching Date','Created Date','Documented Date','Incident Date'] : ['Incident Date','Date','Date Served','Corrective Date','Created Date'];
}
function checklistLikeRowsState(source){ if(source===DATED_SOURCE) return state.categorized.dated; if(source==='documented_coaching') return state.data.documented_coaching; if(source==='comp_calls') return state.data.comp_calls; if(isCustomSource(source)){ const c=customSource(source)||{}; return {headers:c.headers||[],rows:c.rows||[]}; } return state.data.checklist; }
function clonePlain(obj){return JSON.parse(JSON.stringify(obj||{}));}
