const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const axios = require("axios");
const jkanime = require("../src/services/jkanime.service");

function fixture(name) {
  return readFileSync(path.join(__dirname, "fixtures", "jkanime", name), "utf8");
}

function mockHtml(t, html) {
  const requested = [];
  t.mock.method(axios, "get", async (url) => {
    requested.push(url);
    return { data: html };
  });
  return requested;
}

test("JKAnime keeps only exact anime/host episode links across all containers", async (t) => {
  const requested = mockHtml(t, fixture("info.html"));
  const { data } = await jkanime.getAnimeInfo("https://jkanime.net/example/");

  assert.deepEqual(requested, ["https://jkanime.net/example/"]);
  assert.deepEqual(data.episodes.map((episode) => episode.number), [0, 1, 1.5, 2, 3]);
  assert.equal(data.totalEpisodes, 5);
  assert.ok(data.episodes.every((episode) => new URL(episode.url).host === "jkanime.net"));
  assert.ok(data.episodes.every((episode) => new URL(episode.url).pathname === `/example/${episode.number}/`));
});

test("JKAnime does not accept a matching slug embedded in another path", async (t) => {
  mockHtml(t, '<a href="https://other.example/example/8/">Wrong host</a><a href="/other/example/9/">Wrong path</a>');
  const { data } = await jkanime.getAnimeInfo("https://jkanime.net/example/");
  assert.deepEqual(data.episodes, []);
});

test("JKAnime accepts canonical www aliases after a redirect without accepting external hosts", async (t) => {
  const requested = mockHtml(t, `
    <a href="https://www4.jkanime.net/example/1/">One</a>
    <a href="https://www.jkanime.net/example/2/">Two</a>
    <a href="https://www4.jkanime.net.evil.example/example/3/">External</a>
    <a href="https://player.jkanime.net/example/4/">Other subdomain</a>
  `);
  const { data } = await jkanime.getAnimeInfo("https://jkanime.net/example/");
  assert.deepEqual(requested, ["https://jkanime.net/example/"]);
  assert.deepEqual(data.episodes.map((episode) => episode.number), [1, 2]);
  assert.deepEqual(data.episodes.map((episode) => new URL(episode.url).host), ["www4.jkanime.net", "www.jkanime.net"]);
});

for (const declaration of ["var", "let", "const"]) {
  test(`JKAnime retains every variant and download from ${declaration} servers`, async (t) => {
    mockHtml(t, fixture("episode.html")
      .replace("const servers =", `${declaration} servers =`)
      .replace("const remote =", `${declaration} remote =`));
    const { data } = await jkanime.getEpisodeLinks("https://jkanime.net/example/1/");

    assert.deepEqual(data.streamLinks.SUB.map((link) => link.url), [
      "https://video.example/sub-a", "https://video.example/sub-b", "https://video.example/shared", "https://player.example/embed",
    ]);
    assert.deepEqual(data.streamLinks.DUB.map((link) => link.url), [
      "https://video.example/dub-a", "https://video.example/dub-b", "https://video.example/shared",
    ]);
    assert.deepEqual(data.servers.sub, data.streamLinks.SUB);
    assert.deepEqual(data.servers.dub, data.streamLinks.DUB);
    assert.deepEqual(data.variants, { SUB: 1, DUB: 1 });
    assert.deepEqual(data.downloadLinks.SUB.map((link) => link.url), [
      "https://download.example/d/sub-a/", "https://download.example/d/sub-b/", "https://download.example/d/shared/",
    ]);
    assert.deepEqual(data.downloadLinks.DUB.map((link) => link.url), [
      "https://download.example/d/dub-a/", "https://download.example/d/dub-b/", "https://download.example/d/shared/",
    ]);
  });
}

test("JKAnime retains the explicit Mega and excluded-server behavior", async (t) => {
  mockHtml(t, fixture("episode.html"));
  const { data } = await jkanime.getEpisodeLinks("https://jkanime.net/example/1/", "true", "subb,duba");
  assert.ok(data.streamLinks.SUB.some((link) => link.server === "Mega"));
  assert.ok(!data.streamLinks.SUB.some((link) => link.server === "Sub B"));
  assert.ok(!data.streamLinks.DUB.some((link) => link.server === "Dub A"));
});
