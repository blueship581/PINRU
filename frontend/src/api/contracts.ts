import type {
  ChatMessage,
  ChatSession,
  SendMessageRequest,
  SendMessageResponse,
  SessionWithMessages,
} from './chat';
import type { PollOutputResponse, SkillItem, StartClaudeRequest, StartClaudeResponse } from './cli';
import type {
  GitHubAccountConfig,
  GitLabSettings,
  ProjectConfig,
  TraeSettings,
} from './config';
import type {
  DirectoryInspectionResult,
  GitLabProject,
  GitLabProjectLookupResult,
  ManagedClaimPathPlan,
  NormalizeManagedSourceFoldersResult,
} from './git';
import type {
  BackgroundJob,
  JobFilter,
  SubmitJobRequest,
} from './job';
import type {
  GeneratePromptRequest,
  LlmProviderConfig,
  PolishTextRequest,
  PolishTextResult,
  PromptGenerationResult,
} from './llm';
import type {
  PublishSourceRepoRequest,
  PublishSourceRepoResult,
  SubmitAllRequest,
  SubmitAllResult,
  SubmitModelRunRequest,
  SubmitModelRunResult,
} from './submit';
import type {
  AiReviewNodeFromDB,
  AiReviewRoundFromDB,
  AddModelRunRequest,
  BatchUpdateResult,
  BatchUpdateTasksRequest,
  CreateTaskRequest,
  ExtractTaskSessionsResult,
  ModelRunFromDB,
  TaskChildDirectory,
  TaskFromDB,
  UpdateModelRunRequest,
  UpdateModelRunSessionRequest,
  UpdateTaskReportFieldsRequest,
  UpdateTaskSessionListRequest,
} from './task';

type ServiceMethod<Args extends unknown[], Result> = {
  args: Args;
  result: Result;
};

export type WailsServiceContract = {
  ChatService: {
    CreateSession: ServiceMethod<[request: { taskId: string; model: string }], ChatSession>;
    ListSessions: ServiceMethod<[taskId: string, model: string], ChatSession[]>;
    GetSessionWithMessages: ServiceMethod<[sessionId: string], SessionWithMessages>;
    RenameSession: ServiceMethod<[sessionId: string, title: string], void>;
    DeleteSession: ServiceMethod<[sessionId: string], void>;
    SendMessage: ServiceMethod<[request: SendMessageRequest], SendMessageResponse>;
    GetMessage: ServiceMethod<[messageId: string], ChatMessage>;
    SaveMessageAsPrompt: ServiceMethod<[taskId: string, messageId: string], void>;
  };
  CliService: {
    CheckCLI: ServiceMethod<[], string>;
    StartClaude: ServiceMethod<[request: StartClaudeRequest], StartClaudeResponse>;
    PollOutput: ServiceMethod<[request: { sessionId: string; offset: number }], PollOutputResponse>;
    CancelSession: ServiceMethod<[sessionId: string], void>;
    ListSkills: ServiceMethod<[], SkillItem[]>;
  };
  ConfigService: {
    GetConfig: ServiceMethod<[key: string], string>;
    SetConfig: ServiceMethod<[key: string, value: string], void>;
    TestGitLabConnection: ServiceMethod<[url: string, token: string], boolean>;
    TestGitHubConnection: ServiceMethod<[username: string, token: string], boolean>;
    TestGitHubAccountConnection: ServiceMethod<
      [id: string, username: string, token: string],
      boolean
    >;
    GetGitLabSettings: ServiceMethod<[], GitLabSettings>;
    SaveGitLabSettings: ServiceMethod<[url: string, username: string, token: string], void>;
    ListProjects: ServiceMethod<[], ProjectConfig[]>;
    CreateProject: ServiceMethod<[project: ProjectConfig], void>;
    UpdateProject: ServiceMethod<[project: ProjectConfig], void>;
    DeleteProject: ServiceMethod<[id: string], void>;
    ConsumeProjectQuota: ServiceMethod<[projectId: string, taskType: string], void>;
    ListLLMProviders: ServiceMethod<[], LlmProviderConfig[]>;
    CreateLLMProvider: ServiceMethod<[provider: LlmProviderConfig], void>;
    UpdateLLMProvider: ServiceMethod<[provider: LlmProviderConfig], void>;
    DeleteLLMProvider: ServiceMethod<[id: string], void>;
    ListGitHubAccounts: ServiceMethod<[], GitHubAccountConfig[]>;
    CreateGitHubAccount: ServiceMethod<[account: GitHubAccountConfig], void>;
    UpdateGitHubAccount: ServiceMethod<[account: GitHubAccountConfig], void>;
    DeleteGitHubAccount: ServiceMethod<[id: string], void>;
    GetTraeSettings: ServiceMethod<[], TraeSettings>;
    SaveTraeSettings: ServiceMethod<[workspaceStoragePath: string, logsPath: string], void>;
  };
  GitService: {
    FetchGitLabProject: ServiceMethod<[projectRef: string, url: string, token: string], GitLabProject>;
    FetchGitLabProjects: ServiceMethod<
      [projectRefs: string[], url: string, token: string],
      GitLabProjectLookupResult[]
    >;
    FetchConfiguredGitLabProjects: ServiceMethod<
      [projectRefs: string[]],
      GitLabProjectLookupResult[]
    >;
    CloneProject: ServiceMethod<
      [cloneUrl: string, path: string, username: string, token: string],
      void
    >;
    CloneConfiguredProject: ServiceMethod<[cloneUrl: string, path: string], void>;
    DownloadGitLabProject: ServiceMethod<
      [projectId: number, url: string, token: string, destination: string, sha: string | null],
      void
    >;
    CopyProjectDirectory: ServiceMethod<[sourcePath: string, destinationPath: string], void>;
    CheckPathsExist: ServiceMethod<[paths: string[]], string[]>;
    InspectDirectory: ServiceMethod<[path: string], DirectoryInspectionResult>;
    PlanManagedClaimPaths: ServiceMethod<
      [
        basePath: string,
        projectName: string,
        projectId: number,
        taskType: string,
        count: number,
        projectConfigId: string,
      ],
      ManagedClaimPathPlan[]
    >;
    NormalizeManagedSourceFolders: ServiceMethod<
      [projectId: string],
      NormalizeManagedSourceFoldersResult
    >;
  };
  PromptService: {
    TestLLMProvider: ServiceMethod<[provider: LlmProviderConfig], boolean>;
    GenerateTaskPrompt: ServiceMethod<[request: GeneratePromptRequest], PromptGenerationResult>;
    SaveTaskPrompt: ServiceMethod<[taskId: string, promptText: string], void>;
    PolishText: ServiceMethod<[request: PolishTextRequest], PolishTextResult>;
  };
  SubmitService: {
    PublishSourceRepo: ServiceMethod<[request: PublishSourceRepoRequest], PublishSourceRepoResult>;
    SubmitModelRun: ServiceMethod<[request: SubmitModelRunRequest], SubmitModelRunResult>;
    SubmitAll: ServiceMethod<[request: SubmitAllRequest], SubmitAllResult>;
  };
  JobService: {
    SubmitJob: ServiceMethod<[request: SubmitJobRequest], BackgroundJob>;
    ListJobs: ServiceMethod<[filter: JobFilter | null], BackgroundJob[]>;
    GetJob: ServiceMethod<[id: string], BackgroundJob | null>;
    RetryJob: ServiceMethod<[id: string], BackgroundJob>;
    CancelJob: ServiceMethod<[id: string], void>;
    DeleteAiReviewJob: ServiceMethod<[id: string], void>;
  };
  TaskService: {
    ListTasks: ServiceMethod<[projectConfigId: string | null], TaskFromDB[]>;
    GetTask: ServiceMethod<[id: string], TaskFromDB | null>;
    ListModelRuns: ServiceMethod<[taskId: string], ModelRunFromDB[]>;
    ListAiReviewNodes: ServiceMethod<[taskId: string], AiReviewNodeFromDB[]>;
    ListAiReviewRounds: ServiceMethod<[taskId: string], AiReviewRoundFromDB[]>;
    ListTaskChildDirectories: ServiceMethod<[taskId: string], TaskChildDirectory[]>;
    CreateTask: ServiceMethod<[task: CreateTaskRequest], TaskFromDB>;
    UpdateTaskStatus: ServiceMethod<[id: string, status: string], void>;
    UpdateTaskType: ServiceMethod<[id: string, taskType: string], void>;
    UpdateTaskSessionList: ServiceMethod<[request: UpdateTaskSessionListRequest], void>;
    ExtractTaskSessions: ServiceMethod<[taskId: string], ExtractTaskSessionsResult>;
    UpdateModelRun: ServiceMethod<[request: UpdateModelRunRequest], void>;
    DeleteTask: ServiceMethod<[id: string], void>;
    OpenTaskLocalFolder: ServiceMethod<[id: string], void>;
    UpdateModelRunSessionInfo: ServiceMethod<[request: UpdateModelRunSessionRequest], void>;
    AddModelRun: ServiceMethod<[request: AddModelRunRequest], void>;
    DeleteModelRun: ServiceMethod<[taskId: string, modelName: string], void>;
    UpdateTaskReportFields: ServiceMethod<[request: UpdateTaskReportFieldsRequest], void>;
    BatchUpdateTasks: ServiceMethod<[request: BatchUpdateTasksRequest], BatchUpdateResult>;
    BatchDeleteTasks: ServiceMethod<[taskIds: string[]], BatchUpdateResult>;
    SaveAiReviewRoundNotes: ServiceMethod<[roundID: string, reviewNotes: string, nextPrompt: string], void>;
  };
};
