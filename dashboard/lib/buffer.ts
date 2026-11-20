export type BufferPostStatus = "draft" | "needs_approval" | "scheduled" | "sending" | "sent" | "error";

export type BufferQueuePost = {
  id: string;
  text: string;
  status: BufferPostStatus | string;
  dueAt: string | null;
  channelId: string;
  channelName: string;
  service: string;
  bannerUrl: string | null;
  avatarUrl: string | null;
  /** Public profile URL on the social network, when Buffer provides it. */
  profileUrl: string | null;
};

export type BufferQueueSnapshot = {
  status: "ok" | "unconfigured" | "error";
  organizationId?: string;
  organizationName?: string;
  fetchedAt?: string;
  posts: BufferQueuePost[];
  counts?: Record<string, number>;
  message?: string;
};

/** One creative (banner + caption) and its per-channel Buffer outputs. */
export type BufferCreativeGroup = {
  key: string;
  text: string;
  bannerUrl: string | null;
  outlets: BufferQueuePost[];
  nextDueAt: string | null;
};

type GraphqlBody = {
  data?: unknown;
  errors?: { message?: string }[];
};

type AccountPayload = {
  account?: {
    organizations?: { id?: string; name?: string }[];
  };
};

type ChannelsPayload = {
  channels?: {
    id?: string;
    name?: string;
    displayName?: string;
    service?: string;
    avatar?: string;
    externalLink?: string | null;
  }[];
};

type PostsPayload = {
  posts?: {
    edges?: {
      node?: {
        id?: string;
        text?: string;
        status?: string;
        dueAt?: string | null;
        channelId?: string;
        assets?: { thumbnail?: string; source?: string; mimeType?: string; type?: string }[];
      };
    }[];
  };
};

const endpoint = "https://api.buffer.com";
const monitorStatuses: BufferPostStatus[] = ["scheduled", "needs_approval", "error", "draft"];

function apiKey(): string {
  return (process.env.BUFFER_API_KEY ?? "").trim();
}

async function bufferGraphql(query: string, key: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!response) throw new Error("Buffer API tidak terjangkau.");
  const body = (await response.json().catch(() => null)) as GraphqlBody | null;
  if (!response.ok) throw new Error(`Buffer API menolak permintaan (${response.status}).`);
  if (body?.errors?.length) throw new Error(body.errors[0]?.message || "Buffer GraphQL error.");
  return body?.data;
}

function clipText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}

function normalizeBannerKey(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function normalizeCaptionKey(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

/** Same banner = same creative. Tanpa banner, samakan caption yang mirip. */
function creativeKey(post: BufferQueuePost): string {
  const banner = normalizeBannerKey(post.bannerUrl);
  if (banner) return `banner:${banner}`;
  const text = normalizeCaptionKey(post.text);
  if (text) return `text:${text}`;
  return `post:${post.id}`;
}

/** Group Buffer posts that share the same banner design + draft caption. */
export function groupBufferCreatives(posts: BufferQueuePost[]): BufferCreativeGroup[] {
  const groups = new Map<string, BufferCreativeGroup>();

  for (const post of posts) {
    const key = creativeKey(post);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        text: post.text,
        bannerUrl: post.bannerUrl,
        outlets: [post],
        nextDueAt: post.dueAt,
      });
      continue;
    }
    existing.outlets.push(post);
    if (!existing.bannerUrl && post.bannerUrl) existing.bannerUrl = post.bannerUrl;
    if (post.text.length > existing.text.length) existing.text = post.text;
    if (post.dueAt) {
      const next = existing.nextDueAt ? Date.parse(existing.nextDueAt) : Number.POSITIVE_INFINITY;
      const candidate = Date.parse(post.dueAt);
      if (!Number.isNaN(candidate) && candidate < next) existing.nextDueAt = post.dueAt;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      outlets: [...group.outlets].sort((left, right) => {
        const byService = bufferServiceLabel(left.service).localeCompare(bufferServiceLabel(right.service), "id");
        if (byService !== 0) return byService;
        const leftTime = left.dueAt ? Date.parse(left.dueAt) : Number.POSITIVE_INFINITY;
        const rightTime = right.dueAt ? Date.parse(right.dueAt) : Number.POSITIVE_INFINITY;
        return leftTime - rightTime;
      }),
    }))
    .sort((left, right) => {
      const leftTime = left.nextDueAt ? Date.parse(left.nextDueAt) : Number.POSITIVE_INFINITY;
      const rightTime = right.nextDueAt ? Date.parse(right.nextDueAt) : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return right.outlets.length - left.outlets.length;
    });
}

function pickBanner(assets: { thumbnail?: string; source?: string }[] | undefined): string | null {
  for (const asset of assets ?? []) {
    const url = asset.thumbnail || asset.source;
    if (typeof url === "string" && /^https:\/\//i.test(url)) return url;
  }
  return null;
}

function normalizeProfileUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function profileUrlFromHandle(service: string, handle: string): string | null {
  const username = handle.replace(/^@/, "").trim();
  if (!username || /\s/.test(username)) return null;
  const encoded = encodeURIComponent(username);
  const path = {
    instagram: `https://www.instagram.com/${encoded}/`,
    facebook: `https://www.facebook.com/${encoded}`,
    tiktok: `https://www.tiktok.com/@${encoded}`,
    twitter: `https://x.com/${encoded}`,
    x: `https://x.com/${encoded}`,
    linkedin: `https://www.linkedin.com/in/${encoded}`,
    youtube: `https://www.youtube.com/@${encoded}`,
    threads: `https://www.threads.net/@${encoded}`,
    pinterest: `https://www.pinterest.com/${encoded}/`,
  }[service.toLowerCase()];
  return path ?? null;
}

function countByStatus(posts: BufferQueuePost[]): Record<string, number> {
  return posts.reduce<Record<string, number>>((counts, post) => {
    counts[post.status] = (counts[post.status] ?? 0) + 1;
    return counts;
  }, {});
}

export async function fetchBufferQueue(fetchImpl: typeof fetch = fetch): Promise<BufferQueueSnapshot> {
  const key = apiKey();
  if (!key) {
    return {
      status: "unconfigured",
      posts: [],
      counts: {},
      message: "BUFFER_API_KEY belum diisi di dashboard/.env.local.",
    };
  }

  try {
    const account = (await bufferGraphql(
      `query GetOrganizations {
        account {
          organizations { id name }
        }
      }`,
      key,
      fetchImpl,
    )) as AccountPayload;

    const organizations = account.account?.organizations ?? [];
    const preferred = (process.env.BUFFER_ORGANIZATION_ID ?? "").trim();
    const organization = preferred
      ? organizations.find((item) => item.id === preferred)
      : organizations[0];
    if (!organization?.id) {
      return {
        status: "error",
        posts: [],
        counts: {},
        message: preferred
          ? "BUFFER_ORGANIZATION_ID tidak cocok dengan organisasi di akun Buffer."
          : "Akun Buffer tidak memiliki organisasi.",
      };
    }

    const channelsData = (await bufferGraphql(
      `query GetChannels {
        channels(input: { organizationId: "${organization.id}" }) {
          id
          name
          displayName
          service
          avatar
          externalLink
        }
      }`,
      key,
      fetchImpl,
    )) as ChannelsPayload;

    const channelMap = new Map(
      (channelsData.channels ?? [])
        .filter((channel): channel is {
          id: string;
          name?: string;
          displayName?: string;
          service?: string;
          avatar?: string;
          externalLink?: string | null;
        } => Boolean(channel.id))
        .map((channel) => {
          const service = channel.service || "unknown";
          const handle = channel.name || "";
          return [
            channel.id,
            {
              name: channel.displayName || channel.name || channel.id,
              service,
              avatar: typeof channel.avatar === "string" && /^https:\/\//i.test(channel.avatar) ? channel.avatar : null,
              profileUrl:
                normalizeProfileUrl(channel.externalLink) ?? profileUrlFromHandle(service, handle),
            },
          ] as const;
        }),
    );

    const postsData = (await bufferGraphql(
      `query GetMonitorPosts {
        posts(
          first: 60
          input: {
            organizationId: "${organization.id}"
            filter: { status: [${monitorStatuses.join(", ")}] }
            sort: [{ field: dueAt, direction: asc }, { field: createdAt, direction: desc }]
          }
        ) {
          edges {
            node {
              id
              text
              status
              dueAt
              channelId
              assets {
                thumbnail
                mimeType
                source
                type
              }
            }
          }
        }
      }`,
      key,
      fetchImpl,
    )) as PostsPayload;

    const posts = (postsData.posts?.edges ?? [])
      .map((edge) => edge.node)
      .filter((node): node is NonNullable<typeof node> => Boolean(node?.id))
      .map((node) => {
        const channel = channelMap.get(node.channelId ?? "");
        return {
          id: node.id!,
          text: clipText(typeof node.text === "string" ? node.text : ""),
          status: node.status || "unknown",
          dueAt: typeof node.dueAt === "string" ? node.dueAt : null,
          channelId: node.channelId || "",
          channelName: channel?.name || "Kanal tidak dikenal",
          service: channel?.service || "unknown",
          bannerUrl: pickBanner(node.assets),
          avatarUrl: channel?.avatar ?? null,
          profileUrl: channel?.profileUrl ?? null,
        } satisfies BufferQueuePost;
      });

    return {
      status: "ok",
      organizationId: organization.id,
      organizationName: organization.name || organization.id,
      fetchedAt: new Date().toISOString(),
      posts,
      counts: countByStatus(posts),
    };
  } catch (error) {
    return {
      status: "error",
      posts: [],
      counts: {},
      message: error instanceof Error ? error.message : "Gagal membaca Buffer.",
    };
  }
}

export function formatBufferDueAt(value: string | null): string {
  if (!value) return "Tanpa jadwal";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function bufferStatusLabel(status: string): string {
  return (
    {
      draft: "Draf",
      needs_approval: "Menunggu persetujuan",
      scheduled: "Terjadwal",
      sending: "Mengirim",
      sent: "Terkirim",
      error: "Gagal",
    }[status] ?? status
  );
}

export function bufferServiceLabel(service: string): string {
  const key = service.toLowerCase();
  return (
    {
      instagram: "Instagram",
      facebook: "Facebook",
      tiktok: "TikTok",
      twitter: "X",
      x: "X",
      linkedin: "LinkedIn",
      youtube: "YouTube",
      threads: "Threads",
      pinterest: "Pinterest",
      googlebusiness: "Google Bisnis",
    }[key] ?? (service ? service.charAt(0).toUpperCase() + service.slice(1) : "Kanal")
  );
}
