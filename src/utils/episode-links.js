// Keep language classification explicit: an unknown server label does not imply dubbing.
function normalizeVariant(value, fallback = "SUB") {
  const token = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\b(?:sub|subbed|subtitled|subtitulado?s?|japones|japanese|jp|jap)\b/.test(token)) return "SUB";
  if (/\b(?:dub|dubbed|doblado?s?|doblaje|latino|latam|espanol|spanish|castellano|lat|esp|es|en|eng|english)\b/.test(token)) return "DUB";
  return fallback;
}

function filterServerLinks(links, includeMega, excludeServers) {
  const tokens = (Array.isArray(excludeServers) ? excludeServers : String(excludeServers || "").split(","))
    .map((value) => String(value).trim().toLowerCase())
    .filter(Boolean);
  if (String(includeMega).toLowerCase() !== "true") tokens.push("mega");
  return links.filter((link) => !tokens.some((token) => String(link.server || "").toLowerCase().includes(token)));
}

function addServerLink(groups, variant, server, rawUrl, baseUrl, quality = null) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return;
  let url;
  try {
    url = new URL(rawUrl.replace(/\\\//g, "/").replace(/&amp;/g, "&"), baseUrl);
    if (!/^https?:$/.test(url.protocol)) return;
  } catch (_) {
    return;
  }
  if (!groups[variant].some((link) => link.url === url.href)) {
    groups[variant].push({ server: server || "Unknown", url: url.href, quality });
  }
}

module.exports = { normalizeVariant, filterServerLinks, addServerLink };
