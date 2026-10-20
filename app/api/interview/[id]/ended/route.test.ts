import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserId } from "@/lib/auth";
import { markInterviewEnded } from "@/lib/database/interview";
import { UnauthorizedError } from "@/lib/error/errors";
import { POST } from "./route";

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/database/interview", () => ({ markInterviewEnded: vi.fn() }));

const INTERVIEW_ID = "3f2b8c1e-8a4d-4c2e-9b1a-2d3e4f5a6b7c";

async function post(body: BodyInit | null, contentType = "application/json") {
  const response = await POST(
    new Request(`http://localhost/api/interview/${INTERVIEW_ID}/ended`, {
      method: "POST",
      headers: body === null ? {} : { "content-type": contentType },
      body,
    }),
    { params: Promise.resolve({ id: INTERVIEW_ID }) },
  );
  return { status: response.status, body: (await response.json()) as unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  vi.mocked(requireUserId).mockResolvedValue("user_1");
  vi.mocked(markInterviewEnded).mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/interview/[id]/ended", () => {
  it("records the end of the call once, with the SDK's reason in the log only", async () => {
    expect(await post(JSON.stringify({ reason: "agent" }))).toEqual({
      status: 200,
      body: { ok: true, data: { recorded: true } },
    });
    expect(markInterviewEnded).toHaveBeenCalledWith({
      interviewId: INTERVIEW_ID,
      endedAt: new Date("2026-10-13T12:00:00Z"),
    });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("reason=agent recorded=true"));
  });

  it("answers recorded=false when there was nothing to write, as for a second report", async () => {
    vi.mocked(markInterviewEnded).mockResolvedValue(false);

    expect(await post(JSON.stringify({ reason: "user" }))).toEqual({
      status: 200,
      body: { ok: true, data: { recorded: false } },
    });
  });

  it("tolerates an empty or non-JSON body: the reason is for the log", async () => {
    expect((await post(null)).status).toBe(200);
    expect((await post("not json", "text/plain")).status).toBe(200);
    expect(markInterviewEnded).toHaveBeenCalledTimes(2);
  });

  it("rejects a reason that is not a short string, and a signed-out caller", async () => {
    expect((await post(JSON.stringify({ reason: "x".repeat(41) }))).status).toBe(400);
    expect(markInterviewEnded).not.toHaveBeenCalled();

    vi.mocked(requireUserId).mockRejectedValue(new UnauthorizedError());
    expect(await post(JSON.stringify({ reason: "user" }))).toEqual({
      status: 401,
      body: { ok: false, code: "UNAUTHORIZED" },
    });
  });
});
