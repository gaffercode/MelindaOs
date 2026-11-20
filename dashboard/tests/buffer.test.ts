import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bufferStatusLabel,
  fetchBufferQueue,
  formatBufferDueAt,
  groupBufferCreatives,
  type BufferQueuePost,
} from "@/lib/buffer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Buffer queue reader", () => {
  it("reports unconfigured when the API key is missing", async () => {
    vi.stubEnv("BUFFER_API_KEY", "");
    const snapshot = await fetchBufferQueue(vi.fn() as unknown as typeof fetch);
    expect(snapshot.status).toBe("unconfigured");
    expect(snapshot.posts).toEqual([]);
  });

  it("maps organizations, channels, and monitor posts", async () => {
    vi.stubEnv("BUFFER_API_KEY", "test-key");
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const query = String(JSON.parse(String(init?.body)).query);
      if (query.includes("GetOrganizations")) {
        return Response.json({
          data: { account: { organizations: [{ id: "org-1", name: "RSIA Melinda" }] } },
        });
      }
      if (query.includes("GetChannels")) {
        return Response.json({
          data: {
            channels: [{
              id: "ch-1",
              name: "rsia.melinda",
              displayName: "Instagram RSIA",
              service: "instagram",
              avatar: "https://buffer-channel-avatars-bucket.s3.amazonaws.com/a.jpg",
              externalLink: "instagram.com/rsia.melinda",
            }],
          },
        });
      }
      return Response.json({
        data: {
          posts: {
            edges: [
              {
                node: {
                  id: "post-1",
                  text: "Cek jadwal imunisasi minggu ini.",
                  status: "scheduled",
                  dueAt: "2026-10-25T03:00:00.000Z",
                  channelId: "ch-1",
                  assets: [{ thumbnail: "https://cdn.example.com/banner.jpg", source: "https://cdn.example.com/full.jpg", type: "image" }],
                },
              },
            ],
          },
        },
      });
    }) as unknown as typeof fetch;

    const snapshot = await fetchBufferQueue(fetchImpl);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.organizationName).toBe("RSIA Melinda");
    expect(snapshot.posts).toHaveLength(1);
    expect(snapshot.counts?.scheduled).toBe(1);
    expect(snapshot.posts[0]).toMatchObject({
      id: "post-1",
      channelName: "Instagram RSIA",
      service: "instagram",
      status: "scheduled",
      bannerUrl: "https://cdn.example.com/banner.jpg",
      avatarUrl: "https://buffer-channel-avatars-bucket.s3.amazonaws.com/a.jpg",
      profileUrl: "https://instagram.com/rsia.melinda",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("labels statuses and formats WIB times", () => {
    expect(bufferStatusLabel("needs_approval")).toBe("Menunggu persetujuan");
    expect(formatBufferDueAt("2026-10-25T03:00:00.000Z")).toMatch(/25/);
    expect(formatBufferDueAt(null)).toBe("Tanpa jadwal");
  });

  it("groups the same banner design and draft across social outlets", () => {
    const banner = "https://cdn.example.com/banner.jpg?v=1";
    const posts: BufferQueuePost[] = [
      {
        id: "p1",
        text: "Imunisasi minggu ini. #rsia",
        status: "scheduled",
        dueAt: "2026-10-26T03:00:00.000Z",
        channelId: "ig",
        channelName: "IG",
        service: "instagram",
        bannerUrl: banner,
        avatarUrl: null,
        profileUrl: "https://www.instagram.com/rsia/",
      },
      {
        id: "p2",
        text: "Imunisasi minggu ini.",
        status: "draft",
        dueAt: null,
        channelId: "tt",
        channelName: "TT",
        service: "tiktok",
        bannerUrl: "https://cdn.example.com/banner.jpg?v=2",
        avatarUrl: null,
        profileUrl: "https://www.tiktok.com/@rsia",
      },
      {
        id: "p3",
        text: "Konten lain.",
        status: "scheduled",
        dueAt: "2026-10-25T03:00:00.000Z",
        channelId: "fb",
        channelName: "FB",
        service: "facebook",
        bannerUrl: "https://cdn.example.com/other.jpg",
        avatarUrl: null,
        profileUrl: null,
      },
    ];

    const groups = groupBufferCreatives(posts);
    expect(groups).toHaveLength(2);
    expect(groups[0].text).toBe("Konten lain.");
    expect(groups[1].outlets).toHaveLength(2);
    expect(groups[1].outlets.map((outlet) => outlet.service).sort()).toEqual(["instagram", "tiktok"]);
  });
});

