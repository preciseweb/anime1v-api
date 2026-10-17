const axios = require("axios");
const { URL } = require("node:url");
const { ApiError } = require("../utils/api-error");
const { normalizeVariant, filterServerLinks, addServerLink } = require("../utils/episode-links");

const DEFAULT_DOMAIN = "hentaila.com";

const HTTP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// SvelteKit stores nested objects and arrays as references into one value table.
function decodeNodeData(values) {
  const decoded = new Map();
  function resolve(index) {
    if (!Number.isInteger(index) || index < 0 || index >= values.length) return null;
    if (decoded.has(index)) return decoded.get(index);
    const value = values[index];
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value) && value[0] === "Date") return value[1];

    const result = Array.isArray(value) ? [] : {};
    decoded.set(index, result);
    for (const [key, reference] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        value: resolve(reference), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  }
  return resolve(0);
}

function parseSvelteKitNodes(nodes) {
  if (!Array.isArray(nodes)) {
    return [];
  }

  const results = [];
  for (const node of nodes) {
    if (!node || node.type !== "data" || !Array.isArray(node.data) || node.data.length === 0) {
      results.push(null);
      continue;
    }

    const schema = node.data[0];
    const values = node.data;

    if (typeof schema === "object" && schema !== null) {
      results.push({ schema, values, decoded: decodeNodeData(values) });
    } else {
      results.push(null);
    }
  }

  return results;
}

function resolveNodeValue(nodeData, schemaKey) {
  if (!nodeData || !nodeData.schema || !Array.isArray(nodeData.values)) {
    return null;
  }

  const idx = nodeData.schema[schemaKey];
  if (typeof idx === "number" && idx >= 0 && idx < nodeData.values.length) {
    return nodeData.values[idx];
  }

  return null;
}

function resolveItemFromData(dataValues, schemaIndex) {
  const itemSchema = dataValues[schemaIndex];
  if (!itemSchema || typeof itemSchema !== "object") {
    return null;
  }

  const item = {};
  for (const [key, valueIdx] of Object.entries(itemSchema)) {
    if (typeof valueIdx === "number" && valueIdx < dataValues.length) {
      item[key] = dataValues[valueIdx];
    }
  }

  return item;
}

function resolveResultsArray(dataValues, refsArray) {
  if (!Array.isArray(refsArray)) {
    return [];
  }

  return refsArray
    .map((idx) => resolveItemFromData(dataValues, idx))
    .filter(Boolean);
}

async function fetchJson(url) {
  try {
    const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
    const response = await axios.get(url, {
      timeout,
      headers: HTTP_HEADERS,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    return response.data;
  } catch (error) {
    throw new ApiError(500, "No se pudo obtener contenido desde HentaiLA", error.message);
  }
}

function parseEpisodeNumber(value) {
  return /^\d+(?:\.\d+)?$/.test(String(value)) ? Number(value) : null;
}

function parseAnimeUrl(url, baseUrl) {
  try {
    const parsed = new URL(url, baseUrl);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments[segments.length - 1] === "__data.json") segments.pop();
    if (segments[0] === "media" && (segments.length === 2 || segments.length === 3)) {
      const episode = segments.length === 3 ? parseEpisodeNumber(segments[2]) : null;
      if (segments.length === 3 && episode === null) return null;
      return { slug: segments[1], episode };
    }
    if (segments[0] === "ver" && segments.length === 2) {
      const match = segments[1].match(/^(.*)-(\d+(?:\.\d+)?)$/);
      if (match && match[1]) return { slug: match[1], episode: Number(match[2]) };
    }
  } catch (_) {
    // Unsupported or malformed URLs have no reliable anime identity.
  }
  return null;
}

function parseMediaFromNode(nodeData, slug) {
  const visited = new Set();
  function find(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || visited.has(value)) return null;
    visited.add(value);
    // Follow page data and the named media object, never recommendations or layout objects.
    const nested = find(value.media) || find(value.data);
    if (nested) return nested;
    return value.slug === slug && (value.title || Array.isArray(value.episodes)) ? value : null;
  }
  return find(nodeData && nodeData.decoded);
}

function buildEpisodesList(mediaData) {
  if (!mediaData || !Array.isArray(mediaData.episodes)) return [];
  const slug = mediaData.slug;
  const episodes = new Map();
  for (const entry of mediaData.episodes) {
    const ep = typeof entry === "number" ? { number: entry } : entry;
    if (!ep || typeof ep !== "object") continue;
    const number = parseEpisodeNumber(ep.number);
    if (number === null) continue;
    if (ep.media && ep.media.slug && ep.media.slug !== slug) continue;
    if (ep.mediaId != null && mediaData.id != null && String(ep.mediaId) !== String(mediaData.id)) continue;
    if (ep.url) {
      const identity = parseAnimeUrl(ep.url, `https://${DEFAULT_DOMAIN}`);
      if (!identity || identity.slug !== slug || identity.episode !== number) continue;
    }
    const existing = episodes.get(number);
    if (!existing || (existing.id === null && ep.id != null)) {
      episodes.set(number, {
        id: ep.id ?? null,
        number,
        title: `Episodio ${number}`,
        url: `https://${DEFAULT_DOMAIN}/media/${slug}/${number}`,
      });
    }
  }
  return [...episodes.values()].sort((a, b) => a.number - b.number);
}

function findEpisodeNodes(parsedNodes, slug, episodeNumber) {
  const candidates = [];
  const invalidNodes = new Set();
  const mediaIds = new Set();
  function findMediaId(value, visited) {
    if (!value || typeof value !== "object" || Array.isArray(value) || visited.has(value)) return;
    visited.add(value);
    if (value.media && value.media.slug === slug && value.media.id != null) {
      mediaIds.add(String(value.media.id));
    }
    findMediaId(value.episode, visited);
    findMediaId(value.data, visited);
  }
  for (const node of parsedNodes) {
    if (node) findMediaId(node.decoded, new Set());
  }
  const knownMediaId = mediaIds.size === 1 ? [...mediaIds][0] : null;
  function visit(value, context, visited, nodeIndex) {
    if (!value || typeof value !== "object" || Array.isArray(value) || visited.has(value)) return;
    visited.add(value);
    const nestedEpisode = value.episode && typeof value.episode === "object" ? value.episode : null;
    const media = value.media || (nestedEpisode && nestedEpisode.media);
    const mediaSlug = (media && media.slug) || value.mediaSlug || value.animeSlug || context.slug;
    const rawNumber = value.number ?? value.episodeNumber ?? (nestedEpisode && nestedEpisode.number) ??
      (typeof value.episode === "number" ? value.episode : context.number);
    const number = rawNumber == null ? null : parseEpisodeNumber(rawNumber);
    const mediaId = media && media.id != null ? String(media.id) : context.mediaId;
    const ownerIds = [value.mediaId, nestedEpisode && nestedEpisode.mediaId];
    if ((mediaSlug && mediaSlug !== slug) ||
        (rawNumber != null && number !== episodeNumber) ||
        (value.slug && value.slug !== slug && value.slug !== `${slug}-${episodeNumber}`) ||
        (mediaId != null && context.mediaId != null && mediaId !== context.mediaId) ||
        (mediaId != null && ownerIds.some((id) => id != null && String(id) !== mediaId))) {
      // An invalid child also invalidates links attached to its ancestor wrapper.
      invalidNodes.add(nodeIndex);
      return;
    }

    const identity = { slug: mediaSlug || (value.slug ? slug : null), number, mediaId };
    if (value.embeds || value.downloads) {
      candidates.push({ decoded: value, nodeIndex, score: Number(Boolean(identity.slug)) + Number(number !== null) });
    }
    visit(nestedEpisode, identity, visited, nodeIndex);
    visit(value.data, identity, visited, nodeIndex);
  }
  for (const [index, node] of parsedNodes.entries()) {
    if (node) visit(node.decoded, { mediaId: knownMediaId }, new Set(), index);
  }
  const lastDataIndex = parsedNodes.reduce((last, node, index) => node ? index : last, -1);
  return candidates.filter((candidate) => !invalidNodes.has(candidate.nodeIndex) &&
    (candidate.score > 0 || candidate.nodeIndex === lastDataIndex));
}

function parseLinksFromNodes(nodes, field, baseUrl) {
  const result = { SUB: [], DUB: [] };
  const fieldNodes = nodes.filter((node) => node.decoded[field]);
  const bestScore = Math.max(-1, ...fieldNodes.map((node) => node.score));
  const lastIndex = Math.max(-1, ...fieldNodes.map((node) => node.nodeIndex));
  // Layout data may expose generic links. Prefer identified episode data; if the
  // route omits identity, only its deepest data node is a reliable fallback.
  const selectedIndexes = new Set(fieldNodes.filter((node) => node.score === bestScore &&
    (bestScore > 0 || node.nodeIndex === lastIndex)).map((node) => node.nodeIndex));
  // One route node can split SUB and DUB between its wrapper and episode object.
  const selected = fieldNodes.filter((node) => selectedIndexes.has(node.nodeIndex));
  function collect(value, variant, visited) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const entry of value) collect(entry, variant, visited);
    } else if (typeof value.url === "string") {
      const language = normalizeVariant(value.lang || value.language || value.variant, variant);
      const server = value.server || (field === "downloads" ? "Download" : "Unknown");
      addServerLink(result, language, server, value.url, baseUrl,
        field === "downloads" ? value.quality || server : null);
    } else {
      for (const [key, entries] of Object.entries(value)) {
        collect(entries, normalizeVariant(key, variant), visited);
      }
    }
    // A referenced group can legitimately be present under both SUB and DUB.
    visited.delete(value);
  }
  for (const node of selected) collect(node.decoded[field], "SUB", new Set());
  return result;
}

// Public API

async function searchAnime(query, domainCandidate) {
  const cleanQuery = (query || "").toString().trim();
  if (!cleanQuery) {
    throw new ApiError(400, "Se requiere el parametro q");
  }

  const domain = (domainCandidate || DEFAULT_DOMAIN).toString().trim();
  const searchUrl = `https://${domain}/catalogo/__data.json?search=${encodeURIComponent(cleanQuery)}`;
  const data = await fetchJson(searchUrl);

  const parsedNodes = parseSvelteKitNodes(data.nodes);
  const catalogNode = parsedNodes && parsedNodes.length > 2 ? parsedNodes[2] : null;

  let results = [];
  if (catalogNode) {
    const rawResults = resolveNodeValue(catalogNode, "results");
    if (Array.isArray(rawResults)) {
      results = resolveResultsArray(catalogNode.values, rawResults)
        .filter((item) => item && item.title)
        .map((item) => ({
          id: item.id || null,
          title: item.title,
          slug: item.slug || null,
          url: `https://${domain}/media/${item.slug}`,
          image: item.id ? `https://cdn.hentaila.com/covers/${item.id}.jpg` : null,
          backdrop: null,
          type: item.category ? item.category.name : null,
          score: item.score || null,
          status: item.status || null,
          year: null,
        }));
    }
  }

  return {
    success: true,
    data: {
      query: cleanQuery,
      results,
      count: results.length,
    },
    source: "hentaila",
  };
}

async function getAnimeInfo(urlCandidate) {
  const identity = parseAnimeUrl(urlCandidate);
  if (!identity) {
    throw new ApiError(400, "URL invalida");
  }
  const { slug } = identity;

  const apiUrl = `https://${DEFAULT_DOMAIN}/media/${slug}/__data.json`;
  const data = await fetchJson(apiUrl);

  const parsedNodes = parseSvelteKitNodes(data.nodes);
  const mediaData = parsedNodes.map((node) => parseMediaFromNode(node, slug))
    .filter(Boolean).sort((a, b) => Number(Array.isArray(b.episodes)) - Number(Array.isArray(a.episodes)))[0];
  if (!mediaData) {
    throw new ApiError(404, "Anime no encontrado en HentaiLA");
  }
  const episodes = buildEpisodesList(mediaData);

  return {
    success: true,
    data: {
      id: mediaData.id || null,
      title: mediaData.title,
      titleJapanese: null,
      description: mediaData.synopsis || null,
      image: mediaData.id ? `https://cdn.hentaila.com/covers/${mediaData.id}.jpg` : null,
      backdrop: null,
      status: null,
      type: mediaData.category ? mediaData.category.name : null,
      year: mediaData.startDate ? String(mediaData.startDate).split("-")[0] : null,
      startDate: mediaData.startDate || null,
      endDate: null,
      score: mediaData.score || null,
      votes: mediaData.votes || null,
      totalEpisodes: episodes.length,
      malId: mediaData.malId || null,
      trailer: null,
      genres: Array.isArray(mediaData.genres)
        ? mediaData.genres.map((g) => ({
            id: g.id || null,
            name: g.name,
            slug: g.slug || g.name.toLowerCase().replace(/\s+/g, "-"),
            malId: g.malId || null,
          }))
        : [],
      episodes,
    },
    source: "hentaila",
  };
}

async function getEpisodeLinks(urlCandidate, includeMega = "false", excludeServers = "") {
  const identity = parseAnimeUrl(urlCandidate);
  if (!identity || identity.episode === null) {
    throw new ApiError(400, "URL invalida - no se pudo extraer slug y numero de episodio");
  }
  const { slug, episode: episodeNumber } = identity;

  const apiUrl = `https://${DEFAULT_DOMAIN}/media/${slug}/${episodeNumber}/__data.json`;
  const data = await fetchJson(apiUrl);

  const parsedNodes = parseSvelteKitNodes(data.nodes);

  const episodeNodes = findEpisodeNodes(parsedNodes, slug, episodeNumber);
  const embeds = parseLinksFromNodes(episodeNodes, "embeds", urlCandidate);
  const downloads = parseLinksFromNodes(episodeNodes, "downloads", urlCandidate);
  for (const variant of ["SUB", "DUB"]) {
    embeds[variant] = filterServerLinks(embeds[variant], includeMega, excludeServers);
    downloads[variant] = filterServerLinks(downloads[variant], includeMega, excludeServers);
  }
  const epData = episodeNodes.slice().sort((a, b) => b.score - a.score)
    .map((node) => node.decoded).find((value) => value.title);

  return {
    success: true,
    data: {
      id: null,
      episode: episodeNumber,
      title: epData ? epData.title : `Episodio ${episodeNumber}`,
      season: null,
      variants: {
        SUB: embeds.SUB.length > 0 || downloads.SUB.length > 0 ? 1 : 0,
        DUB: embeds.DUB.length > 0 || downloads.DUB.length > 0 ? 1 : 0,
      },
      publishedAt: null,
      servers: {
        sub: embeds.SUB.map((l) => ({ server: l.server, url: l.url })),
        dub: embeds.DUB.map((l) => ({ server: l.server, url: l.url })),
      },
      streamLinks: {
        SUB: embeds.SUB.map((l) => ({ server: l.server, url: l.url })),
        DUB: embeds.DUB.map((l) => ({ server: l.server, url: l.url })),
      },
      downloadLinks: {
        SUB: downloads.SUB.map((l) => ({
          server: l.server,
          url: l.url,
          quality: l.quality || l.server,
        })),
        DUB: downloads.DUB.map((l) => ({
          server: l.server,
          url: l.url,
          quality: l.quality || l.server,
        })),
      },
    },
    source: "hentaila",
  };
}

module.exports = {
  searchAnime,
  getAnimeInfo,
  getEpisodeLinks,
};
