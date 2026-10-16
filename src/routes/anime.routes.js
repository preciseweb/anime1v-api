const express = require("express");
const { requireApiKey } = require("../middlewares/auth");
const { dailyRateLimit } = require("../middlewares/rate-limit");
const animeService = require("../services/anime.service");
const downloadService = require("../services/download.service");
const { resolveEmbedUrl } = require("../utils/resolvers");
const { isLikelyVideoUrl } = require("../utils/http");
const { ApiError } = require("../utils/api-error");

const router = express.Router();

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

router.get(
  "/image-proxy",
  asyncHandler(async (req, res) => {
    const { url } = req.query;
    if (!url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    try {
      const axios = require("axios");
      const response = await axios.get(url, {
        responseType: "stream",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: new URL(url).origin
        },
        timeout: 10000
      });

      res.setHeader("Content-Type", response.headers["content-type"] || "image/jpeg");
      response.data.pipe(res);
    } catch (err) {
      throw new ApiError(500, "Error al descargar la imagen de portada", err.message);
    }
  })
);

router.use(requireApiKey, dailyRateLimit);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    const response = await animeService.searchAnime(req.query.q, req.query.domain);
    res.status(200).json(response);
  })
);

router.get(
  "/info",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    const response = await animeService.getAnimeInfo(req.query.url);
    res.status(200).json(response);
  })
);

router.get(
  "/episode",
  asyncHandler(async (req, res) => {
    if (!req.query.url) {
      throw new ApiError(400, "Se requiere el parametro url");
    }

    const includeMega = req.query.includeMega !== undefined
      ? String(req.query.includeMega).toLowerCase() === "true"
      : true;

    const response = await animeService.getEpisodeLinks(req.query.url, includeMega, req.query.excludeServers);
    res.status(200).json(response);
  })
);

router.get(
  "/catalog",
  asyncHandler(async (req, res) => {
    const provider = req.query.provider || req.query.domain;
    let service;
    if (provider === "animeflv") {
      service = require("../services/animeflv.service");
    } else if (provider === "jkanime") {
      service = require("../services/jkanime.service");
    } else if (provider === "tioanime") {
      service = require("../services/tioanime.service");
    } else if (provider === "monoschinos") {
      service = require("../services/monoschinos.service");
    } else if (provider === "hentaila") {
      service = require("../services/hentaila.service");
    } else {
      service = require("../services/animeav1.service");
    }

    if (typeof service.getCatalog !== "function") {
      console.log(`[ANIME CATALOG] Selected provider ${provider} does not support getCatalog. Falling back to AnimeAV1.`);
      service = require("../services/animeav1.service");
    }

    const response = await service.getCatalog(req.query.page, req.query.genre);
    
    if (response && response.data && Array.isArray(response.data.results)) {
      response.data.results.forEach(item => {
        if (item.url) item.slug = item.url;
        item.provider = provider || "animeav1";
      });
    }
    
    res.status(200).json(response);
  })
);

router.get(
  "/resolve",
  asyncHandler(async (req, res) => {
    let urls = [];
    if (req.query.urls) {
      try {
        urls = JSON.parse(req.query.urls);
        if (!Array.isArray(urls)) urls = [urls];
      } catch (_e) {
        urls = [req.query.urls];
      }
    } else if (req.query.url) {
      urls = [req.query.url];
    }

    if (urls.length === 0) {
      throw new ApiError(400, "Se requiere el parametro url o urls");
    }

    function isDirectStream(directUrl, originalUrl) {
      if (!directUrl || typeof directUrl !== "string") return false;
      const isEmbedOrPage = /videoembed|\/embed|player\.php|embed\.php|embed-|mega\.nz|mediafire\.com|1fichier\.com|zippyshare\.com|\.html(?:\?|$)/i.test(directUrl);
      if (isEmbedOrPage) {
        return false;
      }
      const hasExt = /\.(?:m3u8|mp4|webm)(?:\?|#|$)/i.test(directUrl);
      if (hasExt) {
        return true;
      }
      if (directUrl !== originalUrl && (directUrl.includes(".m3u8") || directUrl.includes(".mp4") || directUrl.includes("/delivery/"))) {
        return true;
      }
      return false;
    }

    const resolvePromises = urls.map(async (url) => {
      try {
        const directUrl = await resolveEmbedUrl(url);
        if (directUrl && isDirectStream(directUrl, url)) {
          let server = "unknown";
          const lower = (url + " " + directUrl).toLowerCase();
          if (lower.includes("voe")) server = "voe";
          else if (lower.includes("tape")) server = "streamtape";
          else if (lower.includes("wish") || lower.includes("playnix") || lower.includes("medix") || lower.includes("awish") || lower.includes("sfastwish")) server = "streamwish";
          else if (lower.includes("vidhide")) server = "vidhide";
          else if (lower.includes("dood")) server = "doodstream";
          else if (lower.includes("mixdrop") || lower.includes("mxdcontent")) server = "mixdrop";
          else if (lower.includes("yourupload")) server = "yourupload";
          else if (lower.includes("dropload") || lower.includes("dr0p")) server = "dropload";
          else if (lower.includes("mp4upload")) server = "mp4upload";
          else if (lower.includes("filemoon")) server = "filemoon";
          else if (lower.includes("hqq") || lower.includes("waaw") || lower.includes("netu")) server = "hqq";
          else if (lower.includes("pdrain") || lower.includes("pixeldrain")) server = "pixeldrain";
          else if (lower.includes("zilla") || lower.includes("hls")) server = "hls";

          return {
            success: true,
            server,
            mediaType: directUrl.includes(".m3u8") ? "hls" : "mp4",
            streamUrl: directUrl,
            resolvedFrom: url
          };
        }
      } catch (err) {
        console.warn(`[RESOLVE CASCADE] Fallo en ${url}: ${err.message}`);
      }
      throw new Error("No se pudo resolver");
    });

    try {
      // Carrera en paralelo: el primer servidor que resuelva con éxito entrega el OK e interrumpe la espera de los demás
      const fastestResult = await Promise.any(resolvePromises);
      return res.status(200).json(fastestResult);
    } catch (err) {
      throw new ApiError(404, "No se pudo obtener el enlace de streaming directo en ningún servidor");
    }
  })
);

router.post(
  "/download",
  asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = downloadService.createDownload(req.body || {}, baseUrl);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.get(
  "/download/:id",
  asyncHandler(async (req, res) => {
    const data = downloadService.getDownload(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.post(
  "/batch-download",
  asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const data = downloadService.createBatch(req.body || {}, baseUrl);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

router.get(
  "/batch/:id",
  asyncHandler(async (req, res) => {
    const data = downloadService.getBatch(req.params.id);

    res.status(200).json({
      success: true,
      data,
    });
  })
);

module.exports = router;
