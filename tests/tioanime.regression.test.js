const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");
const service = require("../src/services/tioanime.service");

test("TioAnime keeps numbered series slugs and excludes recommendations from episode lists", async (t) => {
  const urls = [];
  t.mock.method(axios, "get", async (url) => {
    urls.push(url);
    return { data: `<h1 class="title">Example 2</h1>
      <a href="/ver/example-2-3">3</a><a href="/ver/another-20">20</a>
      <a href="/ver/example-2-special-4">special</a>
      <a href="https://tioanime.com/ver/example-2-1">1</a>
      <a href="https://unrelated.example/ver/example-2-9">9</a>
      <a href="/ver/example-2-0">0</a><a href="/ver/example-2-1.5">1.5</a>
      <a href="/ver/example-2-1">duplicate</a>` };
  });
  const { data } = await service.getAnimeInfo("https://tioanime.com/anime/example-2");
  assert.deepEqual(urls, ["https://tioanime.com/anime/example-2"]);
  assert.deepEqual(data.episodes.map((ep) => ep.number), [0, 1, 1.5, 3]);
  assert.ok(data.episodes.every((ep) => ep.url === `https://tioanime.com/ver/example-2-${ep.number}`));
});

test("TioAnime preserves the complete script episode list", async (t) => {
  t.mock.method(axios, "get", async () => ({ data: '<h1>Example</h1><script>var episodes = [3, "2", 1, 0];</script><a href="/ver/other-99">Related</a>' }));
  const { data } = await service.getAnimeInfo("https://tioanime.com/anime/example");
  assert.deepEqual(data.episodes.map((ep) => ep.number), [0, 1, 2, 3]);
});

test("TioAnime separates explicitly labeled server variants without guessing unknown languages", async (t) => {
  t.mock.method(axios, "get", async () => ({ data: `<script>const videos = {
    SUB: [["Server A", "https://video.example/sub"], ["Server B", "//video.example/sub-b"]],
    LAT: [["Server A", "https://video.example/dub"], ["Server A", "https://video.example/dub"]],
    DUB: [{server: "Server C", url: "https://video.example/dub-c"}],
    unknown: [["Server D", "https://video.example/unknown"]]
  };</script>` }));
  const { data } = await service.getEpisodeLinks("https://tioanime.com/ver/example-2-1");
  assert.deepEqual(data.servers.sub.map((link) => link.url), [
    "https://video.example/sub", "https://video.example/sub-b", "https://video.example/unknown",
  ]);
  assert.deepEqual(data.servers.dub.map((link) => link.url), ["https://video.example/dub", "https://video.example/dub-c"]);
  assert.deepEqual(data.variants, { SUB: 1, DUB: 1 });
});

test("TioAnime preserves legacy video tuples and honors optional language and server filters", async (t) => {
  t.mock.method(axios, "get", async () => ({ data: `<script>var videos = [
    ["YourUpload", "https://video.example/sub", 0],
    ["VOE", "https://video.example/dub", "Español"],
    ["Mega", "https://mega.nz/file/example", "DUB"]
  ];</script>` }));
  const { data } = await service.getEpisodeLinks("https://tioanime.com/ver/example-1", "false", "yourupload");
  assert.deepEqual(data.servers.sub, []);
  assert.deepEqual(data.servers.dub, [{ server: "VOE", url: "https://video.example/dub" }]);
});
