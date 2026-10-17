const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const axios = require("axios");
const animeflv = require("../src/services/animeflv.service");

function fixture(name) {
  return readFileSync(path.join(__dirname, "fixtures", "animeflv", name), "utf8");
}

function mockHtml(t, html) {
  const requested = [];
  t.mock.method(axios, "get", async (url) => {
    requested.push(url);
    return { data: html };
  });
  return requested;
}

for (const declaration of ["var", "let", "const"]) {
  test(`AnimeFLV combines the complete ${declaration} episode list with only matching HTML links`, async (t) => {
    const requested = mockHtml(t, fixture("info.html").replace("const episodes =", `${declaration} episodes =`));
    const { data } = await animeflv.getAnimeInfo("https://animeflv.net/anime/example-2");

    assert.deepEqual(requested, ["https://animeflv.net/anime/example-2"]);
    assert.deepEqual(data.episodes.map((episode) => episode.number), [0, 1, 1.5, 2, 3, 4]);
    assert.equal(data.totalEpisodes, 6);
    assert.equal(data.episodes.find((episode) => episode.number === 2).id, 102);
    assert.ok(data.episodes.every((episode) => new URL(episode.url).host === "animeflv.net"));
    assert.ok(data.episodes.every((episode) => new URL(episode.url).pathname === `/ver/example-2-${episode.number}`));
  });

  test(`AnimeFLV keeps all SUB/DUB servers from ${declaration} videos`, async (t) => {
    mockHtml(t, fixture("episode.html").replace("const videos =", `${declaration} videos =`));
    const { data } = await animeflv.getEpisodeLinks("https://animeflv.net/ver/example-2-1.5");

    assert.equal(data.episode, 1.5);
    assert.deepEqual(data.streamLinks.SUB.map((link) => link.url), [
      "https://video.example/sub-a", "https://video.example/sub-b", "https://video.example/shared",
    ]);
    assert.deepEqual(data.streamLinks.DUB.map((link) => link.url), [
      "https://video.example/dub-a", "https://video.example/dub-b", "https://video.example/shared",
    ]);
    assert.deepEqual(data.servers.sub, data.streamLinks.SUB);
    assert.deepEqual(data.servers.dub, data.streamLinks.DUB);
    assert.deepEqual(data.variants, { SUB: 1, DUB: 1 });
    assert.equal(data.downloadLinks.SUB[0].url, "https://download.example/sub");
    assert.equal(data.downloadLinks.DUB[0].url, "https://download.example/dub");
  });
}

test("AnimeFLV also filters and sorts episode links when no script list exists", async (t) => {
  mockHtml(t, fixture("info.html").replace(/<script>[\s\S]*?<\/script>/g, ""));
  const { data } = await animeflv.getAnimeInfo("https://animeflv.net/anime/example-2");
  assert.deepEqual(data.episodes.map((episode) => episode.number), [2, 4]);
});

test("AnimeFLV preserves the series slug when starting from a fractional episode URL", async (t) => {
  const requested = mockHtml(t, fixture("info.html"));
  await animeflv.getAnimeInfo("https://animeflv.net/ver/example-2-1.5");
  assert.deepEqual(requested, ["https://animeflv.net/anime/example-2"]);
});

test("AnimeFLV accepts canonical www aliases after a redirect without accepting external hosts", async (t) => {
  const requested = mockHtml(t, `
    <a href="https://www4.animeflv.net/ver/example-1">One</a>
    <a href="https://www.animeflv.net/ver/example-2">Two</a>
    <a href="https://www4.animeflv.net.evil.example/ver/example-3">External</a>
    <a href="https://player.animeflv.net/ver/example-4">Other subdomain</a>
  `);
  const { data } = await animeflv.getAnimeInfo("https://animeflv.net/anime/example");
  assert.deepEqual(requested, ["https://animeflv.net/anime/example"]);
  assert.deepEqual(data.episodes.map((episode) => episode.number), [1, 2]);
  assert.deepEqual(data.episodes.map((episode) => new URL(episode.url).host), ["www4.animeflv.net", "www.animeflv.net"]);
});

test("AnimeFLV still applies explicitly requested server filters", async (t) => {
  mockHtml(t, fixture("episode.html"));
  const { data } = await animeflv.getEpisodeLinks("https://animeflv.net/ver/example-2-1", "true", "subb,duba");
  assert.ok(data.streamLinks.SUB.some((link) => link.server === "Mega"));
  assert.ok(!data.streamLinks.SUB.some((link) => link.server === "Sub B"));
  assert.ok(!data.streamLinks.DUB.some((link) => link.server === "Dub A"));
});
