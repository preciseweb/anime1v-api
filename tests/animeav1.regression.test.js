const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");
const animeav1 = require("../src/services/animeav1.service");

const animeUrl = "https://animeav1.com/media/selected-anime";
const episodeUrl = `${animeUrl}/2`;

function serveData(t, data, extraHtml = "") {
  const html = `<html><script>__sveltekit_fixture = {data:${JSON.stringify(data)}};</script>${extraHtml}</html>`;
  return t.mock.method(axios, "get", async () => ({ data: html }));
}

function urls(links) {
  return links.map((link) => link.url);
}

test("info selects the requested anime instead of richer related media", async (t) => {
  serveData(t, [
    { recommendations: [{ media: { id: 999, slug: "other-anime", title: "Other", description: "Rich", genres: ["Drama"], poster: "/other.jpg", episodes: [{ number: 50 }] } }] },
    { data: { media: { slug: "selected-anime", title: "Selected", episodes: [{ number: 1 }] } } },
  ]);
  const result = await animeav1.getAnimeInfo(animeUrl);
  assert.equal(result.data.title, "Selected");
  assert.deepEqual(Array.from(result.data.episodes, ({ number, url }) => ({ number, url })), [{ number: 1, url: `${animeUrl}/1` }]);
});

test("info rejects a page containing only a different anime", async (t) => {
  serveData(t, [{ media: { slug: "other-anime", title: "Other", episodes: [{ number: 1 }] } }]);
  await assert.rejects(animeav1.getAnimeInfo(animeUrl), /No se encontro informacion del anime/);
});

test("episodes use actual numbers, validate ownership, and deduplicate the same episode", async (t) => {
  serveData(t, [{ media: {
    id: 7, slug: "selected-anime", title: "Selected", episodes: [
      { id: 100, number: 0 },
      { id: 101, number: null, episode: 1 },
      { id: 102, number: "", url: `${animeUrl}/2` },
      { id: 103, number: 2, url: `${animeUrl}/2?variant=SUB` },
      { number: null, episode: "", title: "Unknown number" },
      { number: 3, url: "https://animeav1.com/media/other-anime/3" },
      { number: 4, mediaId: 999 },
      { number: 5, media: { slug: "other-anime" } },
      { number: 6, url: `${animeUrl}/7` },
      { number: 8, url: "https://different.example/media/selected-anime/8" },
    ],
  } }]);
  const { data } = await animeav1.getAnimeInfo(animeUrl);
  assert.deepEqual(Array.from(data.episodes, ({ number, url }) => ({ number, url })), [
    { number: 0, url: `${animeUrl}/0` },
    { number: 1, url: `${animeUrl}/1` },
    { number: 2, url: `${animeUrl}/2` },
  ]);
});

test("media URL identity works without a slug and preserves episodeList", async (t) => {
  serveData(t, [{ data: { media: { url: animeUrl, title: "Selected", episodeList: [{ ep: "2" }] } } }]);
  const { data } = await animeav1.getAnimeInfo(animeUrl);
  assert.equal(data.episodes[0].url, episodeUrl);
});

test("episode links come only from the requested episode and keep DUB-only availability", async (t) => {
  const wanted = "https://player.zilla.example/play/selected-dub";
  serveData(t, [
    { media: { slug: "other-anime" }, episode: { number: 2, title: "Other" }, streamLinks: { SUB: ["https://mp4upload.com/embed-other.html"] } },
    { data: {
      media: { slug: "selected-anime" },
      episode: { number: 2, title: "Selected episode", streamLinks: { DUB: [{ server: "HLS", url: wanted }] } },
      recommendations: [{ episode: { number: 2, streamLinks: { SUB: ["https://mp4upload.com/embed-related.html"] } } }],
      episodes: [{ number: 3, streamLinks: { SUB: ["https://mp4upload.com/embed-next.html"] } }],
    } },
  ], '<a href="https://pixeldrain.com/u/unrelated">Unrelated</a>');
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.equal(data.title, "Selected episode");
  assert.deepEqual(data.variants, { SUB: 0, DUB: 1 });
  assert.deepEqual(urls(data.streamLinks.DUB), [wanted]);
  assert.deepEqual(data.streamLinks.SUB, []);
  assert.deepEqual(data.downloadLinks.SUB, []);
});

test("all explicit SUB/DUB server shapes survive without reclassifying streams as downloads", async (t) => {
  const sub = "https://cdn.example/sub.mp4";
  const dub = "https://cdn.example/dub.mp4";
  const dubTwo = "https://mp4upload.com/embed-dub-two.html";
  const subDownload = "https://pixeldrain.com/u/download-sub";
  const dubDownload = "https://1fichier.com/?download-dub";
  serveData(t, [{ data: {
    media: { slug: "selected-anime" },
    episode: { number: 2, servers: [{ variant: "SUB", server: "Direct", url: sub }, { variant: "DUB", server: "Direct", url: dub }] },
    streamLinks: { SUB: { server: "Direct", url: sub }, DUB: { MP4Upload: dubTwo } },
    downloadLinks: { SUB: [{ url: subDownload, quality: "1080p" }], DUB: { url: dubDownload, quality: "720p" } },
  } }]);
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(urls(data.streamLinks.SUB), [sub]);
  assert.deepEqual(urls(data.streamLinks.DUB), [dub, dubTwo]);
  assert.deepEqual(urls(data.downloadLinks.SUB), [subDownload]);
  assert.deepEqual(urls(data.downloadLinks.DUB), [dubDownload]);
  assert.equal(data.downloadLinks.DUB[0].quality, "720p");
  assert.deepEqual(data.servers, { sub: data.streamLinks.SUB, dub: data.streamLinks.DUB });
});

test("nested variant containers and page-level links preserve their explicit language", async (t) => {
  serveData(t, [{ data: { variants: {
    SUB: { servers: { MP4Upload: "https://mp4upload.com/embed-sub.html" } },
    DUB: { streamLinks: [{ url: "https://cdn.example/dub.mp4" }], downloadLinks: ["https://pixeldrain.com/u/dub"] },
  } } }]);
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(urls(data.streamLinks.SUB), ["https://mp4upload.com/embed-sub.html"]);
  assert.deepEqual(urls(data.streamLinks.DUB), ["https://cdn.example/dub.mp4"]);
  assert.deepEqual(urls(data.downloadLinks.DUB), ["https://pixeldrain.com/u/dub"]);
});

test("an unrelated episode cannot supply page-level or raw HTML fallback links", async (t) => {
  serveData(t, [{ data: { episode: { number: 9 }, streamLinks: { SUB: ["https://mp4upload.com/embed-wrong.html"] } } }],
    '<div id="player"><iframe src="https://mp4upload.com/embed-wrong.html"></iframe></div>');
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.equal(data.episode, 2);
  assert.deepEqual(data.variants, { SUB: 0, DUB: 0 });
});

test("the matching episode can be selected inside its media episode list", async (t) => {
  serveData(t, [{ media: { slug: "selected-anime", episodes: [
    { number: 1, streamLinks: { SUB: ["https://mp4upload.com/embed-first.html"] } },
    { number: 2, streamLinks: { SUB: ["https://mp4upload.com/embed-second.html"] } },
  ] } }]);
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(urls(data.streamLinks.SUB), ["https://mp4upload.com/embed-second.html"]);
});

test("episode zero is preserved and relative URLs are normalized for HTTP", async (t) => {
  const request = serveData(t, [{ episode: { number: 0, servers: { SUB: ["https://cdn.example/zero.mp4"] } } }]);
  const { data } = await animeav1.getEpisodeLinks("/media/selected-anime/0");
  assert.equal(request.mock.calls[0].arguments[0], `${animeUrl}/0`);
  assert.equal(data.episode, 0);
  assert.equal(data.title, "Episodio 0");
});

test("server filters apply to both variants and unknown languages never become DUB", async (t) => {
  serveData(t, [{ episode: { number: 2, servers: [
    { variant: "SUB", server: "Mega", url: "https://mega.nz/file/sub" },
    { variant: "DUB", server: "Mega", url: "https://mega.nz/file/dub" },
    { variant: "DUB", server: "MP4Upload", url: "https://mp4upload.com/embed-dub.html" },
    { variant: "unknown", server: "Other", url: "https://cdn.example/unknown.mp4" },
  ] } }]);
  const excluded = await animeav1.getEpisodeLinks(episodeUrl, false, "mp4upload");
  assert.deepEqual(excluded.data.variants, { SUB: 0, DUB: 0 });
  const included = await animeav1.getEpisodeLinks(episodeUrl, true, "mp4upload");
  assert.deepEqual(urls(included.data.streamLinks.SUB), ["https://mega.nz/file/sub"]);
  assert.deepEqual(urls(included.data.streamLinks.DUB), ["https://mega.nz/file/dub"]);
});

test("HTML-only fallback respects explicit language and ignores related player links", async (t) => {
  t.mock.method(axios, "get", async () => ({ data: `<html>
    <aside class="related"><div class="player"><iframe src="https://mp4upload.com/embed-other.html"></iframe></div></aside>
    <div id="player" data-variant="DUB"><iframe src="https://mp4upload.com/embed-dub.html"></iframe></div>
    <div class="downloads" data-variant="DUB"><a href="https://pixeldrain.com/u/dub">Download</a></div>
    <div class="player" data-variant="unknown"><iframe src="https://mp4upload.com/embed-unknown.html"></iframe></div>
  </html>` }));
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(data.variants, { SUB: 0, DUB: 1 });
  assert.deepEqual(urls(data.streamLinks.DUB), ["https://mp4upload.com/embed-dub.html"]);
  assert.deepEqual(urls(data.downloadLinks.DUB), ["https://pixeldrain.com/u/dub"]);
});

test("matching structured data can supplement servers from explicitly labeled player markup", async (t) => {
  const sub = "https://mp4upload.com/embed-sub.html";
  const dub = "https://mp4upload.com/embed-dub.html";
  serveData(t, [{ data: {
    media: { slug: "selected-anime" },
    episode: { number: 2, streamLinks: { SUB: [sub] } },
  } }], `<div id="player" data-language="DUB"><iframe src="${dub}"></iframe></div>`);
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(urls(data.streamLinks.SUB), [sub]);
  assert.deepEqual(urls(data.streamLinks.DUB), [dub]);
});

test("unlabeled markup does not relabel structured DUB servers as SUB", async (t) => {
  const dub = "https://mp4upload.com/embed-dub.html";
  serveData(t, [{ episode: { number: 2, streamLinks: { DUB: [dub] } } }],
    `<div id="player"><iframe src="${dub}"></iframe></div>`);
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(data.variants, { SUB: 0, DUB: 1 });
  assert.deepEqual(urls(data.streamLinks.DUB), [dub]);
});

test("episode ownership mismatch also rejects sibling links and HTML fallback", async (t) => {
  serveData(t, [{ data: {
    media: { id: 7, slug: "selected-anime" },
    episode: { number: 2, mediaId: 99 },
    streamLinks: { DUB: ["https://mp4upload.com/embed-wrong.html"] },
  } }], '<div id="player" data-variant="DUB"><iframe src="https://mp4upload.com/embed-wrong.html"></iframe></div>');
  const { data } = await animeav1.getEpisodeLinks(episodeUrl);
  assert.deepEqual(data.variants, { SUB: 0, DUB: 0 });
});
