const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");
const hentaila = require("../src/services/hentaila.service");

// Encode fixtures using SvelteKit's devalue reference-table format, including
// nested arrays, primitive numbers, and shared object references.
function node(value) {
  const values = [];
  const seen = new Map();
  function encode(item) {
    if (seen.has(item)) return seen.get(item);
    const index = values.length;
    seen.set(item, index);
    values.push(null);
    values[index] = item && typeof item === "object"
      ? (Array.isArray(item) ? item.map(encode) : Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, encode(entry)])))
      : item;
    return index;
  }
  encode(value);
  return { type: "data", data: values };
}

function mockNodes(t, ...nodes) {
  const requested = [];
  t.mock.method(axios, "get", async (url) => {
    requested.push(url);
    return { data: { nodes: nodes.map((value) => value === null ? null : node(value)) } };
  });
  return requested;
}

const link = (server, url = server.toLowerCase()) => ({ server, url: `https://video.example/${url}` });

test("HentaiLA finds the exact media after layout data and keeps zero, fractional, and ID-less episodes", async (t) => {
  const requested = mockNodes(t,
    { media: { slug: "other", title: "Other", episodes: [{ number: 99 }] } },
    null,
    { recommendations: [{ slug: "example-2", title: "Recommendation", episodes: [{ number: 80 }] }] },
    { data: { media: {
      id: 12, slug: "example-2", title: "Example 2", category: { name: "OVA" },
      genres: [{ id: 8, name: "Comedy", slug: "comedy" }],
      episodes: [
        { number: 2, id: 20 }, { number: 0, id: 0 }, { number: 1.5 }, { number: "1" },
        { number: 2, id: 20 }, { number: 7, media: { slug: "other" } },
        { number: 8, mediaId: 99 }, { number: 9, url: "/media/other/9" },
        { number: 10, url: "http://[invalid" }, { number: "invalid" },
      ],
    } } });
  const { data } = await hentaila.getAnimeInfo("https://hentaila.com/media/example-2");
  assert.deepEqual(requested, ["https://hentaila.com/media/example-2/__data.json"]);
  assert.equal(data.title, "Example 2");
  assert.equal(data.type, "OVA");
  assert.deepEqual(data.genres, [{ id: 8, name: "Comedy", slug: "comedy", malId: null }]);
  assert.deepEqual(data.episodes.map((episode) => episode.number), [0, 1, 1.5, 2]);
  assert.deepEqual(data.episodes.map((episode) => episode.id), [0, null, null, 20]);
  assert.ok(data.episodes.every((episode) => episode.url === `https://hentaila.com/media/example-2/${episode.number}`));
});

for (const path of ["/media/example-2/1", "/ver/example-2-1", "/media/example-2/__data.json"]) {
  test(`HentaiLA preserves the anime slug when getting details from ${path}`, async (t) => {
    const requested = mockNodes(t, { media: { slug: "example-2", title: "Example 2", episodes: [0, 1] } });
    const { data } = await hentaila.getAnimeInfo(`https://hentaila.com${path}`);
    assert.deepEqual(requested, ["https://hentaila.com/media/example-2/__data.json"]);
    assert.deepEqual(data.episodes.map((episode) => episode.number), [0, 1]);
  });
}

test("HentaiLA rejects a response belonging to another anime or recommendations only", async (t) => {
  mockNodes(t, { media: { slug: "other", title: "Other", episodes: [{ number: 1 }] },
    recommendations: [{ slug: "example", title: "Example", episodes: [{ number: 99 }] }] });
  await assert.rejects(hentaila.getAnimeInfo("https://hentaila.com/media/example"), /Anime no encontrado/);
});

for (const path of ["/media/example-2/1.5", "/ver/example-2-1.5"]) {
  test(`HentaiLA resolves every nested SUB/DUB stream and download for ${path}`, async (t) => {
    const shared = link("Shared");
    const requested = mockNodes(t,
      { embeds: { SUB: [link("Layout")] } },
      { data: { episode: {
        number: 1.5, media: { slug: "example-2" }, title: "Special",
        embeds: { SUB: [link("SubA"), shared, shared], LAT: [link("DubA"), shared],
          extra: [Object.assign(link("DubB"), { language: "Español" })] },
        downloads: { sub: [{ ...link("SubDownload"), quality: "720p" }],
          DUB: [{ ...link("DubDownload"), quality: "1080p" }] },
      } } },
      { episode: { number: 1.5, media: { slug: "other" }, embeds: { DUB: [link("WrongAnime")] } } },
      { episode: { number: 2, media: { slug: "example-2" }, embeds: { SUB: [link("WrongEpisode")] } } });
    const { data } = await hentaila.getEpisodeLinks(`https://hentaila.com${path}`);
    assert.deepEqual(requested, ["https://hentaila.com/media/example-2/1.5/__data.json"]);
    assert.equal(data.episode, 1.5);
    assert.equal(data.title, "Special");
    assert.deepEqual(data.streamLinks.SUB.map((entry) => entry.server), ["SubA", "Shared"]);
    assert.deepEqual(data.streamLinks.DUB.map((entry) => entry.server), ["DubA", "Shared", "DubB"]);
    assert.deepEqual(data.downloadLinks.SUB.map((entry) => entry.quality), ["720p"]);
    assert.deepEqual(data.downloadLinks.DUB.map((entry) => entry.quality), ["1080p"]);
    assert.deepEqual(data.servers.sub, data.streamLinks.SUB);
    assert.deepEqual(data.servers.dub, data.streamLinks.DUB);
    assert.deepEqual(data.variants, { SUB: 1, DUB: 1 });
  });
}

test("HentaiLA accepts episode zero and separate download data without merging generic layout streams", async (t) => {
  mockNodes(t,
    { embeds: { SUB: [link("Layout")] } },
    { episode: { number: 0, media: { slug: "example" }, embeds: { DUB: [link("Dub")] } } },
    { downloads: { DUB: [link("Download")] } });
  const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/example/0");
  assert.equal(data.episode, 0);
  assert.deepEqual(data.streamLinks.SUB, []);
  assert.deepEqual(data.streamLinks.DUB.map((entry) => entry.server), ["Dub"]);
  assert.deepEqual(data.downloadLinks.DUB.map((entry) => entry.server), ["Download"]);
});

test("HentaiLA chooses the route's deepest anonymous embeds and supports filters", async (t) => {
  mockNodes(t,
    { embeds: { SUB: [link("Layout")] } },
    { data: { embeds: { DUB: [link("Dub"), link("Mega"), link("Excluded")] } } });
  const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/example/1", "true", "Excluded");
  assert.deepEqual(data.streamLinks.SUB, []);
  assert.deepEqual(data.streamLinks.DUB.map((entry) => entry.server), ["Dub", "Mega"]);
});

test("HentaiLA returns no servers from explicitly mismatched episode data", async (t) => {
  mockNodes(t, { embeds: { SUB: [link("Layout")] } },
    { episode: { media: { slug: "example" }, number: 3, embeds: { SUB: [link("Wrong")] } } });
  const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/example/1");
  assert.deepEqual(data.streamLinks, { SUB: [], DUB: [] });
  assert.deepEqual(data.variants, { SUB: 0, DUB: 0 });
});

test("HentaiLA rejects a detail URL as an episode instead of truncating its numeric slug", async (t) => {
  const requested = mockNodes(t);
  await assert.rejects(hentaila.getEpisodeLinks("https://hentaila.com/media/example-2"), /URL invalida/);
  assert.deepEqual(requested, []);
});

test("HentaiLA preserves complementary parent SUB and nested episode DUB groups", async (t) => {
  mockNodes(t, { embeds: { SUB: [link("Layout")] } }, {
    media: { slug: "chosen" },
    embeds: { SUB: [link("Sub")] },
    downloads: { SUB: [link("SubDownload")] },
    data: { episode: { number: 1,
      embeds: { DUB: [link("Dub")] }, downloads: { DUB: [link("DubDownload")] },
    } },
  });
  const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/chosen/1");
  assert.deepEqual(data.streamLinks.SUB.map((entry) => entry.server), ["Sub"]);
  assert.deepEqual(data.streamLinks.DUB.map((entry) => entry.server), ["Dub"]);
  assert.deepEqual(data.downloadLinks.SUB.map((entry) => entry.server), ["SubDownload"]);
  assert.deepEqual(data.downloadLinks.DUB.map((entry) => entry.server), ["DubDownload"]);
});

for (const nested of [false, true]) {
  test(`HentaiLA rejects inconsistent episode ownership without recovering wrapper or layout links (nested=${nested})`, async (t) => {
    const episode = { number: 1, mediaId: 2, embeds: { SUB: [link("WrongOwner")] } };
    mockNodes(t, { embeds: { SUB: [link("Layout")] } }, {
      media: { id: 1, slug: "chosen" },
      embeds: { DUB: [link("Wrapper")] },
      ...(nested ? { data: { episode } } : { episode }),
    });
    const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/chosen/1");
    assert.deepEqual(data.streamLinks, { SUB: [], DUB: [] });
    assert.deepEqual(data.downloadLinks, { SUB: [], DUB: [] });
  });
}

test("HentaiLA validates episode mediaId against the identified media in a preceding node", async (t) => {
  mockNodes(t, { media: { id: 1, slug: "chosen" } },
    { episode: { number: 1, mediaId: 2, embeds: { SUB: [link("WrongOwner")] } } });
  const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/chosen/1");
  assert.deepEqual(data.streamLinks, { SUB: [], DUB: [] });
});

test("HentaiLA preserves valid zero media IDs and string episode ownership IDs", async (t) => {
  mockNodes(t, { media: { id: 0, slug: "chosen" }, data: {
    episode: { number: 1, mediaId: "0", embeds: { DUB: [link("Dub")] } },
  } });
  const { data } = await hentaila.getEpisodeLinks("https://hentaila.com/media/chosen/1");
  assert.deepEqual(data.streamLinks.DUB.map((entry) => entry.server), ["Dub"]);
});
