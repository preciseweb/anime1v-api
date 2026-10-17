const assert = require("node:assert/strict");
const { test } = require("node:test");
const axios = require("axios");
const service = require("../src/services/monoschinos.service");

test("MonosChinos filters episode links to the selected anime and orders them", async (t) => {
  t.mock.method(axios, "get", async () => ({ headers: {}, data: `<h1>Example 2</h1>
    <a href="/ver/example-2-episodio-3">3</a><a href="/ver/another-episodio-9">related</a>
    <a href="https://monoschinos2.com/ver/example-2-episodio-1">1</a>
    <a href="https://unrelated.example/ver/example-2-episodio-8">8</a>
    <a href="/ver/example-2-ova-episodio-7">ova</a>
    <a href="/ver/example-2-episodio-1">duplicate</a>` }));
  const { data } = await service.getAnimeInfo("https://monoschinos2.com/anime/example-2");
  assert.deepEqual(data.episodes.map((ep) => ep.number), [1, 3]);
  assert.equal(data.totalEpisodes, 2);
});

test("MonosChinos retains matching HTML episodes when AJAX pagination fails halfway", async (t) => {
  t.mock.method(axios, "get", async () => ({ headers: {}, data: `<h1>Example</h1>
    <meta name="csrf-token" content="fixture"><script>const pagination = "https://monoschinos2.com/ajax_pagination/10";</script>
    <a href="/ver/example-episodio-2">2</a><a href="/ver/other-episodio-7">Related</a>` }));
  t.mock.method(axios, "post", async (url) => {
    if (url.endsWith("/ajax_pagination/10")) return { data: { paginate_url: "https://monoschinos2.com/episodes", eps: [1, 2], perpage: 1 } };
    if (url.endsWith("?p=1")) return { data: { caps: [
      { episodio: 1, url: "/ver/example-episodio-1" },
      { episodio: 8, url: "/ver/other-episodio-8" },
    ] } };
    throw new Error("fixture page unavailable");
  });
  const { data } = await service.getAnimeInfo("https://monoschinos2.com/anime/example");
  assert.deepEqual(data.episodes.map((ep) => ep.number), [1, 2]);
});

test("MonosChinos separates SUB/DUB servers and keeps shared URLs in each language", async (t) => {
  const encoded = Buffer.from("https://video.example/shared").toString("base64");
  t.mock.method(axios, "get", async () => ({ headers: {}, data: `<h1>Episode</h1>
    <button class="play-video" data-player="${encoded}" data-language="SUB">Server A</button>
    <div class="tab-pane" id="dub"><button class="play-video" data-player="${encoded}">Server A</button></div>
    <div data-lang="Español"><button class="play-video" data-player="https://video.example/dub-b">Server B</button></div>
    <button class="play-video" data-lang="DUB" data-player="https://video.example/dub-b">Duplicate</button>
    <button class="play-video" data-lang="DUB" data-player="https://mega.nz/file/fixture">Mega</button>` }));
  const { data } = await service.getEpisodeLinks("https://monoschinos2.com/ver/example-episodio-1", "false", "");
  assert.deepEqual(data.servers.sub.map((link) => link.url), ["https://video.example/shared"]);
  assert.deepEqual(data.servers.dub.map((link) => link.url), ["https://video.example/shared", "https://video.example/dub-b"]);
  assert.deepEqual(data.variants, { SUB: 1, DUB: 1 });
  assert.deepEqual(data.servers.dub, data.streamLinks.DUB);
  const filtered = await service.getEpisodeLinks("https://monoschinos2.com/ver/example-episodio-1", "true", "server b");
  assert.ok(filtered.data.servers.dub.some((link) => link.server === "mega"));
  assert.ok(!filtered.data.servers.dub.some((link) => link.server === "server b"));
});

test("MonosChinos recognizes an explicitly dubbed series without inventing SUB servers", async (t) => {
  t.mock.method(axios, "get", async () => ({ headers: {}, data: '<button class="play-video" data-player="https://video.example/dub">VOE</button>' }));
  const { data } = await service.getEpisodeLinks("https://monoschinos2.com/ver/tsubasa-latino-episodio-1");
  assert.deepEqual(data.variants, { SUB: 0, DUB: 1 });
  assert.equal(data.servers.dub.length, 1);
});

test("MonosChinos does not infer dubbing from short language codes inside anime titles", async (t) => {
  t.mock.method(axios, "get", async () => ({ headers: {}, data: `
    <button class="play-video" data-player="https://video.example/sub">VOE</button>
    <button class="play-video" data-lang="es" data-player="https://video.example/dub">VOE</button>` }));
  for (const slug of ["es-otherwise", "aventura-en-otro-mundo"]) {
    const { data } = await service.getEpisodeLinks(`https://monoschinos2.com/ver/${slug}-episodio-1`);
    assert.deepEqual(data.servers.sub.map((link) => link.url), ["https://video.example/sub"]);
    assert.deepEqual(data.servers.dub.map((link) => link.url), ["https://video.example/dub"]);
  }
});

test("MonosChinos rejects invalid player text while preserving absolute and explicit relative links", async (t) => {
  const urls = ["https://video.example/https", "http://video.example/http", "//video.example/protocol-relative",
    "/player/root", "./player/current", "../player/parent"];
  const values = [...urls, ...urls.map((url) => Buffer.from(url).toString("base64")),
    "not-a-url", Buffer.from("not-a-url").toString("base64"), Buffer.from("javascript:alert(1)").toString("base64")];
  t.mock.method(axios, "get", async () => ({ headers: {}, data: values.map((value) =>
    `<button class="play-video" data-player="${value}">VOE</button>`).join("") }));
  const episodeUrl = "https://monoschinos2.com/ver/example-episodio-1";
  const { data } = await service.getEpisodeLinks(episodeUrl);
  assert.deepEqual(data.servers.sub.map((link) => link.url), urls.map((url) => new URL(url, episodeUrl).href));
  assert.deepEqual(data.servers.dub, []);
});
