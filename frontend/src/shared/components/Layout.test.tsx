import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "./Layout";
import { MsgDirNotEmpty } from "../constants/messages";

const openFileMock = vi.fn();
const inspectDirectoryMock = vi.fn();
const getProjectsMock = vi.fn(async () => []);
const createProjectMock = vi.fn(async (_project?: unknown) => undefined);
const deleteProjectMock = vi.fn(async (_id?: string) => undefined);
const setActiveProjectIdMock = vi.fn(async (_projectId?: string) => undefined);
const unlockAiReviewMock = vi.fn();
const loadActiveProjectMock = vi.fn();
const resetForNewProjectMock = vi.fn(async () => undefined);

vi.mock("@wailsio/runtime", () => ({
  Dialogs: {
    OpenFile: (...args: unknown[]) => openFileMock(...args),
  },
}));

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      theme: "light",
      aiReviewVisible: false,
      unlockAiReview: unlockAiReviewMock,
      activeProject: null,
      loadActiveProject: loadActiveProjectMock,
      resetForNewProject: resetForNewProjectMock,
    }),
}));

vi.mock("../../api/git", () => ({
  inspectDirectory: (path: string) => inspectDirectoryMock(path),
}));

vi.mock("../../api/config", () => ({
  createNewProjectTaskSettings: () => ({
    taskTypes: ["Bug修复"],
    quotas: { Bug修复: 0 },
    totals: { Bug修复: 0 },
  }),
  createProject: (project: unknown) => createProjectMock(project),
  deleteProject: (id: string) => deleteProjectMock(id),
  getProjects: () => getProjectsMock(),
  serializeProjectModels: (models: string[]) => models.join("\n"),
  serializeProjectTaskSettings: () => ({
    taskTypes: '["Bug修复"]',
    taskTypeQuotas: '{"Bug修复":0}',
    taskTypeTotals: '{"Bug修复":0}',
  }),
  setActiveProjectId: (projectId: string) => setActiveProjectIdMock(projectId),
}));

vi.mock("./BackgroundJobPanel", () => ({
  default: () => <div data-testid="background-job-panel" />,
}));

vi.mock("./TaskTypeQuotaEditor", () => ({
  default: () => <div data-testid="task-type-quota-editor" />,
}));

describe("Layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectsMock.mockResolvedValue([]);
    openFileMock.mockResolvedValue("/tmp/non-empty-project");
    inspectDirectoryMock.mockResolvedValue({
      path: "/tmp/non-empty-project",
      name: "non-empty-project",
      exists: true,
      isDir: true,
      isEmpty: false,
    });
  });

  it("shows a visible alert when the selected project directory is not empty", async () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTitle("新建项目"));
    fireEvent.click(screen.getByRole("button", { name: "浏览" }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(MsgDirNotEmpty);
    expect(openFileMock).toHaveBeenCalledTimes(1);
    expect(inspectDirectoryMock).toHaveBeenCalledWith("/tmp/non-empty-project");
  });
});
